import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {purposeFixture} from './purpose-fixture.js';
import {workspaceSnapshot} from '../server/conversation-pages.mjs';
import {secretaryAnswerComplete} from '../server/secretary-completion.mjs';

test('normal native answer survives read acknowledgement and disappears as soon as next input queues',async t=>{
 const f=await fixture(t);t.after(()=>f.service.close());const a=f.agents[0];a.projectId=(await f.service.putProject({requestId:randomUUID(),name:'Completion'})).id;
 const r=await f.service.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:'相談です'});
 await f.submit(r);await f.complete(r);
 const done=()=>f.service.snapshot().agents.find(x=>x.id===a.id).answerComplete;
 assert.equal(done(),true);
 const notificationCount=f.notifications.length;
 const view=f.service.snapshot();await f.service.viewAgent(a.id,{revision:view.reviews[a.id].revision});
 assert.equal(done(),true);assert.equal(f.service.snapshot().reviews[a.id].unreviewed,false);assert.equal(f.notifications.length,notificationCount);
 assert.equal(workspaceSnapshot(f.service.snapshot(),{},[]).agents.find(x=>x.id===a.id).answerComplete,true);
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
test('current run, role and native session boundaries never resurrect a historical answer',()=>{
 const a={id:'s',location:'mayor',state:'idle',observedSessionId:'session',nativeTurns:[]};
 const r={id:'r',agentId:'s',conversationId:'c',sessionId:'session',turnId:'t',state:'completed',conversationAnswer:true,displayMode:'reply',createdAt:'2026-01-01'};
 const view={runs:[r],requests:[]};assert.equal(secretaryAnswerComplete(view,a),true);
 for(const state of ['queued','awaiting_input','running','failed','interrupted','send_unknown'])assert.equal(secretaryAnswerComplete({...view,runs:[r,{...r,id:'new',createdAt:'2026-01-02',state}]},a),false,state);
 for(const state of ['busy','failed','interrupted','unknown','terminated'])assert.equal(secretaryAnswerComplete(view,{...a,state}),false,state);
 assert.equal(secretaryAnswerComplete(view,{...a,location:'workshop'}),false);
 assert.equal(secretaryAnswerComplete(view,{...a,observedSessionId:'other'}),false);
 assert.equal(secretaryAnswerComplete(view,{...a,nativeTurns:[{id:'other',sessionId:'session',state:'completed'}]}),false);
 assert.equal(secretaryAnswerComplete({...view,runs:[{...r,displayMode:'progress'}]},a),false);
});
