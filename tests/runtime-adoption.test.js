import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
const handle=(s,r,finish=true)=>s.flow[finish?'finish':'respond']({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id),results:s.flow.results(r.humanRequestId,r.workId).filter(e=>!e.handled&&!e.superseded).map(e=>({requestId:e.workId,resultId:e.id,version:e.version,decision:'accept'}))});
const setup=async(t,options)=>{const f=await fixture(t,options),[a,b]=f.agents;Object.assign(b,{workshopId:a.workshopId,location:a.location,projectId:a.projectId,cwd:a.cwd,connection:structuredClone(a.connection)});return {...f,a,b};};
const adopt=(s,a,b,op=randomUUID())=>s.adoptRuntime(a.id,{operationId:op,revision:a.metadataRevision||0,replacementRevision:b.metadataRevision||0,replacementAgentId:b.id});
test('queued initial run adopts new runtime under the same Agent entry and dispatches once, including restart',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f;a.inputEnvelope={mode:'legacy'};
 const r=await s.send(a.id,{instruction:'queued once',requestId:randomUUID()}),id=r.id,requestId=r.humanRequestId;
 assert.equal(r.runModel.state.kind,'queued');assert.equal(r.dispatchAttemptedAt,undefined);assert.equal(f.sent.length,0);
 const x={operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id},before=JSON.stringify(s.flow.root(requestId));
 const receipt=await s.adoptRuntime(a.id,x);assert.equal(JSON.stringify(s.flow.root(requestId)),before);assert.equal(a.name,'Secretary 0');assert.equal(a.id,f.agents[0].id);assert.equal(b.runtimeRetiredTo,a.id);
 assert.deepEqual(await s.adoptRuntime(a.id,x),receipt);await assert.rejects(s.send(b.id,{instruction:'retired',requestId:randomUUID()}),/旧ランタイム/);
 await s.tick();assert.equal(f.sent.length,1);assert.equal(s.flow.run(id).agentId,a.id);await f.submit(r);await handle(s,r);await f.complete(r);
 const restarted=await f.restart();assert.equal(restarted.agent(a.id).inputEnvelope.mode,'startup-v2');assert.deepEqual(await restarted.adoptRuntime(a.id,x),receipt);assert.equal(f.sent.length,1);
 const next=await restarted.send(a.id,{instruction:'same existing entry',requestId:randomUUID()});assert.equal(next.agentId,a.id);assert.equal(f.sent.length,2);
});
test('parent waiting for child adopts runtime and receives result without changing parent/child links',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f,r=await s.send(a.id,{instruction:'parent',requestId:randomUUID()});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await handle(s,r,false);await f.complete(r);a.inputEnvelope={mode:'legacy'};
 await adopt(s,a,b);const cr=s.flow.run(child.currentRunId);await f.submit(cr);await handle(s,cr);await f.complete(cr);await s.tick();
 const q=s.flow.root(r.humanRequestId),parent=s.flow.work(q,r.workId),next=s.flow.run(parent.currentRunId);assert.notEqual(next.id,r.id);assert.equal(parent.assignee,a.id);assert.equal(s.flow.work(q,child.id).parentId,parent.id);
 await f.submit(next);await handle(s,next);await f.complete(next);assert.equal(parent.state.kind,'completed');assert.equal(f.notifications.length,1);
});
test('already generated queued report resumes on adopted runtime and notifies once',async t=>{
 const f=await setup(t,{reportMode:true}),s=f.service,{a,b}=f,r=await s.send(a.id,{instruction:'report task',requestId:randomUUID()});await f.submit(r);await handle(s,r);a.inputEnvelope={mode:'legacy'};await f.complete(r);
 const q=s.flow.root(r.humanRequestId),report=s.flow.run(q.requestGraph.nodes[0].reportRunId);assert.equal(report.runModel.state.kind,'queued');const rid=report.id;
 await adopt(s,a,b);await s.tick();assert.equal(report.id,rid);await f.submit(report);await f.complete(report);await s.tick();assert.equal(f.notifications.length,1);assert.equal(s.data.runs.filter(r=>r.phase==='report').length,1);
});
for(const running of [false,true])test('runtime adoption rejects '+(running?'running':'sent/unknown')+' without replay',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f,r=await s.send(a.id,{instruction:'inflight',requestId:randomUUID()});if(running)await f.submit(r);
 const snapshot=JSON.stringify(r);await assert.rejects(adopt(s,a,b),/受付不明・実行中/);assert.equal(JSON.stringify(r),snapshot);assert.equal(f.sent.length,1);assert.equal(a.tabId,'tab0');
});
test('stale revision, used donor and persistence failure cannot partially move runtime ownership',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f;const x={operationId:randomUUID(),revision:1,replacementRevision:0,replacementAgentId:b.id};await assert.rejects(s.adoptRuntime(a.id,x),/更新/);
 const cwd=b.cwd;b.cwd='/different';await assert.rejects(adopt(s,a,b),/同じ場所/);b.cwd=cwd;
 const save=s.save.bind(s);s.save=async()=>{if(a.runtimeMigrations?.length)throw Error('disk-failure');return save();};
 const old=a.workspaceId,fresh=b.workspaceId;await assert.rejects(adopt(s,a,b),/disk-failure/);assert.equal(s.agent(a.id).workspaceId,old);assert.equal(s.agent(b.id).workspaceId,fresh);assert.equal(s.agent(a.id).runtimeMigrations,undefined);s.save=save;
 const r=await s.send(b.id,{instruction:'used donor',requestId:randomUUID()});await assert.rejects(adopt(s,a,b),/未使用/);assert.equal(r.agentId,b.id);
});
