// Secretary as supervisor (docs/secretary-supervisor.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
import {RECOVERY_PREFIX,DELIVERY_GUIDANCE} from '../server/conversations.mjs';
import {PATROL_INTERVAL_MS,PATROL_GUIDANCE,patrolInterval} from '../server/conversation-patrol.mjs';
import {conversationNotification} from '../server/conversation-notification.mjs';
import {conversationDisplayMode} from '../server/conversation-purpose.mjs';
import {runState} from '../server/run-lifecycle.mjs';
import {AgentRules} from '../server/agent-rules.mjs';
import {DEFAULT_SECRETARY_POLICY,secretaryGuide} from '../server/project-guides.mjs';

async function stoppedLeader(t,outcome='failed'){
 const x=await purposeFixture(t),{f,human,first}=x,d=f.service;
 await d.tick();const leader=d.flow.run(first.runId);await f.submit(leader);await f.complete(leader,outcome);
 const c=d.conversations.record(human.conversationId),event=c.deliveries.find(e=>e.kind==='attention');
 await d.tick();const attention=d.flow.run(event.runId);await f.submit(attention);
 return {...x,d,leader,attention,c};
}
const recoverArgs=(x,actor,extra={})=>({conversationId:x.human.conversationId,actorRunId:actor.id,operationId:'recover-'+actor.id.slice(0,8),purposeId:x.first.humanRequestId,instruction:'テストの続きから進めてください',...extra});

test('recover: a failed leader run is retried under the original permission, once, and the handled failure is not pinged',async t=>{
 const x=await stoppedLeader(t),{f,d,leader,attention}=x;
 assert.match(attention.instruction,/conversations recover/);
 const receipt=await d.conversations.recover(recoverArgs(x,attention));
 assert.equal(receipt.mode,'retry');assert.equal(receipt.action,'recover');assert.deepEqual(receipt.authorization,x.auth);
 const retry=d.flow.run(receipt.runId);assert.equal(retry.agentId,leader.agentId);assert.equal(retry.retryFrom,leader.id);assert.equal(retry.origin,'retry');
 assert(retry.instruction.startsWith(RECOVERY_PREFIX));assert.match(retry.instruction,/テストの続きから/);
 // Idempotent: the same operation returns the same receipt; a changed payload is refused; nothing new is queued.
 const runs=d.data.runs.length;assert.deepEqual(await d.conversations.recover(recoverArgs(x,attention)),receipt);assert.equal(d.data.runs.length,runs);
 await assert.rejects(d.conversations.recover(recoverArgs(x,attention,{instruction:'別の指示'})),/operationIdの再利用/);
 // The retry is queued or running now: a second recovery is refused rather than doubling the work.
 await assert.rejects(d.conversations.recover(recoverArgs(x,attention,{operationId:'recover-again-1'})),/実行中|立て直せません/);
 await d.tick();assert.notEqual(runState(retry),'queued','the retry is dispatched');
 await f.complete(attention);
 assert.deepEqual(conversationNotification(d.data,attention),{notify:false,reason:'secretary-handled'});
 assert.equal(f.notifications.filter(n=>n.id==='conversation-answer:'+attention.id).length,0);
});

test('recover: a failure the secretary does not handle is still reported to the human',async t=>{
 const {f,d,attention}=await stoppedLeader(t,'interrupted');
 await f.complete(attention);assert.deepEqual(conversationNotification(d.data,attention),{notify:true,reason:'work-report'});
 assert.equal(f.notifications.filter(n=>n.id==='conversation-answer:'+attention.id).length,1);
});

test('recover refuses unknown acceptance, running work and extra arguments',async t=>{
 const x=await purposeFixture(t),{f,human,first}=x,d=f.service;
 // A second human turn gives the secretary a current run while the leader's job is being dispatched.
 const turn=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'状況は？'});
 await d.tick();const leader=d.flow.run(first.runId);
 assert(['sent','queued','awaiting_input'].includes(runState(leader)));
 await f.submit(turn);
 const args={conversationId:human.conversationId,actorRunId:turn.id,operationId:randomUUID(),purposeId:first.humanRequestId,instruction:'続けて'};
 await assert.rejects(d.conversations.recover(args),/受付不明|実行中/);
 await f.submit(leader);await assert.rejects(d.conversations.recover({...args,operationId:randomUUID()}),/受付不明|実行中/);
 await assert.rejects(d.conversations.recover({...args,operationId:randomUUID(),authorization:x.auth}),/目的IDと指示だけ/);
 await assert.rejects(d.conversations.recover({...args,operationId:randomUUID(),purposeId:randomUUID()}),/目的ID/);
});

test('recover resumes a leader that ended normally but left its work open, unless it is legitimately waiting',async t=>{
 const x=await purposeFixture(t),{f,human,first}=x,d=f.service;
 await d.tick();const leader=d.flow.run(first.runId);await f.submit(leader);
 // The leader asked the secretary and is waiting for the answer: not a stall.
 await d.flow.report({humanRequestId:leader.humanRequestId,workId:leader.workId,actorRunId:leader.id,operationId:randomUUID(),kind:'question',text:'AとBのどちらで進めますか？'});
 await d.flow.respond({humanRequestId:leader.humanRequestId,workId:leader.workId,runId:leader.id,operationId:randomUUID(),inputs:d.flow.inputs(leader.humanRequestId,leader.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
 await f.complete(leader);
 const c=d.conversations.record(human.conversationId),event=c.deliveries.find(e=>e.kind==='question');assert(event,'question delivered');
 await d.tick();const asked=d.flow.run(event.runId);await f.submit(asked);
 assert(asked.instruction.startsWith(DELIVERY_GUIDANCE.question));
 const args={conversationId:human.conversationId,actorRunId:asked.id,operationId:randomUUID(),purposeId:first.humanRequestId,instruction:'続けて'};
 await assert.rejects(d.conversations.recover(args),/秘書の回答を待っています/);
 // The secretary answers from the agreement; the leader resumes and the human is not pinged.
 const answer=await d.conversations.followup({conversationId:human.conversationId,actorRunId:asked.id,operationId:randomUUID(),purposeId:first.humanRequestId,instruction:'合意どおりAで進めてください'});
 assert.equal(answer.action,'amend');await f.complete(asked);
 assert.equal(conversationNotification(d.data,asked).notify,false);
 await d.tick();const resumed=d.data.runs.findLast(r=>r.humanRequestId===first.humanRequestId&&r.agentId===leader.agentId);
 assert.notEqual(resumed.id,leader.id);assert.equal(resumed.origin,'inbox');
 const answered=d.flow.root(first.humanRequestId).requestGraph.nodes[0].inbox.find(i=>i.kind==='supplement');assert.equal(answered.text,'合意どおりAで進めてください');assert.deepEqual(answered.attempts,[resumed.id]);
});

test('patrol wakes the secretary only after a quiet interval, postpones on progress, backs off, and stays quiet',async t=>{
 const x=await purposeFixture(t),{f,human,first}=x,d=f.service;
 await d.tick();const leader=d.flow.run(first.runId);await f.submit(leader);
 const patrols=()=>d.data.runs.filter(r=>r.conversationId===human.conversationId&&r.conversationSource?.patrol);
 let now=Date.now();
 assert.equal(await d.patrol.check(now),0);
 now+=PATROL_INTERVAL_MS-60000;assert.equal(await d.patrol.check(now),0);
 // Progress (the leader's output grows) postpones the patrol by a full interval.
 const native=f.runtimes.get(d.agent(leader.agentId).workspaceId.replace(/^ws-/,'')).turns.find(t=>t.id===leader.turnId);
 native.output=(native.output||'')+'progress';await d.tick();assert.match(leader.output,/progress/);now+=120000;assert.equal(await d.patrol.check(now),0);
 now+=PATROL_INTERVAL_MS-60000;assert.equal(await d.patrol.check(now),0);
 now+=60000;assert.equal(await d.patrol.check(now),1);
 const [p]=patrols();assert(p.instruction.startsWith(PATROL_GUIDANCE));const packet=JSON.parse(p.instruction.slice(PATROL_GUIDANCE.length+1));
 assert.equal(packet.jobs.length,1);assert.equal(packet.jobs[0].purposeId,first.humanRequestId);assert.equal(packet.jobs[0].state.code,'working');
 assert.equal(d.conversations.record(human.conversationId).patrol.count,1);
 // While that patrol turn is pending or running, no second one is queued.
 assert.equal(await d.patrol.check(now+PATROL_INTERVAL_MS*3),0);
 await d.tick();await f.submit(p);await f.complete(p);
 assert.equal(conversationDisplayMode(d.data,p),'progress');assert.deepEqual(conversationNotification(d.data,p),{notify:false,reason:'patrol-quiet'});
 // Quiet patrols back off: the next one waits twice as long.
 assert.equal(patrolInterval(1),PATROL_INTERVAL_MS*2);
 assert.equal(await d.patrol.check(now+PATROL_INTERVAL_MS*2-60000),0);
 assert.equal(await d.patrol.check(now+PATROL_INTERVAL_MS*2+1000),1);
 // Finished work is no longer patrolled.
 await d.flow.finish({humanRequestId:leader.humanRequestId,workId:leader.workId,runId:leader.id,operationId:randomUUID(),inputs:d.flow.inputs(leader.humanRequestId,leader.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
 await f.complete(leader);const before=patrols().length;
 await d.tick();for(const r of patrols())if(runState(r)!=='completed'){await f.submit(r);await f.complete(r);}
 assert.equal(await d.patrol.check(now+PATROL_INTERVAL_MS*50),0);assert.equal(patrols().length,before);
});

test('a patrol that explicitly replies reaches the human',async t=>{
 const x=await purposeFixture(t),{f,human,first}=x,d=f.service;
 await d.tick();await f.submit(d.flow.run(first.runId));
 const now=Date.now();await d.patrol.check(now);assert.equal(await d.patrol.check(now+PATROL_INTERVAL_MS+1000),1);
 const p=d.data.runs.findLast(r=>r.conversationSource?.patrol);await d.tick();await f.submit(p);
 await d.conversations.display({conversationId:human.conversationId,actorRunId:p.id,operationId:randomUUID(),expectedVersion:0,mode:'reply'});
 await f.complete(p);assert.equal(conversationDisplayMode(d.data,p),'reply');assert.deepEqual(conversationNotification(d.data,p),{notify:true,reason:'explicit-conversation-reply'});
});

test('rules and Project policy describe the supervising secretary within the agreed direction',()=>{
 const r=new AgentRules('http://127.0.0.1:5173'),work=r.specification().text,supervise=r.action('supervise');
 assert(work.length<1700);assert.match(work,/最後まで監督/);assert.match(work,/元に戻せない/);assert.match(work,/mainマージ/);assert.match(work,/conversations recover/);assert.match(work,/範囲を自分で広げない/);
 assert.equal(supervise.revision,r.specification().revision);assert.match(supervise.text,/見回り/);assert.match(supervise.text,/受付不明は推測で再送しない/);
 assert.match(r.action('leader').text,/report kind:question/);
 const guide=secretaryGuide({available:true,projectId:'p',content:DEFAULT_SECRETARY_POLICY+'\n独自',revision:'r'});
 assert.match(guide.content,/監督/);assert.match(guide.content,/mainマージは明示許可/);assert(guide.content.endsWith('\n独自'));
});

test('recover resumes a leader stuck after normal endings that never handled its input',async t=>{
 const x=await purposeFixture(t),{f,human,first}=x,d=f.service;
 const turn=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'進み具合を見ておいて'});
 // The leader ends normally without declaring its input handled; the village redelivers it once.
 for(let i=0;i<4;i++){await d.tick();const r=d.data.runs.findLast(r=>r.humanRequestId===first.humanRequestId&&['sent','awaiting_input','queued'].includes(runState(r)));if(!r)break;await f.submit(r);await f.complete(r);}
 const w=d.flow.root(first.humanRequestId).requestGraph.nodes[0],last=d.flow.run(w.currentRunId);
 assert.equal(w.state.kind,'active');assert.equal(runState(last),'completed');assert(w.inbox.some(i=>!i.handledBy));
 await d.tick();await f.submit(turn);
 const receipt=await d.conversations.recover({conversationId:human.conversationId,actorRunId:turn.id,operationId:randomUUID(),purposeId:first.humanRequestId,instruction:'残りを進めて完了を申告してください'});
 assert.equal(receipt.mode,'resume');const resumed=d.flow.run(receipt.runId);assert.equal(resumed.origin,'continuation');assert(resumed.instruction.startsWith(RECOVERY_PREFIX));
 // The continuation carries the unhandled input and is the current run, so the village does not deliver it a second time.
 const now=d.flow.root(first.humanRequestId).requestGraph.nodes[0];assert(now.inbox.filter(i=>!i.handledBy&&!i.retiredBy).every(i=>i.attempts.includes(resumed.id)));assert.equal(now.currentRunId,resumed.id);
 const count=d.data.runs.length;await d.tick();assert.equal(d.data.runs.length,count);
 await d.tick();assert.notEqual(runState(resumed),'queued','the continuation is dispatched');
});
