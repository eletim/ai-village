import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {agentChange} from '../server/agent-lifecycle.mjs';
import {changeRun} from '../server/run-lifecycle.mjs';
async function setup(t,{pendingJob=false}={}){
 const f=await fixture(t),d=f.service,[old,target,leader]=f.agents;
 const p=await d.putProject({requestId:randomUUID(),name:'handover'});for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:leader.id},p.id);
 const history=await d.send(old.id,{mode:'conversation',requestId:randomUUID(),instruction:'旧会話本文'});await f.submit(history);const job=pendingJob?await d.conversations.job({conversationId:history.conversationId,actorRunId:history.id,operationId:randomUUID(),instruction:'既存作業を継続',authorization:{runId:history.id,quote:history.instruction},leaderAgentId:leader.id}):null;await f.complete(history);
 const legacy=await d.flow.start(old.id,{requestId:randomUUID(),instruction:'重複秘書の整理'});await d.flow.dispatchReady();
 changeRun(legacy,{type:'lost',actor:'program',at:Date.now(),reason:'unknown-old-result'});
 const node=d.flow.work(d.flow.root(legacy.humanRequestId),legacy.workId);for(const i of node.inbox)i.attempts.push('past-unconfirmed-attempt');
 if(pendingJob){await d.putProject({revision:d.data.projects.find(x=>x.id===p.id).revision,leaderAgentId:f.agents[3].id},p.id);}
 const actor=await d.flow.start((pendingJob?f.agents[3]:leader).id,{requestId:randomUUID(),instruction:'許可済みの同Project秘書整理'});await d.flow.dispatchReady();await f.submit(actor);
 const c=d.conversations.record(history.conversationId),queued=d.conversations.enqueue(c,{requestId:randomUUID(),instruction:'未送信の質問',source:{kind:'human'}});
 agentChange(old,{type:'stop',actor:'human'});agentChange(old,{type:'observe',actor:'program',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}});old.processVerification={remainingOwned:0};old.terminatedAt=new Date().toISOString();await d.save();
 const args=()=>({operationId:'handover-test-operation',actorRunId:actor.id,targetAgentId:target.id,planHash:d.secretaryHandoverPlan(old.id,target.id).planHash,reason:'旧秘書の窓口を統合。unknownを保持し再送しない'});
 return {f,d,old,target,leader,history,legacy,actor,c,queued,args,job};
}
test('handover preserves historical identities/unknowns, moves unsent conversation and responsibility exactly once, survives restart',async t=>{
 const {f,d,old,target,history,legacy,c,queued,args}=await setup(t);const oldHistory=structuredClone(history),oldUnknown=structuredClone(legacy),count=d.data.runs.length,sends=f.sent.length,x=args();
 const receipt=await d.handoverSecretary(old.id,x);assert.equal(c.agentId,target.id);assert.equal(queued.agentId,target.id);assert.equal(queued.runModel.state.kind,'queued');
 assert.deepEqual(history,oldHistory);assert.deepEqual(legacy,oldUnknown);assert.equal(d.flow.work(d.flow.root(legacy.humanRequestId),legacy.workId).assignee,target.id);assert.equal(d.data.runs.length,count);assert.equal(f.sent.length,sends);
 assert.deepEqual(await d.handoverSecretary(old.id,x),receipt);assert.equal(d.conversations.pendingForAgent(old.id),false);assert.equal(d.snapshot().runs.find(r=>r.id===history.id).agentId,target.id);
 await assert.rejects(d.handoverSecretary(old.id,{...x,reason:'changed'}),/引継ぎ済み/);
 await f.restart();assert.equal(f.service.conversations.record(c.id).agentId,target.id);assert.deepEqual(f.service.flow.run(legacy.id).runModel,oldUnknown.runModel);
 await f.service.tick();assert.equal(f.service.data.runs.filter(r=>r.humanRequestId===legacy.humanRequestId).length,1);assert.deepEqual(f.service.flow.run(legacy.id).runModel,oldUnknown.runModel);
 const deleted=await f.service.deleteAgent(old.id,{operationId:'delete-after-handover',revision:f.service.agent(old.id).metadataRevision});assert.equal(deleted.status,'deleted');assert.equal(f.service.flow.run(history.id).agentId,old.id);
});
test('handover rejects stale plans, wrong authority, uncertain dispatch, scheduled work and incomplete stop',async t=>{
 const {d,old,queued,legacy,args}=await setup(t);const x=args();
 await assert.rejects(d.handoverSecretary(old.id,{...x,actorRunId:legacy.id}),/リーダー/);
 queued.dispatchAttemptedAt='2026-01-01';await assert.rejects(d.handoverSecretary(old.id,x),/対象が変わりました/);
 await assert.rejects(d.handoverSecretary(old.id,args()),/未送信/);delete queued.dispatchAttemptedAt;
 old.processVerification.remainingOwned=1;await assert.rejects(d.handoverSecretary(old.id,args()),/正式停止/);old.processVerification.remainingOwned=0;
 const node=d.flow.work(d.flow.root(legacy.humanRequestId),legacy.workId);node.selfResume={current:{status:'scheduled'}};await assert.rejects(d.handoverSecretary(old.id,args()),/予約/);delete node.selfResume;
 const save=d.save;d.save=async()=>{throw Error('save-failure');};await assert.rejects(d.handoverSecretary(old.id,args()),/save-failure/);d.save=save;
 assert.equal(d.agent(old.id).secretaryHandover,undefined);assert.equal(d.flow.run(queued.id).agentId,old.id);
});

test('future result delivery follows inherited conversation without repeating the old job',async t=>{
 let {f,d,old,target,c,args,job}=await setup(t,{pendingJob:true});
 await d.handoverSecretary(old.id,args());
 await d.deleteAgent(old.id,{operationId:'delete-pending-job-source',revision:old.metadataRevision});
 d=await f.restart();c=d.conversations.record(c.id);assert.equal(d.flow.root(job.humanRequestId).integrity,undefined);
 const run=d.flow.run(job.runId);await f.submit(run);await d.flow.finish({humanRequestId:run.humanRequestId,workId:run.workId,runId:run.id,operationId:randomUUID(),inputs:d.flow.inputs(run.humanRequestId,run.workId).map(i=>i.id),results:[]});await f.complete(run);
 const event=c.deliveries.find(e=>e.humanRequestId===job.humanRequestId);assert.ok(event);
 assert.equal(d.flow.run(event.runId).agentId,target.id);assert.equal(d.data.runs.filter(r=>r.humanRequestId===job.humanRequestId).length,1);
 d.conversations.validate();
});

for(const withdrawn of [false,true])test(`conversation requester survives handover, deletion and fresh process; withdrawn=${withdrawn}`,async t=>{
 const {execFileSync}=await import('node:child_process');
 const {inspectRequests,quarantineRequests}=await import('../server/request-integrity.mjs');
 const {f,d,old,target,c,args,job}=await setup(t,{pendingJob:true});
 const run=d.flow.run(job.runId);await f.submit(run);
 if(withdrawn)await d.flow.cancel({humanRequestId:job.humanRequestId,revision:d.flow.root(job.humanRequestId).revision});
 else{await d.flow.finish({humanRequestId:run.humanRequestId,workId:run.workId,runId:run.id,operationId:randomUUID(),inputs:d.flow.inputs(run.humanRequestId,run.workId).map(i=>i.id),results:[]});await f.complete(run);}
 const before=structuredClone(d.flow.root(job.humanRequestId)),runs=structuredClone(d.data.runs.filter(r=>r.humanRequestId===job.humanRequestId)),count=d.data.runs.length,sends=f.sent.length;
 await d.handoverSecretary(old.id,args());await d.deleteAgent(old.id,{operationId:'delete-after-transfer',revision:old.metadataRevision});
 assert.equal(c.agentId,target.id);assert.deepEqual(d.flow.root(job.humanRequestId),before);
 // Existing startup validation is the recovery path for the old false quarantine.
 d.flow.root(job.humanRequestId).integrity={version:1,reasons:['Invalid conversation recipient']};await d.save();d.close();
 const code=`import {DirectAgents} from './server/direct.mjs';const deny=async()=>{throw Error('external operation forbidden')};const d=new DirectAgents({dir:process.argv[1],localRun:deny,remote:deny,notifier:{status:()=>({}),enqueue:deny}});await d.init({watch:false});const q=d.data.requests.find(q=>q.id===process.argv[2]);console.log(JSON.stringify({q,runs:d.data.runs.filter(r=>r.humanRequestId===q.id),count:d.data.runs.length}));d.close();`;
 const restarted=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,f.options.dir,job.humanRequestId],{encoding:'utf8'}));
 assert.deepEqual(restarted.q,before);assert.deepEqual(restarted.runs,JSON.parse(JSON.stringify(runs)));assert.equal(restarted.count,count);assert.equal(f.sent.length,sends);
 await f.restart();const data=f.service.data;
 for(const mutate of [
  x=>{x.conversations.find(v=>v.id===c.id).handoverHistory=[];},
  x=>{x.conversations.find(v=>v.id===c.id).agentId='unrelated';},
  x=>{x.agents.find(v=>v.id===old.id).secretaryHandover.plan.conversations=[];},
  x=>{x.agents.find(v=>v.id===target.id).projectId='wrong-project';},
  x=>{x.requests.find(v=>v.id===job.humanRequestId).requestedBy.actorRunId='forged';},
  x=>{x.conversations.find(v=>v.id===c.id).handoverHistory[0].historicalRunIds=[];},
  x=>{x.conversations.find(v=>v.id===c.id).operations=[];},
 ]){
  const bad=structuredClone(data);mutate(bad);quarantineRequests(bad);assert.ok(bad.requests.find(q=>q.id===job.humanRequestId).integrity?.reasons.includes('Invalid conversation recipient'));
 }
 const valid=inspectRequests(data).find(q=>q.id===job.humanRequestId);assert.deepEqual(valid.reasons,[]);
 f.service.close();
});
