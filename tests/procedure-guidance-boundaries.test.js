import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {changeRun} from '../server/run-lifecycle.mjs';
const args=(r,inputs,results=[])=>({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs,results});
const remaining=(s,r)=>s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id);
async function setup(t){const f=await fixture(t,{commonRequests:true}),s=f.service,r=await s.send(f.agents[0].id,{instruction:'parent',requestId:randomUUID()});await f.submit(r);return {...f,s,r,q:s.flow.root(r.humanRequestId),w:s.flow.work(s.flow.root(r.humanRequestId),r.workId)};}
async function finishGuide(t){
 const f=await setup(t),{s,r,q,w}=f,child=await f.delegate(r,f.agents[2]);await s.tick();const cr=s.flow.run(child.currentRunId);await f.submit(cr);await s.flow.respond(args(r,remaining(s,r)));await f.complete(r);await s.flow.finish(args(cr,remaining(s,cr)));await f.complete(cr);
 const reviewer=s.flow.run(w.currentRunId);await f.submit(reviewer);const e=s.flow.results(q.id,w.id)[0];await s.flow.respond(args(reviewer,remaining(s,reviewer),[{requestId:e.requestId,resultId:e.id,version:e.version,decision:'accept'}]));await f.complete(reviewer);
 const guide=w.inbox.find(i=>i.procedure),corrector=s.flow.run(w.currentRunId);assert(guide.procedure.missing.finish);await f.submit(corrector);return {...f,guideId:guide.id,corrector};
}
for(const outcome of ['failed','interrupted','unknown'])test('finish-only guidance remains pending after provisional finish and '+outcome,async t=>{
 const f=await finishGuide(t),{s,q,w,corrector,guideId}=f;await s.flow.finish(args(corrector,remaining(s,corrector)));await s.flow.settle();assert.equal(w.inbox.find(i=>i.id===guideId).retiredBy,undefined);
 if(outcome==='unknown'){changeRun(corrector,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});await s.save();await s.flow.settle();}else await f.complete(corrector,outcome);
 const guide=w.inbox.find(i=>i.id===guideId);assert.equal(guide.retiredBy,undefined);assert.equal(guide.handledBy,undefined);assert.equal(w.state.kind,'active');assert.equal(w.currentRunId,corrector.id);
 const restarted=await f.restart();await restarted.tick();const persisted=restarted.flow.work(restarted.flow.root(q.id),w.id);assert.equal(persisted.inbox.find(i=>i.id===guideId).retiredBy,undefined);assert.equal(persisted.currentRunId,corrector.id);
});
for(const closure of ['normal','complete','cancel'])test('finish guide still resolves on '+closure,async t=>{
 const f=await finishGuide(t),{s,q,w,corrector,guideId}=f;
 if(closure==='normal'){await s.flow.finish(args(corrector,remaining(s,corrector)));await f.complete(corrector);assert.equal(w.inbox.find(i=>i.id===guideId).handledBy,corrector.id);assert.equal(w.state.kind,'completed');}
 else {await s.flow[closure]({humanRequestId:q.id,revision:q.revision});await s.flow.settle();assert(w.inbox.find(i=>i.id===guideId).retiredBy);}
});
for(const fresh of [false,true])test('delayed guide retires at original budget, preserves fresh input='+fresh+', and survives restart',async t=>{
 const f=await setup(t),{s,r,q,w}=f,original=w.inbox[0].id;
 for(let i=0;i<23;i++)await s.flow.supplement({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'additional '+i});
 await f.complete(r);const second=s.flow.run(w.currentRunId),guide=w.inbox.find(i=>i.procedure);assert.equal(second.inboxBatch.length,24);assert(!second.inboxBatch.includes(guide.id));await f.submit(second);await s.flow.respond(args(second,remaining(s,second).filter(id=>id!==original)));
 if(fresh)await s.flow.supplement({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'fresh human input'});
 await f.complete(second);assert(w.inbox.find(i=>i.id===guide.id).retiredBy);assert.equal(w.inbox.find(i=>i.id===original).attempts.length,2);
 if(fresh){const next=s.flow.run(w.currentRunId);assert.equal(next.inboxBatch.length,1);assert.equal(w.inbox.find(i=>i.id===next.inboxBatch[0]).text,'fresh human input');}
 else assert.equal(w.currentRunId,second.id);
 const count=f.sent.length,restarted=await f.restart();await restarted.tick();assert.equal(f.sent.length,count);const persisted=restarted.flow.work(restarted.flow.root(q.id),w.id);assert(persisted.inbox.find(i=>i.id===guide.id).retiredBy);assert.equal(persisted.inbox.find(i=>i.id===original).attempts.length,2);
});
test('queued and dispatched second-attempt original plus guide remain valid',async t=>{
 const f=await setup(t),{s,r,q,w}=f;s.progress=()=>{};const pump=s.flow.pump.bind(s.flow);s.flow.pump=(wait,requests)=>pump(wait,requests,false);await f.complete(r);await pump(true,[q],false);const next=s.flow.run(w.currentRunId),guide=w.inbox.find(i=>i.procedure);assert.equal(next.runModel.state.kind,'queued');assert.equal(w.inbox[0].attempts.length,2);await s.flow.settle();assert.equal(w.inbox.find(i=>i.id===guide.id).retiredBy,undefined);
 await pump(true,[q],true);await f.submit(next);await s.flow.settle();assert.equal(w.inbox.find(i=>i.id===guide.id).retiredBy,undefined);await s.flow.finish(args(next,remaining(s,next)));await f.complete(next);await pump(true,[q],false);assert.equal(w.state.kind,'completed');
});
for(const fresh of [false,true])test('persisted old queued guide is retired without cancelling unrelated new input='+fresh,async t=>{
 const f=await setup(t),{s,r,q,w}=f,original=w.inbox[0].id;
 for(let i=0;i<23;i++)await s.flow.supplement({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'additional '+i});
 await f.complete(r);const second=s.flow.run(w.currentRunId),guideId=w.inbox.find(i=>i.procedure).id;await f.submit(second);await s.flow.respond(args(second,remaining(s,second).filter(id=>id!==original)));await f.complete(second);
 // Reconstruct the valid persisted queue produced by the previous version,
 // without claiming that the synthetic fixture is a real native execution.
 s.progress=()=>{};const guide=w.inbox.find(i=>i.id===guideId);delete guide.retiredBy;
 const extra={id:randomUUID(),kind:'supplement',source:{actor:'human'},text:'new human input',createdAt:new Date().toISOString(),attempts:[]};if(fresh)w.inbox.push(extra);
 const queued=s.flow.enqueue(q,w,'old pending guidance','legacy-'+randomUUID(),'inbox',{inboxBatch:[guideId,...(fresh?[extra.id]:[])]});guide.attempts.push(queued.id);if(fresh)extra.attempts.push(queued.id);await s.save();
 const count=f.sent.length,restarted=await f.restart();await restarted.tick();const after=restarted.flow.work(restarted.flow.root(q.id),w.id),run=restarted.flow.run(queued.id);assert(after.inbox.find(i=>i.id===guideId).retiredBy);
 if(fresh){assert.notEqual(run.runModel.state.kind,'cancelled');assert.equal(f.sent.length,count+1);assert.equal(after.inbox.find(i=>i.id===extra.id).retiredBy,undefined);}else{assert.equal(run.runModel.state.kind,'cancelled');assert.equal(f.sent.length,count);}
});
