import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correlate,inputHash,runtimeScript} from '../server/runtime-events.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('native Codex JSONL input/message/turn identities are independent of arbitrary reply text',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-events-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));
 const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'turn-1'}},{type:'response_item',payload:{role:'user',id:'msg-1',content:[{type:'input_text',text:'hello'}],internal_chat_message_metadata_passthrough:{turn_id:'turn-1',content_item_kinds:['user.text']}}},{type:'event_msg',payload:{type:'task_complete',turn_id:'turn-1',last_agent_message:'not JSON; no declaration'}}];
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));
 const r=correlate({dispatchConfirmed:true,baselineRuntime:{cursor:0,sessionId:sid},inputHash:inputHash('hello')},s);assert.equal(r.state,'completed');assert.equal(r.turnId,'turn-1');assert.equal(r.output,'not JSON; no declaration');assert.equal(r.finalOutput,'not JSON; no declaration');
 rows.push({type:'event_msg',payload:{type:'task_started',turn_id:'turn-2'}},{type:'event_msg',payload:{type:'turn_aborted',turn_id:'turn-2'}});
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const later=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));assert.equal(later.turns.at(-1).state,'interrupted');assert.equal(correlate({...r},later).output,r.output);
});
test('unmatched, duplicate, missing or replaced runtime input stays unknown',()=>{
 const run={dispatchConfirmed:true,baselineRuntime:{sessionId:'s',cursor:10},inputHash:inputHash('same')};
 const s={available:true,sessionId:'s',inputs:[{id:'1',hash:run.inputHash,turnId:'t',offset:5}],turns:[{id:'t',state:'completed',output:'stale'}]};
 assert.equal(correlate(run,s).state,'unknown');s.inputs[0].offset=20;s.inputs.push({...s.inputs[0],id:'2',turnId:'other'});assert.equal(correlate(run,s).state,'unknown');
 assert.equal(correlate(run,{...s,sessionId:'replaced'}).state,'unknown');assert.equal(correlate(run,{available:false}).state,'unknown');
});
test('lost send acknowledgement and additional input in an owned turn never get assigned by prose',()=>{
 const s={available:true,sessionId:'s',cursor:50,inputs:[{id:'one',turnId:'t',hash:inputHash('hello'),offset:10}],turns:[{id:'t',state:'completed',output:'done'}]};
 const run={baselineRuntime:{sessionId:'s',cursor:0},inputHash:inputHash('hello')};
 assert.equal(correlate(run,s).state,'unknown');
 const bound=correlate({...run,dispatchConfirmed:true},s);assert.equal(bound.state,'completed');
 s.inputs.push({id:'steering',turnId:'t',hash:inputHash('external'),offset:30});assert.equal(correlate(bound,s).state,'unknown');
});
test('Claude native UUID ancestry and stop reasons distinguish replies from API errors',async t=>{
 const home=await mkdtemp(join(tmpdir(),'claude-native-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.claude/projects/test');await mkdir(root,{recursive:true});const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'user',uuid:'input-1',message:{content:'hello'}},{type:'assistant',uuid:'tool',parentUuid:'input-1',message:{stop_reason:'tool_use',content:[]}},{type:'user',uuid:'tool-result',parentUuid:'tool',message:{content:[{type:'tool_result',content:'ok'}]}},{type:'assistant',uuid:'answer',parentUuid:'tool-result',message:{stop_reason:'end_turn',content:[{type:'text',text:'arbitrary prose'}]}},{type:'user',uuid:'input-2',parentUuid:'answer',message:{content:'hello again'}},{type:'assistant',uuid:'error',parentUuid:'input-2',isApiErrorMessage:true,error:'authentication_failed',message:{stop_reason:'stop_sequence',content:[{type:'text',text:'Login expired'}]}}];
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));
 assert.equal(s.inputs.length,2);assert.equal(s.turns[0].state,'completed');assert.equal(s.turns[0].output,'arbitrary prose');assert.equal(s.turns[1].state,'failed');assert.equal(s.turns[1].error,'authentication_failed');
 rows.push({type:'user',uuid:'input-3',message:{content:'more'}},{type:'assistant',uuid:'limit',parentUuid:'input-3',message:{stop_reason:'max_tokens',content:[{type:'text',text:'truncated'}]}});
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const limited=JSON.parse(execFileSync('python3',['-c',runtimeScript,'claude',sid],{env:{...process.env,HOME:home}}));assert.equal(limited.turns[2].state,'interrupted');
});
test('all visible Codex assistant messages are retained without using their contents for completion',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-prose-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'t'}},...['commentary','final_answer'].map(phase=>({type:'response_item',payload:{role:'assistant',phase,content:[{type:'output_text',text:phase+' free prose'}]}})),{type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'final_answer free prose'}}];
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');const s=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));assert.equal(s.turns[0].state,'completed');assert.equal(s.turns[0].output,'commentary free prose\n\nfinal_answer free prose');assert.equal(s.turns[0].finalOutput,'final_answer free prose');
});
