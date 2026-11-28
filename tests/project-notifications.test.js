import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {purposeFixture,acceptDelivery} from './purpose-fixture.js';
import {fixture} from './inbox-fixture.js';
import {VillageNotifier} from '../server/notifier.mjs';
async function attach(f){
 const d=f.service,n=new VillageNotifier({dir:d.dir,environment:{VILLAGE_OFFICE_URL:'http://village.test/agents'}});await n.init();n.deliveryGate=d.notifier.deliveryGate;d.notifier=n;const calls=[];n.send=(...args)=>{calls.push(args);return Promise.resolve({status:'sent',delivered:true});};return {d,n,calls};
}
async function toggle(d,id,enabled){const p=d.data.projects.find(p=>p.id===id);return d.putProject({revision:p.revision,externalNotifications:enabled},id);}
test('Project OFF blocks accepted result, normal answer and failure response at real notifier; display stays intact',async t=>{
 const {f,first,completeJob,view}=await purposeFixture(t);const {d,n,calls}=await attach(f),p=d.data.projects[0];await toggle(d,p.id,false);
 const {delivery}=await completeJob(first);await acceptDelivery(f,delivery);await f.complete(delivery);assert.equal(view().decision.state,'committed');assert.equal(view().decision.kind,'accept');assert.equal(delivery.notification.status,'suppressed');assert.equal(delivery.notification.reason,'project-external-notifications-disabled');
 const shown=d.conversations.get(delivery.conversationId).runs.find(r=>r.id===delivery.id);assert.equal(shown.humanAnswer,'Final '+delivery.id);
 const normal=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'状況を教えて'});await f.submit(normal);await f.complete(normal);assert.equal(normal.notification.status,'suppressed');
 const human=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'別件を依頼します'});await f.submit(human);
 const receipt=await d.conversations.job({conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),instruction:'別件',authorization:{runId:human.id,quote:human.instruction}});await f.complete(human);await d.tick();const worker=d.flow.run(receipt.runId);await f.submit(worker);await f.complete(worker,'failed');
 const c=d.conversations.record(human.conversationId),attention=d.flow.run(c.deliveries.findLast(e=>e.kind==='attention').runId);await d.tick();await f.submit(attention);await f.complete(attention);assert.equal(attention.notification.status,'suppressed');assert.equal(calls.length,0);
 await toggle(d,p.id,true);await d.conversations.notifications();assert.equal(calls.length,0);await n.enqueue({id:'conversation-answer:'+delivery.id,role:'assistant',projectId:p.id,eventAt:0});assert.equal(calls.length,0);
});
test('queued claims recheck OFF; enable does not replay delayed events; other Project unchanged',async t=>{
 const f=await fixture(t),{d,n,calls}=await attach(f);const p=await d.putProject({requestId:randomUUID(),name:'off'}),other=await d.putProject({requestId:randomUUID(),name:'unchanged'});
 let release;n.queue=new Promise(r=>release=r);const eventAt=Date.now(),pending=n.enqueue({id:'queued',role:'assistant',projectId:p.id,eventAt});await toggle(d,p.id,false);release();assert.equal((await pending).status,'suppressed');assert.equal(calls.length,0);
 await toggle(d,p.id,true);const delayed=await n.enqueue({id:'not-yet-enqueued',role:'assistant',projectId:p.id,eventAt});assert.equal(delayed.reason,'project-notification-before-enable');
 await n.enqueue({id:'other',role:'assistant',projectId:other.id,eventAt});assert.equal(calls.length,1);
 const fresh=Date.parse(d.data.projects.find(x=>x.id===p.id).externalNotificationsAfter)+1;await n.enqueue({id:'fresh',role:'assistant',projectId:p.id,eventAt:fresh});assert.equal(calls.length,2);
 const restored=new VillageNotifier({dir:d.dir,environment:{VILLAGE_OFFICE_URL:'http://village.test/agents'}});await restored.init();restored.send=()=>{throw Error('must not replay');};await restored.enqueue({id:'queued',role:'assistant'});
 const journal=(await readFile(join(d.dir,'notifications.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert(journal.some(x=>x.messageId==='queued'&&x.reason==='project-external-notifications-disabled'));
 await assert.rejects(d.putProject({revision:d.data.projects.find(x=>x.id===p.id).revision,externalNotifications:'off'},p.id),/boolean/);
});
test('OFF committed during claim journal blocks transport; started transport is not cancelled',async t=>{
 const f=await fixture(t),{d,n,calls}=await attach(f),p=await d.putProject({requestId:randomUUID(),name:'boundary'});const record=n.record.bind(n);let entered,release;const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);n.record=async e=>{await record(e);if(e.status==='attempting'){entered();await wait;}};
 const queued=n.enqueue({id:'claim',role:'assistant',projectId:p.id,eventAt:Date.now()});await ready;await toggle(d,p.id,false);release();assert.equal((await queued).status,'suppressed');assert.equal(calls.length,0);
 await toggle(d,p.id,true);n.record=record;let started,finish;const signal=new Promise(r=>started=r);n.send=()=>{started();return new Promise(r=>finish=r);};const active=n.enqueue({id:'started',role:'assistant',projectId:p.id,eventAt:Date.now()+1});await signal;await toggle(d,p.id,false);finish({status:'sent',delivered:true});assert.equal((await active).status,'sent');
});
