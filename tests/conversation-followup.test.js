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
 const next=await invoke(f,input(human,first.humanRequestId,one.delivery.id));assert.notEqual(next.humanRequestId,first.humanRequestId);assert.equal(next.purposeId,first.humanRequestId);assert.deepEqual(f.service.flow.root(next.humanRequestId).requestedBy.authorization,auth);assert.equal(view().requestIds.length,2);
 await f.complete(one.delivery);await f.restart();const two=await completeJob(next);await f.service.conversations.decide({conversationId:human.conversationId,actorRunId:two.delivery.id,operationId:randomUUID(),decision:'accept',reason:'具体的な不足点の修正を確認'});await f.complete(two.delivery);assert.equal(view().decision.state,'committed');
});
test('after adoption followup requires later human input and preserves purpose, no extra permission argument',async t=>{
 const {f,human,first,completeJob}=await purposeFixture(t),one=await completeJob(first);
 await f.service.conversations.decide({conversationId:human.conversationId,actorRunId:one.delivery.id,operationId:randomUUID(),decision:'accept',reason:'達成'});await f.complete(one.delivery);
 const h=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'その目的の残りも修正して'});await f.submit(h);
 await assert.rejects(invoke(f,{...input(human,first.humanRequestId,h.id),authorization:{runId:h.id,quote:h.instruction}}),/追加権限/);
 const next=await invoke(f,input(human,first.humanRequestId,h.id));assert.equal(next.purposeId,first.humanRequestId);assert.equal(f.service.flow.root(next.humanRequestId).continuesRequestId,first.humanRequestId);
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
 const [a,b]=await Promise.all([invoke(f,x),invoke(f,x)]);assert.deepEqual(a,b);assert.equal(f.service.data.requests.length,2);
 assert.deepEqual(await invoke(f,{...x,operationId:randomUUID()}),a);assert.equal(f.service.data.requests.length,2);
 await f.complete(one.delivery);await f.restart();assert.deepEqual(await invoke(f,x),a);
});
test('new auto recovery delivers saved result only and accepts through simple decide',async t=>{
 const {f,human,first,completeJob,view}=await purposeFixture(t),one=await completeJob(first);await f.complete(one.delivery);
 await Promise.all([f.service.tick(),f.service.tick()]);const c=f.service.conversations.record(human.conversationId),events=c.deliveries.filter(e=>e.decisionRecovery);assert.equal(events.length,1);
 const recovery=f.service.flow.run(events[0].runId);await f.submit(recovery);await f.service.conversations.decide({conversationId:c.id,actorRunId:recovery.id,operationId:randomUUID(),decision:'accept',reason:'保存成果で目的達成を確認'});await f.complete(recovery);await f.restart();await f.service.tick();assert.equal(view().decision.state,'committed');assert.equal(f.service.data.requests.length,1);assert.equal(f.service.data.runs.filter(r=>r.humanRequestId===first.humanRequestId).length,1);
});
