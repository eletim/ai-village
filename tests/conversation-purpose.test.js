import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {purposeView,conversationDisplayMode} from '../server/conversation-purpose.mjs';
import {runState} from '../server/run-lifecycle.mjs';
import {VillageOperations} from '../server/operations.mjs';
import {purposeFixture} from './purpose-fixture.js';
test('secretary evaluates, autonomously continues with original permission, and explicitly reports achievement',async t=>{
 const {f,human,auth,first,completeJob,args,view}=await purposeFixture(t);
 const one=await completeJob(first);
 assert.equal(f.service.snapshot().agents.find(a=>a.id===human.agentId).conversationWork.jobs[0].code,'evaluating');
 const input={...args(one),continuesRequestId:first.humanRequestId,instruction:'不足部分だけを修正。実施済み操作は繰り返さない',authorization:auth};delete input.humanRequestId;
 const next=await f.service.conversations.job(input);
 assert.deepEqual(await f.service.conversations.job(input),next);
 await assert.rejects(f.service.conversations.job({...input,operationId:randomUUID()}),/後続/);
 assert.equal(view().requestIds.length,2);assert.equal(Object.values(f.service.snapshot().reviews).flatMap(x=>x.attentionRequestIds).length,0);assert.equal(view().decision.kind,'continue');
 await f.complete(one.delivery);assert.equal(conversationDisplayMode(f.service.data,one.delivery),'progress');
 const two=await completeJob(next);
 const decision={...args(two,1),decision:'accept'};
 await f.service.conversations.decide(decision);
 assert.equal(view().decision.state,'pending');
 assert.notEqual(f.service.snapshot().agents.find(a=>a.id===human.agentId).conversationWork.jobs[0].code,'completed');
 await f.complete(two.delivery);
 assert.equal(view().decision.state,'committed');assert.equal(view().decision.kind,'accept');
 assert.equal(conversationDisplayMode(f.service.data,two.delivery),'reply');
 assert.equal(f.service.snapshot().agents.find(a=>a.id===human.agentId).conversationWork.jobs.length,1);
 assert.equal(f.service.snapshot().agents.find(a=>a.id===human.agentId).conversationWork.jobs[0].code,'completed');
 assert(f.notifications.some(n=>n.content.includes(two.delivery.id)));
 assert(!f.notifications.some(n=>n.content.includes(one.delivery.id)));
 await f.restart();assert.equal(view().decision.state,'committed');assert.equal((await f.service.conversations.decide(decision)).version,2);
});
test('normal reply without a decision does not adopt a result or notify achievement',async t=>{
 const {f,first,completeJob,view}=await purposeFixture(t),one=await completeJob(first);
 await f.service.conversations.display({conversationId:one.delivery.conversationId,actorRunId:one.delivery.id,operationId:randomUUID(),mode:'reply',expectedVersion:0});
 await f.complete(one.delivery);assert.equal(view().decision,null);assert.equal(conversationDisplayMode(f.service.data,one.delivery),'progress');
 assert(!f.notifications.some(n=>n.content.includes(one.delivery.id)));
});
test('failure and a later human input never commit an earlier accept; no automatic work replay',async t=>{
 for(const late of [false,true]){
  const {f,human,first,completeJob,args,view}=await purposeFixture(t),one=await completeJob(first);
  await f.service.conversations.decide({...args(one),decision:'accept'});
  if(late)await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'追加の条件があります'});
  await f.complete(one.delivery,late?'completed':'failed');
  assert.equal(view().decision.state,late?'stale':'failed');
  assert.notEqual(f.service.snapshot().agents.find(a=>a.id===human.agentId).conversationWork.jobs[0].code,'completed');
  const before=f.service.data.requests.length;await f.restart();await f.service.tick();assert.equal(f.service.data.requests.length,before);
 }
});
test('explicit question is visible only after normal reply and old permission supports amendment',async t=>{
 const {f,human,auth,first,completeJob,args,view}=await purposeFixture(t),one=await completeJob(first);
 const question={...args(one),decision:'question',question:'公開する日を指定してください'};
 await f.service.conversations.decide(question);await f.complete(one.delivery);
 const job=f.service.snapshot().agents.find(a=>a.id===human.agentId).conversationWork.jobs[0];
 assert.equal(job.code,'human-question');assert.equal(job.questionText,question.question);assert.equal(view().decision.state,'committed');
 const r=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'12月1日です'});await f.submit(r);
 const second=await f.service.conversations.job({...args(one,1),actorRunId:r.id,continuesRequestId:first.humanRequestId,authorization:auth,instruction:'指定日で残作業だけ進める'}); // job can use original delivered permission
 await f.service.conversations.amend({conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),humanRequestId:second.humanRequestId,authorization:auth,instruction:'公開日は12月1日'});
 assert.equal(f.service.flow.inputs(second.humanRequestId,second.workId).length,2);
});
test('stale versions, undelivered result, permission substitution, post-arrival decision and response loss are fenced',async t=>{
 const {f,human,auth,first,completeJob,args}=await purposeFixture(t),one=await completeJob(first);
 await assert.rejects(f.service.conversations.decide({...args(one,5),decision:'accept'}),/version/);
 await assert.rejects(f.service.conversations.decide({...args(one),deliveryId:'foreign',decision:'accept'}),/正式配送/);
 await assert.rejects(f.service.conversations.job({...args(one),continuesRequestId:first.humanRequestId,authorization:{...auth,quote:'修正'},instruction:'残作業'}),/元の許可/);
 const command=new VillageOperations({dir:f.options.dir},null,{direct:f.service}).commands.find(c=>c.name==='conversations decide');
 const input={...args(one),decision:'question',question:'どちらを公開しますか'};
 const receipt=await command.run([JSON.stringify(input)]);assert.deepEqual(await command.run([JSON.stringify(input)]),receipt);
 await assert.rejects(command.run([JSON.stringify({...input,question:'different'})]),/再利用/);
 await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'後からの指示'});
 await assert.rejects(f.service.conversations.decide({...args(one,1),decision:'accept'}),/後着/);
});
test('leader asks secretary, secretary explicitly asks human, original permission resumes active work after restart',async t=>{
 const {f,human,auth,first,view}=await purposeFixture(t);
 await f.service.tick();const leader=f.service.flow.run(first.runId);await f.submit(leader);
 await f.service.flow.report({humanRequestId:first.humanRequestId,workId:first.workId,actorRunId:leader.id,operationId:randomUUID(),kind:'question',text:'公開日が未指定です'});
 await f.service.flow.respond({humanRequestId:first.humanRequestId,workId:first.workId,runId:leader.id,operationId:randomUUID(),inputs:f.service.flow.inputs(first.humanRequestId,first.workId).map(i=>i.id),results:[]});
 await f.complete(leader);
 const c=f.service.conversations.record(human.conversationId),event=c.deliveries.find(e=>e.kind==='question'),delivery=f.service.flow.run(event.runId);await f.submit(delivery);
 await f.service.conversations.decide({conversationId:c.id,actorRunId:delivery.id,operationId:randomUUID(),humanRequestId:first.humanRequestId,deliveryId:event.id,expectedPurposeVersion:0,decision:'question',reason:'許可には日付がなく本人の希望が必要',question:'公開する日を教えてください'});
 await f.complete(delivery);assert.equal(view().decision.state,'committed');await f.restart();
 const reply=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'12月1日でお願いします'});await f.submit(reply);
 await f.service.conversations.amend({conversationId:c.id,actorRunId:reply.id,operationId:randomUUID(),humanRequestId:first.humanRequestId,authorization:auth,instruction:'12月1日に公開する残作業を進める'});
 assert.equal(view().decision.kind,'resume');assert.equal(view().decision.state,'continued');
 await f.complete(reply);await f.service.tick();
 const root=f.service.flow.root(first.humanRequestId),work=f.service.flow.work(root,first.workId);
 assert.notEqual(work.currentRunId,leader.id);assert.equal(f.service.data.requests.length,1);
});
test('plain consultation starts no work, duplicate result delivery does not create work, fixed startup contract is unchanged',async t=>{
 const f=await fixture(t),p=await f.service.putProject({requestId:randomUUID(),name:'相談のみ'});
 f.agents[0].projectId=p.id;
 const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'設計について相談したい'});await f.submit(r);await f.complete(r);
 assert.equal(f.service.data.requests.length,0);assert.equal(f.service.data.conversations[0].purposeDecisions,undefined);
 const {f:g,first,completeJob}=await purposeFixture(t);await completeJob(first);
 const c=g.service.data.conversations[0],e=c.deliveries[0],before=g.service.data.runs.length;
 g.service.conversations.deliver(c,g.service.flow.root(first.humanRequestId),e.id,e.kind,e.material);
 assert.equal(g.service.data.runs.length,before);
});
test('save failure does not leave a successor or decision; retry is one operation',async t=>{
 const {f,auth,first,completeJob,args,view}=await purposeFixture(t),one=await completeJob(first);
 const input={...args(one),continuesRequestId:first.humanRequestId,authorization:auth,instruction:'不足だけ修正'};
 const write=f.service.store.write;f.service.store.write=async()=>{throw Error('disk failure');};
 await assert.rejects(f.service.conversations.job(input),/disk failure/);
 f.service.store.write=write;
 assert.equal(view().version,0);assert.equal(view().requestIds.length,1);
 await f.service.conversations.job(input);assert.equal(view().requestIds.length,2);
});
test('a failed judgment can be reconsidered after restart without replaying the completed execution',async t=>{
 const {f,human,first,completeJob,args,view}=await purposeFixture(t),one=await completeJob(first);
 await f.service.conversations.decide({...args(one),decision:'accept'});await f.complete(one.delivery,'failed');await f.restart();
 const r=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'保存済み成果を確認して報告してください'});await f.submit(r);
 await f.service.conversations.decide({...args(one,1),actorRunId:r.id,decision:'accept'});
 await f.complete(r);assert.equal(view().decision.state,'committed');assert.equal(f.service.data.requests.length,1);
 assert.equal(f.sent.filter(s=>s.agentId===f.agents[2].id&&s.text.includes(first.runId)).length,1);
});
test('post-achievement correction requires a later delivered human input and keeps the original purpose',async t=>{
 const {f,human,auth,first,completeJob,args,view}=await purposeFixture(t),one=await completeJob(first);
 await f.service.conversations.decide({...args(one),decision:'accept'});await f.complete(one.delivery);
 const r=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'成果のこの箇所を修正してください'});await f.submit(r);
 const x={...args(one,1),actorRunId:r.id,continuesRequestId:first.humanRequestId,authorization:auth,instruction:'指摘箇所だけ修正'};
 await assert.rejects(f.service.conversations.job(x),/reopenRunId/);
 const next=await f.service.conversations.job({...x,reopenRunId:r.id});
 assert.equal(next.purposeId,first.humanRequestId);assert.equal(view().decision.reopenRunId,r.id);
});
test('a real question or achieved report is not hidden by continuation of another purpose in the same reply',async t=>{
 const {f,human,auth,first,completeJob,args}=await purposeFixture(t),one=await completeJob(first);
 delete one.event.decisionRecoveryVersion; // compatibility result intentionally evaluated on another purpose's reply
 const second=await f.service.conversations.job({conversationId:human.conversationId,actorRunId:one.delivery.id,operationId:randomUUID(),instruction:'別の目的',authorization:auth});
 await f.complete(one.delivery);const two=await completeJob(second);
 await f.service.conversations.decide({...args(one),actorRunId:two.delivery.id,decision:'question',question:'AとBのどちらにしますか'});
 await f.service.conversations.job({...args(two),continuesRequestId:second.humanRequestId,authorization:auth,instruction:'別目的の不足だけ修正'});
 await f.complete(two.delivery);
 assert.equal(conversationDisplayMode(f.service.data,two.delivery),'reply');
 assert(f.notifications.some(n=>n.content.includes(two.delivery.id)));
});
test('historical actor cannot read a later continuation instruction or decision material',async t=>{
 const {f,human,auth,first,completeJob,args}=await purposeFixture(t),one=await completeJob(first);
 await f.service.conversations.job({...args(one),continuesRequestId:first.humanRequestId,authorization:auth,instruction:'FUTURE_SECRET_INSTRUCTION',reason:'FUTURE_SECRET_REASON'});
 const past=f.service.conversations.get(human.conversationId,human.id);
 assert(!JSON.stringify(past).includes('FUTURE_SECRET'));
});
