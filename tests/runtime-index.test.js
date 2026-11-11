import {inputHash} from './model-fixtures.mjs';
import {fixtureModels,testView} from './model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,readFile,rm,readdir,rename,chmod,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runtimeScript,correlate,terminalBoundary} from '../server/runtime-events.mjs';
import {RuntimeReader} from '../server/runtime-reader.mjs';
const sid='11111111-2222-3333-4444-555555555555';
const lines=rows=>rows.map(JSON.stringify).join('\n')+'\n';
const start={type:'event_msg',payload:{type:'task_started',turn_id:'t'}};
const input={type:'response_item',payload:{role:'user',id:'u',turn_id:'t',content:[{type:'input_text',text:'hello ai-village-run-hello'}]}};
const answer=text=>({type:'response_item',payload:{role:'assistant',id:'a',turn_id:'t',content:[{type:'output_text',text}]}});
const done={type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'done'}};
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'native-index-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));const file=join(dir,'sessions',sid+'.jsonl'),env={...process.env,CODEX_HOME:dir,VILLAGE_NATIVE_CACHE_DIR:join(dir,'cache')};let responses=[];const execute=async(a,args)=>{const raw=execFileSync(args[0],args.slice(1),{env,maxBuffer:15*1024*1024}).toString();responses.push(JSON.parse(raw));return raw;};const a={provider:'codex',connection:{connectionType:'local'}},status={agentSessionId:sid};return {dir,file,env,execute,a,status,responses,reader:new RuntimeReader(dir)};}
test('incremental/restarted replica preserves correlation, unicode chunks, partial input and unchanged read transfers no history',async t=>{
 const f=await setup(t);await writeFile(f.file,lines([start,input,answer('🙂'.repeat(600000)),done]));let s;
 for(let i=0;i<20;i++){s=await f.reader.read(f.a,f.status,f.execute);if(s.available)break;assert.equal(correlate({},s).state,'unknown');}
 assert(s.available);assert.equal(s.turns[0].messages[0].text,'🙂'.repeat(600000));assert.equal(correlate({runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{cursor:0,sessionId:sid},id:'hello',inputMarker:'ai-village-run-hello'},s).state,'completed');
 f.reader=new RuntimeReader(f.dir);const again=await f.reader.read(f.a,f.status,f.execute);assert.deepEqual(again.turns,s.turns);assert.equal(f.responses.at(-1).pieces.length,0);assert.equal(again.indexedBytes,0);
 await appendFile(f.file,'{"type":');s=await f.reader.read(f.a,f.status,f.execute);assert(!s.available);assert(s.incompleteTail);assert(!terminalBoundary(s,{alive:true,agentSessionId:sid}));
 await appendFile(f.file,'"event_msg","payload":{"type":"task_started","turn_id":"new"}}\n');s=await f.reader.read(f.a,f.status,f.execute);assert(s.available);assert.equal(s.turns.at(-1).id,'new');assert(s.indexedBytes<1000);
});
test('same-size rewrite, truncation, inode replacement, alternative path and duplicate session are not attributed across generations',async t=>{
 const f=await setup(t);const content=lines([start,input,done]);await writeFile(f.file,content);let s=await f.reader.read(f.a,f.status,f.execute);let identity=s.fileIdentity;
 const run={baselineRuntime:{fileIdentity:identity,cursor:0,sessionId:sid},runModel:{facts:[{type:'transport-ack',at:0}]},id:'hello',inputMarker:'ai-village-run-hello'};
 await writeFile(f.file,content.replace('hello','other'));s=await f.reader.read(f.a,f.status,f.execute);assert.notEqual(s.fileIdentity,identity);assert.equal(correlate(run,s).state,'unknown');identity=s.fileIdentity;
 await writeFile(f.file,lines([start]));s=await f.reader.read(f.a,f.status,f.execute);assert.notEqual(s.fileIdentity,identity);assert.equal(s.turns[0].state,'running');identity=s.fileIdentity;
 await rename(f.file,f.file+'.old');await writeFile(f.file,content);s=await f.reader.read(f.a,f.status,f.execute);assert.notEqual(s.fileIdentity,identity);
 await mkdir(join(f.dir,'sessions','nested'));await rename(f.file,join(f.dir,'sessions','nested',sid+'.jsonl'));identity=s.fileIdentity;s=await f.reader.read(f.a,f.status,f.execute);assert.notEqual(s.fileIdentity,identity);
 await writeFile(f.file,content);s=await f.reader.read(f.a,f.status,f.execute);assert.equal(s.available,false);assert.match(s.reason,/ambiguous/);
});
// chmod moves ctime without writing a single content byte (confirmed experimentally
// against a real Claude Code session file: chmod alone reproduces this stat() shape
// with edges() unchanged). A live, actively-growing real Claude Code session was also
// observed moving BOTH mtime and ctime with size and edges() completely unchanged —
// some internal write that touches the inode without changing visible content, not an
// external metadata-only operation. Neither timestamp is trustworthy here; see
// docs/runtime-file-replaced-investigation.md.
test('metadata-only touches (chmod, or mtime+ctime moving with no content change) never rotate fileIdentity; a real same-size rewrite still does',async t=>{
 const f=await setup(t);const content=lines([start,input,done]);await writeFile(f.file,content);
 let s=await f.reader.read(f.a,f.status,f.execute);const identity=s.fileIdentity;
 const run={baselineRuntime:{fileIdentity:identity,cursor:0,sessionId:sid},runModel:{facts:[{type:'transport-ack',at:0}]},id:'hello',inputMarker:'ai-village-run-hello'};
 await chmod(f.file,0o640);
 s=await f.reader.read(f.a,f.status,f.execute);assert.equal(s.fileIdentity,identity);assert.equal(correlate(run,s).state,'completed');
 // utimes() moves both mtime and ctime (ctime is a side effect of any metadata write) with
 // no content byte touched — reproducing the naturally-observed real-session anomaly.
 const touched=new Date();await utimes(f.file,touched,touched);
 s=await f.reader.read(f.a,f.status,f.execute);assert.equal(s.fileIdentity,identity);assert.equal(correlate(run,s).state,'completed');
 // A genuine same-size content rewrite (edges() mismatches) must still rotate.
 await writeFile(f.file,content.replace('hello','other'));
 s=await f.reader.read(f.a,f.status,f.execute);assert.notEqual(s.fileIdentity,identity);assert.equal(correlate(run,s).state,'unknown');
});
test('parser upgrade and corrupt host/core caches rebuild without silently completing stale ownership',async t=>{
 const f=await setup(t);await writeFile(f.file,lines([start,input,done]));let s=await f.reader.read(f.a,f.status,f.execute);const old=s.fileIdentity,db=join(f.dir,'cache',(await readdir(join(f.dir,'cache'))).find(n=>n.endsWith('.sqlite')));
 execFileSync('python3',['-c',"import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);p=json.loads(c.execute(\"select value from meta where key='checkpoint'\").fetchone()[0]);p['version']=0;c.execute(\"update meta set value=? where key='checkpoint'\",(json.dumps(p),));c.commit()",db]);
 s=await f.reader.read(f.a,f.status,f.execute);assert.equal(s.fileIdentity,old);
 const replica=join(f.dir,'native-index-replica'),key=(await readdir(replica))[0],page=(await readdir(join(replica,key)))[0];await writeFile(join(replica,key,page),'broken');f.reader=new RuntimeReader(f.dir);s=await f.reader.read(f.a,f.status,f.execute);assert(s.available);assert.equal(s.turns[0].state,'completed');assert(f.responses.at(-1).pieces.length>0);
 await writeFile(db,'broken');s=await f.reader.read(f.a,f.status,f.execute);assert(!s.available);s=await f.reader.read(f.a,f.status,f.execute);assert(s.available);assert.equal(s.fileIdentity,old);
});
test('concurrent consumers serialize replica pages and unchanged source emits no duplicate inputs/messages',async t=>{
 const f=await setup(t);await writeFile(f.file,lines([start,input,answer('once'),done]));const snapshots=await Promise.all(Array.from({length:3},()=>f.reader.read(f.a,f.status,f.execute)));for(const s of snapshots){assert.equal(s.inputs.length,1);assert.equal(s.turns[0].messages.length,1);}assert.equal(f.responses.at(-1).pieces.length,0);
});

test('legacy dev:inode baselines remain usable, but a detected rewrite never aliases that baseline again',async t=>{
 const f=await setup(t);await writeFile(f.file,lines([start]));const legacy=JSON.parse(execFileSync('python3',['-c',"import os,json,sys;s=os.stat(sys.argv[1]);print(json.dumps({'fileIdentity':str(s.st_dev)+':'+str(s.st_ino),'cursor':s.st_size}))",f.file]));
 const run={runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{...legacy,sessionId:sid},id:'hello',inputMarker:'ai-village-run-hello'};
 await appendFile(f.file,lines([input,answer('done'),done]));let s=await f.reader.read(f.a,f.status,f.execute);assert.equal(s.fileIdentity,legacy.fileIdentity);const accepted=correlate(run,s);assert.equal(accepted.state,'completed');
 const bound={...run,turnId:'t',inputId:'u'};assert.equal(correlate(bound,s).state,'completed');assert.equal(correlate({...bound,id:'different',inputMarker:'ai-village-run-different'},s).state,'unknown');
 const original=await readFile(f.file,'utf8');await writeFile(f.file,original.replace('hello','other'));s=await f.reader.read(f.a,f.status,f.execute);assert.equal(correlate(bound,s).state,'unknown');const replacedIdentity=s.fileIdentity;
 // Rebuilding corrupt index is not a return to the legacy identity.
 const db=join(f.dir,'cache',(await readdir(join(f.dir,'cache'))).find(n=>n.endsWith('.sqlite')));await writeFile(db,'broken');await f.reader.read(f.a,f.status,f.execute);s=await f.reader.read(f.a,f.status,f.execute);assert.equal(s.fileIdentity,replacedIdentity);assert.equal(correlate(bound,s).state,'unknown');
});
test('invalid complete JSON and oversized single row stay unconfirmed instead of skipping to a terminal',async t=>{
 const f=await setup(t);await writeFile(f.file,lines([start,input])+'not-json\n'+lines([done]));let s=await f.reader.read(f.a,f.status,f.execute);assert(!s.available);assert.equal(s.reason,'invalid-json-line');const cursor=s.cursor;
 await writeFile(f.file,lines([start,input])+JSON.stringify({type:'padding',data:'x'.repeat(8*1024*1024)})+'\n'+lines([done]));s=await f.reader.read(f.a,f.status,f.execute);assert(!s.available);assert.equal(s.reason,'record-too-large');assert.equal(s.cursor,cursor);
});
test('Claude ancestry, model and tool output boundaries survive append and restart',async t=>{
 const f=await setup(t),root=join(f.dir,'.claude','projects','test');await mkdir(root,{recursive:true});const file=join(root,sid+'.jsonl');
 const execute=async(a,args)=>execFileSync(args[0],args.slice(1),{env:{...f.env,HOME:f.dir},maxBuffer:15e6}).toString(),a={...f.a,provider:'claude'};
 // Interim prose beside a tool_use block must surface as output while the turn is still running, matching Codex parity.
 await writeFile(file,lines([{type:'user',uuid:'u',message:{content:'hello ai-village-run-hello'}},{type:'assistant',uuid:'tool',parentUuid:'u',message:{stop_reason:'tool_use',content:[{type:'thinking',text:'ignored'},{type:'text',text:'looking into it'},{type:'tool_use',id:'t1',name:'Read'}]}}]));let s=await f.reader.read(a,f.status,execute);
 assert.equal(s.turns[0].state,'running');assert.equal(s.turns[0].output,'looking into it');assert.equal(s.turns[0].completionOffset,undefined);
 await appendFile(file,lines([{type:'user',uuid:'tool-result',parentUuid:'tool',message:{content:[{type:'tool_result',content:'ok'}]}},{type:'assistant',uuid:'answer',parentUuid:'tool-result',message:{model:'claude-test',usage:{speed:'fast'},stop_reason:'end_turn',content:[{type:'text',text:'answer'}]}}]));f.reader=new RuntimeReader(f.dir);s=await f.reader.read(a,f.status,execute);
 assert.equal(s.turns[0].output,'looking into it\n\nanswer');assert.equal(s.turns[0].finalOutput,'answer');assert.equal(s.turns[0].state,'completed');
 assert.equal(s.modelInfo.serviceTier,'fast');assert.equal(correlate({runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{cursor:0,sessionId:sid},id:'hello',inputMarker:'ai-village-run-hello'},s).state,'completed');
});
test('a Claude compaction boundary appended mid-session never rotates fileIdentity or severs prior turn ownership',async t=>{
 // Reproduces, byte-for-byte, what a real Claude Code auto/manual compaction writes to
 // the transcript: a `system`/`compact_boundary` line followed by an `isMeta` summary
 // `user` line, both purely appended (verified empirically against a live Claude Code
 // 2.1.272 session: same inode, identical head-byte hash, monotonically growing size
 // across 100ms-resolution polling through a forced autocompaction). Any lineage
 // softening belongs at the direct.mjs blocksInput layer, never here: fileIdentity must
 // stay exactly stable and ownership of turns observed before the boundary must survive.
 const f=await setup(t),root=join(f.dir,'.claude','projects','test');await mkdir(root,{recursive:true});const file=join(root,sid+'.jsonl');
 const execute=async(a,args)=>execFileSync(args[0],args.slice(1),{env:{...f.env,HOME:f.dir},maxBuffer:15e6}).toString(),a={...f.a,provider:'claude'};
 await writeFile(file,lines([{type:'user',uuid:'u1',message:{content:'hello ai-village-run-hello'}},{type:'assistant',uuid:'a1',parentUuid:'u1',message:{stop_reason:'end_turn',content:[{type:'text',text:'first answer'}]}}]));
 let s=await f.reader.read(a,f.status,execute);const identity=s.fileIdentity,firstCursor=0;
 const baseline1={runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{cursor:firstCursor,sessionId:sid,fileIdentity:identity},id:'hello',inputMarker:'ai-village-run-hello'};
 const accepted1=correlate(baseline1,s);assert.equal(accepted1.state,'completed');
 const bound1={...baseline1,turnId:accepted1.turnId,inputId:accepted1.inputId,sessionId:sid};
 await appendFile(file,lines([{type:'system',subtype:'compact_boundary',isMeta:true},{type:'user',isMeta:true,isCompactSummary:true,uuid:'summary',message:{content:'condensed summary of the conversation so far'}}]));
 f.reader=new RuntimeReader(f.dir);s=await f.reader.read(a,f.status,execute);
 assert.equal(s.fileIdentity,identity);assert.equal(s.turns.length,1);const secondCursor=s.cursor;
 assert.equal(correlate(bound1,s).state,'completed');
 await appendFile(file,lines([{type:'user',uuid:'u2',message:{content:'next ai-village-run-next'}},{type:'assistant',uuid:'a2',parentUuid:'u2',message:{stop_reason:'end_turn',content:[{type:'text',text:'second answer'}]}}]));
 f.reader=new RuntimeReader(f.dir);s=await f.reader.read(a,f.status,execute);
 assert.equal(s.fileIdentity,identity);assert.equal(s.turns.length,2);
 // Ownership of the pre-compaction turn, bound before the boundary was ever written, is still intact several appends later.
 assert.equal(correlate(bound1,s).state,'completed');
 const baseline2={runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{cursor:secondCursor,sessionId:sid,fileIdentity:identity},id:'next',inputMarker:'ai-village-run-next'};
 const accepted2=correlate(baseline2,s);assert.equal(accepted2.state,'completed');assert.notEqual(accepted2.turnId,accepted1.turnId);
});
test('incremental snapshots match the frozen pre-index parser for both providers at every append boundary',async t=>{
 const f=await setup(t),reference=new URL('./fixtures/runtime-events-reference.py',import.meta.url).pathname;
 const codex=[start,{type:'turn_context',payload:{model:'model',service_tier:'fast'}},{type:'event_msg',payload:{type:'user_message',turn_id:'t',message:'hello ai-village-run-hello'}},input,answer('same'),answer('same'),done,{type:'response_item',payload:{role:'user',id:'u2',turn_id:'t',content:[{type:'input_text',text:'supplement ai-village-run-supplement'}]}},answer('after'),{type:'event_msg',payload:{type:'task_complete',turn_id:'t',error:{message:'capacity',codex_error_info:'server_overloaded'}}}];
 const claude=[{type:'user',uuid:'u',message:{content:'hello ai-village-run-hello'}},{type:'assistant',uuid:'m',parentUuid:'u',message:{stop_reason:'end_turn',content:'initial'}},{type:'assistant',uuid:'tool',parentUuid:'m',message:{stop_reason:'tool_use',content:'later tool'}},{type:'user',uuid:'r',parentUuid:'tool',message:{content:[{type:'tool_result',content:'ok'}]}},{type:'assistant',uuid:'end',parentUuid:'r',message:{stop_reason:'max_tokens',content:'partial'}},{type:'assistant',uuid:'error',parentUuid:'end',isApiErrorMessage:true,error:'error',message:{content:'failed'}}];
 for(const [provider,rows] of [['codex',codex],['claude',claude]]){
  const file=provider==='codex'?f.file:join(f.dir,'.claude','projects','fixture',sid+'.jsonl');await mkdir(join(file,'..'),{recursive:true});await writeFile(file,'');
  const env={...f.env,HOME:f.dir},execute=async(a,args)=>execFileSync(args[0],args.slice(1),{env,maxBuffer:15e6}).toString();
  for(const row of rows){await appendFile(file,lines([row]));const actual=await f.reader.read({...f.a,provider},f.status,execute),expected=JSON.parse(execFileSync('python3',[reference,provider,sid],{env}));for(const field of ['available','cursor','turns','inputs','modelInfo'])assert.deepEqual(field==='inputs'?actual[field].map(({aliases,...i})=>i):actual[field],expected[field],provider+' '+field);}
 }
});
test('Direct runtime retains local/SSH routing and does not mix equal session IDs on different hosts',async t=>{
 const {DirectAgents}=await import('../server/direct.mjs'),local=await setup(t),remote=await setup(t);await writeFile(local.file,lines([start,input,answer('local'),done]));await writeFile(remote.file,lines([start,input,answer('remote'),done]));const hosts=[];
 const service=new DirectAgents({dir:local.dir,notifier:{status:()=>({})},localRun:async(command,args)=>execFileSync(command,args,{env:local.env,maxBuffer:15e6}).toString(),remote:async(args,host,id)=>{hosts.push([host,id]);return execFileSync(args[0],args.slice(1),{env:remote.env,maxBuffer:15e6}).toString();}});
 const a={...local.a,id:'local'},b={...remote.a,id:'remote',connection:{connectionType:'ssh',sshHost:'fixture-host'}};
 assert.equal((await service.runtime(a,local.status)).turns[0].output,'local');assert.equal((await service.runtime(b,remote.status)).turns[0].output,'remote');assert.deepEqual(hosts,[['fixture-host','remote']]);
});
test('Direct idle CLI does not unlock send or complete an active run during index catch-up',async t=>{
 const {DirectAgents}=await import('../server/direct.mjs'),f=await setup(t);const service=new DirectAgents({dir:f.dir,notifier:{status:()=>({})}});
 const a={id:'a',provider:'codex',connection:{connectionType:'local'},state:'idle',lifecycle:'alive',workspaceId:'ws',tabId:'tab'};service.data.requests=[];service.data.agents=[a];service.data.runs=[{id:'r',agentId:'a',state:'running',baselineRuntime:{sessionId:sid,cursor:0},id:'hello',inputMarker:'ai-village-run-hello'}];service.pmux=async()=>({alive:true,cliState:'idle',agentSessionId:sid});service.runtime=async()=>({available:false,reason:'index-catching-up',sessionId:sid,turns:[],inputs:[],cursor:0});
 fixtureModels(service.data);await service.observe(a);assert.equal(testView(a).canSend,false);assert.equal(testView(a).canSteer,false);assert.equal(service.data.runs[0].runModel.state.kind,'sent');
});
test('event input upgraded to response retains accepted ownership, priorInputs and original steering output boundary',async t=>{
 const f=await setup(t),event={type:'event_msg',payload:{type:'user_message',turn_id:'t',message:'hello ai-village-run-hello'}};
 await writeFile(f.file,lines([start,event]));let s=await f.reader.read(f.a,f.status,f.execute);
 const initial={runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{sessionId:sid,cursor:0,fileIdentity:s.fileIdentity},id:'hello',inputMarker:'ai-village-run-hello'};
 const accepted=correlate(initial,s),old=s.inputs[0];assert.equal(accepted.state,'running');
 const bound={...initial,turnId:accepted.turnId,inputId:accepted.inputId,sessionId:sid};
 await appendFile(f.file,lines([answer('between representations'),input]));
 s=await f.reader.read(f.a,f.status,f.execute);assert.equal(s.inputs.length,1);assert.equal(correlate(bound,s).state,'running');
 assert.equal(correlate({...bound,steerTarget:{sessionId:sid,turnId:'t'}},s).output,'between representations');
 // Canonical representation after baseline is not a new human input.
 assert.equal(correlate({...initial,baselineRuntime:{...initial.baselineRuntime,cursor:old.offset}},s).reason,'input-not-observed');
 const before=s.cursor,extra={type:'response_item',payload:{role:'user',id:'extra',turn_id:'t',content:[{type:'input_text',text:'extra ai-village-run-extra'}]}};
 await appendFile(f.file,lines([extra,answer('supplement answer'),done]));s=await f.reader.read(f.a,f.status,f.execute);
 assert.equal(correlate(bound,s).reason,'additional-input-in-owned-turn');
 const supplement={runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{...initial.baselineRuntime,cursor:before},priorInputs:[old],id:'extra',inputMarker:'ai-village-run-extra',steerTarget:{sessionId:sid,turnId:'t'}};
 const added=correlate(supplement,s);assert.equal(added.state,'completed');
 assert.equal(correlate({...supplement,turnId:'t',inputId:added.inputId,sessionId:sid},s).state,'completed');
 // A genuinely repeated response input is never text-deduplicated.
 await appendFile(f.file,lines([extra]));s=await f.reader.read(f.a,f.status,f.execute);
 assert.equal(s.inputs.length,3);assert.equal(correlate(supplement,s).state,'unknown');
});
test('fresh Claude missing session stays unrecorded through the indexed reader, but ambiguity does not',async t=>{
 const f=await setup(t);const root=join(f.dir,'.claude','projects');await mkdir(root,{recursive:true});
 const a={provider:'claude',connection:{connectionType:'local'}};
 const execute=async(a,args)=>execFileSync(args[0],args.slice(1),{env:{...f.env,HOME:f.dir},maxBuffer:15*1024*1024}).toString();
 const first=await f.reader.read(a,f.status,execute);assert.equal(first.unrecorded,true);assert.equal(first.available,false);assert.equal(first.sessionId,sid);
 await writeFile(join(root,sid+'.jsonl'),'');await mkdir(join(root,'other'));await writeFile(join(root,'other',sid+'.jsonl'),'');
 const ambiguous=await f.reader.read(a,f.status,execute);assert.equal(ambiguous.available,false);assert.notEqual(ambiguous.unrecorded,true);
});
