import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AgentRules} from '../server/agent-rules.mjs';
import {VillageOperations} from '../server/operations.mjs';
import {RequestFlow} from '../server/requests.mjs';
import {fixture} from './inbox-fixture.js';
const finish=(s,r)=>s.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&i.attempts.includes(r.id)).map(i=>i.id),results:[]});
test('specification update and service restart preserve the stable installed bootstrap',async t=>{
 const f=await fixture(t),a=f.agents[0],startup=f.service.startupInstructions(),old=AgentRules.prototype.work;
 t.after(()=>{AgentRules.prototype.work=old;});
 const r=await f.service.send(a.id,{instruction:'first',requestId:randomUUID()});await f.submit(r);await finish(f.service,r);await f.complete(r);
 const before=JSON.parse(f.sent.at(-1).text.split('<ai-village-request>')[1].split('</ai-village-request>')[0]);
 AgentRules.prototype.work=function(id){return old.call(this,id)+'\nUpdated operation detail';};
 const s=await f.restart();assert.equal(s.startupInstructions(),startup);assert.equal(s.agent(a.id).inputEnvelope.mode,'startup-v2');
 const next=await s.send(a.id,{instruction:'second',requestId:randomUUID()});const text=f.sent.at(-1).text;
 const after=JSON.parse(text.split('<ai-village-request>')[1].split('</ai-village-request>')[0]);assert.notEqual(after.rulesRevision,before.rulesRevision);assert(!text.includes('Updated operation detail'));assert(!text.includes('requests finish JSON'));
 await f.submit(next);await finish(s,next);await f.complete(next);
 const ops=new VillageOperations({dir:f.options.dir},null,{direct:s});assert.equal((await ops.execute(['rules','get','work'])).result.revision,after.rulesRevision);assert.equal((await ops.execute(['rules','get','unknown'])).ok,false);
});
test('legacy mode stops new dispatch, diagnostics are read-only, and explicit transfer preserves request and input IDs',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0],target=f.agents[1];a.inputEnvelope={mode:'legacy',reason:'request-rules-updated'};
 const r=await s.send(a.id,{instruction:'migrate this request',requestId:randomUUID()});assert.equal(f.sent.length,0);assert.equal(r.dispatchAttemptedAt,undefined);assert.equal(r.queuedReason,'startup-contract-migration-required');
 const before=JSON.stringify(s.data),diagnostic=s.instructionStatus(a.id);assert.equal(diagnostic.requiresFreshSession,true);assert.equal(diagnostic.tracking.length,0);assert.equal(JSON.stringify(s.data),before);
 await assert.rejects(s.installInstructions(a),/実行済みまたは不明/);
 assert.equal(r.runModel.state.kind,'queued');await assert.rejects(s.flow.continue({humanRequestId:r.humanRequestId,workId:r.workId,agentId:target.id,revision:s.flow.root(r.humanRequestId).revision,operationId:randomUUID(),instruction:'no replay'},true),/継続は同じ仕事・担当/);
});
for(const state of ['sent','running'])test('migration keeps '+state+' native tracking and rejects premature transfer',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0],r=await s.send(a.id,{instruction:'in-flight',requestId:randomUUID()});if(state==='running')await f.submit(r);
 const fingerprint=structuredClone(r.inputCorrelation),model=structuredClone(r.runModel);a.inputEnvelope={mode:'startup-v1',hash:'old-rules'};await s.save();const restarted=await f.restart();const retained=restarted.flow.run(r.id);
 assert.deepEqual(retained.inputCorrelation,fingerprint);assert.deepEqual(retained.runModel,model);assert.equal(f.sent.length,1);assert.equal(restarted.instructionStatus(a.id).tracking[0].runId,r.id);
 await assert.rejects(restarted.flow.continue({humanRequestId:r.humanRequestId,workId:r.workId,agentId:f.agents[1].id,revision:restarted.flow.root(r.humanRequestId).revision,operationId:randomUUID(),instruction:'must not replay'},true),/継続は同じ仕事・担当/);
 if(state==='sent')await f.submit(retained);await finish(restarted,retained);await f.complete(retained);assert.equal(f.sent.length,1);
});
for(const origin of ['human','delegation','result','steering','report'])test(origin+' envelope has no repeated instruction or operation manual',()=>{
 const rules=new AgentRules('http://127.0.0.1:15179'),text='固有の依頼本文'.repeat(700),r={id:'r',workId:'w',humanRequestId:'q',instruction:text,origin,phase:origin==='report'?'report':'work'};
 const q={id:'q',inputProtocol:1},w={id:'w',inbox:[],metadata:{reporting:{version:2,completionAt:null,reportAt:'2026-11-20T06:26:23.133Z',reports:[]}}};
 const ctx={root:()=>q,work:()=>w,inputs:()=>[{id:'input',kind:'request',text,attempts:['r']}],d:{rules}};
 const envelope=text+RequestFlow.prototype.context.call(ctx,r),meta=JSON.parse(envelope.split('<ai-village-request>')[1].split('</ai-village-request>')[0]);
 assert.equal(envelope.split(text).length,2);assert(!envelope.includes('requests finish'));assert.equal(meta.inputProtocol,1);assert.equal(meta.deadline.version,2);assert.equal(meta.contract,2);assert.equal(meta.rulesRevision,rules.specification(r.phase==='report'?'report':'work').revision);
 if(origin!=='report')assert.deepEqual(meta.inputs,[{id:'input',kind:'request',textInInstruction:true}]);
});
test('normal terminal delivers unhandled inbox once without a separate recovery execution',async t=>{
 const f=await fixture(t),s=f.service,text='固有原依頼'.repeat(120),r=await s.send(f.agents[0].id,{instruction:text,requestId:randomUUID()});await f.submit(r);await f.complete(r);
 const next=s.flow.run(s.flow.work(s.flow.root(r.humanRequestId),r.workId).currentRunId);assert.notEqual(next.id,r.id);assert.equal(next.workId,r.workId);assert.equal(next.origin,'inbox');assert.equal(next.autoRecoveryFrom,undefined);assert.equal(next.recoveryPolicy,undefined);
 await f.submit(next);await f.complete(next);await s.tick();assert.equal(s.flow.work(s.flow.root(r.humanRequestId),r.workId).currentRunId,next.id);assert.equal(f.sent.length,2);
});
