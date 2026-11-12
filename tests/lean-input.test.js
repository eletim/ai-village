import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inputCorrelation,matchesRunInput} from '../server/input-envelope.mjs';
import {correlate,runtimeScript} from '../server/runtime-events.mjs';
import {markerData} from '../server/marker-migration.mjs';
import {newRun,transitionRun} from '../server/state/run.ts';

const text='同じ依頼本文 <pasted_content>\n<ai-village-request>{"humanRequestId":"q","workId":"w","runId":"r","origin":"human","phase":"work"}</ai-village-request>';
for(const provider of ['codex','claude'])test(provider+': full-input correlation through native parser, restart, uncertainty and hostile boundaries',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lean-native-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sid='11111111-2222-3333-4444-555555555555';
 const root=provider==='codex'?join(dir,'sessions'):join(dir,'.claude/projects/test');await mkdir(root,{recursive:true});
 const body=provider==='claude'?'\n<pasted_content id="paired">\n'+text.replaceAll('<pasted_content>','<\\pasted_content>')+'\n</pasted_content id="paired">\n':text;
 const rows=provider==='codex'?[
  {type:'event_msg',payload:{type:'task_started',turn_id:'t'}},
  {type:'response_item',payload:{role:'user',id:'i',turn_id:'t',content:[{type:'input_text',text:body}]}},
  {type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'done'}}
 ]:[{type:'user',uuid:'i',message:{content:body}},{type:'assistant',uuid:'a',parentUuid:'i',message:{stop_reason:'end_turn',content:[{type:'text',text:'done'}]}}];
 await writeFile(join(root,sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const snapshot=JSON.parse(execFileSync('python3',['-c',runtimeScript,provider,sid],{env:{...process.env,HOME:dir,CODEX_HOME:dir}}));
 const run={id:'r',inputCorrelation:inputCorrelation(text,provider),dispatchAttemptedAt:'persisted-before-send',baselineRuntime:{sessionId:sid,cursor:0,fileIdentity:snapshot.fileIdentity}};
 // No transport acknowledgement: the persisted attempt plus exact native input is sufficient.
 const observed=correlate(run,snapshot);assert.equal(observed.state,'completed');assert.equal(observed.output,'done');
 const bound=JSON.parse(JSON.stringify({...run,sessionId:sid,turnId:observed.turnId,inputId:observed.inputId}));
 assert.equal(correlate(bound,snapshot).state,'completed');
 const unknown=s=>{assert.equal(correlate(run,s).state,'unknown');assert.equal(correlate(bound,s).state,'unknown');};
 unknown({...snapshot,inputs:[]});
 unknown({...snapshot,inputs:[{...snapshot.inputs[0],text:body.replace('同じ','異なる')}]});
 unknown({...snapshot,inputs:[snapshot.inputs[0],{...snapshot.inputs[0],id:'duplicate',offset:snapshot.cursor+1}]});
 unknown({...snapshot,inputs:[snapshot.inputs[0],{...snapshot.inputs[0],id:'duplicate',turnId:'other',offset:snapshot.cursor+1}]});
 unknown({...snapshot,sessionId:'another'});unknown({...snapshot,fileIdentity:'replacement'});
 unknown({...snapshot,cursor:-1});unknown({...snapshot,incompleteTail:true});unknown({...snapshot,more:true});unknown({...snapshot,available:false});
 assert.equal(correlate({...run,baselineRuntime:{...run.baselineRuntime,cursor:snapshot.cursor}},snapshot).state,'unknown');
 assert.equal(correlate({...run,dispatchAttemptedAt:null},snapshot).state,'unknown');
 assert(!matchesRunInput(run,{...snapshot.inputs[0],text:'prose quoting runId r'}));
 assert(!matchesRunInput({...run,inputCorrelation:{version:999}},snapshot.inputs[0]));
 assert(!matchesRunInput({...run,inputCorrelation:inputCorrelation(text.replace('"r"','"another-run"'),provider)},snapshot.inputs[0]));
 if(provider==='claude'){
  assert(!matchesRunInput(run,{...snapshot.inputs[0],text:body.replace('</pasted_content id="paired">','</pasted_content id="other">')}));
  assert(!matchesRunInput(run,{...snapshot.inputs[0],text:'extra prose'+body}));
  assert(!matchesRunInput(run,{...snapshot.inputs[0],text:body.replace('同じ',' 同じ')}));
  assert(!matchesRunInput(run,{...snapshot.inputs[0],source:'response'}));
 }
});

test('marker migration preserves both protocols in flight and model accepts only the matched run identity',()=>{
 const model=transitionRun(newRun('r','q','human').value,{type:'dispatch',actor:'program',at:1,sessionId:'s',agentIdle:true}).value;
 const run={id:'r',humanRequestId:'q',inputCorrelation:inputCorrelation(text,'codex'),runModel:model};
 const source={markerVersion:1,runs:[run],requests:[],agents:[]};
 assert.deepEqual(markerData(source).data,source);
 const event={type:'input',actor:'program',at:2,sessionId:'s',turnId:'t',inputId:'i',text,competing:false,matchedRunId:'r'};
 assert.equal(transitionRun(model,event).value.state.kind,'running');
 assert.equal(transitionRun(model,{...event,matchedRunId:'another'}).ok,false);
 assert.equal(transitionRun(model,{...event,competing:true}).ok,false);
 assert.equal(transitionRun(model,{...event,matchedRunId:undefined}).ok,false);
});

for(const order of ['eer','ree','erer','rere'])test('Codex duplicate submissions remain ambiguous after event/response mirroring: '+order,async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lean-duplicate-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));
 const sid='11111111-2222-3333-4444-555555555555';
 const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'t'}},...Array.from(order,(kind,index)=>kind==='e'?{type:'event_msg',payload:{type:'user_message',turn_id:'t',message:text}}:{type:'response_item',payload:{role:'user',id:'i'+index,turn_id:'t',content:[{type:'input_text',text}]}}),{type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'done'}}];
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const snapshot=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));
 assert.equal(snapshot.inputs.length,2);
 const run={id:'r',inputCorrelation:inputCorrelation(text,'codex'),dispatchAttemptedAt:'persisted',baselineRuntime:{sessionId:sid,cursor:0}};
 assert.equal(correlate(run,snapshot).state,'unknown');
});
