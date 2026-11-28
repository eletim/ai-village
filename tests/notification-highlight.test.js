import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {conversationNotification,conversationNotificationTarget} from '../server/conversation-notification.mjs';
import {notificationEntries,reviewRevision,migrateNotificationReviews} from '../server/notification-review.mjs';
import {completedEntries} from '../src/completions.js';
import {humanProjection} from '../server/report-view.mjs';
async function setup(t){
 const f=await fixture(t);t.after(()=>f.service.close());const d=f.service,a=f.agents[0];
 const p=await d.putProject({requestId:randomUUID(),name:'Highlight'});a.projectId=p.id;
 const send=async(text='相談')=>{const r=await d.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:text});await f.submit(r);return r;};
 const shown=()=>f.service.snapshot().agents.find(x=>x.id===a.id).answerComplete;
 const read=async()=>{const revision=f.service.snapshot().reviews[a.id].revision;await f.service.viewAgent(a.id,{revision});return revision;};
 return {f,d,a,p,send,shown,read};
}
test('notification semantics control highlight; delivery status, runtime and new internal work do not',async t=>{
 const {f,d,a,p,send,shown,read}=await setup(t);
 const r=await send();await f.complete(r);assert.equal(shown(),true);
 const count=f.notifications.length;
 for(const status of ['attempting','sent','failed','delivery_unknown','suppressed']){
  r.notification.status=status;p.externalNotifications=false;a.observedSessionId='other';a.nativeTurns=[];
  await d.save();assert.equal(shown(),true,status);
 }
 // New internal processing must not delay a notification which already exists.
 const next=await send('次の相談');assert.equal(shown(),true);
 await read();assert.equal(shown(),false);
 await d.conversations.display({conversationId:next.conversationId,actorRunId:next.id,operationId:randomUUID(),expectedVersion:0,mode:'progress'});
 await f.complete(next);assert.equal(shown(),false,'non-target completion cannot resurrect read answer');
 assert.equal(f.notifications.length,count);
});
test('presence is delivery suppression; normal reply still becomes read, and reconnect cannot relight',async t=>{
 const {f,d,a,send,shown,read}=await setup(t);
 const r=await send();d.markPresence(a.id,{client:'one',seq:2,viewing:true});d.markPresence(a.id,{client:'two',seq:1,viewing:true});d.markPresence(a.id,{client:'one',seq:3,viewing:false});
 assert.equal(d.markPresence(a.id,{client:'one',seq:2,viewing:true}).stale,true);
 await f.complete(r);assert.equal(r.notificationSuppressed.reason,'human-present-quick-reply');assert.equal(f.notifications.length,0);assert.equal(shown(),true);
 await read();await f.restart();assert.equal(shown(),false);
});
test('work-dispatch-only (including presence-shortcut) and settled old semantic suppression stay unlit',async t=>{
 const {f,d,a,send,shown}=await setup(t);
 const r=await send();const c=d.conversations.record(r.conversationId);
 c.operations.push({id:randomUUID(),payload:JSON.stringify({action:'job',input:{actorRunId:r.id}}),receipt:{actorRunId:r.id}});
 d.markPresence(a.id);await f.complete(r);
 assert.equal(r.notificationSuppressed.reason,'human-present-quick-reply');assert.equal(conversationNotification(d.data,r).reason,'work-dispatch-only');assert.equal(shown(),false);
 const old=await send();await f.complete(old);old.notificationSuppressed={reason:'purpose-decision-progress'};delete old.notification;await d.save();
 assert.equal(conversationNotification(d.data,old).notify,true);assert.equal(shown(),false,'do not reinterpret old settled exclusions');
});
test('same turn inputs have distinct read revisions; late ack cannot clear new target',async t=>{
 const {f,d,a,send,shown,read}=await setup(t);
 const first=await send();await f.complete(first);const before=await read();
 // Use a second real accepted/ended input, then share native identity to exercise
 // the projection/read boundary independently of native steering implementation.
 const next=await send();await f.complete(next);next.turnId=first.turnId;next.sessionId=first.sessionId;await d.save();
 assert.equal(notificationEntries(d.data).filter(e=>e.agentId===a.id).length,2);
 assert.notEqual(d.snapshot().reviews[a.id].revision,before);
 await assert.rejects(d.viewAgent(a.id,{revision:before}),/新しい応答/);assert.equal(shown(),true);await read();assert.equal(shown(),false);
});
test('new human before old terminal uses notification exclusion, not agent idle/latest gates',async t=>{
 const {f,d,send,shown}=await setup(t);const r=await send();
 const next=await d.send(r.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'補足'});
 // Ensure the policy time relation explicitly; no elapsed-time success inference.
 next.createdAt=r.createdAt;await f.complete(r);
 assert.equal(conversationNotification(d.data,r).reason,'human-input-before-answer-ended');assert.equal(conversationNotificationTarget(d.data,r),false);assert.equal(shown(),false);
});
test('old read receipts migrate in place; stale receipts never clear unseen notifications',async t=>{
 const {f,d,a,send,shown}=await setup(t);const r=await send();await f.complete(r);
 const old=reviewRevision(completedEntries(humanProjection(d.data)).filter(x=>x.agentId===a.id).map(x=>x.key));
 d.data.agentReviews={[a.id]:old};migrateNotificationReviews(d.data,humanProjection(d.data));await d.save();assert.equal(shown(),false);
 const second=await send();await f.complete(second);assert.equal(shown(),true);
 migrateNotificationReviews(d.data,humanProjection(d.data));await d.save();assert.equal(shown(),true);
});

test('prepared request notification key survives same-work continuation and historical ownership changes',async t=>{
 const {d,a}=await setup(t);
 const request=id=>({id,finalAgentId:a.id,finalRunId:'r-'+id,rootWorkId:id,requestGraph:{nodes:[{id,state:{kind:'completed'}}]},notification:{id:'request:'+id,status:'suppressed'},reviewedAt:'read'});
 d.data.requests.push(request('one'),request('two'));
 d.data.runs.push({id:'r-one',agentId:a.id},{id:'r-two',agentId:a.id});
 const before=notificationEntries(d.data);d.data.agentReviews={[a.id]:reviewRevision(before.map(e=>e.key))};
 const second=d.data.requests.at(-1);second.requestGraph.nodes[0].state.kind='active';second.finalAgentId='new-owner';
 assert.deepEqual(notificationEntries(d.data),before);
 assert.equal(d.reviewStates({})[a.id].unreviewed,false);
});
