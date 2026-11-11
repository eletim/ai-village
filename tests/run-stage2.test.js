import {fixtureModels} from './model-fixtures.mjs';
import {receipt} from './model-fixtures.mjs';
import {testView} from './model-fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateDirect} from '../server/state/migrate.ts';
import {migrateRunStore} from '../server/run-migration.mjs';
import {changeRun,initializeRun,observeRun} from '../server/run-lifecycle.mjs';
import {DirectAgents} from '../server/direct.mjs';
import {humanProjection} from '../server/report-view.mjs';
import {recoveryRequests,needsRunRecovery} from '../src/run-recovery.js';
const oldRun=state=>({id:'r',agentId:'a',state,blocksInput:true,dispatchAttemptedAt:'2026-11-11T00:00:00.000Z',baselineRuntime:{sessionId:'s',cursor:10,fileIdentity:'f'},inputMarker:'ai-village-run-r',acceptance:'accepted',sessionId:'s',turnId:'t',inputId:'i'});
const data=run=>({version:1,agents:[],workshops:[],runs:[run],requests:[]});
test('stage2 migration preserves in-flight ownership and ends only released uncertainty',()=>{
 for(const state of ['sending','awaiting_input','running','waiting_input','unknown','send_unknown']){
  const r=oldRun(state),before=structuredClone(r),m=migrateDirect(data(r),{resumeInFlight:true});assert.equal(testView(m.runs[0]).state.kind,'running',state);assert.deepEqual(r,before);
 }
 for(const state of ['unknown','send_unknown']){const m=migrateDirect(data({...oldRun(state),blocksInput:false}),{resumeInFlight:true});assert.equal(testView(m.runs[0]).state.outcome,'unconfirmed');}
 const r=oldRun('sending');delete r.inputId;const m=migrateDirect(data(r),{resumeInFlight:true});assert.deepEqual(testView(m.runs[0]).state,{kind:'sent',sessionId:'s',sentAt:Date.parse(r.dispatchAttemptedAt)});
});
test('migration durably backs up original bytes once; repeated startup does not reinterpret active states',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'run-migrate-'));t.after(()=>rm(dir,{recursive:true,force:true}));const old=data(oldRun('running')),bytes=JSON.stringify(old);await writeFile(join(dir,'direct.json'),bytes);
 const next=await migrateRunStore(dir,old);assert.equal(next.runs[0].runModel.state.kind,'running');assert.deepEqual(next.runs[0].baselineRuntime,old.runs[0].baselineRuntime);assert.equal(await readFile(join(dir,'direct.pre-run-state-v1.json'),'utf8'),bytes);
 assert.deepEqual(await migrateRunStore(dir,next),next);assert.equal(await readFile(join(dir,'direct.pre-run-state-v1.json'),'utf8'),bytes);
});
test('migration rejects malformed IDs, tracked orphans and unknown versions before replacing data',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'run-migrate-bad-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const bad of [{...data(oldRun('running')),runStateVersion:77},data({...oldRun('running'),humanRequestId:'missing'}),data({...oldRun('running'),id:''}),{...data(oldRun('running')),runs:'bad'}]){
  const bytes=JSON.stringify(bad);await writeFile(join(dir,'direct.json'),bytes);await assert.rejects(migrateRunStore(dir,bad));assert.equal(await readFile(join(dir,'direct.json'),'utf8'),bytes);
 }
});
test('adapter cannot accept wrong actors; terminal uncertainty cannot later become success',()=>{
 const r={id:'r',humanRequestId:'q'};initializeRun(r);assert.throws(()=>changeRun(r,{type:'dispatch',actor:'agent',at:1,agentIdle:true,sessionId:'s'}),/actor-forbidden/);
 changeRun(r,{type:'dispatch',actor:'program',at:1,agentIdle:true,sessionId:'s'});changeRun(r,{type:'lost',actor:'program',at:2,reason:'timeout'});assert.equal(r.runModel.state.outcome,'unconfirmed');assert.equal(receipt(r).blocksInput,false);assert.throws(()=>changeRun(r,{type:'terminal',actor:'program',at:3,sessionId:'s',turnId:'t',outcome:'normal'}),/run-terminal/);
});
test('resumed legacy sent input supports native hash proof without manufacturing a marker',()=>{
 const r={...oldRun('awaiting_input'),acceptance:'pending',inputHash:'hash'};delete r.inputMarker;delete r.inputId;delete r.turnId;delete r.sessionId;
 fixtureModels({runs:[r]});observeRun(r,{state:'completed',sessionId:'s',turnId:'t',inputId:'i'},{inputs:[{id:'i',turnId:'t',offset:20,text:'human',hash:'hash'}]});assert.equal(r.runModel.state.outcome,'normal');
});
test('unresolved tracking times out even after blocksInput=false',()=>{
 const d=new DirectAgents({dir:'/unused',notifier:{status:()=>({})}}),r=oldRun('unknown');r.blocksInput=false;
 // This is an in-flight migrated record, subsequently unblocked by an observer.
 r.runModel=migrateDirect(data({...r,blocksInput:true}),{resumeInFlight:true}).runs[0];r.error='runtime-unavailable';r.unknownSince=new Date(Date.now()-600001).toISOString();d.data.runs=[r];d.releaseStuckRuns({id:'a'});assert.equal(r.runModel.state.outcome,'unconfirmed');
});
test('unconfirmed report releases reportPending and stays recoverable with a deleted/missing agent',()=>{
 const r={id:'r',humanRequestId:'q',agentId:'a',phase:'report',state:'terminated',needsReview:true,runModel:{state:{kind:'ended',outcome:'unconfirmed',reason:'timeout'}}};
 const w={id:'w',currentRunId:'r',agentId:'a',parentWorkId:null},q={id:'q',revision:1,status:'active',reportMode:true,works:[w],instruction:'test'};
 const d={runs:[r],requests:[q],agents:[{id:'a',deletedAt:'yes',state:'terminated'}]};q.requestModel={state:{kind:'active',review:['timeout']},runs:[],declarations:[]};d.agents[0].agentModel={id:'a',intent:'stop',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}};assert(needsRunRecovery(q,r,w));assert.equal(humanProjection(d).agents[0].reportPending,undefined);assert.equal(recoveryRequests(d)[0].canRetry,false);d.agents=[];assert.equal(recoveryRequests(d)[0].agentName,'削除済みAgent');q.requestModel.state={kind:'withdrawn'};assert.equal(recoveryRequests(d).length,0);
});
test('each lost event is terminal, clears blocking and disallows automatic retry',()=>{
 for(const reason of ['session-changed','turn-ended-without-marker','timeout','agent-stopped']){
  const r={id:'r',humanRequestId:'q',blocksInput:true};initializeRun(r);changeRun(r,{type:'dispatch',actor:'program',sessionId:'s',at:1,agentIdle:true});changeRun(r,{type:'lost',actor:'program',at:2,reason});assert.deepEqual(r.runModel.state,{kind:'ended',outcome:'unconfirmed',reason});assert.equal(receipt(r).blocksInput,false);
 }
});
test('versioned corrupt outcome is rejected rather than treated as normal or remigrated',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'run-corrupt-'));t.after(()=>rm(dir,{recursive:true,force:true}));const next=await migrateRunStore(dir,data({...oldRun('unknown'),blocksInput:false}));next.runs[0].runModel.state.outcome='invented';const before=await readFile(join(dir,'direct.json'),'utf8');await assert.rejects(migrateRunStore(dir,next),/Invalid run model/);assert.equal(await readFile(join(dir,'direct.json'),'utf8'),before);
});
test('recovery projection never leaks runtime error snippets from hidden report output',()=>{
 const d={agents:[{id:'a',tabId:'tab'}],runs:[{id:'r',agentId:'a',humanRequestId:'q',phase:'report',state:'failed',error:'SECRET report text'}],requests:[{id:'q',status:'active',reportMode:true,works:[{id:'w',agentId:'a',currentRunId:'r'}]}]};assert(!JSON.stringify(recoveryRequests(d)).includes('SECRET'));
});
test('restart preserves overloaded retry budget instead of granting a new automatic budget',()=>{
 const r={...oldRun('failed'),humanRequestId:'q',workId:'w',errorCode:'server_overloaded',completedAt:'2026-11-11T00:00:00Z'};
 const d={...data(r),requests:[{id:'q',rootWorkId:'w',status:'active',inbox:[],works:[{id:'w',currentRunId:'r',runIds:['r'],autoRetry:{attempts:2,firstFailureAt:100}}]}]};assert.deepEqual(migrateDirect(d,{resumeInFlight:true}).runs[0].retryBudget,{count:2,firstFailureAt:100});
});
test('an unsent supplement preserves reversible ownership across legacy migration',()=>{
 const r={...oldRun('superseded'),supersededBy:'next'},next={id:'next',state:'queued'};
 const m=migrateDirect({...data(r),runs:[r,next]},{resumeInFlight:true}).runs[0];assert.equal(testView(m).state.kind,'running');const imported={...r,runModel:m};changeRun(imported,{type:'restore',actor:'human',successorId:'next'});assert.equal(testView(imported).state,'running');
});
test('a brief disconnect after a long healthy run starts a fresh uncertainty interval',()=>{
 const d=new DirectAgents({dir:'/unused',notifier:{status:()=>({})}}),r=oldRun('running');r.runModel=migrateDirect(data(r),{resumeInFlight:true}).runs[0];r.error='runtime-unavailable';d.data.runs=[r];d.releaseStuckRuns({id:'a'});assert.equal(r.runModel.state.kind,'running');assert(Date.now()-Date.parse(r.unknownSince)<2000);
});
