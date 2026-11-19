import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {inspectRequests} from '../server/request-integrity.mjs';
const send=(s,a)=>s.send(a.id,{instruction:'Parent purpose',requestId:randomUUID()});
const handle=(s,r,results=[])=>s.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id),results});
for(const actor of ['human','agent'])test(actor+' plans a child without executing; launch and restart preserve one execution',async t=>{
 const f=await fixture(t,{commonRequests:true}),s=f.service,r=await send(s,f.agents[0]);await f.submit(r);
 const q=s.flow.root(r.humanRequestId),x={humanRequestId:q.id,parentWorkId:r.workId,revision:q.revision,actorRunId:r.id,operationId:randomUUID(),instruction:'Child purpose'};
 const plan=()=>actor==='human'?s.flow.humanCompose(x,'plan'):s.flow.plan(x);
 const child=await plan();assert.equal(child.currentRunId,null);assert.deepEqual(await plan(),child);assert.equal(s.data.runs.length,1);
 const n=s.flow.work(q,child.id);assert.equal(n.createdBy,actor);assert.deepEqual(n.recipient,{kind:'request',requestId:r.workId});
 assert.deepEqual(inspectRequests(s.data).flatMap(x=>x.reasons),[]);
 const launch={humanRequestId:q.id,workId:child.id,agentId:f.agents[1].id,revision:q.revision,actorRunId:r.id,operationId:randomUUID()};
 const run=await (actor==='human'?s.flow.humanCompose(launch,'launch'):s.flow.launch(launch));assert(run.currentRunId);assert.equal(s.data.runs.length,2);
 assert.equal((await (actor==='human'?s.flow.humanCompose(launch,'launch'):s.flow.launch(launch))).currentRunId,run.currentRunId);
 await s.tick();const cr=s.flow.run(run.currentRunId);await f.submit(cr);await handle(s,cr);await f.complete(cr);
 assert.equal(s.flow.work(q,child.id).state.kind,'submitted');
 const e=s.flow.results(q.id,r.workId)[0];await handle(s,r,[{requestId:child.id,resultId:e.id,version:e.version,decision:'accept'}]);await f.complete(r);
 const resumed=s.flow.run(s.flow.work(q,r.workId).currentRunId);if(resumed.id!==r.id){await f.submit(resumed);await handle(s,resumed,[{requestId:child.id,resultId:e.id,version:e.version,decision:'accept'}]);await f.complete(resumed);}
 assert.equal(s.flow.work(q,r.workId).state.kind,'completed');assert.equal(s.flow.work(q,child.id).state.kind,'completed');
 const next=await f.restart();assert.deepEqual(inspectRequests(next.data).flatMap(x=>x.reasons),[]);
});
test('report is delivery; failure and supplement never overwrite the submitted work result',async t=>{
 const f=await fixture(t,{commonRequests:true,reportMode:true}),s=f.service,r=await send(s,f.agents[0]);await f.submit(r);await handle(s,r);await f.complete(r);
 const q=s.flow.root(r.humanRequestId),w=s.flow.work(q,r.workId);assert.equal(w.state.kind,'submitted');assert.equal(w.currentRunId,r.id);const report=s.flow.run(w.reportRunId);assert(report);await f.submit(report);await f.complete(report,'failed');assert.equal(w.currentRunId,r.id);assert.equal(w.state.kind,'submitted');assert.equal(w.submissions.length,1);
 await s.flow.supplement({humanRequestId:q.id,workId:w.id,operationId:randomUUID(),instruction:'new constraint'});await s.tick();assert.equal(w.state.kind,'active');assert(!q.report);assert.notEqual(w.currentRunId,r.id);
 assert.deepEqual(inspectRequests(s.data).flatMap(x=>x.reasons),[]);
});
test('successful report publishes once and keeps the work result identity after restart',async t=>{
 const f=await fixture(t,{commonRequests:true,reportMode:true}),s=f.service,r=await send(s,f.agents[0]);await f.submit(r);await handle(s,r);await f.complete(r);
 const q=s.flow.root(r.humanRequestId),w=s.flow.work(q,r.workId),report=s.flow.run(w.reportRunId);await f.submit(report);await f.complete(report);assert.equal(w.state.kind,'completed');assert.equal(w.currentRunId,r.id);assert.equal(q.finalRunId,report.id);assert.equal(f.notifications.length,1);
 const next=await f.restart();assert(!next.flow.root(q.id).integrity);await next.tick();assert.equal(f.notifications.length,1);
});
test('stale human edits, foreign Agent edits, and starting without an assignee are rejected without side effects',async t=>{
 const f=await fixture(t,{commonRequests:true}),s=f.service,r=await send(s,f.agents[0]),foreign=await send(s,f.agents[1]);await f.submit(r);await f.submit(foreign);
 const q=s.flow.root(r.humanRequestId),x={humanRequestId:q.id,parentWorkId:r.workId,revision:q.revision,operationId:randomUUID(),instruction:'plan'};
 await assert.rejects(s.flow.plan({...x,actorRunId:foreign.id}));const child=await s.flow.humanCompose(x,'plan');
 await assert.rejects(s.flow.humanCompose({...x,operationId:randomUUID()},'plan'),/更新/);
 await assert.rejects(s.flow.humanCompose({humanRequestId:q.id,workId:child.id,revision:q.revision,operationId:randomUUID()},'launch'),/担当/);
 assert.equal(s.flow.work(q,child.id).runIds.length,0);assert.equal(q.requestGraph.nodes.length,2);
 const op={humanRequestId:q.id,workId:child.id,revision:q.revision,operationId:randomUUID()};await s.flow.humanCompose(op,'discard');assert.equal(s.flow.work(q,child.id).state.kind,'withdrawn');
 await assert.rejects(s.flow.humanCompose({...op,operationId:randomUUID(),revision:q.revision,agentId:f.agents[2].id},'launch'));
 assert.deepEqual(inspectRequests(s.data).flatMap(x=>x.reasons),[]);
});
test('failed plan persistence rolls back input and child, retrying same operation creates exactly one child',async t=>{
 const f=await fixture(t,{commonRequests:true}),s=f.service,r=await send(s,f.agents[0]);await f.submit(r);const q=s.flow.root(r.humanRequestId),x={humanRequestId:q.id,parentWorkId:r.workId,revision:q.revision,operationId:randomUUID(),instruction:'planned'};
 const write=s.store.write;s.store.write=async()=>{throw Error('disk failure');};await assert.rejects(s.flow.humanCompose(x,'plan'),/disk failure/);s.store.write=write;
 assert.equal(s.flow.root(q.id).requestGraph.nodes.length,1);await s.flow.humanCompose(x,'plan');await s.flow.humanCompose(x,'plan');assert.equal(s.flow.root(q.id).requestGraph.nodes.length,2);
});
test('report retry executes only delivery and cannot accept child inputs',async t=>{
 const f=await fixture(t,{commonRequests:true,reportMode:true}),s=f.service,r=await send(s,f.agents[0]);await f.submit(r);await handle(s,r);await f.complete(r);
 const q=s.flow.root(r.humanRequestId),w=s.flow.work(q,r.workId),report=s.flow.run(w.reportRunId);await f.submit(report);await f.complete(report,'failed');
 const retry=await s.flow.continue({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'retry only report'},true);await s.tick();assert.equal(retry.phase,'report');assert.equal(w.currentRunId,r.id);await f.submit(retry);await f.complete(retry);assert.equal(w.state.kind,'completed');assert.equal(f.notifications.length,1);assert.deepEqual(inspectRequests(s.data).flatMap(x=>x.reasons),[]);
});
test('secretary to secretary to workshop uses the same submission and acceptance contract',async t=>{
 const f=await fixture(t,{commonRequests:true}),s=f.service,r=await send(s,f.agents[0]);await f.submit(r);
 const b=await f.delegate(r,f.agents[1]);await s.tick();const br=s.flow.run(b.currentRunId);await f.submit(br);
 const c=await f.delegate(br,f.agents[2]);await s.tick();const cr=s.flow.run(c.currentRunId);await f.submit(cr);await handle(s,cr);await f.complete(cr);
 async function collect(parent){let current=parent;for(let i=0;i<3;i++){
  const refs=s.flow.results(parent.humanRequestId,parent.workId).filter(e=>!e.superseded).map(e=>({requestId:e.requestId,resultId:e.id,version:e.version,decision:'accept'}));
  await handle(s,current,refs);await f.complete(current);const w=s.flow.work(s.flow.root(parent.humanRequestId),parent.workId);if(w.currentRunId===current.id)return w;current=s.flow.run(w.currentRunId);await f.submit(current);
 }throw Error('unexpected endless resume');}
 const bw=await collect(br);assert.equal(bw.state.kind,'submitted');assert.deepEqual(bw.recipient,{kind:'request',requestId:r.workId});assert.equal(bw.reportRunId,null);
 const root=await collect(r);assert.equal(root.state.kind,'completed');assert.deepEqual(root.recipient,{kind:'human'});assert.equal(f.notifications.length,1);
 assert.deepEqual(inspectRequests(s.data).flatMap(x=>x.reasons),[]);
});
