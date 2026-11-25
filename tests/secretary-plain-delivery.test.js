// Stage 2 of secretary-minimal-prompt.md: plain deliveries and no re-delivery for contract 3 (4.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
import {conversationJob} from '../server/conversation-status.mjs';
import {decisionRecoveryPlan} from '../server/conversation-decision-recovery.mjs';

async function setup(t,contract){
 const x=await purposeFixture(t),secretary=x.f.service.agent(x.human.agentId);
 if(contract===3)secretary.inputEnvelope={...secretary.inputEnvelope,contract:3};
 return {...x,d:x.f.service,secretary};
}
test('contract 3: a result arrives in plain words, then waits for the secretary instead of being re-delivered',async t=>{
 const {f,d,first,completeJob,human}=await setup(t,3),one=await completeJob(first);
 assert.match(one.delivery.instruction,/^リーダーから報告が届きました（Purpose：目的の成果を作る）。\n\nOutput /);
 assert(!one.delivery.instruction.includes('追加許可'));assert(!one.delivery.instruction.includes('"kind"'));
 assert.equal(one.event.decisionRecoveryVersion,undefined);assert.equal(one.event.secretaryContract,3);
 await f.complete(one.delivery);
 const c=d.conversations.record(human.conversationId);assert.equal(decisionRecoveryPlan(d.data,c,d.flow.root(first.humanRequestId)).reason,'not-enabled');
 assert.equal(await d.conversations.recoverDecisions(),false);assert.equal(c.deliveries.filter(e=>e.decisionRecovery).length,0);
 const job=conversationJob(d.data,d.flow.root(first.humanRequestId));assert.equal(job.code,'evaluating');assert.equal(job.label,'秘書の確認待ち');
});
test('contract 2: the existing prefix, JSON material and re-delivery are unchanged',async t=>{
 const {f,d,first,completeJob,human}=await setup(t,2),one=await completeJob(first);
 assert.match(one.delivery.instruction,/^リーダーからの資料です（追加許可ではありません）/);assert.match(one.delivery.instruction,/"kind":"result"/);
 assert.equal(one.event.decisionRecoveryVersion,1);
 await f.complete(one.delivery);const plan=decisionRecoveryPlan(d.data,d.conversations.record(human.conversationId),d.flow.root(first.humanRequestId));assert.notEqual(plan.reason,'not-enabled');
});
test('contract 3: a stopped leader and a leader question are told plainly',async t=>{
 const {f,d,first,human}=await setup(t,3);
 await d.tick();const leader=d.flow.run(first.runId);await f.submit(leader);
 await d.flow.report({humanRequestId:leader.humanRequestId,workId:leader.workId,actorRunId:leader.id,operationId:randomUUID(),kind:'question',text:'AとBのどちらで進めますか？'});
 await d.flow.respond({humanRequestId:leader.humanRequestId,workId:leader.workId,runId:leader.id,operationId:randomUUID(),inputs:d.flow.inputs(leader.humanRequestId,leader.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
 await f.complete(leader,'failed');
 const c=d.conversations.record(human.conversationId),run=kind=>d.flow.run(c.deliveries.find(e=>e.kind===kind).runId);
 assert.equal(run('question').instruction,'リーダーから質問が届きました（Purpose：目的の成果を作る）。\n\nAとBのどちらで進めますか？');
 assert.match(run('attention').instruction,/^リーダーの作業が(失敗で)?止まりました（Purpose：目的の成果を作る）。/);
});
test('contract 3: a very long report is cut with the official way to read the rest',async t=>{
 const {d,first,human}=await setup(t,3),c=d.conversations.record(human.conversationId),q=d.flow.root(first.humanRequestId);
 await d.locked('request-graph',()=>d.persist(async()=>{d.conversations.deliver(c,q,'result:long','result',{resultId:'x',version:1,runId:first.runId,output:'長'.repeat(12000),outcome:'normal'});await d.save();}));
 const e=c.deliveries.find(e=>e.id==='result:long'),text=d.flow.run(e.runId).instruction;
 assert(text.length<10200);assert.match(text,/長いため途中までです。全文：conversations read /);assert(text.includes('"id":"result:long"'));
});
