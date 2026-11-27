import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
async function setup(t,actions=['continue']){
 const x=await purposeFixture(t),{f,first}=x,s=f.service;
 const project=await s.putProject({requestId:randomUUID(),name:'同名Project'}),a=f.agents[1];a.location='mayor';a.projectId=project.id;
 const q=s.flow.root(first.humanRequestId),scope={projectId:q.projectId,workId:first.workId,actions};
 const human=await s.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:'選択した仕事の未完了分だけ続けてください',scope});await f.submit(human);
 const input={conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),instruction:'元の許可範囲で未完了分を確認して継続してください'};
 return {...x,s,source:human,input,scope};
}
test('addressed normal input continues the same work once without relay records',async t=>{
 const {f,s,first,source,input}=await setup(t),old=s.flow.run(first.runId);
 await f.submit(old);await f.complete(old,'interrupted');
 const report=s.data.conversations.flatMap(c=>c.deliveries).find(e=>e.humanRequestId===first.humanRequestId&&e.kind==='attention');if(report){const rr=s.flow.run(report.runId);await f.submit(rr);await f.complete(rr);}
 const receipt=await s.conversations.input(input);assert.deepEqual(await s.conversations.input(input),receipt);
 await f.complete(source);await s.tick();const receiver=s.flow.run(receipt.runId);await f.submit(receiver);
 const continued=await s.secretaryCommands.followup(receiver.id,undefined,'未完了分だけ継続');
 assert.equal(continued.workId,first.workId);assert.equal(continued.humanRequestId,first.humanRequestId);
 assert(s.data.conversations.every(c=>!c.relayInbox&&!c.relaySent));
 assert.deepEqual(await s.secretaryCommands.followup(receiver.id,undefined,'未完了分だけ継続'),continued);
 await f.complete(receiver);await s.tick();await f.submit(s.flow.run(continued.runId));
 await f.restart();
});
test('target permission is operation specific and cannot be supplied by the sender',async t=>{
 const {f,s,first,source,input}=await setup(t,['supplement']),old=s.flow.run(first.runId);
 await assert.rejects(s.conversations.input({...input,scope:{actions:['continue']}}),/宛先/);
 await f.submit(old);await f.complete(old,'interrupted');
 const report=s.data.conversations.flatMap(c=>c.deliveries).find(e=>e.humanRequestId===first.humanRequestId&&e.kind==='attention');if(report){const rr=s.flow.run(report.runId);await f.submit(rr);await f.complete(rr);}const receipt=await s.conversations.input(input);
 await f.complete(source);await s.tick();const receiver=s.flow.run(receipt.runId);await f.submit(receiver);
 await assert.rejects(s.secretaryCommands.followup(receiver.id,undefined,'続ける'),/対象・操作/);
 assert.equal(s.flow.work(s.flow.root(first.humanRequestId),first.workId).currentRunId,old.id);
 await assert.rejects(s.conversations.job({conversationId:receiver.conversationId,actorRunId:receiver.id,operationId:randomUUID(),instruction:'別仕事',authorization:s.flow.root(first.humanRequestId).requestedBy.authorization}),/新規/);
});
test('renaming or duplicate names do not change the bound work; payload changes cannot replay',async t=>{
 const {s,input,scope}=await setup(t);
 s.data.projects.forEach(p=>p.name='同名Project');
 const receipt=await s.conversations.input(input);assert.equal(receipt.workId,scope.workId);
 await assert.rejects(s.conversations.input({...input,instruction:'違う対象'}),/operationId/);
 await assert.rejects(s.conversations.input({...input,operationId:randomUUID(),instruction:'違う対象'}),/配送済み/);
});
test('later source human input holds the old addressed input before delivery',async t=>{
 const {f,s,source,input}=await setup(t),receipt=await s.conversations.input(input);
 await s.send(source.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'待ってください'});
 await f.complete(source);await s.tick();
 const r=s.flow.run(receipt.runId);assert.equal(r.runModel.state.reason,'dispatch-boundary-changed');assert(!r.runModel.facts.some(f=>f.type==='input'));
});
test('free text without a bound target cannot authorize a cross-project input',async t=>{
 const {s,input,source}=await setup(t);delete source.conversationSource.scope;
 await assert.rejects(s.conversations.input(input),/対象/);
 assert(s.data.conversations.every(c=>!c.relayInbox));
});

test('independent target later human blocks addressed cancel',async t=>{
 const {s,f,input,source,first}=await setup(t,['cancel']);const receipt=await s.conversations.input(input);await f.complete(source);await s.tick();const receiver=s.flow.run(receipt.runId);await f.submit(receiver);
 s.flow.dispatchReady=async()=>{};
 await s.send(receiver.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'中止せず進めてください'});
 let error;try{await s.secretaryCommands.withdraw(receiver.id,undefined,'古い中止依頼');}catch(e){error=e.message;}
 const state=s.flow.work(s.flow.root(first.humanRequestId),first.workId).state.kind;console.log({state,error});assert.notEqual(state,'withdrawn');
});

test('a newly scoped human input continues an accepted work without UUID permission prose',async t=>{
 const {f,first,completeJob}=await purposeFixture(t),s=f.service;
 const result=await completeJob(first);await s.secretaryCommands.accept(result.delivery.id,'成果を確認');await f.complete(result.delivery);
 const project=await s.putProject({requestId:randomUUID(),name:'送信元'}),a=f.agents[1];a.projectId=project.id;
 const q=s.flow.root(first.humanRequestId),scope={projectId:q.projectId,workId:first.workId,actions:['continue']};
 const human=await s.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:'選択した仕事に追加修正をお願いします',scope});await f.submit(human);
 const sent=await s.secretaryCommands.order(human.id,'保存成果を維持して追加修正');await f.complete(human);await s.tick();const incoming=s.flow.run(sent.runId);await f.submit(incoming);
 const continued=await s.secretaryCommands.followup(incoming.id,undefined,'保存成果に必要な修正だけ');assert.equal(continued.workId,first.workId);assert.equal(s.data.requests.length,1);
});

test('addressed reply is read from the received input with no return execution or authority',async t=>{
 const {f,s,input,source}=await setup(t),sent=await s.conversations.input(input);await f.complete(source);await s.tick();const r=s.flow.run(sent.runId);await f.submit(r);await f.complete(r);const count=s.data.runs.length;
 const view=await s.secretaryCommands.status(source.id),reply=view.addressedInputs.find(x=>x.runId===r.id);assert.equal(reply.accepted,true);assert.match(reply.answer,/Final/);await s.tick();assert.equal(s.data.runs.length,count);assert.match(reply.meaning,/追加の操作許可とは別/);
});

test('a scope granted before a later final decision does not reopen that decision',async t=>{
 const {f,s,first,completeJob,source}=await setup(t);
 const result=await completeJob(first);await s.secretaryCommands.accept(result.delivery.id,'成果を採用');await f.complete(result.delivery);
 const receipt=await s.secretaryCommands.order(source.id,'以前の依頼で継続');await f.complete(source);await s.tick();const receiver=s.flow.run(receipt.runId);await f.submit(receiver);
 await assert.rejects(s.secretaryCommands.followup(receiver.id,undefined,'古い許可で再開'),/追加指示|人間|判断/);
 assert.equal(s.flow.work(s.flow.root(first.humanRequestId),first.workId).state.kind,'completed');
});
