import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {enrollLegacy,legacyAllowed,legacyReviewDue} from '../server/legacy-contract.mjs';
test('old sessions receive a visible migration-waiting boundary once; v2 failures never fall back',()=>{
 const old={inputEnvelope:{mode:'startup-v1'}};enrollLegacy(old,1000);const copy=structuredClone(old);enrollLegacy(old,9000);assert.deepEqual(old,copy);assert(legacyAllowed(old,2000));assert(legacyAllowed(old,1000+7*86400000));assert(legacyReviewDue(old,1000+7*86400000));old.runtimeUpgrade={state:'prepared'};assert(!legacyAllowed(old,2000));
 for(const mode of ['startup-v2','migration-required']){const a={inputEnvelope:{mode}};enrollLegacy(a);assert.equal(a.legacyContract,undefined);assert(!legacyAllowed(a));}
});
test('target preparation holds only its queued work while unrelated old Agents keep dispatching across restart',async t=>{
 const f=await fixture(t);for(const a of f.agents.slice(0,2))a.inputEnvelope={mode:'legacy',reason:'request-rules-updated'};await f.service.save();let s=await f.restart();
 const [a,b]=f.agents.map(a=>s.agent(a.id)),reviewAt=a.legacyContract.reviewAt;
 const x={operationId:randomUUID(),revision:0},receipt=await s.prepareRuntime(a.id,x);assert.deepEqual(await s.prepareRuntime(a.id,x),receipt);
 const held=await s.send(a.id,{instruction:'held target',requestId:randomUUID()});assert.equal(held.runModel.state.kind,'queued');assert.equal(f.sent.length,0);
 const other=await s.send(b.id,{instruction:'unrelated continues',requestId:randomUUID()});assert.equal(other.runModel.state.kind,'sent');assert.equal(other.inputEnvelopeMode,'legacy-compat');assert.equal(f.sent.length,1);assert(f.sent[0].text.includes('移行待ち互換入力'));assert(f.sent[0].text.includes('rules get work ACTION'));assert.equal(b.inputEnvelope.mode,'legacy');
 await s.save();s=await f.restart();assert.equal(s.agent(a.id).legacyContract.reviewAt,reviewAt);assert.deepEqual(await s.prepareRuntime(a.id,x),receipt);assert.equal(s.flow.run(held.id).dispatchAttemptedAt,undefined);
});
test('preparing a running target does not cancel its native execution; review date never blocks unrelated dispatch',async t=>{
 const f=await fixture(t),a=f.agents[0];a.inputEnvelope={mode:'startup-v1'};await f.service.save();const s=await f.restart(),target=s.agent(a.id),r=await s.send(a.id,{instruction:'existing execution',requestId:randomUUID()});await f.submit(r);
 const before=structuredClone(r.runModel);await s.prepareRuntime(a.id,{operationId:randomUUID(),revision:0});assert.deepEqual(r.runModel,before);assert.equal(f.sent.length,1);
 const b=s.agent(f.agents[1].id);b.inputEnvelope={mode:'legacy'};enrollLegacy(b,0);const continued=await s.send(b.id,{instruction:'review date passed',requestId:randomUUID()});assert.equal(continued.runModel.state.kind,'sent');assert.equal(f.sent.length,2);assert.equal(s.instructionStatus(b.id).legacyDispatchAllowed,true);assert.equal(s.instructionStatus(b.id).legacyMigrationReviewDue,true);
});
