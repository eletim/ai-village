import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {purposeFixture} from './purpose-fixture.js';
import {workspaceSnapshot} from '../server/conversation-pages.mjs';

test('normal native answer clears on read acknowledgement and disappears as soon as next input queues',async t=>{
 const f=await fixture(t);t.after(()=>f.service.close());const a=f.agents[0];a.projectId=(await f.service.putProject({requestId:randomUUID(),name:'Completion'})).id;
 const r=await f.service.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:'相談です'});
 await f.submit(r);await f.complete(r);
 const done=()=>f.service.snapshot().agents.find(x=>x.id===a.id).answerComplete;
 assert.equal(done(),true);
 const notificationCount=f.notifications.length;
 const view=f.service.snapshot();await f.service.viewAgent(a.id,{revision:view.reviews[a.id].revision});
 assert.equal(done(),false);assert.equal(f.service.snapshot().reviews[a.id].unreviewed,false);assert.equal(f.notifications.length,notificationCount);
 assert.equal(workspaceSnapshot(f.service.snapshot(),{},[]).agents.find(x=>x.id===a.id).answerComplete,false);
 const next=await f.service.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:'次の相談'});
 assert.equal(done(),false);await f.submit(next);assert.equal(done(),false);await f.complete(next,'failed');assert.equal(done(),false);
});
test('internal result review is not an answer; formally accepted result is',async t=>{
 const {f,completeJob,first,args}=await purposeFixture(t);t.after(()=>f.service.close());
 const {delivery,event}=await completeJob(first);
 await f.service.conversations.decide({...args({delivery,event}),decision:'accept'});
 await f.complete(delivery);
 assert.equal(f.service.snapshot().agents.find(a=>a.id===delivery.agentId).answerComplete,true);
});
test('undecided result completion remains internal progress',async t=>{
 const {f,completeJob,first}=await purposeFixture(t);t.after(()=>f.service.close());const {delivery}=await completeJob(first);await f.complete(delivery);
 assert.equal(f.service.snapshot().agents.find(a=>a.id===delivery.agentId).answerComplete,false);
});
test('stale view revision cannot clear the next unread normal answer',async t=>{
 const f=await fixture(t);t.after(()=>f.service.close());const a=f.agents[0];a.projectId=(await f.service.putProject({requestId:randomUUID(),name:'Read boundary'})).id;
 const answer=async()=>{const r=await f.service.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:'相談'});await f.submit(r);await f.complete(r);};
 await answer();const old=f.service.snapshot().reviews[a.id].revision;
 await f.service.viewAgent(a.id,{revision:old});await answer();
 const current=f.service.snapshot().reviews[a.id].revision;assert.notEqual(current,old);
 await assert.rejects(f.service.viewAgent(a.id,{revision:old}),/新しい応答/);
 assert.equal(f.service.snapshot().agents.find(x=>x.id===a.id).answerComplete,true);
 await f.service.viewAgent(a.id,{revision:current});
 assert.equal(f.service.snapshot().agents.find(x=>x.id===a.id).answerComplete,false);
});
