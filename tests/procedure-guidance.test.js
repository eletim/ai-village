import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {AgentRules} from '../server/agent-rules.mjs';
const args=(r,inputs,results=[])=>({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs,results});
const remaining=(s,r)=>s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id);
async function setup(t){const f=await fixture(t,{commonRequests:true}),s=f.service,r=await s.send(f.agents[0].id,{instruction:'自然に答える相談',requestId:randomUUID()});await f.submit(r);const q=s.flow.root(r.humanRequestId),w=s.flow.work(q,r.workId);return {...f,s,r,q,w};}
test('normal accepted omission gets one guidance, correction completes with one human notification',async t=>{
 const f=await setup(t),{s,r,q,w}=f;await f.complete(r);const guide=w.inbox.find(i=>i.procedure);assert(guide);assert.equal(guide.source.actor,'program');assert.deepEqual(guide.procedure.missing.inputs,[w.inbox[0].id]);
 const next=s.flow.run(w.currentRunId);assert.notEqual(next.id,r.id);await f.submit(next);await s.flow.finish(args(next,remaining(s,next)));await f.complete(next);
 assert.equal(w.state.kind,'completed');assert.equal(f.notifications.length,1);await s.tick();assert.equal(f.notifications.length,1);assert.equal(w.inbox.filter(i=>i.procedure).length,1);assert.equal(q.report,undefined);
});
test('repeated omission stops without bypassing input attempts or creating guidance chains',async t=>{
 const f=await setup(t),{s,r,w}=f;await f.complete(r);const next=s.flow.run(w.currentRunId);await f.submit(next);await f.complete(next);await s.tick();assert.equal(w.currentRunId,next.id);assert.equal(f.sent.length,2);assert.equal(w.inbox.filter(i=>i.procedure).length,1);assert.equal(w.inbox[0].attempts.length,2);assert(w.inbox.find(i=>i.procedure).retiredBy);
});
for(const outcome of ['failed','interrupted'])test(outcome+' never gets procedural recovery',async t=>{const f=await setup(t);await f.complete(f.r,outcome);assert(!f.w.inbox.some(i=>i.procedure));assert.equal(f.sent.length,1);});
test('self reservation and active child wait are not procedural omissions',async t=>{
 const f=await setup(t),{s,r,w}=f;await s.flow.selfResume({humanRequestId:r.humanRequestId,workId:r.workId,actorRunId:r.id,operationId:randomUUID(),expectedVersion:0,at:new Date(Date.now()+60000).toISOString(),text:'確認'});await s.flow.respond(args(r,remaining(s,r)));await f.complete(r);assert(!w.inbox.some(i=>i.procedure));assert.equal(w.currentRunId,r.id);
});
test('child decision omitted is explained without choosing accept; missing finish is also guided',async t=>{
 const f=await setup(t),{s,r,q,w}=f;const child=await f.delegate(r,f.agents[2]);await s.tick();const cr=s.flow.run(child.currentRunId);await f.submit(cr);await s.flow.respond(args(r,remaining(s,r)));await f.complete(r);assert(!w.inbox.some(i=>i.procedure));
 await s.flow.finish(args(cr,remaining(s,cr)));await f.complete(cr);const reviewer=s.flow.run(w.currentRunId);await f.submit(reviewer);await f.complete(reviewer);const guide=w.inbox.find(i=>i.procedure);assert.equal(guide.procedure.missing.results[0].resultId,cr.id);assert.equal(guide.procedure.missing.results[0].decision,undefined);
 const corrector=s.flow.run(w.currentRunId);await f.submit(corrector);const e=s.flow.results(q.id,w.id)[0];await s.flow.respond(args(corrector,remaining(s,corrector),[{requestId:e.requestId,resultId:e.id,version:e.version,decision:'accept'}]));await f.complete(corrector);
 assert.equal(w.inbox.filter(i=>i.procedure).length,2);assert(w.inbox.at(-1).procedure.missing.finish);const final=s.flow.run(w.currentRunId);await f.submit(final);await s.flow.finish(args(final,remaining(s,final)));await f.complete(final);assert.equal(w.state.kind,'completed');assert.equal(f.notifications.length,1);
});
test('restart retains guidance identity and save failure cannot split creation from wakeup',async t=>{
 const f=await setup(t),{s,r,w,q}=f;const save=s.store.save.bind(s.store);let fail=true;s.store.save=(...x)=>{if(fail){fail=false;throw Error('disk failure');}return save(...x);};await assert.rejects(f.complete(r));await s.tick();
 const guide=s.flow.work(s.flow.root(q.id),w.id).inbox.find(i=>i.procedure);assert(guide);const restarted=await f.restart();await restarted.tick();assert.equal(restarted.flow.work(restarted.flow.root(q.id),w.id).inbox.filter(i=>i.procedure).length,1);assert.equal(restarted.flow.work(restarted.flow.root(q.id),w.id).inbox.find(i=>i.procedure).id,guide.id);
});
test('API missing fields returns actionable help and never commits a claim',async t=>{
 const f=await setup(t),{s,r,w}=f;await assert.rejects(s.flow.respond({...args(r,undefined),inputs:undefined}),/rules get work respond/);assert.equal(w.inputClaims.length,0);await assert.rejects(s.flow.respond({...args(r,remaining(s,r)),results:undefined}),/requests results/);assert.equal(w.inputClaims.length,0);
});
test('unspecified default is direct; explicit choice and existing request mode persist',async t=>{
 const f=await fixture(t),s=f.service;delete s.data.reportSettings;assert.equal(s.flow.reportStatus().enabled,false);const a=await s.send(f.agents[0].id,{instruction:'相談',requestId:randomUUID()});assert.equal(s.flow.root(a.humanRequestId).reportMode,false);
 await s.flow.configureReport(true);const b=await s.send(f.agents[1].id,{instruction:'任意の書換え',requestId:randomUUID()});assert.equal(s.flow.root(b.humanRequestId).reportMode,true);await s.flow.configureReport(false);assert.equal(s.flow.root(b.humanRequestId).reportMode,true);const restarted=await f.restart();assert.equal(restarted.flow.root(a.humanRequestId).reportMode,false);assert.equal(restarted.flow.root(b.humanRequestId).reportMode,true);
});
test('short work contract has on-demand operation schema with same revision',()=>{const rules=new AgentRules('http://127.0.0.1:15233'),basic=rules.specification('work');assert(!basic.text.includes('expectedVersion'));const action=rules.action('selfResume');assert(action.text.includes('expectedVersion'));assert.equal(action.revision,basic.revision);assert.throws(()=>rules.action('not-an-operation'));});
test('unknown execution and a newly arrived input do not become omissions',async t=>{
 const {changeRun}=await import('../server/run-lifecycle.mjs');const f=await setup(t),{s,r,w,q}=f;changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});await s.save();await s.flow.settle();assert(!w.inbox.some(i=>i.procedure));
 await s.flow.supplement({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'追加'});await s.tick();assert(!w.inbox.some(i=>i.procedure));assert.equal(f.sent.length,1);
});
test('concurrent supplement batches with guidance, and human completion retires a queued stale guide',async t=>{
 const f=await setup(t),{s,r,w,q}=f;s.progress=()=>{};
 await s.flow.supplement({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'追加条件'});
 // Prevent transport only: preserve the real normal native observation and enqueue boundary.
 const pump=s.flow.pump.bind(s.flow);s.flow.pump=(wait,requests)=>pump(wait,requests,false);
 await f.complete(r);await pump(true,[q],false);const next=s.flow.run(w.currentRunId);assert.equal(next.runModel.state.kind,'queued');assert.equal(next.inboxBatch.length,3);
 await s.flow.complete({humanRequestId:q.id,revision:q.revision});assert.equal(next.runModel.state.kind,'cancelled');assert(w.inbox.find(i=>i.procedure).retiredBy);await s.tick();assert.equal(f.sent.length,1);
});
test('saving guidance itself rolls back and retry creates one durable notice',async t=>{
 const f=await setup(t),{s,r,w,q}=f,save=s.store.save.bind(s.store);let failed=false;
 s.store.save=(...x)=>{if(!failed&&s.flow.work(s.flow.root(q.id),w.id).inbox.some(i=>i.procedure)){failed=true;throw Error('guidance save failed');}return save(...x);};
 await assert.rejects(f.complete(r),/guidance save failed/);assert.equal(s.flow.work(s.flow.root(q.id),w.id).inbox.filter(i=>i.procedure).length,0);await s.tick();assert.equal(s.flow.work(s.flow.root(q.id),w.id).inbox.filter(i=>i.procedure).length,1);
});
