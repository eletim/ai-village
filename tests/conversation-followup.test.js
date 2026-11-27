import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
import {VillageOperations} from '../server/operations.mjs';
const input=(human,purposeId,actorRunId,instruction='残作業だけを修正')=>({conversationId:human.conversationId,actorRunId,purposeId,instruction,operationId:randomUUID()});
const invoke=(f,x)=>new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute(['conversations','followup',JSON.stringify(x)]).then(r=>{if(!r.ok)throw Error(r.error);return r.result;});
test('one followup entry supplements active work and continues delivered result using original permission',async t=>{
 const {f,human,first,completeJob,auth,view}=await purposeFixture(t);
 const h=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'同じ目的で不足点も修正して'});await f.submit(h);
 const x=input(human,first.humanRequestId,h.id);const a=await invoke(f,x);assert.equal(a.action,'amend');assert.equal(f.service.data.requests.length,1);
 assert.deepEqual(await invoke(f,x),a);assert.deepEqual(await invoke(f,{...x,operationId:randomUUID()}),a);assert.equal(f.service.flow.inputs(first.humanRequestId,first.workId).length,2);
 await f.complete(h);
 const leader=f.service.flow.run(first.runId);await f.submit(leader);
 await f.service.flow.respond({humanRequestId:first.humanRequestId,workId:first.workId,runId:leader.id,operationId:randomUUID(),inputs:f.service.flow.inputs(first.humanRequestId,first.workId).filter(i=>i.attempts.includes(leader.id)&&!i.handledBy).map(i=>i.id),results:[]});await f.complete(leader);await f.service.tick();
 const resumed=f.service.flow.work(f.service.flow.root(first.humanRequestId),first.workId).currentRunId;
 const one=await completeJob({...first,runId:resumed});
 const next=await invoke(f,input(human,first.humanRequestId,one.delivery.id));assert.equal(next.humanRequestId,first.humanRequestId);assert.equal(next.workId,first.workId);assert.equal(next.purposeId,first.humanRequestId);assert.deepEqual(f.service.flow.root(next.humanRequestId).requestedBy.authorization,auth);assert.equal(view().requestIds.length,1);assert(f.service.flow.inputs(next.humanRequestId,next.workId).some(i=>i.text==='残作業だけを修正'&&i.attempts.includes(next.runId)));
 await f.complete(one.delivery);await f.restart();const two=await completeJob(next);await f.service.conversations.decide({conversationId:human.conversationId,actorRunId:two.delivery.id,operationId:randomUUID(),decision:'accept',reason:'具体的な不足点の修正を確認'});await f.complete(two.delivery);assert.equal(view().decision.state,'committed');
});
test('after adoption followup requires later human input and preserves purpose, no extra permission argument',async t=>{
 const {f,human,first,completeJob}=await purposeFixture(t),one=await completeJob(first);
 await f.service.conversations.decide({conversationId:human.conversationId,actorRunId:one.delivery.id,operationId:randomUUID(),decision:'accept',reason:'達成'});await f.complete(one.delivery);
 const h=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'その目的の残りも修正して'});await f.submit(h);
 await assert.rejects(invoke(f,{...input(human,first.humanRequestId,h.id),authorization:{runId:h.id,quote:h.instruction}}),/追加権限/);
 const next=await invoke(f,input(human,first.humanRequestId,h.id));assert.equal(next.purposeId,first.humanRequestId);assert.equal(f.service.flow.root(next.humanRequestId).continuesRequestId,undefined);assert.equal(next.workId,first.workId);
});
test('followup rejects withdrawal, unknown execution, foreign target and later human input without creating work',async t=>{
 for(const mode of ['withdrawn','unknown','foreign','later']){
  const {f,human,first}=await purposeFixture(t),h=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'修正して'});await f.submit(h);
  if(mode==='withdrawn')await f.service.flow.cancel({humanRequestId:first.humanRequestId,revision:f.service.flow.root(first.humanRequestId).revision});
  if(mode==='unknown'){const {changeRun}=await import('../server/run-lifecycle.mjs');changeRun(f.service.flow.run(first.runId),{type:'lost',actor:'program',at:Date.now(),reason:'unknown'});}
  if(mode==='later')await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'追加の制約'});
  const before=f.service.data.runs.length;await assert.rejects(invoke(f,input(human,mode==='foreign'?randomUUID():first.humanRequestId,h.id)));assert.equal(f.service.data.requests.length,1);assert.equal(f.service.data.runs.length,before);
 }
});
test('competing followups serialize and response replay never creates a second successor',async t=>{
 const {f,human,first,completeJob}=await purposeFixture(t),one=await completeJob(first),x=input(human,first.humanRequestId,one.delivery.id);
 const [a,b]=await Promise.all([invoke(f,x),invoke(f,x)]);assert.deepEqual(a,b);assert.equal(f.service.data.requests.length,1);
 assert.deepEqual(await invoke(f,{...x,operationId:randomUUID()}),a);assert.equal(f.service.data.requests.length,1);
 await f.complete(one.delivery);await f.restart();assert.deepEqual(await invoke(f,x),a);
});
test('new auto recovery delivers saved result only and accepts through simple decide',async t=>{
 const {f,human,first,completeJob,view}=await purposeFixture(t),one=await completeJob(first);await f.complete(one.delivery);
 await Promise.all([f.service.tick(),f.service.tick()]);const c=f.service.conversations.record(human.conversationId),events=c.deliveries.filter(e=>e.decisionRecovery);assert.equal(events.length,1);
 const recovery=f.service.flow.run(events[0].runId);await f.submit(recovery);await f.service.conversations.decide({conversationId:c.id,actorRunId:recovery.id,operationId:randomUUID(),decision:'accept',reason:'保存成果で目的達成を確認'});await f.complete(recovery);await f.restart();await f.service.tick();assert.equal(view().decision.state,'committed');assert.equal(f.service.data.requests.length,1);assert.equal(f.service.data.runs.filter(r=>r.humanRequestId===first.humanRequestId).length,1);
});
test('ordinary followup resumes confirmed interrupted work once, preserving artifacts and input history',async t=>{
 const {f,human,first}=await purposeFixture(t),r=f.service.flow.run(first.runId);
 await f.submit(r);await f.complete(r,'interrupted');
 const c=f.service.conversations.record(human.conversationId),e=c.deliveries.find(e=>e.kind==='attention'),actor=f.service.flow.run(e.runId);await f.submit(actor);
 const old=structuredClone(r.runModel),x=input(human,first.humanRequestId,actor.id,'既存Webは維持し、未完了部分だけ継続');
 const receipt=await invoke(f,x);assert.equal(receipt.previousRunId,r.id);assert.equal(receipt.humanRequestId,first.humanRequestId);
 assert.deepEqual(await invoke(f,x),receipt);assert.deepEqual(r.runModel,old);
 assert.equal(f.service.flow.run(receipt.runId).runModel.createdBy,'agent');
 await f.service.tick();await f.submit(f.service.flow.run(receipt.runId));
 assert.equal(f.service.flow.inputs(first.humanRequestId,first.workId)[0].text,'目的の成果を作る');
});
test('late native input prevents continuation reservation, not just its send',async t=>{
 const {f,human,first}=await purposeFixture(t),r=f.service.flow.run(first.runId);
 await f.submit(r);await f.complete(r,'interrupted');
 const c=f.service.conversations.record(human.conversationId),actor=f.service.flow.run(c.deliveries.find(e=>e.kind==='attention').runId);await f.submit(actor);
 const native=f.runtimes.get(r.agentId);native.inputs.push({id:'late',turnId:'late',offset:++native.cursor});
 const before=f.service.data.runs.length;
 await assert.rejects(invoke(f,input(human,first.humanRequestId,actor.id)),/実行境界/);assert.equal(f.service.data.runs.length,before);
});
test('native input arriving during contract verification prevents a reserved continuation send',async t=>{
 const {f,human,first}=await purposeFixture(t),r=f.service.flow.run(first.runId);
 await f.submit(r);await f.complete(r,'interrupted');
 const c=f.service.conversations.record(human.conversationId),actor=f.service.flow.run(c.deliveries.find(e=>e.kind==='attention').runId);await f.submit(actor);
 const receipt=await invoke(f,input(human,first.humanRequestId,actor.id)),verify=f.service.verifyInstructions.bind(f.service);
 let injected=false;
 f.service.verifyInstructions=async a=>{await verify(a);if(a.id===r.agentId&&!injected){injected=true;const native=f.runtimes.get(r.agentId);native.inputs.push({id:'after-verify',turnId:'after-verify',offset:++native.cursor});}};
 const before=f.sent.filter(s=>s.agentId===r.agentId).length;
 await f.service.tick();assert.equal(injected,true);assert.equal(f.sent.filter(s=>s.agentId===r.agentId).length,before);
 assert.equal(f.service.flow.run(receipt.runId).runModel.state.reason,'dispatch-boundary-changed');
});
