import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
import {decisionRecoveryPlan,recoverMissingDecision,resultSourceEvent} from '../server/conversation-decision-recovery.mjs';

async function ready(t){
 const x=await purposeFixture(t),one=await x.completeJob(x.first);
 delete one.event.decisionRecoveryVersion;
 await x.f.complete(one.delivery);
 const c=()=>x.f.service.conversations.record(x.human.conversationId),q=()=>x.f.service.flow.root(x.first.humanRequestId);
 const plan=()=>decisionRecoveryPlan(x.f.service.data,c(),q());
 const recover=()=>x.f.service.locked('request-graph',()=>x.f.service.persist(async()=>{const changed=recoverMissingDecision(x.f.service.conversations,c(),q());if(changed)await x.f.service.save();return changed;}));
 return {...x,one,c,q,plan,recover};
}
test('missing normal judgment queues only saved-result review, deduplicates under lock and across restart, bounded at two',async t=>{
 const x=await ready(t),{f}=x;
 assert.equal(x.plan().reason,'not-enabled');x.one.event.decisionRecoveryVersion=1;
 const requests=structuredClone(f.service.data.requests),leaderSends=()=>f.sent.filter(s=>s.agentId===f.agents[2].id).length,initial=leaderSends();
 assert.deepEqual(await Promise.all([x.recover(),x.recover()]),[true,false]);
 let e=x.c().deliveries.at(-1),r=f.service.flow.run(e.runId);
 assert.equal(e.decisionRecovery.attempt,1);assert.equal(resultSourceEvent(x.c(),e),x.one.event);assert.equal(r.agentId,x.c().agentId);assert.equal(r.conversationSource.kind,'program');
 await f.restart();assert.equal(await x.recover(),false);
 await f.service.tick();r=f.service.flow.run(e.runId);await f.submit(r);await f.complete(r);
 await x.recover();e=x.c().deliveries.at(-1);assert.equal(e.decisionRecovery.attempt,2);
 await f.service.tick();r=f.service.flow.run(e.runId);await f.submit(r);await f.complete(r);
 assert.equal(x.plan().reason,'retry-limit');assert.equal(await x.recover(),false);
 assert.equal(leaderSends(),initial);assert.deepEqual(f.service.data.requests,requests);assert.equal(x.view().decision,null);
});
test('withdrawn, human closure, successor and changed result never recover',async t=>{
 const x=await ready(t);x.one.event.decisionRecoveryVersion=1;
 const w=x.q().requestGraph.nodes.find(n=>n.id===x.q().rootWorkId),state=structuredClone(w.state);
 for(const value of [{kind:'withdrawn',reason:'human'},{kind:'completed',by:'human'}]){w.state=value;assert.equal(x.plan().reason,'not-agent-result');}
 w.state=state;x.one.event.material.version++;assert.equal(x.plan().reason,'result-changed');
});
test('every explicit pending/committed/stale/failed judgment excludes autonomous retry',async t=>{
 const x=await ready(t);x.one.event.decisionRecoveryVersion=1;
 const c=x.c();
 for(const kind of ['accept','question','continue']){
  c.purposeDecisions=[{id:randomUUID(),purposeId:x.q().id,humanRequestId:x.q().id,kind,actorRunId:x.one.delivery.id,deliveryId:x.one.event.id,humanSequence:1}];
  assert.match(x.plan().reason,/^decision-/);
 }
 c.purposeDecisions[0].actorRunId='missing';c.purposeDecisions[0].kind='accept';assert.equal(x.plan().reason,'decision-failed');
});
test('late human input is delivered first, accepted normal context permits review, unknown stops it',async t=>{
 const x=await ready(t),{f}=x;x.one.event.decisionRecoveryVersion=1;
 const h=await f.service.send(x.human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'古い制約に加えて追加の条件も守って'});
 assert.equal(x.plan().reason,'later-human-input');await f.submit(h);
 assert.equal(await x.recover(),false);
 // Disable automatic scheduler until the observed normal response is checked.
 delete x.one.event.decisionRecoveryVersion;await f.complete(h);x.one.event.decisionRecoveryVersion=1;
 assert.equal(x.plan().ready,true);
 h.runModel.state={kind:'ended',outcome:'unconfirmed',reason:'receipt-unknown'};
 assert.equal(x.plan().reason,'later-human-unconfirmed');assert.equal(await x.recover(),false);
});
test('failed review, invalid source material and unavailable secretary stop without executing work',async t=>{
 const x=await ready(t),{f}=x;x.one.event.decisionRecoveryVersion=1;
 await x.recover();let e=x.c().deliveries.at(-1),r=f.service.flow.run(e.runId);
 await f.service.tick();await f.submit(r);await f.complete(r,'failed');
 assert.equal(x.plan().reason,'previous-not-normal');assert.equal(await x.recover(),false);
 e.material.output+='modified';assert.equal(resultSourceEvent(x.c(),e),null);assert.equal(x.plan().reason,'invalid-recovery-chain');
});
test('atomic save failure rolls back review event and run, then one retry succeeds',async t=>{
 const x=await ready(t),{f}=x;x.one.event.decisionRecoveryVersion=1;await f.service.save();
 const before={runs:f.service.data.runs.length,deliveries:x.c().deliveries.length,sequence:x.c().sequence},write=f.service.store.write;
 f.service.store.write=async()=>{throw Error('disk failure');};
 await assert.rejects(x.recover(),/disk failure/);f.service.store.write=write;
 assert.deepEqual({runs:f.service.data.runs.length,deliveries:x.c().deliveries.length,sequence:x.c().sequence},before);
 assert.equal(await x.recover(),true);assert.equal(await x.recover(),false);
});
test('recovered secretary can explicitly accept saved original result and normal response ends recovery',async t=>{
 const x=await ready(t),{f}=x;x.one.event.decisionRecoveryVersion=1;await x.recover();
 const e=x.c().deliveries.at(-1),r=f.service.flow.run(e.runId);await f.service.tick();await f.submit(r);
 await f.service.conversations.decide({...x.args(x.one),actorRunId:r.id,decision:'accept'});
 assert.equal(x.plan().reason,'decision-pending');await f.complete(r);assert.equal(x.plan().reason,'decision-committed');
 assert.equal(await x.recover(),false);assert.equal(x.view().decision.deliveryId,x.one.event.id);assert.equal(x.view().decision.state,'committed');
 assert.equal(f.service.data.requests.length,1);
});
test('migration or missing current secretary defers review; old session is never used',async t=>{
 const x=await ready(t);x.one.event.decisionRecoveryVersion=1;
 const a=x.f.service.data.agents.find(a=>a.id===x.c().agentId);a.runtimeUpgrade={state:'prepared'};
 assert.equal(x.plan().reason,'secretary-unavailable');assert.equal(await x.recover(),false);
 x.c().agentId='missing';assert.equal(x.plan().reason,'secretary-unavailable');
});

test('unsent reminder retires on human arrival and cannot block the mailbox or exceed its finite budget',async t=>{
 const {retireDecisionReminder,decisionReminderGuard}=await import('../server/conversation-decision-recovery.mjs');
 const x=await ready(t),{f}=x;x.one.event.decisionRecoveryVersion=1;await x.recover();
 const first=x.c().deliveries.at(-1),r=f.service.flow.run(first.runId);
 // Construct a queued human turn without dispatching the reminder first.
 const h=f.service.conversations.enqueue(x.c(),{requestId:randomUUID(),instruction:'追加条件',source:{kind:'human'}});
 assert.equal(decisionReminderGuard(f.service.data,r).reason,'later-human-input');
 assert.equal(retireDecisionReminder(f.service.data,r),true);assert.equal(retireDecisionReminder(f.service.data,r),false);
 assert.equal(r.runModel.state.kind,'cancelled');assert.equal(first.decisionRecovery.retired.reason,'later-human-input');assert.equal(x.plan().reason,'later-human-input');
 await f.service.save();await f.service.tick();await f.submit(h);await f.complete(h);
 await x.recover();assert.equal(x.c().deliveries.at(-1).decisionRecovery.attempt,2);
});
test('queued reminder rechecks withdrawal and explicit decision; dispatched review cannot be cancelled',async t=>{
 const {retireDecisionReminder,decisionReminderGuard}=await import('../server/conversation-decision-recovery.mjs');
 const x=await ready(t),{f}=x;x.one.event.decisionRecoveryVersion=1;await x.recover();
 const e=x.c().deliveries.at(-1),r=f.service.flow.run(e.runId),w=x.q().requestGraph.nodes.find(n=>n.id===x.q().rootWorkId),original=structuredClone(w.state);
 w.state={kind:'withdrawn',reason:'human'};assert.equal(decisionReminderGuard(f.service.data,r).reason,'request-closed-or-changed');w.state=original;
 await f.service.tick();await f.submit(r);w.state={kind:'withdrawn',reason:'human'};
 assert.equal(retireDecisionReminder(f.service.data,r),false);assert.equal(r.runModel.state.kind,'running');
});
test('program cancellation is restricted to fresh queued reminder conversations, never ordinary conversation or dispatched work',async()=>{
 const {newRun,transitionRun}=await import('../server/state/run.ts');
 const make=(id,actor='program',kind={phase:'conversation'})=>newRun('id',id,actor,null,kind).value;
 const command={type:'cancel-decision-reminder',actor:'program'},id='conversation-delivery:decision-recovery:source:1';
 const good=make(id);assert.equal(transitionRun(good,command).ok,true);
 for(const bad of [make('ordinary'),make(id,'human'),make(id,'program',{phase:'report'}),{...good,facts:[{type:'transport-ack',at:1}]},{...good,state:{kind:'sent',sentAt:1,sessionId:'s'}}])assert.equal(transitionRun(bad,command).ok,false);
 assert.equal(transitionRun(good,{...command,actor:'human'}).ok,false);
});
