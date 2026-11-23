import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {reportInputs} from '../server/report-inputs.mjs';
const handle=(s,r,finish=false,results=[])=>s.flow[finish?'finish':'respond']({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id),results});
async function setup(t){const f=await fixture(t,{commonRequests:true}),s=f.service,r=await s.send(f.agents[0].id,{instruction:'Check later',requestId:randomUUID()});await f.submit(r);const q=s.flow.root(r.humanRequestId),node=()=>s.flow.work(q,r.workId);let clock=Date.now();s.flow.reporting.clock=()=>clock;const args=(extra={})=>({humanRequestId:q.id,workId:r.workId,actorRunId:r.id,operationId:randomUUID(),expectedVersion:node().selfResume?.version||0,at:new Date(clock+10000).toISOString(),text:'Inspect file change',...extra});return {...f,s,r,q,node,args,advance:()=>{clock+=20000;}};}
test('leaf responds, waits without completion or deadline changes, fires once and finishes after review',async t=>{
 const f=await setup(t),{s,r,q,node,args}=f,before=structuredClone(node().metadata.reporting);
 const reservation=await s.flow.selfResume(args());await handle(s,r);await f.complete(r);
 assert.equal(node().state.kind,'active');assert.equal(s.flow.get(q.id).waiting[r.workId],'self-resume');assert.equal(f.notifications.length,0);assert.deepEqual(node().metadata.reporting,before);
 f.advance();await s.flow.reporting.expire();await s.tick();const next=s.flow.run(node().currentRunId);assert.notEqual(next.id,r.id);assert.equal(next.origin,'inbox');assert.equal(node().inbox.filter(i=>i.id===reservation.current.id).length,1);
 assert.equal(reportInputs(q,s.data.runs).human.length,0);assert.equal(node().inbox.find(i=>i.id===reservation.current.id).source.actor,'program');
 await s.flow.reporting.expire();assert.equal(node().currentRunId,next.id);await f.submit(next);await handle(s,next,true);await f.complete(next);assert.equal(node().state.kind,'completed');assert.equal(f.notifications.length,1);
});
test('timer due while running batches with supplement without interrupting; explicit finish retires it',async t=>{
 const f=await setup(t),{s,r,q,node,args}=f;const reserved=await s.flow.selfResume(args());await handle(s,r,true);f.advance();await s.flow.reporting.expire();assert.equal(node().currentRunId,r.id);assert.equal(f.sent.length,1);
 await f.complete(r);assert.equal(node().state.kind,'completed');assert(node().inbox.find(i=>i.id===reserved.current.id).retiredBy);assert.equal(f.sent.length,1);assert.equal(node().selfResume.current.status,'cancelled');
});
test('replace/cancel version conflict and replay preserve history and prevent old firing',async t=>{
 const f=await setup(t),{s,args,node,r}=f,x=args();const first=await s.flow.selfResume(x);assert.deepEqual(await s.flow.selfResume(x),first);
 await assert.rejects(s.flow.selfResume({...x,text:'different'}));await assert.rejects(s.flow.selfResume({...args(),expectedVersion:0}));
 const second=await s.flow.selfResume(args({text:'New check'}));assert.notEqual(second.current.id,first.current.id);assert.equal(second.history[1].reason,'replaced');
 await s.flow.selfResume(args({at:null}));await handle(s,r);await f.complete(r);f.advance();await s.flow.reporting.expire();assert.equal(f.sent.length,1);assert.equal(node().selfResume.current.status,'cancelled');
});
test('other work, old/unaccepted/report run, malformed/past date and finish-then-schedule are refused',async t=>{
 const f=await setup(t),{s,r,args}=f;const foreign=await s.send(f.agents[1].id,{instruction:'Foreign',requestId:randomUUID()});await f.submit(foreign);
 await assert.rejects(s.flow.selfResume(args({actorRunId:foreign.id})));await assert.rejects(s.flow.selfResume(args({actorRunId:randomUUID()})));
 for(const at of [undefined,'bad','2020-01-01T00:00:00Z','2030-01-01T00:00:00'])await assert.rejects(s.flow.selfResume(args({at})));
 for(const text of ['', 'x'.repeat(4001),null])await assert.rejects(s.flow.selfResume(args({text})));
 r.phase='report';await assert.rejects(s.flow.selfResume(args()));delete r.phase;
 await handle(s,r,true);await assert.rejects(s.flow.selfResume(args()),/finish/);
});
for(const outcome of ['failed','interrupted'])test(outcome+' turn is never retried by self reservation',async t=>{
 const f=await setup(t),{s,r,node,args}=f;await s.flow.selfResume(args());await handle(s,r);await f.complete(r,outcome);f.advance();await s.flow.reporting.expire();assert.equal(node().currentRunId,r.id);assert.equal(f.sent.length,1);assert(node().state.review.some(x=>x.startsWith('run-needs-review')));
});
test('restart retains waiting reservation and overdue delivery ID; save failure retries once',async t=>{
 const f=await setup(t),{s,r,q,args}=f;const booked=await s.flow.selfResume(args());await handle(s,r);await f.complete(r);
 const restarted=await f.restart(),scheduler=restarted.flow.reporting;scheduler.clock=()=>Date.parse(booked.current.at)+1;
 const save=restarted.store.save.bind(restarted.store);let failed=false;restarted.store.save=(...a)=>{if(!failed){failed=true;throw Error('disk failure');}return save(...a);};
 await assert.rejects(scheduler.expire());assert.equal(restarted.flow.work(restarted.flow.root(q.id),r.workId).selfResume.current.status,'scheduled');
 scheduler.clock=()=>Date.parse(booked.current.at)+10000;await scheduler.expire();await scheduler.expire();assert.equal(restarted.flow.work(restarted.flow.root(q.id),r.workId).inbox.filter(i=>i.id===booked.current.id).length,1);
});
test('human cancellation invalidates timer and already delivered input; no queued resumption',async t=>{
 const f=await setup(t),{s,r,q,node,args}=f;const reservation=await s.flow.selfResume(args());f.advance();await s.flow.reporting.expire();
 await s.flow.cancel({humanRequestId:q.id,revision:q.revision});assert.equal(node().selfResume.current.status,'cancelled');assert(node().inbox.find(i=>i.id===reservation.current.id).retiredBy);await s.tick();assert.equal(f.sent.length,1);
});
test('booking save failure rolls back reservation and receipt, concurrent versions admit one update',async t=>{
 const f=await setup(t),{s,q,r,args}=f,x=args(),save=s.store.save.bind(s.store);let fail=true;s.store.save=(...a)=>{if(fail){fail=false;throw Error('disk failure');}return save(...a);};
 await assert.rejects(s.flow.selfResume(x),/disk failure/);assert.equal(s.flow.work(s.flow.root(q.id),r.workId).selfResume,undefined);
 assert(!s.flow.root(q.id).requestGraph.operations.some(o=>o.id===x.operationId));
 const results=await Promise.allSettled([s.flow.selfResume(x),s.flow.selfResume({...x,operationId:randomUUID(),text:'Competing'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.deepEqual(await s.flow.selfResume(x),results[0].value);
});
test('firing then replacement retires old input and only new reservation resumes',async t=>{
 const f=await setup(t),{s,r,node,args}=f;const old=await s.flow.selfResume(args());f.advance();await s.flow.reporting.expire();
 const next=await s.flow.selfResume(args({text:'Updated check'}));assert(node().inbox.find(i=>i.id===old.current.id).retiredBy);
 await handle(s,r);await f.complete(r);assert.equal(node().currentRunId,r.id);assert.equal(node().state.kind,'active');
 f.advance();await s.flow.reporting.expire();await s.tick();const resumed=s.flow.run(node().currentRunId);assert.deepEqual(resumed.inboxBatch,[next.current.id]);assert.equal(f.sent.length,2);
});
test('reservation and child result plus human supplement coalesce into one continuation',async t=>{
 const f=await setup(t),{s,r,q,node,args}=f;await s.flow.selfResume(args());const child=await f.delegate(r,f.agents[2]),cr=s.flow.run(child.currentRunId);await s.tick();await f.submit(cr);
 await s.flow.supplement({humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:randomUUID(),instruction:'Keep original scope'});
 await handle(s,cr,true);await f.complete(cr);f.advance();await s.flow.reporting.expire();assert.equal(node().currentRunId,r.id);
 // Only acknowledge the original input; the newly arrived inputs belong to the next turn.
 await s.flow.respond({humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:[node().inbox[0].id],results:[]});await f.complete(r);
 const next=s.flow.run(node().currentRunId);assert.notEqual(next.id,r.id);assert.equal(next.inboxBatch.length,3);assert.equal(f.sent.filter(e=>e.agentId===r.agentId).length,2);
});
test('human completion cancels a queued timer continuation before dispatch',async t=>{
 const f=await setup(t),{s,r,q,node,args}=f;await s.flow.selfResume(args());await handle(s,r);await f.complete(r);
 // Keep the enqueue and dispatch boundary observable, without changing any external execution fact.
 s.progress=()=>{};f.advance();await s.flow.reporting.expire();await s.flow.pump(true,[q],false);
 const queued=s.flow.run(node().currentRunId);assert.equal(queued.runModel.state.kind,'queued');
 await s.flow.complete({humanRequestId:q.id,revision:q.revision});await s.tick();assert.equal(queued.runModel.state.kind,'cancelled');assert.equal(f.sent.length,1);
});
test('unknown native outcome never retries, and an unaccepted current run cannot reserve',async t=>{
 const {changeRun}=await import('../server/run-lifecycle.mjs');const f=await setup(t),{s,r,node,args}=f;
 const unsent=await s.send(f.agents[1].id,{instruction:'Await native input',requestId:randomUUID()});
 await assert.rejects(s.flow.selfResume({...args(),humanRequestId:unsent.humanRequestId,workId:unsent.workId,actorRunId:unsent.id}));
 await s.flow.selfResume(args());await handle(s,r);changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});await s.save();f.advance();await s.flow.reporting.expire();await s.tick();assert.equal(node().currentRunId,r.id);assert.equal(r.runModel.state.outcome,'unconfirmed');assert.equal(f.sent.filter(x=>x.agentId===r.agentId).length,1);
 await assert.rejects(s.flow.selfResume(args({at:null})));
});
test('fire/cancel race rejects stale version, reread cancels the exact delivered input',async t=>{
 const f=await setup(t),{s,r,node,args}=f;await s.flow.selfResume(args());const cancel=args({at:null});f.advance();
 const results=await Promise.allSettled([s.flow.reporting.expire(),s.flow.selfResume(cancel)]);
 if(results[1].status==='rejected')await s.flow.selfResume(args({at:null}));
 await handle(s,r);await f.complete(r);await s.flow.reporting.expire();assert.equal(f.sent.length,1);assert.equal(node().selfResume.current.status,'cancelled');assert(node().inbox.filter(i=>i.id===node().selfResume.current.id).every(i=>i.retiredBy));
});
test('reservation corruption is quarantined; persisted valid graph and wakeup survive delivery restart',async t=>{
 const {validateGraph}=await import('../server/unified-requests.mjs');const f=await setup(t),{s,r,q,node,args}=f;await s.flow.selfResume(args());validateGraph(s.data,q);
 const bad=structuredClone(q);bad.requestGraph.nodes[0].selfResume.current.actorRunId='foreign';assert.throws(()=>validateGraph(s.data,bad),/reservation/);
 f.advance();await s.flow.reporting.expire();validateGraph(s.data,q);const restarted=await f.restart();const recovered=restarted.flow.root(q.id);validateGraph(restarted.data,recovered);
 assert.equal(recovered.requestGraph.nodes.find(n=>n.id===r.workId).inbox.filter(i=>i.id===node().selfResume.current.id).length,1);
});
