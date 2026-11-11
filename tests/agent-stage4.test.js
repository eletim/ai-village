import {receipt} from './model-fixtures.mjs';
import {testView} from './model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bindAgent,agentChange,runtimeObservation,projectControls} from '../server/agent-lifecycle.mjs';
import {migrateAgentStore} from '../server/agent-migration.mjs';
import {durableData} from '../server/direct-store.mjs';
import {initializeRun,changeRun} from '../server/run-lifecycle.mjs';
const idle={connected:true,process:'alive',activity:'idle',canSteer:false};
test('saved flags cannot override observations and reports never gate send controls',()=>{
 const a=bindAgent({id:'a',state:'busy',canSend:false,reportPending:true});
 assert.equal(testView(a).canSend,false);agentChange(a,{type:'observe',actor:'program',observation:idle});
 assert.equal(testView(a).state,'idle');assert.equal(testView(a).canSend,true);
 a.canSend=false;assert.equal(testView(a).canSend,true);delete a.canSend;
 for(const [activity,state] of [['running','busy'],['input-needed','waiting_input'],['unknown','unknown']]){
  agentChange(a,{type:'observe',actor:'program',observation:{...idle,activity}});assert.equal(testView(a).state,state);assert.equal(testView(a).canSend,false);
 }
 agentChange(a,{type:'stop',actor:'human'});assert.equal(testView(a).state,'stopping');
 agentChange(a,{type:'observe',actor:'program',observation:{...idle,process:'absent'}});assert.equal(testView(a).state,'terminated');
});
test('permission is structured evidence even when native history is unavailable',()=>{
 const observation=runtimeObservation({alive:true,cliState:'waiting-for-permission',permissionRequest:{toolName:'Bash'}},{available:false,turns:[],inputs:[]});
 assert.equal(observation.activity,'input-needed');assert.equal(observation.process,'alive');
 const disconnected=bindAgent({id:'a'});agentChange(disconnected,{type:'observe',actor:'program',observation:{...idle,connected:false}});assert.equal(testView(disconnected).canQueue,false);
});
test('pending physical dispatch prevents a second send; only owned Codex running input permits steering',()=>{
 const a=bindAgent({id:'a',provider:'codex',runtime:{cliState:'busy',agentSessionId:'s'}});
 agentChange(a,{type:'observe',actor:'program',observation:idle});
 const r={id:'r',agentId:'a',humanRequestId:'q'};initializeRun(r);changeRun(r,{type:'dispatch',actor:'program',at:1,agentIdle:true});
 projectControls(a,[r]);assert.equal(testView(a).canSend,false);assert.equal(testView(a).canQueue,true);assert.equal(testView(a).canSteer,false);
 changeRun(r,{type:'input',actor:'program',at:2,sessionId:'s',turnId:'t',inputId:'i',text:'ai-village-run-r',competing:false});r.sessionId='s';r.turnId='t';
 agentChange(a,{type:'observe',actor:'program',observation:{...idle,activity:'running'}});projectControls(a,[r]);assert.equal(testView(a).canSteer,true);
 r.error='competing-or-unmatched-input';projectControls(a,[r]);assert.equal(testView(a).canSteer,false);
});
test('transport receipts exist only as model facts, with no persisted compatibility fields',()=>{
 const a=bindAgent({id:'a'}),r={id:'r',humanRequestId:'q'};initializeRun(r);changeRun(r,{type:'dispatch',actor:'program',at:1,agentIdle:true});changeRun(r,{type:'transport-ack',actor:'program',at:2});
 assert.equal(receipt(r).dispatchConfirmed,true);assert.equal(receipt(JSON.parse(JSON.stringify(r))).acceptance,'pending');
 const saved=durableData({agents:[a],runs:[r]});assert.equal(saved.agents[0].state,undefined);assert.equal(saved.runs[0].acceptance,undefined);assert(saved.runs[0].runModel.facts.some(f=>f.type==='transport-ack'));
});
test('agent migration backs up once, distrusts saved idle flags, preserves active run identities and rejects invalid versions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'agent-stage4-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source={agents:[{id:'a',state:'idle',canSend:true}],runs:[{id:'r',sessionId:'s',turnId:'t',inputId:'i',runModel:{state:{kind:'running'}}}],requests:[]};
 const bytes=JSON.stringify(source);await writeFile(join(dir,'direct.json'),bytes);
 const migrated=await migrateAgentStore(dir,source);assert.equal(migrated.agentStateVersion,1);assert.equal(migrated.agents[0].agentModel.observation,null);assert.deepEqual(migrated.runs,source.runs);
 assert.equal(await readFile(join(dir,'direct.pre-agent-state-v1.json'),'utf8'),bytes);assert.deepEqual(await migrateAgentStore(dir,migrated),migrated);
 await assert.rejects(migrateAgentStore(dir,{...migrated,agentStateVersion:2}),/Unsupported/);
 await assert.rejects(migrateAgentStore(dir,{...migrated,agents:[{id:'a',agentModel:{id:'wrong'}}]}),/Invalid/);
});
