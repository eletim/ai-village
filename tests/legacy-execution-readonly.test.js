import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {VillageOperations} from '../server/operations.mjs';

test('removed relay writers and donor exchange cannot mutate or dispatch',async t=>{
 const f=await fixture(t),s=f.service,[a,b]=f.agents,before=JSON.stringify(s.data);
 for(const action of ['relay','relayApply','relayRecover','relaySucceed'])await assert.rejects(async()=>s.conversations[action]({}),e=>e.status===410);
 await assert.rejects(s.adoptRuntime(a.id,{operationId:randomUUID(),revision:0,replacementAgentId:b.id,replacementRevision:0,handover:'legacy'}),/廃止/);
 const ops=new VillageOperations({dir:f.options.dir},null,{direct:s});for(const action of ['relay','relayApply','relayRecover','relaySucceed'])await assert.rejects(async()=>ops.execute(['conversations',action,'{}']),/未対応/);
 assert.equal(JSON.stringify(s.data),before);assert.equal(f.sent.length,0);
});
test('legacy contract metadata remains readable across restart but never grants a send',async t=>{
 const f=await fixture(t),a=f.agents[0];a.inputEnvelope={mode:'legacy'};a.legacyContract={version:1,startedAt:'2020-01-01',reviewAt:'2020-01-08',reason:'historical'};await f.service.save();const s=await f.restart();
 const r=await s.send(a.id,{instruction:'unmigrated work',requestId:randomUUID()});await s.tick();assert.equal(r.runModel.state.kind,'queued');assert.equal(f.sent.length,0);assert.deepEqual(s.agent(a.id).legacyContract,a.legacyContract);assert.equal(s.instructionStatus(a.id).legacyDispatchAllowed,false);assert.equal(r.dispatchAttemptedAt,undefined);
});
for(const state of ['sent','running'])test('already dispatched legacy '+state+' stays observational, never resent',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0],r=await s.send(a.id,{instruction:'existing input',requestId:randomUUID()});if(state==='running')await f.submit(r);
 a.inputEnvelope={mode:'startup-v1'};const facts=structuredClone(r.runModel.facts);await s.save();const re=await f.restart();await re.tick();assert.deepEqual(re.flow.run(r.id).runModel.facts,facts);assert.equal(f.sent.length,1);
});

test('legacy work without an inbox is held before sending; already sent facts remain readable',async t=>{
 const f=await fixture(t),s=f.service;
 const a=f.agents[0];a.inputEnvelope={mode:'legacy'};const r=await s.send(a.id,{instruction:'old work',requestId:randomUUID()}),q=s.flow.root(r.humanRequestId),w=s.flow.work(q,r.workId);delete w.inbox;
 a.inputEnvelope={mode:'startup-v2',version:2};await s.attemptRun(r);assert.equal(r.runModel.state.reason,'legacy-work-read-only');assert.equal(f.sent.length,0);assert.equal(r.dispatchAttemptedAt,undefined);
});

test('new replacement delegation is rejected before creating a node or run',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'parent',requestId:randomUUID()});await f.submit(r);const before=JSON.stringify(s.data);
 await assert.rejects(s.flow.delegate({humanRequestId:r.humanRequestId,parentWorkId:r.workId,actorRunId:r.id,agentId:f.agents[2].id,operationId:randomUUID(),instruction:'replacement',replacesRequestId:'old-child'}),/旧置換/);assert.equal(JSON.stringify(s.data),before);
});
