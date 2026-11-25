import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {inputHash} from './model-fixtures.mjs';
import {runState,accepted,changeRun} from '../server/run-lifecycle.mjs';
import {workspaceSnapshot} from '../server/conversation-pages.mjs';
import {VillageOperations} from '../server/operations.mjs';

async function setup(t){
 const f=await fixture(t),p=await f.service.putProject({requestId:randomUUID(),name:'Lifecycle'});
 for(const a of f.agents)a.projectId=p.id;
 await f.service.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 return f;
}
const send=(f,instruction='依頼してください')=>f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction});
async function job(f,r){
 return f.service.conversations.job({conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),instruction:'isolated job',authorization:{runId:r.id,quote:r.instruction}});
}
function unobserved(f,r,{competing=false}={}){
 const native=f.runtimes.get(r.agentId),text=f.sent.findLast(s=>s.agentId===r.agentId).text,tid=randomUUID();
 native.cursor+=10;native.inputs.push({id:'i'+tid,turnId:tid,hash:inputHash(text),text,offset:native.cursor,source:'response'});
 native.turns.push({id:tid,state:'running',output:''});
 if(competing){native.cursor++;native.inputs.push({id:'other',turnId:tid,text:'other input',offset:native.cursor,source:'response'});}
 return tid;
}
test('leading whitespace is canonicalized before transport and fingerprint, including lazy first session; next turns still work',async t=>{
 const f=await setup(t),native=f.runtimes.get(f.agents[0].id),observe=f.service.observe.bind(f.service);
 // A newly launched Codex can be idle before its session has been published.
 let cold=true;f.service.observe=async a=>{const s=await observe(a);return a.id===f.agents[0].id&&cold?{available:true,sessionId:'',cursor:0,inputs:[],turns:[]}:s;};
 const original='\n  \n依頼してください';
 const r=await send(f,original);assert.equal(r.instruction,original);assert.equal(r.baselineRuntime.sessionId,'');
 const text=f.sent.at(-1).text;assert.equal(text,text.trim());assert.equal(r.inputCorrelation.digest,inputHash(text));
 cold=false;unobserved(f,r);
 const view=await f.service.conversations.read(r.conversationId,r.id);assert.equal(view.runs[0].state,'running');assert(accepted(r));
 await f.complete(r);assert.equal(runState(r),'completed');assert.equal(f.service.conversations.get(r.conversationId).runs[0].humanAnswer,'Final '+r.id);
 const next=await send(f);await f.submit(next);await f.complete(next);assert.equal(f.sent.length,2);assert.equal(native.inputs.length,2);
});
test('CLI get observes early receipt, but competing input, foreign run and historical unconfirmed stay closed',async t=>{
 const f=await setup(t),r=await send(f);unobserved(f,r);
 const ops=new VillageOperations({dir:f.options.dir},null,{direct:f.service});
 const command=ops.commands.find(c=>c.name==='conversations get');await command.run([r.conversationId,r.id]);assert(accepted(r));await f.complete(r);
 const bad=await send(f);unobserved(f,bad,{competing:true});
 await assert.rejects(command.run([bad.conversationId,bad.id]),/受付照合済み/);assert(!accepted(bad));
 changeRun(bad,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});
 const before=JSON.stringify(bad);await assert.rejects(command.run([bad.conversationId,bad.id]),/受付照合済み/);assert.equal(JSON.stringify(bad),before);
 await assert.rejects(command.run([bad.conversationId,'foreign']),/受付照合済み/);
});
test('re-observe after initial contract check catches a competing first turn before any send',async t=>{
 const f=await setup(t),observe=f.service.observe.bind(f.service);let count=0;
 f.service.observe=async a=>{
  const s=await observe(a);if(a.id!==f.agents[0].id)return s;
  if(++count===1)return {available:true,sessionId:'',cursor:0,inputs:[],turns:[]};
  a.agentModel.observation.activity='running';
  return {...s,inputs:[{id:'external',text:'external',offset:1}],turns:[{id:'external',state:'running'}]};
 };
 const r=await send(f);assert.equal(runState(r),'queued');assert.equal(f.sent.length,0);
});
test('leader busy or migration blocked never locks secretary mailbox; projection survives focused paging and result delivery',async t=>{
 const f=await setup(t),r=await send(f);await f.submit(r);const receipt=await job(f,r);
 await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await f.complete(r);
 const next=await send(f,'追加指示');await f.submit(next);assert.equal(runState(leader),'running');
 let a=f.service.snapshot().agents.find(a=>a.id===r.agentId);assert(a.conversationControl.canAccept);assert.equal(a.conversationWork.jobs[0].code,'working');
 await f.complete(next);
 // Finish leader through the actual graph and return path.
 await f.service.flow.finish({humanRequestId:leader.humanRequestId,workId:leader.workId,runId:leader.id,operationId:randomUUID(),inputs:f.service.flow.inputs(leader.humanRequestId,leader.workId).map(i=>i.id),results:[]});
 await f.complete(leader);
 const c=f.service.conversations.record(r.conversationId),delivery=f.service.flow.run(c.deliveries[0].runId);
 a=workspaceSnapshot(f.service.snapshot(),{},[r.agentId]).agents.find(a=>a.id===r.agentId);
 assert.equal(a.conversationWork.jobs[0].code,'evaluating');await f.submit(delivery);await f.complete(delivery);
 a=f.service.snapshot().agents.find(a=>a.id===r.agentId);assert.equal(a.conversationWork.jobs[0].code,'evaluating');assert.equal(a.conversationWork.jobs[0].humanApproval,'not-inferred');
 assert.equal(f.sent.filter(s=>s.text.includes(delivery.id)).length,1);
 const third=await send(f);await f.submit(third);const secondJob=await job(f,third);
 f.service.agent(leader.agentId).inputEnvelope.mode='migration-required';await f.service.save();await f.service.tick();
 const held=f.service.flow.run(secondJob.runId);assert.equal(runState(held),'queued');assert(!held.dispatchAttemptedAt);
 a=f.service.snapshot().agents.find(a=>a.id===r.agentId);assert.equal(a.conversationWork.leader.code,'migration-required');assert.equal(a.conversationWork.jobs.at(-1).code,'blocked');assert(a.conversationControl.canAccept);
 await f.complete(third);const fourth=await send(f,'リーダーの復旧状況を教えて');await f.submit(fourth);await f.complete(fourth);
 assert.equal(f.sent.filter(s=>s.text.includes(held.id)).length,0);
 await f.restart();assert.equal(f.service.snapshot().agents.find(a=>a.id===r.agentId).conversationWork.jobs.at(-1).code,'blocked');
});
test('failed or unknown leader return is not success; later human input remains usable and migration failure explains next step',async t=>{
 const f=await setup(t),r=await send(f);await f.submit(r);const receipt=await job(f,r);await f.complete(r);const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await f.complete(leader,'failed');
 const a=f.service.snapshot().agents.find(a=>a.id===r.agentId);assert.equal(a.conversationWork.jobs[0].code,'attention');assert(a.conversationControl.canAccept);
 const delivery=f.service.flow.run(f.service.conversations.record(r.conversationId).deliveries[0].runId);await f.submit(delivery);await f.complete(delivery,'failed');
 const next=await send(f);await f.submit(next);await f.complete(next);assert.equal(f.sent.filter(s=>s.agentId===leader.agentId&&s.text.includes(leader.id)).length,1);
 f.service.agent(r.agentId).inputEnvelope.mode='migration-required';await f.service.save();
 assert.equal(f.service.snapshot().agents.find(a=>a.id===r.agentId).conversationControl.canAccept,false);
 await assert.rejects(send(f),/プロフィールの起動契約/);
});
test('human can cancel only an unsent conversation, preserving running turn, graph and internal return',async t=>{
 const f=await setup(t),r=await send(f);await f.submit(r);
 const next=await send(f,'不要な追加指示');assert.equal(runState(next),'queued');
 const args={agentId:next.agentId,runId:next.id};
 await f.service.flow.cancelQueued(args);assert.equal(runState(next),'terminated');assert(next.queueCancelledAt);
 assert.deepEqual(await f.service.flow.cancelQueued(args),next);
 await assert.rejects(f.service.flow.cancelQueued({agentId:r.agentId,runId:r.id}),/未送信/);
 const receipt=await job(f,r);await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await f.complete(leader,'failed');
 const delivery=f.service.flow.run(f.service.conversations.record(r.conversationId).deliveries[0].runId);
 await assert.rejects(f.service.flow.cancelQueued({agentId:delivery.agentId,runId:delivery.id}),/人間の未送信会話/);
 await f.complete(r);assert.equal(runState(delivery),'awaiting_input');assert(!f.sent.some(s=>s.text.includes(next.id)));
 assert.equal(f.service.conversations.get(r.conversationId).runs.find(x=>x.id===next.id).lifecycle.code,'cancelled');
});
