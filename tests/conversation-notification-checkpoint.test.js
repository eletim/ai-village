import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {DirectAgents} from '../server/direct.mjs';
import {conversationFixture} from './helpers/conversation-answer-fixture.mjs';

async function fixture(t){
 const dir=await mkdtemp('/tmp/notification-checkpoint-'),sent=[];
 const d=new DirectAgents({dir,remote:()=>{throw Error('unexpected native');},notifier:{status:()=>({enabled:false}),enqueue:async x=>{sent.push(x);return {status:'sent'};}}});
 t.after(async()=>{d.close();await rm(dir,{recursive:true,force:true});});
 await d.init({watch:false});d.data=conversationFixture();
 for(const r of d.data.runs){r.notificationPolicy='conversation';r.notification={id:'conversation-answer:'+r.id,status:'sent'};}
 await d.save();return {d,sent,r:d.data.runs[0]};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('settled history needs no rollback snapshot, save, or repeated notification',async t=>{
 const {d,sent}=await fixture(t);
 const statuses=['sent','attempting','delivery_unknown','failed'];
 for(const [i,r] of d.data.runs.entries()){
  r.notification.status=statuses[i%statuses.length];
  if(i%5===0){delete r.notification;r.notificationSuppressed={reason:'explicit-conversation-progress'};}
 }
 await d.save();const before=JSON.stringify(d.data),revision=d.store.fingerprint;
 d.units.checkpoint=()=>{throw Error('settled history traversed for rollback');};
 await Promise.all([d.conversations.notifications(),d.conversations.notifications()]);
 assert.equal(JSON.stringify(d.data),before);assert.equal(d.store.fingerprint,revision);assert.equal(sent.length,0);
});

test('notification waits for an uncommitted suppression to roll back, then sends once',async t=>{
 const {d,r,sent}=await fixture(t);delete r.notification;await d.save();
 const entered=deferred(),release=deferred();
 const writer=d.persist(async()=>{r.notificationSuppressed={reason:'transient'};entered.resolve();await release.promise;throw Error('write failed');});
 const rejected=assert.rejects(writer,/write failed/);await entered.promise;
 let completed=false;const notify=d.conversations.notifications().then(()=>{completed=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false);assert.equal(sent.length,0);
 release.resolve();await rejected;await notify;
 assert.equal(r.notificationSuppressed,undefined);assert.equal(r.notification.status,'sent');assert.equal(sent.length,1);
 await d.conversations.notifications();assert.equal(sent.length,1);
});

test('concurrent pending notification checks claim once under the writer barrier',async t=>{
 const {d,r,sent}=await fixture(t);delete r.notification;await d.save();
 await Promise.all([d.conversations.notifications(),d.conversations.notifications()]);
 assert.equal(sent.length,1);assert.equal(r.notification.status,'sent');
});

test('commit-unknown remains fail closed even when all notifications are settled',async t=>{
 const {d,sent}=await fixture(t);const error=Object.assign(Error('commit unknown'),{persistenceUncertain:true});d.persistence.failure=error;
 await assert.rejects(d.conversations.notifications(),e=>e===error);assert.equal(sent.length,0);
});

test('an in-flight uncertain commit blocks notification instead of reading tentative suppression',async t=>{
 const {d,r,sent}=await fixture(t);delete r.notification;await d.save();
 const entered=deferred(),release=deferred(),error=Object.assign(Error('commit uncertain'),{persistenceUncertain:true});
 const writer=d.persist(async()=>{r.notificationSuppressed={reason:'tentative'};entered.resolve();await release.promise;throw error;});
 const rejected=assert.rejects(writer,e=>e===error);await entered.promise;
 const notify=assert.rejects(d.conversations.notifications(),e=>e===error);
 release.resolve();await rejected;await notify;assert.equal(sent.length,0);assert.equal(d.persistence.failure,error);
});

test('pending progress suppression is durable across restart without notification',async t=>{
 const {d,r,sent}=await fixture(t);r.notification.status='pending';r.conversationDisplay={mode:'progress',version:1};await d.save();
 await d.conversations.notifications();assert.equal(r.notification,undefined);assert.equal(r.notificationSuppressed.reason,'explicit-conversation-progress');
 d.close();await d.init({watch:false});await d.conversations.notifications();
 assert.equal(sent.length,0);assert.equal(d.data.runs.find(x=>x.id===r.id).notificationSuppressed.reason,'explicit-conversation-progress');
});

test('external notification failure stays unknown after restart and is not resent',async t=>{
 const {d,r}=await fixture(t);delete r.notification;await d.save();let attempts=0;
 d.notifier.enqueue=async()=>{attempts++;throw Error('delivery outcome unknown');};
 await d.conversations.notifications();assert.equal(r.notification.status,'delivery_unknown');
 d.close();await d.init({watch:false});await d.conversations.notifications();
 assert.equal(attempts,1);assert.equal(d.data.runs.find(x=>x.id===r.id).notification.status,'delivery_unknown');
});
