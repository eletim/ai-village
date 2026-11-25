import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
import {changeRun} from '../server/run-lifecycle.mjs';
import {observeRequest} from '../server/request-lifecycle.mjs';
import {validateGraph} from '../server/unified-requests.mjs';
import {latest} from '../server/state/requests.ts';
async function fixture(t){
 const x=await purposeFixture(t),{f}=x;await f.service.tick();const r=f.service.flow.run(x.first.runId);await f.submit(r);
 const q=()=>f.service.flow.root(r.humanRequestId),w=()=>q().requestGraph.nodes[0];
 changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'session-changed'});r.error='runtime-file-replaced';observeRequest(f.service.data,q());
 const a=f.service.agent(r.agentId);a.inputEnvelope={...a.inputEnvelope,mode:'migration-required',reason:'native-session-changed'};
 await f.service.save();const input={humanRequestId:r.humanRequestId,workId:r.workId,actorRunId:r.id,operationId:randomUUID()};
 return {...x,r,q,w,input};
}
test('self reconciliation preserves lost and old submission, sends nothing, persists and later requires true native terminal',async t=>{
 const x=await fixture(t),{f,r,input}=x,prior=structuredClone(x.w().submissions[0]),sent=f.sent.length;
 const result=await f.service.flow.reconcileObservation(input);assert.equal(result.state,'running');assert.equal(f.sent.length,sent);assert(r.runModel.facts.some(f=>f.type==='lost'));
 assert.deepEqual(x.w().observationCorrections[0].priorSubmission,prior);assert.equal(latest(x.w()),undefined);validateGraph(f.service.data,x.q());
 assert.deepEqual(await f.service.flow.reconcileObservation(input),result);await f.restart();assert.deepEqual(await f.service.flow.reconcileObservation(input),result);
 const current=f.service.flow.run(r.id);assert.equal(current.runModel.state.kind,'running');
 await f.service.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:x.w().inbox.map(i=>i.id),results:[]});
 await f.complete(current);assert.equal(current.runModel.state.outcome,'normal');assert.equal(latest(x.w()).outcome,'normal');assert.equal(latest(x.w()).version,2);assert.deepEqual(x.w().observationCorrections[0].priorSubmission,prior);validateGraph(f.service.data,x.q());
 await f.restart();assert.equal(f.service.flow.root(r.humanRequestId).integrity,undefined);
});
test('mismatched native identity, input and contract reject without changing prior unknown',async t=>{
 for(const mode of ['session','file','hash','contract','turn']){
  const x=await fixture(t),{f,r}=x,before=JSON.stringify(x.q()),a=f.service.agent(r.agentId),native=f.runtimes.get(a.id);
  if(mode==='session')native.sessionId='wrong';if(mode==='file')native.fileIdentity='wrong';if(mode==='hash')native.inputs.at(-1).hash='wrong';if(mode==='turn')native.turns.at(-1).id='wrong';if(mode==='contract')f.promptState('changed');
  await assert.rejects(f.service.flow.reconcileObservation(x.input));assert.equal(r.runModel.state.outcome,'unconfirmed');assert.equal(JSON.stringify(x.q()),before);
 }
});
test('self-only current root, other pending sends and withdrawal remain fenced',async t=>{
 const x=await fixture(t),{f,r}=x;
 await assert.rejects(f.service.flow.reconcileObservation({...x.input,actorRunId:x.human.id}));
 x.w().state={kind:'withdrawn',reason:'human'};await assert.rejects(f.service.flow.reconcileObservation(x.input));assert.equal(r.runModel.state.outcome,'unconfirmed');
});
test('saving reconciliation failure rolls back run, contract and graph; retry uses one operation',async t=>{
 const x=await fixture(t),{f,r}=x,prior=JSON.stringify([r,x.q(),f.service.agent(r.agentId).inputEnvelope]),write=f.service.store.write;
 f.service.store.write=async()=>{throw Error('disk failure');};await assert.rejects(f.service.flow.reconcileObservation(x.input),/disk failure/);f.service.store.write=write;
 assert.equal(JSON.stringify([r,x.q(),f.service.agent(r.agentId).inputEnvelope]),prior);
 await f.service.flow.reconcileObservation(x.input);assert.equal(x.w().observationCorrections.length,1);
});
test('duplicate native input, additional turn, pending send and foreign contract reject',async t=>{
 for(const mode of ['duplicate','later','queued','envelope']){
  const x=await fixture(t),{f,r}=x,a=f.service.agent(r.agentId),native=f.runtimes.get(a.id);
  if(mode==='duplicate')native.inputs.push({...native.inputs.at(-1),id:'duplicate',offset:native.cursor+1});
  if(mode==='later')native.turns.push({id:'later',state:'running'});
  if(mode==='queued')f.service.data.runs.push({...structuredClone(r),id:randomUUID(),runModel:{...r.runModel,state:{kind:'queued'},facts:[]}});
  if(mode==='envelope')a.inputEnvelope.reason='startup-instructions-missing-or-changed';
  await assert.rejects(f.service.flow.reconcileObservation(x.input));assert.equal(r.runModel.state.outcome,'unconfirmed');
 }
});
test('forged retraction without matching recorded proof fails restart validation',async t=>{
 const x=await fixture(t),{f,r}=x;
 await f.service.flow.reconcileObservation(x.input);
 const proof=r.observationReconciliation;delete r.observationReconciliation;
 assert.throws(()=>validateGraph(f.service.data,x.q()),/reconciliation proof/);r.observationReconciliation=proof;
 const prior=x.w().observationCorrections[0].priorSubmission;prior.outcome='normal';assert.throws(()=>validateGraph(f.service.data,x.q()),/reconciliation proof/);
});
test('another lost observation remains unconfirmed with both observation versions preserved',async t=>{
 const x=await fixture(t),{f,r}=x,prior=structuredClone(x.w().submissions[0]);await f.service.flow.reconcileObservation(x.input);
 changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});observeRequest(f.service.data,x.q());
 assert.equal(latest(x.w()).outcome,'unconfirmed');assert.equal(latest(x.w()).version,2);assert.deepEqual(x.w().observationCorrections[0].priorSubmission,prior);validateGraph(f.service.data,x.q());
 await f.service.save();await f.restart();assert.equal(x.q().integrity,undefined);assert.equal(f.service.flow.run(r.id).runModel.state.outcome,'unconfirmed');await assert.rejects(f.service.flow.reconcileObservation({...x.input,operationId:randomUUID()}));
});
test('native endpoint records after withdrawal and without finish never imply work acceptance',async t=>{
 for(const mode of ['withdrawn','completed','no-finish']){
  const x=await fixture(t),{f,r}=x,prior=structuredClone(x.w().submissions[0]);await f.service.flow.reconcileObservation(x.input);
  if(mode!=='no-finish')x.w().state=mode==='withdrawn'?{kind:'withdrawn',reason:'human'}:{kind:'completed',by:'human',reason:'human'};
  await f.complete(r);const observed=x.w().submissions.find(s=>s.runId===r.id);assert.equal(observed.outcome,'normal');assert.equal(observed.version,2);assert.deepEqual(x.w().observationCorrections[0].priorSubmission,prior);
  assert.equal(x.w().state.kind,mode==='no-finish'?'active':mode);assert.equal(x.w().declarations.length,0);validateGraph(f.service.data,x.q());
  await f.restart();assert.equal(x.q().integrity,undefined);assert.equal(x.w().state.kind,mode==='no-finish'?'active':mode);
 }
});
test('persisted proof input hash, contract and operation receipt are required by validation',async t=>{
 const x=await fixture(t),{f,r}=x;await f.service.flow.reconcileObservation(x.input);
 const proof=r.observationReconciliation.proof;
 for(const field of ['inputHash','contractHash']){const value=proof[field];proof[field]='forged';assert.throws(()=>validateGraph(f.service.data,x.q()),/reconciliation proof/);proof[field]=value;}
 const op=x.q().requestGraph.operations.find(o=>o.id===x.input.operationId),receipt=op.observationReconciliation;delete op.observationReconciliation;assert.throws(()=>validateGraph(f.service.data,x.q()),/reconciliation proof/);op.observationReconciliation=receipt;validateGraph(f.service.data,x.q());
});
