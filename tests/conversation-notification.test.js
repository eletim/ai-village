// External notification policy for secretary conversation answers (display is unaffected).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './inbox-fixture.js';
import {acceptDelivery} from './purpose-fixture.js';
import {HUMAN_PRESENT_WINDOW_MS} from '../server/conversation-notification.mjs';
import {purposeView} from '../server/conversation-purpose.mjs';
import {VillageNotifier} from '../server/notifier.mjs';

const QUOTE='明示依頼としてテスト成果を作ってください。';
async function setup(t){
 const f=await fixture(t),d=f.service,p=await d.putProject({requestId:randomUUID(),name:'Notification fixture'});
 for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 const suppressed=[];f.options.notifier.suppress=async x=>{suppressed.push(x);return {status:'suppressed'};};
 const human=async(instruction=QUOTE,{minutes=0}={})=>{const r=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction});await f.submit(r);if(minutes)r.createdAt=new Date(Date.now()-minutes*60*1000).toISOString();return r;};
 const job=(actor,auth=actor)=>d.conversations.job({conversationId:actor.conversationId,actorRunId:actor.id,operationId:randomUUID(),instruction:'テスト成果を作る',authorization:{runId:auth.id,quote:QUOTE}});
 const sentFor=r=>f.notifications.filter(n=>n.id==='conversation-answer:'+r.id);
 const shown=r=>d.conversations.get(r.conversationId).runs.find(x=>x.id===r.id);
 return {f,d,human,job,suppressed,sentFor,shown};
}
async function leaderResult(f,receipt){
 const d=f.service;await d.tick();const r=d.flow.run(receipt.runId);await f.submit(r);
 await d.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:d.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
 await f.complete(r);const c=d.conversations.record(r.conversationId||d.flow.root(r.humanRequestId).conversationId);
 const delivery=d.flow.run(c.deliveries.findLast(e=>e.humanRequestId===receipt.humanRequestId&&e.kind==='result').runId);
 await d.tick();await f.submit(delivery);return delivery;
}

test('presence window is an explicit 3 minute constant',()=>{assert.equal(HUMAN_PRESENT_WINDOW_MS,180000);});

test('A: an answer that only dispatched work is not notified, is journaled, and stays visible',async t=>{
 const {f,human,job,suppressed,sentFor,shown}=await setup(t);
 const r=await human(QUOTE,{minutes:10});await job(r);await f.complete(r);
 assert.equal(sentFor(r).length,0);assert.equal(r.notificationSuppressed.reason,'work-dispatch-only');assert.equal(r.notification,undefined);
 assert.deepEqual(suppressed.map(x=>[x.id,x.reason]),[['conversation-answer:'+r.id,'work-dispatch-only']]);
 assert.equal(shown(r).displayMode,'reply');assert.equal(shown(r).humanAnswer,'Final '+r.id);
 await f.restart();await f.service.tick();assert.equal(sentFor(r).length,0);assert.equal(suppressed.length,1);
});

test('A: a withdrawal-only answer is not notified; a normal consultation answer is',async t=>{
 const {f,d,human,job,sentFor}=await setup(t);
 const first=await human(QUOTE,{minutes:10});const receipt=await job(first);await f.complete(first);
 const second=await human('やっぱり取り下げてください',{minutes:10});
 await d.conversations.withdraw({conversationId:second.conversationId,actorRunId:second.id,operationId:randomUUID(),humanRequestId:receipt.humanRequestId,instruction:'人間の指示で取り下げ',authorization:{runId:first.id,quote:QUOTE}});
 await f.complete(second);assert.equal(sentFor(second).length,0);assert.equal(second.notificationSuppressed.reason,'work-dispatch-only');
 const consult=await human('この方針の長所と短所を教えて',{minutes:10});await f.complete(consult);
 assert.equal(sentFor(consult).length,1);assert.equal(consult.notificationSuppressed,undefined);assert.equal(consult.notification.status,'sent');
});

test('B: a quick answer while the human is present is not notified; a slow answer is',async t=>{
 const {f,human,suppressed,sentFor,shown}=await setup(t);
 const quick=await human('今の状況は？');await f.complete(quick);
 assert.equal(sentFor(quick).length,0);assert.equal(quick.notificationSuppressed.reason,'human-present-quick-reply');assert.equal(suppressed.at(-1).reason,'human-present-quick-reply');
 assert.equal(shown(quick).displayMode,'reply');assert.equal(shown(quick).humanAnswer,'Final '+quick.id);
 const slow=await human('じっくり調べてから教えて',{minutes:4});await f.complete(slow);
 assert.equal(sentFor(slow).length,1);assert.equal(slow.notificationSuppressed,undefined);
});

test('results delivered by the leader: quick accept and question are notified; continuation is not',async t=>{
 const {f,d,human,job,sentFor}=await setup(t);
 const r=await human();const receipt=await job(r);await f.complete(r);
 const delivery=await leaderResult(f,receipt);await acceptDelivery(f,delivery);await f.complete(delivery);
 assert.equal(sentFor(delivery).length,1);assert.equal(delivery.notificationSuppressed,undefined);
 const again=await human('別件も明示依頼として作ってください。');const r2=await d.conversations.job({conversationId:again.conversationId,actorRunId:again.id,operationId:randomUUID(),instruction:'別件',authorization:{runId:again.id,quote:'別件も明示依頼として作ってください。'}});await f.complete(again);
 const second=await leaderResult(f,r2);const c=d.conversations.record(second.conversationId),e=c.deliveries.find(x=>x.runId===second.id);
 await d.conversations.decide({conversationId:c.id,actorRunId:second.id,operationId:randomUUID(),humanRequestId:e.humanRequestId,deliveryId:e.id,expectedPurposeVersion:purposeView(d.data,d.flow.root(e.humanRequestId)).version,decision:'question',reason:'人間の判断が必要',question:'AとBのどちらにしますか？'});
 await f.complete(second);assert.equal(sentFor(second).length,1);
 // Rework without a decision keeps the existing progress suppression.
 const third=await human('三件目も明示依頼として作ってください。');const r3=await d.conversations.job({conversationId:third.conversationId,actorRunId:third.id,operationId:randomUUID(),instruction:'三件目',authorization:{runId:third.id,quote:'三件目も明示依頼として作ってください。'}});await f.complete(third);
 const delivery3=await leaderResult(f,r3);
 await d.conversations.followup({conversationId:c.id,actorRunId:delivery3.id,operationId:randomUUID(),purposeId:r3.humanRequestId,instruction:'不足分を修正'});
 await f.complete(delivery3);assert.equal(sentFor(delivery3).length,0);assert.equal(delivery3.notificationSuppressed.reason,'purpose-decision-progress');
});

test('failure reports stay notified even when the secretary dispatches recovery work',async t=>{
 const {f,d,human,job,sentFor}=await setup(t);
 const r=await human();const receipt=await job(r);await f.complete(r);await d.tick();const leader=d.flow.run(receipt.runId);await f.submit(leader);await f.complete(leader,'failed');
 const c=d.conversations.record(r.conversationId),attention=d.flow.run(c.deliveries.find(e=>e.kind==='attention').runId);
 await d.tick();await f.submit(attention);await job(attention,r);await f.complete(attention);
 assert.equal(sentFor(attention).length,1);assert.equal(attention.notificationSuppressed,undefined);
});

test('explicit display choices keep their meaning; attempted notifications are never revisited',async t=>{
 const {f,d,human,sentFor}=await setup(t);
 const reply=await human('すぐ返事して');await d.conversations.display({conversationId:reply.conversationId,actorRunId:reply.id,operationId:randomUUID(),expectedVersion:0,mode:'reply'});await f.complete(reply);
 assert.equal(sentFor(reply).length,1);
 const progress=await human('途中経過だけ',{minutes:10});await d.conversations.display({conversationId:progress.conversationId,actorRunId:progress.id,operationId:randomUUID(),expectedVersion:0,mode:'progress'});await f.complete(progress);
 assert.equal(sentFor(progress).length,0);assert.equal(progress.notificationSuppressed.reason,'explicit-conversation-progress');
 // A quick answer whose notification was already attempted (e.g. before this policy) is left as is.
 const old=await human('既存の通知');old.notification={status:'delivery_unknown',id:'conversation-answer:'+old.id};await d.save();await f.complete(old);
 assert.equal(old.notificationSuppressed,undefined);assert.equal(old.notification.status,'delivery_unknown');assert.equal(sentFor(old).length,0);
});

test('notifier journals suppression without sending, and the ID cannot be sent later',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'notify-suppress-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const n=new VillageNotifier({dir,environment:{VILLAGE_OFFICE_URL:'http://127.0.0.1:5173/agents',VILLAGE_NOTIFY_BIN:'/nonexistent-notify'}});await n.init();
 const agentId=randomUUID();await n.suppress({id:'conversation-answer:x',kind:'conversation',agentId,reason:'human-present-quick-reply'});
 const rows=(await readFile(join(dir,'notifications.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,1);assert.deepEqual({...rows[0],at:undefined},{messageId:'conversation-answer:x',kind:'conversation',agentId,at:undefined,status:'suppressed',reason:'human-present-quick-reply',delivered:false});
 assert.equal(n.status().latest,null);
 assert.equal((await n.enqueue({id:'conversation-answer:x',role:'assistant',kind:'conversation',content:'x'})).status,'duplicate_or_internal');
 const reloaded=new VillageNotifier({dir,environment:{VILLAGE_OFFICE_URL:'http://127.0.0.1:5173/agents'}});await reloaded.init();
 assert.equal((await reloaded.enqueue({id:'conversation-answer:x',role:'assistant',kind:'conversation',content:'x'})).status,'duplicate_or_internal');
 assert.equal((await readFile(join(dir,'notifications.jsonl'),'utf8')).trim().split('\n').length,1);
});
