import {inputHash} from './model-fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correlate,runtimeScript,terminalBoundary} from '../server/runtime-events.mjs';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('native Codex JSONL input/message/turn identities are independent of arbitrary reply text',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-events-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));
 const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'turn-1'}},{type:'response_item',payload:{role:'user',id:'msg-1',content:[{type:'input_text',text:'hello ai-village-run-hello'}],internal_chat_message_metadata_passthrough:{turn_id:'turn-1',content_item_kinds:['user.text']}}},{type:'event_msg',payload:{type:'task_complete',turn_id:'turn-1',last_agent_message:'not JSON; no declaration'}}];
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));
 const r=correlate({runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{cursor:0,sessionId:sid},id:'hello',inputMarker:'ai-village-run-hello'},s);assert.equal(r.state,'completed');assert.equal(r.turnId,'turn-1');assert.equal(r.output,'not JSON; no declaration');assert.equal(r.finalOutput,'not JSON; no declaration');
 rows.push({type:'event_msg',payload:{type:'task_started',turn_id:'turn-2'}},{type:'event_msg',payload:{type:'turn_aborted',turn_id:'turn-2'}});
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const later=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));assert.equal(later.turns.at(-1).state,'interrupted');assert.equal(correlate({...r,id:'hello',inputMarker:'ai-village-run-hello'},later).output,r.output);
});
test('unmatched, duplicate, missing or replaced runtime input stays unknown',()=>{
 const run={runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{sessionId:'s',cursor:10},id:'same',inputMarker:'ai-village-run-same'};
 const s={available:true,sessionId:'s',inputs:[{id:'1',text:'ai-village-run-same',hash:run.inputHash,turnId:'t',offset:5}],turns:[{id:'t',state:'completed',output:'stale'}]};
 assert.equal(correlate(run,s).state,'unknown');s.inputs[0].offset=20;s.inputs.push({...s.inputs[0],id:'2',turnId:'other'});assert.equal(correlate(run,s).state,'unknown');
 assert.equal(correlate(run,{...s,sessionId:'replaced'}).state,'unknown');assert.equal(correlate(run,{available:false}).state,'unknown');
});
test('lost send acknowledgement and additional input in an owned turn never get assigned by prose',()=>{
 const s={available:true,sessionId:'s',cursor:50,inputs:[{id:'one',turnId:'t',text:'hello ai-village-run-hello',hash:inputHash('hello ai-village-run-hello'),offset:10}],turns:[{id:'t',state:'completed',output:'done'}]};
 const run={baselineRuntime:{sessionId:'s',cursor:0},id:'hello',inputMarker:'ai-village-run-hello'};
 assert.equal(correlate(run,s).state,'unknown');
 const bound={...correlate({...run,runModel:{facts:[{type:'transport-ack',at:0}]}},s),...run};assert.equal(bound.state,'completed');
 s.inputs.push({id:'steering',turnId:'t',hash:inputHash('external'),offset:30});assert.equal(correlate(bound,s).state,'unknown');
});
test('Claude native UUID ancestry and stop reasons distinguish replies from API errors',async t=>{
 const home=await mkdtemp(join(tmpdir(),'claude-native-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.claude/projects/test');await mkdir(root,{recursive:true});const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'user',uuid:'input-1',message:{content:'hello ai-village-run-hello'}},{type:'assistant',uuid:'tool',parentUuid:'input-1',message:{stop_reason:'tool_use',content:[]}},{type:'user',uuid:'tool-result',parentUuid:'tool',message:{content:[{type:'tool_result',content:'ok'}]}},{type:'assistant',uuid:'answer',parentUuid:'tool-result',message:{stop_reason:'end_turn',content:[{type:'text',text:'arbitrary prose'}]}},{type:'user',uuid:'input-2',parentUuid:'answer',message:{content:'hello again'}},{type:'assistant',uuid:'error',parentUuid:'input-2',isApiErrorMessage:true,error:'authentication_failed',message:{stop_reason:'stop_sequence',content:[{type:'text',text:'Login expired'}]}}];
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));
 assert.equal(s.inputs.length,2);assert.equal(s.turns[0].state,'completed');assert.equal(s.turns[0].output,'arbitrary prose');assert.equal(s.turns[1].state,'failed');assert.equal(s.turns[1].error,'authentication_failed');
 rows.push({type:'user',uuid:'input-3',message:{content:'more'}},{type:'assistant',uuid:'limit',parentUuid:'input-3',message:{stop_reason:'max_tokens',content:[{type:'text',text:'truncated'}]}});
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const limited=JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));assert.equal(limited.turns[2].state,'interrupted');
});
test('Claude input recorded inside a pasted_content wrapper retains the recorded wrapper without normalization',async t=>{
 const home=await mkdtemp(join(tmpdir(),'claude-pasted-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.claude/projects/test');await mkdir(root,{recursive:true});const sid='11111111-2222-3333-4444-555555555555';
 const prompt='依頼本文\n\n<ai-village-request>\n{"humanRequestId":"x"}\n</ai-village-request>';
 const wrapped='\n\n<pasted_content id="b984">\n'+prompt+'\n</pasted_content id="b984">\n';
 const mismatched='<pasted_content id="a">\n'+prompt+'\n</pasted_content id="b">';
 const rows=[{type:'user',uuid:'input-1',message:{content:wrapped}},{type:'user',uuid:'input-2',message:{content:prompt}},{type:'user',uuid:'input-3',message:{content:mismatched}}];
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));
 assert.equal(s.inputs[0].text,wrapped);assert.equal(s.inputs[1].hash,inputHash(prompt));assert.equal(s.inputs[2].hash,inputHash(mismatched));
});
test('Claude interim prose across multiple tool_use round trips accumulates before the turn ever completes',async t=>{
 const home=await mkdtemp(join(tmpdir(),'claude-interim-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.claude/projects/test');await mkdir(root,{recursive:true});const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'user',uuid:'u',message:{content:'hello ai-village-run-hello'}},{type:'assistant',uuid:'a1',parentUuid:'u',message:{stop_reason:'tool_use',content:[{type:'thinking',text:'ignored'},{type:'text',text:'step one'},{type:'tool_use',id:'t1',name:'Read'}]}}];
 const run=async()=>{await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');return JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));};
 let s=await run();assert.equal(s.turns[0].state,'running');assert.equal(s.turns[0].output,'step one');assert.equal(s.turns[0].completionOffset,undefined);
 assert.equal(terminalBoundary(s,{alive:true,agentSessionId:sid}),false);
 rows.push({type:'user',uuid:'r1',parentUuid:'a1',message:{content:[{type:'tool_result',content:'ok'}]}},{type:'assistant',uuid:'a2',parentUuid:'r1',message:{stop_reason:'tool_use',content:[{type:'text',text:'step two'},{type:'tool_use',id:'t2',name:'Read'}]}});
 s=await run();assert.equal(s.turns[0].state,'running');assert.equal(s.turns[0].output,'step one\n\nstep two');
 rows.push({type:'user',uuid:'r2',parentUuid:'a2',message:{content:[{type:'tool_result',content:'ok'}]}},{type:'assistant',uuid:'a3',parentUuid:'r2',message:{stop_reason:'end_turn',content:[{type:'text',text:'final reply'}]}});
 s=await run();
 assert.equal(s.turns[0].state,'completed');assert.equal(s.turns[0].finalOutput,'final reply');assert.equal(s.turns[0].output,'step one\n\nstep two\n\nfinal reply');
});
test('all visible Codex assistant messages are retained without using their contents for completion',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-prose-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'t'}},...['commentary','final_answer'].map(phase=>({type:'response_item',payload:{role:'assistant',phase,content:[{type:'output_text',text:phase+' free prose'}]}})),{type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'final_answer free prose'}}];
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));assert.equal(s.turns[0].state,'completed');assert.equal(s.turns[0].output,'commentary free prose\n\nfinal_answer free prose');assert.equal(s.turns[0].finalOutput,'final_answer free prose');
});

test('Codex error-bearing completion retains structured reason and cannot become success on duplicate terminal events',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-error-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));
 const sid='11111111-2222-3333-4444-555555555555',error={message:'Selected model is at capacity. Please try a different model.',codex_error_info:'server_overloaded'};
 const rows=[{type:'event_msg',payload:{type:'task_complete',turn_id:'missing',last_agent_message:'unbound'}},{type:'event_msg',payload:{type:'task_started',turn_id:'t'}},{type:'event_msg',payload:{type:'user_message',turn_id:'t',message:'hello ai-village-run-hello'}},{type:'event_msg',payload:{type:'task_complete',turn_id:'t',error,last_agent_message:null}},{type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:null}}];
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const snapshot=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));
 assert.equal(snapshot.available,true);const r=correlate({runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{cursor:0,sessionId:sid},id:'hello',inputMarker:'ai-village-run-hello'},snapshot);
 assert.equal(r.state,'failed');assert.equal(r.errorCode,'server_overloaded');assert.equal(r.error,error.message);assert.deepEqual(r.runtimeError,error);assert(r.completionOffset>snapshot.inputs[0].offset);
 await appendFile(join(dir,'sessions',sid+'.jsonl'),'{"type":');
 const partial=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));assert.equal(partial.incompleteTail,true);assert.equal(terminalBoundary(partial,{alive:true,agentSessionId:sid}),false);
});
test('same native turn steering owns only messages after accepted input, including repeated words and final',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'steering-output-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));
 const sid='11111111-2222-3333-4444-555555555555',file=join(dir,'sessions',sid+'.jsonl');
 const rows=[];
 const add=async payload=>{rows.push(payload);await writeFile(file,rows.map(JSON.stringify).join('\n')+'\n');return JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));};
 const user=(id,text)=>({type:'response_item',payload:{role:'user',id,turn_id:'t',content:[{type:'input_text',text}]}});
 const answer=(id,text)=>({type:'response_item',payload:{role:'assistant',id,turn_id:'t',content:[{type:'output_text',text}]}});
 await add({type:'event_msg',payload:{type:'task_started',turn_id:'t'}});await add(user('u1','original'));let s=await add(answer('m1','途中報告'));
 const run={runModel:{facts:[{type:'transport-ack',at:0}]},baselineRuntime:{sessionId:sid,cursor:s.cursor},id:'supplement',inputMarker:'ai-village-run-supplement',steerTarget:{sessionId:sid,turnId:'t'},priorInputs:s.inputs.map(({id,hash,offset})=>({id,hash,offset}))};
 s=await add(answer('m2','受付直前'));assert.equal(correlate(run,s).state,'unknown');
 s=await add(user('u2','supplement ai-village-run-supplement'));let observed=correlate(run,s);assert.equal(observed.state,'running');assert.equal(observed.output,'');
 Object.assign(run,{turnId:'t',sessionId:sid,inputId:observed.inputId});
 s=await add(answer('m3','途中報告'));assert.equal(correlate(run,s).output,'途中報告');
 s=await add(answer('m4','途中報告'));assert.equal(correlate(run,s).output,'途中報告\n\n途中報告');
 s=await add({type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'途中報告'}});observed=correlate(run,s);assert.equal(observed.finalOutput,'途中報告');assert.equal(observed.state,'completed');assert(!observed.output.includes('受付直前'));
});
// reportPrompt() now tells the model to call finish BEFORE writing the report body, so the
// report is always the run's truly last message. Confirms the native parser correctly isolates
// finalOutput as that last message even when an earlier finish-related tool_use/remark happened
// first in the same turn — the exact shape that previously corrupted finalOutput when the model
// habitually appended a trailing remark *after* the report (old order: report, then finish, then
// "Finish registered." became finalOutput, losing the report).
test('Claude finalOutput isolates the report as the run\'s last message, surviving an earlier finish-tool remark in the same turn',async t=>{
 const home=await mkdtemp(join(tmpdir(),'claude-report-order-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.claude/projects/test');await mkdir(root,{recursive:true});const sid='11111111-2222-3333-4444-555555555555';
 const report='## 報告\n元のご質問に対する結果です。\n\n詳細な本文がここに続きます。';
 const rows=[{type:'user',uuid:'u',message:{content:'報告だけを作成してください'}},{type:'assistant',uuid:'a1',parentUuid:'u',message:{stop_reason:'tool_use',content:[{type:'text',text:'先にfinishを登録します。'},{type:'tool_use',id:'t1',name:'Bash',input:{command:'requests finish ...'}}]}},{type:'user',uuid:'r1',parentUuid:'a1',message:{content:[{type:'tool_result',content:'ok'}]}},{type:'assistant',uuid:'a2',parentUuid:'r1',message:{stop_reason:'end_turn',content:[{type:'text',text:report}]}}];
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));
 assert.equal(s.turns[0].state,'completed');assert.equal(s.turns[0].finalOutput,report);assert.equal(s.turns[0].output,'先にfinishを登録します。\n\n'+report);
});

test('run marker survives Claude paste escaping and whitespace while ownership and competing input fail closed',async t=>{
 const home=await mkdtemp(join(tmpdir(),'claude-marker-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.claude/projects/test');await mkdir(root,{recursive:true});const sid='11111111-2222-3333-4444-555555555555';
 const marker='ai-village-run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const delivered='本文 <pasted_content>\n<ai-village-request> '+marker+' </ai-village-request>';
 const body='\n\n<pasted_content id="abc">\n'+delivered.replace('<pasted_content>','<\\pasted_content>').replace('> '+marker,'>\n  '+marker)+'\n</pasted_content id="abc">\n';
 const rows=[{type:'user',uuid:'u',message:{content:body}},{type:'assistant',uuid:'a',parentUuid:'u',message:{stop_reason:'end_turn',content:[{type:'text',text:'done'}]}}];
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const snapshot=JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));
 const run={id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',runModel:{facts:[{type:'transport-ack',at:0}]},inputMarker:marker,inputHash:inputHash(delivered),baselineRuntime:{sessionId:sid,cursor:0}};
 assert.notEqual(snapshot.inputs[0].hash,run.inputHash);
 const accepted=correlate(run,snapshot);assert.equal(accepted.state,'completed');
 const owned={...run,...accepted,id:run.id};assert.equal(correlate(owned,snapshot).state,'completed');
 const stranger={id:'foreign',turnId:'other',offset:snapshot.cursor+1,text:'no marker',hash:run.inputHash};
 assert.equal(correlate(run,{...snapshot,inputs:[...snapshot.inputs,stranger]}).reason,'competing-or-unmatched-input');
 assert.equal(correlate(owned,{...snapshot,inputs:[{...snapshot.inputs[0],text:'missing',hash:run.inputHash}]}).reason,'owned-input-mismatch');
 assert.equal(correlate(run,{...snapshot,inputs:[{...snapshot.inputs[0],text:marker+'-suffix'}]}).state,'unknown');
 assert.equal(correlate(run,{...snapshot,inputs:[...snapshot.inputs,{...snapshot.inputs[0],id:'duplicate',offset:snapshot.cursor+1}]}).state,'unknown');
 assert.equal(correlate(owned,{...snapshot,inputs:[...snapshot.inputs,{...stranger,turnId:'u'}]}).reason,'additional-input-in-owned-turn');
 assert.equal(correlate({...run,steerTarget:{sessionId:sid,turnId:'wrong'}},snapshot).reason,'steering-target-changed');
});
test('Claude next-turn steering needs adjacent completed target, native user identity and one matching marker',()=>{
 const r={id:'supp',inputMarker:'ai-village-run-supp',steeringProvider:'claude',steerTarget:{sessionId:'s',turnId:'old'},dispatchAttemptedAt:'now',baselineRuntime:{sessionId:'s',cursor:10,fileIdentity:'file'},priorInputs:[{id:'initial',offset:5}]};
 const s={available:true,sessionId:'s',fileIdentity:'file',cursor:40,turns:[{id:'old',state:'completed',completionOffset:20},{id:'next',state:'running',messages:[],messageOffsets:true}],inputs:[{id:'initial',offset:5,turnId:'old',text:'initial'},{id:'supp-input',offset:30,turnId:'next',text:'ai-village-run-supp',explicitTurn:true,source:'claude-user'}]};
 assert.equal(correlate(r,s).state,'running');assert.equal(correlate({...r,steeringProvider:'codex'},s).reason,'steering-target-changed');
 for(const alter of [x=>x.turns[0].state='running',x=>x.turns[0].completionOffset=35,x=>x.turns.splice(1,0,{id:'foreign',state:'completed'}),x=>x.inputs[1].source='claude-queued',x=>x.inputs[1].explicitTurn=false,x=>x.inputs.push({...x.inputs[1],id:'duplicate',offset:31}),x=>x.inputs.push({id:'external',turnId:'next',text:'other',offset:32}),x=>x.sessionId='other',x=>x.fileIdentity='replaced']){const changed=structuredClone(s);alter(changed);assert.equal(correlate(r,changed).state,'unknown');}
});
