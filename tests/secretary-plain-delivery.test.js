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
 const job=conversationJob(d.data,d.flow.root(first.humanRequestId));assert.equal(job.code,'evaluating');assert.equal(job.label,'秘書の確認待ち（判断記録なし）');
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

import {VillageOperations} from '../server/operations.mjs';
import {conversationDisplayMode} from '../server/conversation-purpose.mjs';
const cli=f=>(...args)=>new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute(args);
async function later(f,text='どうなった？'){
 const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:text});await f.submit(r);return r;
}
for(const action of ['accept','ask'])test('contract 3: undecided result, later status/full material, then '+action,async t=>{
 const {f,d,first,completeJob}=await setup(t,3),one=await completeJob(first),village=cli(f);
 await f.complete(one.delivery);
 assert.equal(one.delivery.notificationSuppressed.reason,'purpose-decision-progress');
 assert.equal(conversationDisplayMode(d.data,one.delivery),'progress');
 const human=await later(f),status=await village('status','--run',human.id);
 assert.equal(status.ok,true,status.error);
 const purpose=status.result.purposes[0];assert.equal(purpose.objective,'目的の成果を作る');
 const material=await village(...purpose.deliveries[0].read);assert.equal(material.ok,true,material.error);
 assert(JSON.stringify(material.result).includes(one.event.material.output));
 const argv=[action,'--run',human.id,first.humanRequestId,'成果を確認しました。公開日はいつですか？'];
 const decided=await village(...argv);assert.equal(decided.ok,true,decided.error);assert.equal(decided.result.deliveryId,one.event.id);
 assert.deepEqual((await village(...argv)).result,decided.result);
 await f.complete(human);
 assert.equal(conversationDisplayMode(d.data,human),'reply');
 assert.notEqual(human.notificationSuppressed?.reason,'purpose-decision-progress');
 const next=await later(f);const processed=await village(action,'--run',next.id,'再判断');
 assert.equal(processed.ok,false);assert.match(processed.error,/判断済み/);
});

test('later decisions require a unique purpose and reject foreign and stale material',async t=>{
 const {f,d,first,completeJob}=await setup(t,3),one=await completeJob(first),village=cli(f);
 await f.complete(one.delivery);const human=await later(f,'もう一つ進めて');
 assert.equal((await village('order','--run',human.id,'もう一つの仕事')).ok,true);
 assert.match((await village('accept','--run',human.id,'達成')).error,/目的が2つ/);
 assert.match((await village('accept','--run',human.id,randomUUID(),'達成')).error,/この会話にありません/);
 assert.equal((await village('ask','--run',human.id,first.humanRequestId,'公開日は？')).ok,true);
});

test('current delivery cannot be replaced by a different purpose argument',async t=>{
 const {f,first,completeJob}=await setup(t,3),village=cli(f);
 const human=await later(f,'別の仕事も進めて');
 const other=await village('order','--run',human.id,'他の仕事');assert.equal(other.ok,true,other.error);
 await f.complete(human);const one=await completeJob(first);
 const wrong=await village('accept','--run',one.delivery.id,other.result.humanRequestId,'達成');
 assert.equal(wrong.ok,false);assert.match(wrong.error,/この回で届いた目的と異なります/);
});

for(const action of ['accept','ask'])test('later '+action+' refuses an obsolete result version',async t=>{
 const {f,first,completeJob}=await setup(t,3),one=await completeJob(first),village=cli(f);
 await f.complete(one.delivery);const human=await later(f);
 one.event.material.version+=1;
 const result=await village(action,'--run',human.id,'確認');
 assert.equal(result.ok,false);assert.match(result.error,/現在の正常な提出結果/);
});

test('plain delivery keeps stop details, conjugates closure, and its full-text command executes',async t=>{
 const {f,d,first,human}=await setup(t,3),c=d.conversations.record(human.conversationId),q=d.flow.root(first.humanRequestId);
 const add=async(id,kind,material)=>{await d.locked('request-graph',()=>d.persist(async()=>{d.conversations.deliver(c,q,id,kind,material);await d.save();}));return d.flow.run(c.deliveries.find(e=>e.id===id).runId);};
 const stopped=await add('attention:test','attention',{outcome:'failed',reason:'API Error: 529 overloaded'});
 assert.match(stopped.instruction,/API Error: 529 overloaded/);
 const closed=await add('close:test','important-change',{state:{kind:'completed'}});
 assert.match(closed.instruction,/終了しました/);
 const withdrawn=await add('withdraw:test','important-change',{state:{kind:'withdrawn'}});
 assert.match(withdrawn.instruction,/取り下げました/);
 const long=await add('result:full','result',{resultId:'test',version:1,runId:first.runId,output:'長'.repeat(12000)});
 // Submit each queued conversation in order, without adopting any of the fixture results.
 for(const r of [stopped,closed,withdrawn,long]){await d.tick();await f.submit(r);if(r!==long)await f.complete(r);}
 const match=long.instruction.match(/conversations read ([^ ]+) RUN_ID '([^']+)'/);
 assert(match,long.instruction.slice(-300));
 const result=await cli(f)('conversations','read',match[1],long.id,match[2]);
 assert.equal(result.ok,true,result.error);assert(JSON.stringify(result.result).includes('長'.repeat(12000)));
});
