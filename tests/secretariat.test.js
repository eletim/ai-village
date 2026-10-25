import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VillageLibrary } from '../server/library.mjs';
import { Secretariat } from '../server/secretariat.mjs';
const markdown=(host='host-one',description='調査済みの説明')=>`---\nname: 試験工房\nssh_host: ${host}\npurplemux_url: http://workshop.example:8022/\nwork_root: /work/village\n---\n# 試験工房\n${description}\n`;
async function setup(choices=[]) {
  const dir=await mkdtemp(join(tmpdir(),'village-chat-'));const root=join(dir,'library');await mkdir(root);await writeFile(join(root,'README.md'),'# 村の資料\n');await writeFile(join(root,'workshop.md'),markdown());
  const calls=[];const bridge={dir,jobs:[],job:null,snapshot(){return {job:this.job,jobs:this.jobs};},async submit(request,connection,instruction){calls.push({request,connection,instruction});this.job={id:'new-job',request,connection,phase:'working'};this.jobs.push(this.job);},async remote(){calls.push('ssh');throw new Error('SSH unavailable');}};
  const library=new VillageLibrary(root);const secretary=new Secretariat(bridge,library);
  secretary.decide=async()=>{const choice=choices.shift();if(!choice)throw new Error('missing choice');return choice;};await secretary.init();
  return {dir,root,library,bridge,secretary,calls};
}
const choice=(action,message='',document='',task='')=>({action,message,document,task});
async function send(secretary,message){await secretary.send(message);await secretary.running;}

test('local replies, fresh document reads and state inspection do not SSH or allocate a job',async()=>{
  const {secretary,calls}=await setup([choice('reply','こんにちは'),choice('read_document','','workshop.md'),choice('read_state'),choice('reply','資料に基づいて説明します')]);
  await send(secretary,'こんにちは');await send(secretary,'工房と仕事の状況を知りたい');assert.deepEqual(calls,[]);assert.equal(secretary.messages.filter(m=>m.role==='assistant').length,2);
});
test('conversation is restored with proposal context; agreed task uses the latest document connection',async()=>{
  const {secretary,bridge,library,root,calls}=await setup([choice('reply','小さな手紙を作りましょう')]);await send(secretary,'どんなものがよい？');
  await writeFile(join(root,'workshop.md'),markdown('host-updated','更新後の説明'));
  const restored=new Secretariat(bridge,library);await restored.init();assert.equal(restored.messages[1].content,'小さな手紙を作りましょう');
  const choices=[choice('read_document','','workshop.md'),choice('dispatch','合意した手紙を作ります','workshop.md','手紙を作って報告してください')];restored.decide=async()=>choices.shift();
  await send(restored,'それで進めて');assert.equal(calls.length,1);assert.equal(calls[0].connection.sshHost,'host-updated');assert.equal(calls[0].instruction,'手紙を作って報告してください');assert.ok(calls[0].connection.documentHash);
});
test('dispatch requires a document actually read this turn, and changed documents require a new read',async()=>{
  const {secretary,root,calls}=await setup();let step=0;
  secretary.decide=async()=>{
    step++;
    if(step===1)return choice('dispatch','開始','workshop.md','作る');
    if(step===2)return choice('read_document','','workshop.md');
    if(step===3){await writeFile(join(root,'workshop.md'),markdown('host-two'));return choice('dispatch','開始','workshop.md','作る');}
    return choice('reply','資料が更新されたので改めて確認します');
  };
  await send(secretary,'作って');assert.deepEqual(calls,[]);assert.equal(secretary.messages.filter(m=>m.role==='tool'&&m.content.includes('最新')).length,2);
});
test('SSH inspection failure is a tool result; conversation and documents remain available',async()=>{
  const {secretary,calls,bridge}=await setup([choice('read_document','','workshop.md'),choice('check_workshop','','workshop.md'),choice('reply','接続できず、現在値は未確認です'),choice('reply','こんにちは')]);
  await send(secretary,'現在の工房を確認して');assert.equal(calls.filter(c=>c==='ssh').length,2);assert.equal(bridge.jobs.length,0);assert.ok(secretary.messages.some(m=>m.role==='tool'&&m.content.includes('原因を特定できないエラー')));await send(secretary,'こんにちは');assert.equal(secretary.messages.at(-1).content,'こんにちは');
});
test('a held job never blocks conversation; rejected dispatch does not repeat or create a report',async()=>{
  const {secretary,bridge}=await setup([choice('read_document','','workshop.md'),choice('dispatch','進める','workshop.md','作る'),choice('dispatch','再実行','workshop.md','作る'),choice('reply','前の報告の確認が必要です'),choice('reply','相談しましょう')]);let attempts=0;bridge.submit=async()=>{attempts++;throw new Error('確認待ち');};
  await send(secretary,'作って');await send(secretary,'相談したい');assert.equal(attempts,1);assert.equal(bridge.jobs.length,0);assert.equal(secretary.messages.at(-1).content,'相談しましょう');
});
test('report arrival is added once, persisted, and interrupted decisions are never redispatched',async()=>{
  const {secretary,bridge,library,dir}=await setup();const job={id:'delivered-job',report:'工房からの報告です'};bridge.jobs=[job];await secretary.receiveReport(job);await secretary.receiveReport(job);assert.equal(secretary.messages.length,1);
  secretary.status='thinking';await secretary.persist();const restored=new Secretariat(bridge,library);await restored.init();assert.equal(restored.status,'idle');assert.equal(restored.messages.filter(m=>m.kind==='report').length,1);assert.ok(restored.messages.some(m=>m.interrupted));
  assert.equal(JSON.parse(await readFile(join(dir,'conversation.json'),'utf8')).knownReports[0],job.id);
});
test('Markdown is the single source, re-read without caching, with path and symlink boundaries',async()=>{
  const {library,root,dir}=await setup();assert.equal((await library.workshop('workshop.md')).sshHost,'host-one');
  await writeFile(join(root,'workshop.md'),markdown('host-two','更新テスト'));assert.equal((await library.workshop('workshop.md')).sshHost,'host-two');assert.match((await library.read('workshop.md')).content,/更新テスト/);
  await writeFile(join(dir,'outside.md'),'secret');await symlink(join(dir,'outside.md'),join(root,'link.md'));await assert.rejects(library.read('link.md'),/範囲外/);await assert.rejects(library.read('../outside.md'),/範囲外/);await assert.rejects(library.read('not-json.json'),/Markdown/);
});

test('persistent Codex session receives only new input and latest observation, including after restart',async()=>{
  const {secretary,bridge,library,dir}=await setup();delete secretary.decide;
  secretary.add('tool','OLD_CODE'.repeat(180000));secretary.add('assistant','OLD_ERROR'.repeat(150000),{kind:'error'});
  const turn=secretary.add('user','短い相談');const calls=[];
  const capture=async(_bin,args,{input})=>{calls.push({args,input});await writeFile(args[args.indexOf('-o')+1],JSON.stringify({action:'reply',message:'返答',document:'',task:'',argv:[],attachments:[]}));return JSON.stringify({type:'thread.started',thread_id:'persistent-test'});};
  secretary.runCodex=capture;await secretary.decide(turn,[],0);
  assert.ok(calls[0].input.length<4000);assert.ok(!calls[0].input.includes('OLD_CODE'));assert.ok(!calls[0].args.includes('--ephemeral'));assert.ok(!calls[0].args.includes('resume'));
  secretary.add('tool','ALREADY_READ'.repeat(100000));
  await secretary.decide(turn,[{result:'ALREADY_READ'.repeat(100000)},{result:{value:'latest-only'}}],1);
  assert.ok(calls[1].args.includes('resume'));assert.ok(calls[1].args.includes('persistent-test'));assert.ok(calls[1].input.length<500);assert.ok(!calls[1].input.includes('ALREADY_READ'));assert.match(calls[1].input,/latest-only/);
  const restored=new Secretariat(bridge,library);await restored.init();restored.runCodex=capture;
  const next=restored.add('user','続き');await restored.decide(next,[],0);assert.ok(calls[2].args.includes('persistent-test'));assert.match(calls[2].input,/続き/);assert.ok(calls[2].input.length<500);
  assert.equal(JSON.parse(await readFile(join(dir,'conversation.json'))).codexSession.id,'persistent-test');
});
test('large tool output is sent once with a bounded excerpt and full result remains archived',async()=>{
  const {secretary,dir}=await setup();delete secretary.decide;let input;
  secretary.runCodex=async(_bin,args,options)=>{input=options.input;await writeFile(args[args.indexOf('-o')+1],JSON.stringify({action:'reply',message:'ok',document:'',task:'',argv:[],attachments:[]}));return JSON.stringify({type:'thread.started',thread_id:'bounded-test'});};
  const turn=secretary.add('user','コードを確認');const content='code'.repeat(300000);secretary.add('tool',content);await secretary.decide(turn,[{result:content}],0);
  assert.ok(input.length<20000);assert.match(input,/省略/);assert.equal(secretary.messages.at(-1).content.length,content.length);
  secretary.decide=async()=>{throw new Error('PRIVATE_INTERNAL_TRACE'.repeat(1000));};await send(secretary,'質問');assert.ok(secretary.messages.at(-1).content.length<160);assert.ok(!secretary.messages.at(-1).content.includes('PRIVATE_INTERNAL_TRACE'));assert.doesNotMatch(await readFile(join(dir,'secretary-errors.jsonl'),'utf8'),/PRIVATE_INTERNAL_TRACE/);assert.match(await readFile(join(dir,'secretary-errors.jsonl'),'utf8'),/general/);
});

const memo = (topic='現在の話題') => ({topic,purpose:'目的',decisions:'決定',permissions:'村長発言IDを参照',unfinished:'未完了',references:'manual.md'});
function mockCodex(secretary, handler) {
  delete secretary.decide; const calls=[];
  secretary.observeContext=async()=>({source:'unknown',tokens:null,window:null});
  secretary.runCodex=async(_bin,args,{input})=>{
    const n=calls.push({args,input}); const result=await handler(n,args,input);
    if (result instanceof Error) throw result;
    await writeFile(args[args.indexOf('-o')+1],JSON.stringify({action:'reply',message:'返答',document:'',task:'',argv:[],attachments:[],...result?.choice}));
    return [JSON.stringify({type:'thread.started',thread_id:result?.id || (args.includes('resume')?args[args.indexOf('resume')+1]:'new-session')}),JSON.stringify({type:'turn.completed',usage:{input_tokens:999999999,output_tokens:100}})].join('\n');
  };return calls;
}
test('memo is a bounded replacement, committed with reply; invalid updates retain valid checkpoint',async()=>{
  const {secretary,dir}=await setup();const calls=mockCodex(secretary,async n=>({choice:{memo:n===1?memo():memo('x'.repeat(4001))}}));
  await send(secretary,'新しい目的');const before=JSON.parse(await readFile(join(dir,'conversation.json')));
  assert.deepEqual(before.memo.value,memo());assert.equal(before.messages.at(-1).content,'返答');
  await send(secretary,'こんにちは');const after=JSON.parse(await readFile(join(dir,'conversation.json')));
  assert.deepEqual(after.memo,before.memo);assert.equal(after.diagnostics.memoUpdate,'rejected');
  assert.ok(calls[1].args.includes('resume'));assert.doesNotMatch(calls[1].input,/村長発言IDを参照/);assert.ok(calls[1].input.length<1000);
  assert.ok(after.diagnostics.memoChars<=4000);
});
test('failed atomic memo/reply persistence keeps old memo and never notifies failed reply',async()=>{
  const {secretary,dir}=await setup();let notices=0;secretary.notifier={enqueue(){notices++;}};
  secretary.memo={value:memo(),cursor:null,updatedAt:'old'};await secretary.persist();
  // Make the temp destination unwritable as a file even when tests run as root.
  await mkdir(join(dir,'conversation.tmp'));
  await assert.rejects(secretary.completeReply('must not appear',{turnId:'t'},memo('changed')));
  assert.equal(secretary.memo.value.topic,'現在の話題');assert.equal(notices,0);assert.ok(!secretary.messages.some(m=>m.content==='must not appear'));
  assert.equal(JSON.parse(await readFile(join(dir,'conversation.json'))).memo.value.topic,'現在の話題');
});
test('measured usage rotates at boundary, never cumulative billed tokens; unknown usage has finite local budget',async()=>{
  const {secretary}=await setup();const calls=mockCodex(secretary,async()=>({choice:{memo:memo()}}));
  await send(secretary,'first');await send(secretary,'normal');assert.ok(calls[1].args.includes('resume'));
  secretary.session.context={source:'rollout-last',tokens:85,window:100};await send(secretary,'switch');
  assert.ok(!calls[2].args.includes('resume'));assert.match(calls[2].input,/現在の話題/);assert.equal(secretary.diagnostics.switchReason,'measured-context-80-percent');
  secretary.session.calls=32;await send(secretary,'fallback');assert.ok(!calls[3].args.includes('resume'));assert.equal(secretary.diagnostics.switchReason,'unknown-usage-local-budget');
});
test('context and missing-session errors recover once, preserving current request and observation; general errors do not retry',async()=>{
  for (const message of ['context_length_exceeded','No saved session found with ID abc']) {
    const {secretary}=await setup();secretary.session={id:'old',cursor:null};
    const calls=mockCodex(secretary,async n=>n===1?new Error(message):{});
    const turn=secretary.add('user','村長の未完了指示');await secretary.decide(turn,[{result:'操作済みの結果'}],0);
    assert.equal(calls.length,2);assert.ok(calls[0].args.includes('resume'));assert.ok(!calls[1].args.includes('resume'));assert.match(calls[1].input,/村長の未完了指示/);assert.match(calls[1].input,/操作済みの結果/);
  }
  for (const message of ['401 authentication failed','network timeout','rate limit exceeded','context_length_exceeded']) {
    const {secretary}=await setup();const calls=mockCodex(secretary,async()=>new Error(message));
    await send(secretary,'request');assert.equal(calls.length,message==='context_length_exceeded'?2:1);assert.equal(secretary.messages.at(-1).kind,'error');
  }
});
test('all pending reports and long mayor messages are delivered in order without tail loss',async()=>{
  const {secretary}=await setup();const calls=mockCodex(secretary,async()=>({}));
  for(let n=0;n<27;n++) await secretary.receiveReport({id:`j${n}`,report:`REPORT_${n}:`+'a'.repeat(1100)});
  await send(secretary,'MAYOR_START'+'b'.repeat(25000)+'MAYOR_END');
  const input=calls.map(c=>c.input).join('\n');for(let n=0;n<27;n++) assert.ok(input.includes(`REPORT_${n}:`));
  assert.match(input,/MAYOR_START/);assert.match(input,/MAYOR_END/);assert.ok(calls.length>=5);assert.equal(secretary.messages.at(-1).content,'返答');
});
test('restart during switch restores intent, memo and unfinished position; old records work without memo',async()=>{
  const {secretary,bridge,library,dir}=await setup();const turn=secretary.add('user','unfinished');
  secretary.activeTurn={id:turn.id,recoveryAttempts:1};secretary.status='thinking';secretary.memo={value:memo(),cursor:null,updatedAt:'old'};secretary.session={id:'old'};
  await secretary.switchSession('context-limit');
  const restored=new Secretariat(bridge,library);await restored.init();const calls=mockCodex(restored,async()=>({}));await send(restored,'続けて');
  assert.ok(!calls[0].args.includes('resume'));assert.match(calls[0].input,/unfinished/);assert.match(calls[0].input,/現在の話題/);
  const saved=JSON.parse(await readFile(join(dir,'conversation.json')));assert.equal(saved.transition,null);
  await writeFile(join(dir,'conversation.json'),JSON.stringify({version:2,messages:[turn],codexSession:{id:'legacy'},knownReports:[],status:'idle'}));
  const old=new Secretariat(bridge,library);await old.init();const oldCalls=mockCodex(old,async n=>n===1?new Error('session_not_found'):{});await send(old,'旧データ');
  assert.equal(oldCalls.length,2);assert.match(oldCalls[1].input,/unfinished/);assert.match(oldCalls[1].input,/旧メモなし/);
});
test('operation write-ahead survives crashes; completed and uncertain mutations never execute again',async()=>{
  const {secretary,bridge,library}=await setup();const turn=secretary.add('user','変更して');secretary.activeTurn={id:turn.id,recoveryAttempts:0};secretary.status='thinking';
  const action={action:'village',argv:['development','apply','job'],document:'',task:''};let executions=0;
  await secretary.recordOperation(turn,action,async()=>{executions++;return {deploymentId:'d1'};});
  await secretary.switchSession('context-limit');
  const restored=new Secretariat(bridge,library);await restored.init();
  assert.deepEqual(await restored.recordOperation(turn,action,async()=>{executions++;}),{deploymentId:'d1'});assert.equal(executions,1);
  await assert.rejects(restored.recordOperation(turn,{...action,argv:['development','apply','other']},async()=>{executions++;}),/復旧中/);assert.equal(executions,1);
  restored.activeTurn={id:'uncertain'};
  await assert.rejects(restored.recordOperation(turn,{...action,argv:['notify']},async()=>{executions++;throw new Error('lost connection after commit');}));
  const again=new Secretariat(bridge,library);await again.init();const result=await again.recordOperation(turn,{...action,argv:['notify']},async()=>{executions++;});
  assert.equal(result.verified,false);assert.equal(executions,2);
});

test('report arriving during Codex execution stays pending until next decision',async()=>{
  const {secretary}=await setup();const calls=mockCodex(secretary,async n=>{if(n===1) await secretary.receiveReport({id:'late',report:'LATE_REPORT'});return {choice:{memo:memo()}};});
  await send(secretary,'hello');assert.doesNotMatch(calls[0].input,/LATE_REPORT/);
  await send(secretary,'next');assert.match(calls[1].input,/LATE_REPORT/);
});
test('completed response checkpoint survives crash before idle finalizer without duplicate notification',async()=>{
  const {secretary,bridge,library}=await setup();let notices=0;secretary.notifier={enqueue(){notices++;}};
  const calls=mockCodex(secretary,async()=>({choice:{memo:memo()}}));await send(secretary,'hello');
  secretary.status='thinking';await secretary.persist();
  const restored=new Secretariat(bridge,library,null,secretary.notifier);await restored.init();
  assert.equal(restored.session.id,'new-session');assert.equal(restored.messages.filter(m=>m.interrupted).length,0);assert.equal(notices,1);assert.equal(calls.length,1);
});
test('full turn recovers after mutation without dispatch/apply/notification replay',async()=>{
  for(const argv of [['development','apply','job'],['notifications','test'],['development','start','--task','work']]) {
    const {secretary,root}=await setup();await writeFile(join(root,'manual.md'),'manual');let operations=0;
    secretary.operations={resolve(){return {command:{mutation:true}};},async execute(){operations++;return {ok:true,operationId:'saved-op'};}};
    const action={action:'village',argv,document:'',task:''};
    const calls=mockCodex(secretary,async n=>{
      if(n===1)return {choice:{action:'read_document',document:'manual.md'}};
      if(n===2||n===5)return {choice:action};
      if(n===3)return new Error('context_length_exceeded');
      if(n===4)return {choice:{action:'read_document',document:'manual.md'}};
      return {choice:{memo:memo()}};
    });
    await send(secretary,'許可した操作を実行');assert.equal(operations,1);assert.equal(calls.length,6);assert.match(calls[3].input,/saved-op/);assert.equal(secretary.messages.at(-1).content,'返答');
  }
});
test('uncertain dispatch result cannot be published as a successful new job',async()=>{
  const {secretary,bridge}=await setup();let submitted=0;bridge.submit=async()=>{submitted++;throw new Error('transport lost');};
  secretary.decide=async(_turn,_obs,step)=> step===0?choice('read_document','','workshop.md'):step===1?choice('dispatch','開始','workshop.md','作成'):choice('reply','成否不明');
  await send(secretary,'作って');assert.equal(submitted,1);assert.equal(secretary.messages.filter(m=>m.kind==='dispatch').length,0);
  assert.equal(secretary.operationLog[0].state,'started');
});

test('reports present without a conversation file are restored without notification or omission',async()=>{
  const {dir,bridge,library}=await setup();
  // A separate fresh directory simulates an old installation with jobs but no conversation.
  const fresh=join(dir,'fresh');bridge.dir=fresh;bridge.jobs=[{id:'old-report',report:'まだ届いていない報告'}];
  let notices=0;const s=new Secretariat(bridge,library,null,{enqueue(){notices++;}});await s.init();
  assert.equal(s.messages[0].content,'まだ届いていない報告');assert.equal(notices,0);
  const calls=mockCodex(s,async()=>({}));await send(s,'報告を確認');assert.match(calls[0].input,/まだ届いていない報告/);
});
test('unchanged observation is not resent during pending-input draining',async()=>{
  const {secretary}=await setup();const calls=mockCodex(secretary,async()=>({}));const turn=secretary.add('user','x'.repeat(20000));
  await secretary.decide(turn,[{result:'ONCE_ONLY'}],0);await secretary.decide(turn,[{result:'ONCE_ONLY'}],1);
  assert.match(calls[0].input,/ONCE_ONLY/);assert.doesNotMatch(calls[1].input,/ONCE_ONLY/);
});

test('unchanged memo advances completion position without resending completed history on rotation',async()=>{
  const {secretary}=await setup();const calls=mockCodex(secretary,async n=>({choice:{memo:n===1?memo():null}}));
  await send(secretary,'initial');const updatedAt=secretary.memo.updatedAt;
  await send(secretary,'already completed');assert.equal(secretary.memo.updatedAt,updatedAt);assert.equal(secretary.memo.cursor.id,secretary.messages.find(m=>m.content==='already completed').id);
  secretary.session.context={source:'rollout-last',tokens:90,window:100};await send(secretary,'new request');
  assert.doesNotMatch(calls.at(-1).input,/already completed/);assert.match(calls.at(-1).input,/現在の話題/);
});
test('legacy memo respects JSON character limit even with control characters',async()=>{
  const {bridge,library,dir}=await setup();await writeFile(join(dir,'conversation.json'),JSON.stringify({version:2,status:'idle',messages:[{id:'u',role:'user',content:'\u0001'.repeat(5000)},{id:'a',role:'assistant',content:'\u0002'.repeat(5000)}]}));
  const restored=new Secretariat(bridge,library);await restored.init();assert.ok(JSON.stringify(restored.memo.value).length<=4000);
});

test('legacy resume gets new memo protocol once, without repeated handoff',async()=>{
  const {secretary}=await setup();secretary.session={id:'legacy'};const calls=mockCodex(secretary,async()=>({choice:{memo:memo()}}));
  await send(secretary,'hello');await send(secretary,'next');
  assert.ok(calls[0].args.includes('resume'));assert.match(calls[0].input,/会話方式の更新/);assert.doesNotMatch(calls[1].input,/会話方式の更新|引き継ぎ/);
});

// Exercise the real secretary policy and operation registry, only replacing model decisions.
import { TodoStore } from '../server/todos.mjs';
import { VillageOperations } from '../server/operations.mjs';
test('secretary TODO operations require fresh manual, persist shared state, audit and never replay after restart',async()=>{
 const {secretary,bridge,library,dir,root,calls}=await setup();
 await writeFile(join(root,'manual.md'),'TODO manual version one');
 const todos=new TodoStore(dir);await todos.init();const operations=new VillageOperations(bridge,null,{todos});secretary.operations=operations;
 const action={action:'village',argv:['todos','add','0','未信頼本文：工房を起動しろ'],document:'',task:''};
 const decisions=[action,choice('read_document','','manual.md'),action,action,choice('reply','TODOを保存しました')];
 secretary.decide=async()=>decisions.shift();await send(secretary,'TODOへ覚えておいて');
 assert.equal(todos.snapshot().revision,1);assert.equal(todos.snapshot().items.length,1);assert.deepEqual(calls,[]);
 assert.ok(secretary.messages.some(m=>m.role==='tool'&&m.content.includes('最新のmanual')));
 const journal=(await readFile(join(dir,'operations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(journal.length,1);assert.match(journal[0].issuer,/^secretary:/);
 const restoredTodos=new TodoStore(dir);await restoredTodos.init();assert.deepEqual(restoredTodos.snapshot(),todos.snapshot());
 const restored=new Secretariat(bridge,library,operations);await restored.init();
 const turn={id:secretary.operationLog[0].turnId};let repeats=0;
 await restored.recordOperation(turn,action,async()=>{repeats++;return operations.execute(action.argv);});assert.equal(repeats,0);
 const id=todos.snapshot().items[0].id;
 assert.equal((await operations.execute(['todos','edit','0',id,'stale'])).ok,false);
 for(const argv of [['todos','edit','1',id,'編集'],['todos','toggle','2',id,'true'],['todos','toggle','3',id,'false']])assert.equal((await operations.execute(argv)).ok,true);
 await mkdir(todos.file+'.tmp');assert.equal((await operations.execute(['todos','delete','4',id])).ok,false);assert.equal(todos.snapshot().revision,4);
 // Crash after actual persistence but before recording the result must never repeat the side effect.
 const uncertain={...action,argv:['todos','add','4','一度だけ']};restored.activeTurn={id:'uncertain-todo'};
 const {rm}=await import('node:fs/promises');await rm(todos.file+'.tmp',{recursive:true});
 await assert.rejects(restored.recordOperation({id:'uncertain-todo'},uncertain,async()=>{await operations.execute(uncertain.argv);throw new Error('crash after commit');}));
 const again=new Secretariat(bridge,library,operations);await again.init();
 const result=await again.recordOperation({id:'uncertain-todo'},uncertain,async()=>{repeats++;});assert.equal(result.verified,false);assert.equal(repeats,0);assert.equal(todos.snapshot().items.length,2);
 assert.equal((await operations.execute(['todos','delete','5',id])).ok,true);
 const final=new TodoStore(dir);await final.init();assert.equal(final.snapshot().revision,6);assert.equal(final.snapshot().items.length,1);
});
test('memo snapshot projects only committed six fields and timestamp, including empty and invalid states',async()=>{
 const {secretary,dir}=await setup();assert.deepEqual(await secretary.memoSnapshot(),{memo:null});
 secretary.session={id:'PRIVATE_SESSION'};secretary.operationLog=[{secret:'PRIVATE_LOG'}];
 await secretary.completeReply('返答',{turnId:'memo-turn'},memo('<script>not executable</script>'));
 const snapshot=await secretary.memoSnapshot();assert.deepEqual(Object.keys(snapshot.memo).sort(),['updatedAt','value']);assert.deepEqual(snapshot.memo.value,memo('<script>not executable</script>'));
 assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_|codexSession|operationLog|messages/);
 secretary.memo.value.topic='not committed';assert.notEqual((await secretary.memoSnapshot()).memo.value.topic,'not committed');
 const saved=JSON.parse(await readFile(join(dir,'conversation.json')));saved.memo.value.extra='PRIVATE';await writeFile(join(dir,'conversation.json'),JSON.stringify(saved));assert.deepEqual(await secretary.memoSnapshot(),{memo:null});
 await writeFile(join(dir,'conversation.json'),'broken PRIVATE_SECRET');await assert.rejects(secretary.memoSnapshot(),error=>!error.message.includes('PRIVATE'));
});

test('reporting policy reaches new and legacy resumed sessions; detail requests retain full generated answers',async()=>{
  const {secretary}=await setup();
  const detailed='確認したcommitは'+ 'a'.repeat(40)+'です。\n'+'検証の詳細。'.repeat(100);
  const calls=mockCodex(secretary,async n=>({choice:{message:n===3?detailed:'依頼されていた修正について、完了しました。'}}));
  await send(secretary,'修正を報告して');
  assert.match(calls[0].input,/原則1〜3文/);assert.match(calls[0].input,/未確認を成功と言わない/);
  secretary.session.protocolVersion=4;
  await send(secretary,'続き');
  assert.ok(calls[1].args.includes('resume'));assert.match(calls[1].input,/原則1〜3文/);
  assert.match(calls[1].input,/既存の仕事・反映・会話記録や成果物を参照/);
  assert.equal(secretary.session.protocolVersion,6);
  await send(secretary,'commitと検証結果の詳細を教えて');
  assert.doesNotMatch(calls[2].input,/会話方式の更新/);
  assert.equal(secretary.messages.at(-1).content,detailed);
});

import { failureClass, stopReport } from '../server/conversation-progress.mjs';
test('long confirmation completes across durable batches without another mayor message',async()=>{
  const {secretary,dir}=await setup();let calls=0;const checkpoints=[];
  // Different observations represent actual progress, not repeated identical reads.
  secretary.decide=async()=>++calls<=25?{...choice('read_conversation','','index'),argv:[String(calls)]}:choice('reply','確認が完了しました');
  const persist=secretary.persist.bind(secretary);
  secretary.persist=async()=>{await persist();if(secretary.activeTurn?.continuation?.state==='queued')checkpoints.push(JSON.parse(await readFile(join(dir,'conversation.json'))));};
  await send(secretary,'長い確認');
  assert.equal(calls,26);assert.equal(secretary.messages.at(-1).content,'確認が完了しました');
  assert.equal(secretary.messages.filter(m=>m.role==='user').length,1);
  assert.ok(checkpoints.some(s=>s.activeTurn.continuation.steps===12));
  assert.ok(checkpoints.some(s=>s.activeTurn.continuation.steps===24));
  assert.equal(JSON.parse(await readFile(join(dir,'conversation.json'))).activeTurn,null);
});
test('queued continuation resumes autonomously after restart with counters and manual safety',async()=>{
  const {secretary,bridge,library,root}=await setup();await writeFile(join(root,'manual.md'),'manual');
  const turn=secretary.add('user','長い作業');secretary.status='thinking';secretary.activeTurn={id:turn.id,continuation:{state:'queued',steps:0,startedAt:Date.now(),fingerprints:[],drains:0}};
  let n=0;secretary.decide=async()=>++n===1?choice('read_document','','manual.md'):{...choice('read_conversation','','index'),argv:[String(n)]};
  assert.equal(await secretary.think(turn),true);
  const restored=new Secretariat(bridge,library);let executions=0;restored.operations={resolve:()=>({command:{mutation:true}}),execute:async()=>{executions++;return {ok:true};}};
  const decisions=[{...choice('village'),argv:['notifications','test']},choice('reply','復元完了')];restored.decide=async()=>decisions.shift();
  await restored.init();assert.equal(restored.status,'thinking');await restored.running;
  assert.equal(executions,0);assert.ok(restored.messages.some(m=>m.role==='tool'&&m.content.includes('最新のmanual')));
  assert.equal(restored.messages.at(-1).content,'復元完了');assert.equal(restored.messages.filter(m=>m.role==='user').length,1);
});
test('restart after write-ahead never repeats a completed or unknown side effect',async()=>{
  for(const uncertain of [false,true]) {
    const {secretary,bridge,library,root}=await setup();await writeFile(join(root,'manual.md'),'manual');
    const turn=secretary.add('user','操作');secretary.status='thinking';secretary.activeTurn={id:turn.id,continuation:{state:'running',steps:4,startedAt:Date.now(),fingerprints:[],drains:0}};
    const action={...choice('village'),argv:['notifications','test']};let executed=0;
    try {await secretary.recordOperation(turn,action,async()=>{executed++;if(uncertain)throw new Error('PRIVATE_STDERR');return {ok:true};});} catch {}
    const restored=new Secretariat(bridge,library);restored.operations={resolve:()=>({command:{mutation:true}}),execute:async()=>{executed++;return {ok:true};}};
    const decisions=[choice('read_document','','manual.md'),action,choice('reply','保存記録を確認しました')];restored.decide=async()=>decisions.shift();
    await restored.init();await restored.running;assert.equal(executed,1);
    assert.equal(restored.operationLog[0].state,uncertain?'started':'completed');
  }
});
test('unchanged or cycling observations stop even when audit timestamps change',async()=>{
  const {secretary}=await setup();let n=0;
  secretary.bridge.snapshot=()=>({phase:++n%2?'one':'two',checkedAt:String(n)});
  secretary.decide=async()=>choice('read_state');await send(secretary,'確認');
  assert.ok(n<=16);assert.match(secretary.messages.at(-1).content,/同じ確認結果の反復/);
  assert.equal(secretary.activeTurn.continuation.state,'stopped');
  assert.doesNotMatch(secretary.messages.at(-1).content,/次に.*確認/);
});
test('operation and wall-clock budgets survive persisted restart',async()=>{
  for(const [steps,startedAt,expected] of [[192,Date.now(),'操作回数'],[1,Date.now()-31*60000,'継続時間']]) {
    const {secretary,bridge,library}=await setup();const turn=secretary.add('user','確認');
    secretary.status='thinking';secretary.activeTurn={id:turn.id,continuation:{state:'queued',steps,startedAt,fingerprints:[],drains:0}};await secretary.persist();
    const restored=new Secretariat(bridge,library);restored.decide=async()=>{assert.fail('exhausted budget called model');};
    await restored.init();await restored.running;assert.match(restored.messages.at(-1).content,new RegExp(expected));
  }
});
test('typed failures distinguish cause and effect without leaking stderr, prompts or IDs',async()=>{
  const cases=[['ETIMEDOUT','応答の制限時間'],['ECONNRESET','通信障害'],['invalid_api_key','認証エラー'],['invalid-output','応答形式'],['output-limit','出力量'],['operation-limit','操作回数'],[undefined,'原因を特定できない']];
  for(const [code,expected] of cases) {
    const {secretary,dir}=await setup();secretary.decide=async()=>{throw Object.assign(new Error('PRIVATE_SECRET timeout authentication 401'),{code});};
    await send(secretary,'確認');const message=secretary.messages.at(-1);
    assert.match(message.content,new RegExp(expected));assert.match(message.content,/変更操作は未実行/);
    assert.doesNotMatch(JSON.stringify(message),/PRIVATE_SECRET|diagnosticId|次に.*確認/);
    assert.doesNotMatch(await readFile(join(dir,'secretary-errors.jsonl'),'utf8'),/PRIVATE_SECRET|turnId|prompt|stderr/);
  }
  assert.equal(failureClass(new Error('timeout 401 connection lost')),'general');
  assert.equal(failureClass({stdout:JSON.stringify({type:'turn.failed',error:{code:'invalid_api_key',message:'PRIVATE'}})}),'authentication');
  const report=stopReport({code:'ETIMEDOUT'},[
    {state:'completed',result:{ok:true}}, {state:'completed',result:{ok:false,verified:true}},
    {state:'completed',result:{ok:false,notStarted:true}}, {state:'started'},
    {state:'completed',result:{ok:true,result:{status:'unknown'}}},
  ]);
  assert.match(report,/成功1件・失敗1件、未実行1件、成否不明2件/);assert.match(report,/再送せず/);
});
test('invalid JSON output stops with a safe output classification',async()=>{
  const {secretary}=await setup();delete secretary.decide;
  secretary.runCodex=async(_bin,args)=>{await writeFile(args[args.indexOf('-o')+1],'PRIVATE invalid json');return JSON.stringify({type:'thread.started',thread_id:'private-session'});};
  await send(secretary,'確認');assert.match(secretary.messages.at(-1).content,/応答形式の不正/);assert.doesNotMatch(secretary.messages.at(-1).content,/PRIVATE|private-session/);
});
test('heavy verification schedules bounded read-only polling and resumes after restart',async()=>{
  const {secretary,bridge,library}=await setup();const turn=secretary.add('user','検証結果を確認');
  secretary.status='thinking';secretary.activeTurn={id:turn.id};let reads=0;
  secretary.operations={resolve:()=>({command:{mutation:false}}),execute:async()=>{reads++;return {ok:true,result:{phase:'running'}};}};
  secretary.decide=async()=>({...choice('village'),argv:['workspace','get','owned-execution']});
  assert.equal(await secretary.think(turn),true);assert.equal(reads,1);assert.ok(secretary.activeTurn.continuation.nextAt>Date.now());
  // Simulate the reserved time having elapsed during downtime.
  secretary.activeTurn.continuation.nextAt=Date.now()-1;await secretary.persist();
  const restored=new Secretariat(bridge,library);restored.operations={resolve:()=>({command:{mutation:false}}),execute:async()=>{reads++;return {ok:true,result:{phase:'completed'}};}};
  restored.decide=async()=>choice('reply','検証が完了しました');
  await restored.init();await restored.running;assert.equal(reads,2);assert.equal(restored.messages.at(-1).content,'検証が完了しました');
});

test('autonomous polling has a persistent no-progress deadline and never asks the model while pending',async()=>{
  const {secretary,bridge,library}=await setup();const turn=secretary.add('user','検証確認');
  secretary.status='thinking';secretary.activeTurn={id:turn.id};let decisions=0;
  secretary.operations={resolve:()=>({command:{mutation:false}}),execute:async()=>({ok:true,result:{phase:'running'}})};
  secretary.decide=async()=>{decisions++;return {...choice('village'),argv:['workspace','get','owned']};};
  await secretary.think(turn);assert.equal(decisions,1);
  secretary.activeTurn.continuation.poll.since=Date.now()-11*60000;
  secretary.activeTurn.continuation.nextAt=Date.now()-1;await secretary.persist();
  const restored=new Secretariat(bridge,library);restored.operations=secretary.operations;
  restored.decide=async()=>assert.fail('host polling must not invoke model');
  await restored.init();await restored.running;
  assert.match(restored.messages.at(-1).content,/同じ確認結果の反復/);
  assert.equal(restored.activeTurn.continuation.state,'stopped');
});
test('raw tool error and stderr never enter the saved conversation or public diagnostics',async()=>{
  const {secretary,dir}=await setup();let n=0;
  secretary.operations={resolve:()=>({command:{mutation:false}}),execute:async()=>({ok:false,error:'PRIVATE_SECRET prompt stderr',errorClass:'authentication',result:{stderr:'PRIVATE_SECRET',releaseError:'PRIVATE_SECRET'}})};
  secretary.decide=async()=>++n===1?{...choice('village'),argv:['workspace','get','owned']}:choice('reply','認証を確認してください。');
  await send(secretary,'確認');
  assert.doesNotMatch(await readFile(join(dir,'conversation.json'),'utf8'),/PRIVATE_SECRET/);
  assert.match(secretary.messages.find(m=>m.role==='tool').content,/認証エラー/);
  const report=stopReport({},[{state:'completed',result:{ok:true,result:{phase:'starting'}}},{state:'completed',result:{ok:true,result:{phase:'unknown'}}},{state:'completed',result:{ok:true,result:{phase:'failed'}}}]);
  assert.match(report,/成功0件・失敗1件/);assert.match(report,/成否不明1件/);assert.match(report,/受付済み・完了未確認1件/);
});

test('resuming a stopped request preserves the latest response turn and observation across restart',async()=>{
  const {secretary,bridge,library}=await setup();
  const old=secretary.add('user','元の依頼'),turn=secretary.add('user','保存結果から再開して');
  secretary.status='thinking';secretary.activeTurn={id:old.id,responseTurnId:turn.id};let n=0;
  secretary.decide=async()=>({...choice('read_conversation','','index'),argv:[String(++n)]});
  await secretary.think(turn);
  const restored=new Secretariat(bridge,library);
  restored.decide=async(actual,observations)=>{assert.equal(actual.id,turn.id);assert.deepEqual(observations.at(-1).argv,['12']);return choice('reply','再開完了');};
  await restored.init();await restored.running;
  assert.equal(restored.messages.at(-1).turnId,turn.id);assert.equal(restored.completedTurnId,turn.id);
});
