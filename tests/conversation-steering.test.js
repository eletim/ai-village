import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {runState,accepted} from '../server/run-lifecycle.mjs';
import {inputHash} from './model-fixtures.mjs';
async function setup(t){const f=await fixture(t),s=f.service;const p=await s.putProject({requestId:randomUUID(),name:'Steering'});for(const a of f.agents)a.projectId=p.id;await s.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);const send=(instruction='original')=>s.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction});const r=await send();await f.submit(r);return {f,s,r,send};}
async function accept(f,r,{turnId=r.steerTarget.turnId}={}){const n=f.runtimes.get(r.agentId),text=f.sent.findLast(x=>x.text.includes(r.id)).text;n.cursor+=10;n.inputs.push({id:randomUUID(),turnId,source:'response',explicitTurn:true,text,hash:inputHash(text),offset:n.cursor});await f.service.tick();}
test('serial additions: saved is not authority; accepted same-turn aliases update read/authorize; single final',async t=>{
 const {f,s,r,send}=await setup(t),a=await send('change A'),b=await send('change B');
 assert.equal(runState(r),'superseded');assert.equal(runState(a),'awaiting_input');assert.equal(runState(b),'queued');assert.equal(f.sent.length,2);
 assert.equal(s.conversations.get(r.conversationId,r.id).sequence,1);
 assert.throws(()=>s.conversations.actor(s.conversations.record(r.conversationId),r.id),/受付/);
 await accept(f,a);assert(accepted(a));assert.equal(runState(b),'awaiting_input');assert.equal(f.sent.length,3);
 assert.equal(s.conversations.get(r.conversationId,r.id).sequence,2);
 await accept(f,b);assert.equal(b.turnId,r.turnId);assert.equal(s.conversations.actor(s.conversations.record(r.conversationId),r.id).id,b.id);
 const view=await s.conversations.read(r.conversationId,r.id);assert.equal(view.current.id,b.id);assert.equal(view.humanInputs.length,3);
 const args={conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),instruction:'job',authorization:{runId:b.id,quote:'change B'}};
 const q=await s.conversations.job(args);assert.equal(s.flow.root(q.humanRequestId).requestedBy.actorRunId,b.id);
 await f.complete(b);assert.equal(runState(b),'completed');assert.equal(runState(r),'superseded');assert.equal(runState(a),'superseded');assert.equal(r.runModel.state.outcome,'normal');assert.equal(a.runModel.state.outcome,'normal');assert(!r.runModel.decisions.some(d=>d.reason==='steering-successor-dispatched'));assert.equal(f.notifications.length,0);
 const before=f.sent.length;await f.restart();await f.service.tick();assert.equal(f.sent.length,before);assert.equal(f.service.conversations.get(r.conversationId).runs.length,3);
});
test('transport unknown survives restart without replay or later input authority',async t=>{
 const {f,s,r,send}=await setup(t);f.lose(true);const a=await send('uncertain');const b=await send('later');
 assert.equal(runState(a),'awaiting_input');assert.equal(runState(b),'queued');assert.equal(s.conversations.get(r.conversationId,r.id).sequence,1);
 await f.restart();await f.service.tick();assert.equal(f.sent.filter(x=>x.text.includes(a.id)).length,1);assert.equal(f.sent.filter(x=>x.text.includes(b.id)).length,0);
});
test('wrong native turn does not extend actor or complete and never resends',async t=>{
 const {f,s,r,send}=await setup(t),a=await send('wrong');await accept(f,a,{turnId:'foreign'});assert(!accepted(a));assert.equal(s.conversations.get(r.conversationId,r.id).sequence,1);await s.tick();assert.equal(f.sent.length,2);
});
test('unsent additions after idle use normal delivery; workshop request behavior unchanged',async t=>{
 const {f,s,r,send}=await setup(t);await f.complete(r);const a=await send('after idle');assert.equal(a.steerTarget,undefined);await f.submit(a);assert.notEqual(a.turnId,r.turnId);assert.equal(s.conversations.get(r.conversationId,r.id).sequence,1);
});

test('failed persistence before dispatch restores previous owner and never transmits the addition',async t=>{
 const {f,s,r,send}=await setup(t);f.offline(true);const a=await send('not yet sent');f.offline(false);
 const original=s.store.write;
 // Observation can save first; fail specifically the dispatch reservation.
 const save=s.save.bind(s);s.save=async(...args)=>{if(s.flow.run(a.id)?.dispatchAttemptedAt){s.store.write=async()=>{throw Error('rollback dispatch');};}return save(...args);};
 await assert.rejects(s.attemptRun(a),/rollback/);s.save=save;s.store.write=original;
 assert.equal(f.sent.filter(x=>x.text.includes(a.id)).length,0);
 const current=s.flow.run(r.id),pending=s.flow.run(a.id);assert.equal(runState(current),'running');assert.equal(current.runModel.supersededBy,undefined);assert.equal(pending.dispatchAttemptedAt,undefined);
 await f.restart();await f.service.tick();assert.equal(f.sent.filter(x=>x.text.includes(a.id)).length,1);
});
test('different conversation never steers, and cancelled queued input is never delivered',async t=>{
 const {f,s,r}=await setup(t),c={id:randomUUID(),agentId:r.agentId,projectId:s.agent(r.agentId).projectId,createdAt:new Date().toISOString(),sequence:0,operations:[],deliveries:[]};s.data.conversations.push(c);await s.save();
 const a=await s.send(r.agentId,{mode:'conversation',conversationId:c.id,requestId:randomUUID(),instruction:'unrelated'});assert.equal(runState(a),'queued');assert.equal(a.steerTarget,undefined);assert.equal(f.sent.length,1);
 await s.flow.cancelQueued({agentId:a.agentId,runId:a.id});await f.complete(r);assert.equal(f.sent.length,1);
});
test('a terminal before the appended native input cannot complete the appended conversation',async t=>{
 const {f,s,r,send}=await setup(t),a=await send('new'),n=f.runtimes.get(r.agentId);
 Object.assign(n.turns.at(-1),{state:'completed',completionOffset:n.cursor+1,finalOutput:'old answer'});await accept(f,a);
 assert(!accepted(a));assert.notEqual(runState(a),'completed');assert.equal(f.sent.length,2);
});
test('accepted addition failing or interrupted cannot produce normal answer or notification',async t=>{
 for(const outcome of ['failed','interrupted']){const {f,s,r,send}=await setup(t),a=await send('addition');await accept(f,a);await f.complete(a,outcome);assert.equal(runState(a),outcome);assert.equal(s.conversations.get(r.conversationId).runs.at(-1).humanAnswer,null);assert.equal(f.notifications.length,0);}
});
test('Claude adjacent next-turn receipt is explicit and never aliases the old actor',async t=>{
 const {f,s,r,send}=await setup(t);s.agent(r.agentId).provider='claude';const a=await send('Claude addition'),n=f.runtimes.get(r.agentId);
 Object.assign(n.turns.at(-1),{state:'completed',completionOffset:++n.cursor,output:'old'});
 const turnId=randomUUID(),text=f.sent.findLast(x=>x.text.includes(a.id)).text;n.cursor++;
 n.inputs.push({id:randomUUID(),turnId,explicitTurn:true,source:'claude-user',offset:n.cursor,text});n.turns.push({id:turnId,state:'running',output:'',messageOffsets:true,messages:[]});
 await s.tick();assert(accepted(a));assert.notEqual(a.turnId,r.turnId);assert.equal(s.conversations.currentActor(r).id,r.id);assert.throws(()=>s.conversations.actor(s.conversations.record(r.conversationId),r.id),/受付/);assert.equal(s.conversations.actor(s.conversations.record(r.conversationId),a.id).id,a.id);
});
test('same CLI operation from original actor is never repeated when the accepted scope advances',async t=>{
 const {f,s,r,send}=await setup(t),original=await s.secretaryCommands.order(r.id,'one job');
 const a=await send('change only');await accept(f,a);
 const repeated=await s.secretaryCommands.order(r.id,'one job');assert.deepEqual(repeated,original);assert.equal(s.data.requests.length,1);
});
test('uncertain dispatch commit fails closed; no send before the uncertain barrier or replay after restart',async t=>{
 const {f,s,r,send}=await setup(t);f.offline(true);const a=await send('uncertain commit');f.offline(false);
 const save=s.save.bind(s),write=s.store.write;s.save=async(...args)=>{if(s.flow.run(a.id)?.dispatchAttemptedAt)s.store.write=async value=>{await write(value);throw Object.assign(Error('commit outcome unknown'),{persistenceUncertain:true});};return save(...args);};
 await assert.rejects(s.attemptRun(a),/commit outcome unknown/);assert.equal(f.sent.length,1);assert(s.persistence.failure);
 await assert.rejects(s.putProject({requestId:randomUUID(),name:'blocked'}),/commit outcome unknown/);
 s.store.write=write;await f.restart();await f.service.tick();assert.equal(f.sent.length,1);assert.equal(f.service.flow.run(a.id).dispatchAttemptedAt!==undefined,true);assert.equal(runState(f.service.flow.run(r.id)),'superseded');
});
test('pending steer does not finalize/notify old output; pre-completed decisions remain committed',async t=>{
 const {f,s,r,send}=await setup(t),a=await send('not received yet');
 await f.complete(r);assert.equal(runState(r),'superseded');assert(!accepted(a));assert.equal(f.notifications.length,0);
 assert.equal(s.conversations.get(r.conversationId).runs.find(x=>x.id===r.id).humanAnswer,null);
});
test('notification boundary suppresses unfinished old answer but preserves a prior normal completion',async()=>{
 const {conversationNotification}=await import('../server/conversation-notification.mjs');
 const r={id:'old',conversationId:'c',conversationSequence:1,conversationSource:{kind:'human'},createdAt:new Date(0).toISOString(),completedAt:new Date(1000).toISOString()},later={id:'new',conversationId:'c',conversationSequence:2,conversationSource:{kind:'human'},createdAt:new Date(900).toISOString()};
 const data={runs:[r,later],conversations:[{id:'c',deliveries:[],operations:[]}]};assert.equal(conversationNotification(data,r).reason,'human-input-before-answer-ended');
 later.createdAt=new Date(1100).toISOString();assert.equal(conversationNotification(data,r).notify,true);
});
test('a pending adoption becomes stale on addition, but an already committed adoption is preserved',async t=>{
 const {purposeFixture}=await import('./purpose-fixture.js');
 for(const ended of [false,true]){
  const {f,human,first,completeJob,args,view}=await purposeFixture(t),one=await completeJob(first);
  await f.service.conversations.decide({...args(one),decision:'accept'});
  if(ended){await f.complete(one.delivery);assert.equal(view().decision.state,'committed');await new Promise(r=>setTimeout(r,2));}
  const extra=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'追加条件'});
  assert.equal(view().decision.state,ended?'committed':'stale');
  if(!ended){await f.submit(extra);assert.equal(view().decision.state,'stale');assert.equal(f.service.data.requests.length,1);}
 }
});
