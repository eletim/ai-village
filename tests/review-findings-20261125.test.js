// Regression fixtures for the 2026-11-25 review of integration/event-driven-requests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {agentChange} from '../server/agent-lifecycle.mjs';
import {conversationJob} from '../server/conversation-status.mjs';
import {conversationDisplayMode} from '../server/conversation-purpose.mjs';
import {answerJobsHTML,conversationWorkHTML} from '../src/conversation-status.js';

async function conversationSetup(t){
 const f=await fixture(t),d=f.service,p=await d.putProject({requestId:randomUUID(),name:'Review fixture'});
 for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 const human=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'明示依頼としてテスト成果を作ってください。'});
 await f.submit(human);
 const job=(actor=human)=>d.conversations.job({conversationId:human.conversationId,actorRunId:actor.id,operationId:randomUUID(),instruction:'テスト成果を作る',authorization:{runId:human.id,quote:'明示依頼としてテスト成果を作ってください。'}});
 return {f,d,p,human,job};
}
async function leaderResult(f,receipt){
 const d=f.service;await d.tick();const r=d.flow.run(receipt.runId);await f.submit(r);
 await d.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:d.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
 await f.complete(r);return r;
}
const deliveryRun=(d,c,humanRequestId,kind)=>d.flow.run(c.deliveries.findLast(e=>e.humanRequestId===humanRequestId&&e.kind===kind).runId);
// The production shape: isolated, no request graph, unrelated to the healthy work.
const quarantined=(id,extra={})=>({id,instruction:'隔離された旧記録',createdAt:'2026-01-01T00:00:00.000Z',integrity:{version:1,reasons:['works','rootWorkId: undefined']},...extra});

test('P1: graph-less quarantined records do not stop wakeups, secretary delivery or decision recovery of healthy conversation work',async t=>{
 const {f,d,p,human,job}=await conversationSetup(t);
 d.data.requests.push(quarantined('quarantined-same',{projectId:p.id,conversationId:human.conversationId,originAgentId:f.agents[2].id,finalAgentId:f.agents[2].id}),quarantined('quarantined-other',{projectId:'other-project'}));
 await d.save();
 const receipt=await job();await f.complete(human);
 // Durable wakeups for both the isolated and the healthy record are processed in one cycle.
 d.store.commit({changes:[],wakeups:['quarantined-same','quarantined-other',receipt.humanRequestId]});d.store.reloadJobs();
 const leader=await leaderResult(f,receipt);
 const c=d.conversations.record(human.conversationId),delivery=deliveryRun(d,c,receipt.humanRequestId,'result');
 assert(delivery,'healthy result must reach the secretary');assert.equal(d.store.jobs.has('quarantined-same'),false);
 assert.equal(d.flow.root('quarantined-same').requestGraph,undefined);
 // Reads that scan the conversation stay available and report the isolation explicitly.
 const view=d.conversations.get(human.conversationId);assert.equal(view.jobs.find(j=>j.id==='quarantined-same').lifecycle.code,'quarantined');
 await d.tick();await f.submit(delivery);await f.complete(delivery);
 // Missing decision on the healthy result is recovered, the isolated record is not touched.
 await d.progress();
 assert.equal(c.deliveries.filter(e=>e.decisionRecovery&&e.humanRequestId===receipt.humanRequestId).length,1);
 assert.equal(c.deliveries.some(e=>e.humanRequestId.startsWith('quarantined')),false);
 assert.equal(d.conversations.pendingForAgent(human.agentId),true);
 await f.restart();await f.service.tick();
 assert(f.service.flow.root('quarantined-same').integrity);assert.equal(f.service.flow.run(leader.id).runModel.state.outcome,'normal');
});

test('P2: failure/state-change reports reach the human; result adoption still requires a decision',async t=>{
 const {f,d,human,job}=await conversationSetup(t);
 const receipt=await job();await f.complete(human);await d.tick();const leader=d.flow.run(receipt.runId);await f.submit(leader);await f.complete(leader,'failed');
 const c=d.conversations.record(human.conversationId),attention=deliveryRun(d,c,receipt.humanRequestId,'attention');
 assert.equal(attention.requiresPurposeDecision,undefined);assert.doesNotMatch(attention.instruction,/達成の報告/);
 await d.tick();await f.submit(attention);
 await d.conversations.display({conversationId:c.id,actorRunId:attention.id,operationId:randomUUID(),expectedVersion:0,mode:'reply'});
 const before=f.notifications.length;await f.complete(attention);
 assert.equal(conversationDisplayMode(d.data,attention),'reply');assert.equal(attention.notificationSuppressed,undefined);
 assert.equal(f.notifications.length,before+1);assert.equal(f.notifications.at(-1).content,'秘書からの返答\nFinal '+attention.id);
 assert.equal(c.purposeDecisions?.length||0,0,'no adoption or question is required for a report');
 // Records written before the split carried the flag on every delivery: classify by kind.
 attention.requiresPurposeDecision=true;delete attention.conversationDisplay;assert.equal(conversationDisplayMode(d.data,attention),'reply');
 // Withdrawal confirmation (important-change) is a report too.
 const second=await d.send(human.agentId,{mode:'conversation',conversationId:c.id,requestId:randomUUID(),instruction:'別件も明示依頼として作ってください。'});await f.submit(second);
 const other=await d.conversations.job({conversationId:c.id,actorRunId:second.id,operationId:randomUUID(),instruction:'別件',authorization:{runId:second.id,quote:'別件も明示依頼として作ってください。'}});await f.complete(second);
 const w=d.flow.root(other.humanRequestId);await d.flow.cancel({humanRequestId:w.id,revision:w.revision,reason:'人間が取り下げ'});await d.tick();
 const closure=deliveryRun(d,c,other.humanRequestId,'important-change');assert.equal(closure.requiresPurposeDecision,undefined);
 await d.tick();await f.submit(closure);const n=f.notifications.length;await f.complete(closure);
 assert.equal(conversationDisplayMode(d.data,closure),'reply');assert.equal(f.notifications.length,n+1);assert.equal(c.purposeDecisions?.length||0,0);
});

test('P2: an already suppressed report notification is not replayed',async t=>{
 const {f,d,human,job}=await conversationSetup(t);
 const receipt=await job();await f.complete(human);await d.tick();const leader=d.flow.run(receipt.runId);await f.submit(leader);await f.complete(leader,'failed');
 const c=d.conversations.record(human.conversationId),attention=deliveryRun(d,c,receipt.humanRequestId,'attention');
 attention.requiresPurposeDecision=true;attention.notificationSuppressed={reason:'purpose-decision-progress',at:'2026-11-25T04:40:33.155Z',displayVersion:0};await d.save();
 await d.tick();await f.submit(attention);const n=f.notifications.length;await f.complete(attention);await f.restart();await f.service.tick();
 assert.equal(f.notifications.length,n);assert.equal(conversationDisplayMode(f.service.data,f.service.flow.run(attention.id)),'reply');
});

async function handoverSetup(t){
 const f=await fixture(t),d=f.service,[old,target,leader]=f.agents;
 const p=await d.putProject({requestId:randomUUID(),name:'handover'});for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:leader.id},p.id);
 const history=await d.send(old.id,{mode:'conversation',requestId:randomUUID(),instruction:'旧会話本文'});await f.submit(history);await f.complete(history);
 const actor=await d.flow.start(leader.id,{requestId:randomUUID(),instruction:'許可済みの同Project秘書整理'});await d.flow.dispatchReady();await f.submit(actor);
 agentChange(old,{type:'stop',actor:'human'});agentChange(old,{type:'observe',actor:'program',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}});old.processVerification={remainingOwned:0};old.terminatedAt=new Date().toISOString();await d.save();
 const args=()=>({operationId:randomUUID(),actorRunId:actor.id,targetAgentId:target.id,planHash:d.secretaryHandoverPlan(old.id,target.id).planHash,reason:'旧秘書の窓口を統合'});
 return {f,d,p,old,target,leader,history,args};
}
test('P3: an unrelated graph-less quarantined record does not affect the handover plan',async t=>{
 const {d,old,target,history,args}=await handoverSetup(t);
 d.data.requests.push(quarantined('unrelated-quarantine',{projectId:'other-project',originAgentId:'someone-else',finalAgentId:'someone-else'}));await d.save();
 const plan=d.secretaryHandoverPlan(old.id,target.id);assert.deepEqual(plan.quarantined,[]);
 const receipt=await d.handoverSecretary(old.id,args());assert.equal(receipt.targetAgentId,target.id);
 assert.equal(d.conversations.record(history.conversationId).agentId,target.id);
});
test('P3: a quarantined record within the secretary responsibility holds the handover with its reason',async t=>{
 const {d,old,target,history,args}=await handoverSetup(t);
 d.data.requests.push(quarantined('related-quarantine',{projectId:old.projectId,conversationId:history.conversationId,originAgentId:old.id,finalAgentId:old.id}));await d.save();
 const plan=d.secretaryHandoverPlan(old.id,target.id);assert.deepEqual(plan.quarantined.map(x=>x.humanRequestId),['related-quarantine']);assert(plan.quarantined[0].reasons.length);
 await assert.rejects(d.handoverSecretary(old.id,args()),/隔離中の依頼記録.*related-quarantine/);
 assert.equal(d.conversations.record(history.conversationId).agentId,old.id);assert.equal(old.secretaryHandover,undefined);
});

test('P4: moving a project leader to another Project requires releasing the leader first; next job is accepted',async t=>{
 const {f,d,p,job}=await conversationSetup(t);const leader=f.agents[2],next=f.agents[3];
 const other=await d.putProject({requestId:randomUUID(),name:'Other'});
 await assert.rejects(d.updateAgent(leader.id,{revision:leader.metadataRevision||0,projectId:other.id}),/リーダーを解除/);
 assert.equal(leader.projectId,p.id);assert.equal(d.data.projects.find(x=>x.id===p.id).leaderAgentId,leader.id);
 const current=()=>d.data.projects.find(x=>x.id===p.id);
 await d.putProject({revision:current().revision,leaderAgentId:null},p.id);
 await d.updateAgent(leader.id,{revision:leader.metadataRevision||0,projectId:other.id});assert.equal(leader.projectId,other.id);
 await d.putProject({revision:current().revision,leaderAgentId:next.id},p.id);
 const receipt=await job();assert.equal(receipt.leaderAgentId,next.id);
 // No Project keeps a leader outside itself.
 for(const x of d.data.projects.filter(x=>x.leaderAgentId))assert.equal(d.agent(x.leaderAgentId).projectId,x.id);
 // Non-leader reassignment and same-Project updates are unaffected.
 await d.updateAgent(f.agents[1].id,{revision:f.agents[1].metadataRevision||0,projectId:other.id});assert.equal(f.agents[1].projectId,other.id);
 await d.updateAgent(next.id,{revision:next.metadataRevision||0,name:'Leader renamed'});
});

test('P5: legacy deliveries without decision records are shown as such, never as an ongoing check or adoption',async t=>{
 const {f,d,human,job}=await conversationSetup(t);
 const receipt=await job();await f.complete(human);
 // Freeze the dispatch while the legacy format is reproduced (pre-decision records).
 await d.tick();const leader=d.flow.run(receipt.runId);await f.submit(leader);
 await d.flow.finish({humanRequestId:leader.humanRequestId,workId:leader.workId,runId:leader.id,operationId:randomUUID(),inputs:d.flow.inputs(leader.humanRequestId,leader.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
 const native=f.runtimes.get(leader.agentId);Object.assign(native.turns.find(x=>x.id===leader.turnId),{state:'completed',output:'result',finalOutput:'result'});
 await d.poll(d.agent(leader.agentId));await d.flow.settle();
 const c=d.conversations.record(human.conversationId),event=c.deliveries.find(e=>e.humanRequestId===receipt.humanRequestId&&e.kind==='result'),delivery=d.flow.run(event.runId);
 delete event.decisionRecoveryVersion;delete delivery.requiresPurposeDecision;await d.save();
 await d.tick();await f.submit(delivery);await f.complete(delivery);await d.progress();
 const q=d.flow.root(receipt.humanRequestId),j=conversationJob(d.data,q);
 assert.equal(j.code,'legacy-unrecorded');assert.match(j.reason,/推定していません/);assert.equal(j.humanApproval,'not-inferred');
 assert.equal(c.purposeDecisions?.length||0,0);assert.equal(c.deliveries.filter(e=>e.decisionRecovery).length,0);
 assert.equal(d.conversations.pendingForAgent(human.agentId),false);
 assert.equal(answerJobsHTML({answerJobs:[j]}),'');
 assert.match(conversationWorkHTML({id:human.agentId,conversationWork:{leader:{name:'L',code:'ready'},jobs:[j]}}),/判断記録なし（旧形式）/);
 assert.doesNotMatch(conversationWorkHTML({id:human.agentId,conversationWork:{leader:{name:'L',code:'ready'},jobs:[j]}}),/秘書が確認中|秘書の確認待ち/);
 await f.restart();assert.equal(conversationJob(f.service.data,f.service.flow.root(q.id)).code,'legacy-unrecorded');
});
test('P5: current-format deliveries keep their ongoing check and recovery',async t=>{
 const {f,d,human,job}=await conversationSetup(t);
 const receipt=await job();await f.complete(human);await leaderResult(f,receipt);
 const c=d.conversations.record(human.conversationId),delivery=deliveryRun(d,c,receipt.humanRequestId,'result');
 assert.equal(conversationJob(d.data,d.flow.root(receipt.humanRequestId)).code,'evaluating');assert.equal(delivery.requiresPurposeDecision,true);
 await d.tick();await f.submit(delivery);const n=f.notifications.length;await f.complete(delivery);await d.progress();
 // A result is material to adopt: without a decision it stays progress and is not announced.
 assert.equal(conversationDisplayMode(d.data,delivery),'progress');assert.equal(delivery.notificationSuppressed.reason,'purpose-decision-progress');assert.equal(f.notifications.length,n);
 assert.notEqual(conversationJob(d.data,d.flow.root(receipt.humanRequestId)).code,'legacy-unrecorded');
 assert.equal(c.deliveries.filter(e=>e.decisionRecovery).length,1);
});
