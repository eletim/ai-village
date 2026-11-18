import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
const handle=(s,r,{ids,results=[],finish=true}={})=>s.flow[finish?'finish':'respond']({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:ids??s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&i.attempts.includes(r.id)).map(i=>i.id),results});
const send=(s,a,text)=>s.send(a.id,{instruction:text,requestId:randomUUID()});
test('normal output never acknowledges inputs; one repair then review, another request proceeds',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];const r=await send(s,a,'A');await f.submit(r);
 const b=await send(s,a,'B');await f.complete(r);
 assert.equal(s.flow.root(r.humanRequestId).requestGraph.nodes[0].state.kind,'active');
 assert(!s.flow.inputs(r.humanRequestId,r.workId)[0].handledBy);
 assert(f.sent.some(x=>x.text.includes(b.id)));await f.submit(b);await handle(s,b);await f.complete(b);
 assert.equal(s.flow.root(b.humanRequestId).requestGraph.nodes[0].state.kind,'completed');
 const retry=s.flow.run(s.flow.work(s.flow.root(r.humanRequestId),r.workId).currentRunId);
 assert.notEqual(retry.id,r.id);await f.submit(retry);await f.complete(retry);
 assert(s.flow.work(s.flow.root(r.humanRequestId),r.workId).state.review.includes('progress-stalled'));
 const count=s.data.runs.length;await s.tick();assert.equal(s.data.runs.length,count);
});
test('waiting A frees secretary for B; supplement and child result batch into A; explicit handling closes',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];const r=await send(s,a,'A');await f.submit(r);
 const c=await f.delegate(r,f.agents[2]);await handle(s,r,{finish:false});await f.complete(r);
 const b=await send(s,a,'B');await f.submit(b);
 const input=await s.flow.supplement({humanRequestId:r.humanRequestId,workId:r.workId,operationId:randomUUID(),instruction:'A mobile change'});
 const cr=s.flow.run(c.currentRunId);await f.submit(cr);await handle(s,cr);await f.complete(cr);
 await handle(s,b);await f.complete(b);
 const ar=s.flow.run(s.flow.work(s.flow.root(r.humanRequestId),r.workId).currentRunId);assert.notEqual(ar.id,r.id);
 await f.submit(ar);
 // A result arriving after batch reservation remains pending for another turn, never lost.
 const items=s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&i.attempts.includes(ar.id));
 assert(items.some(i=>i.id===input.id));
 const refs=items.filter(i=>i.result).map(i=>i.result);
 await handle(s,ar,{results:refs});await f.complete(ar);
 const next=s.flow.run(s.flow.work(s.flow.root(r.humanRequestId),r.workId).currentRunId);
 if(next.id!==ar.id){await f.submit(next);const items=s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&i.attempts.includes(next.id));await handle(s,next,{results:items.filter(i=>i.result).map(i=>i.result)});await f.complete(next);}
 assert.equal(s.flow.root(r.humanRequestId).requestGraph.nodes[0].state.kind,'completed',JSON.stringify(s.flow.get(r.humanRequestId)));
 assert.equal(s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy).length,0);
});
test('late supplement prevents completion; idempotent receipt and restart retain it',async t=>{
 const f=await fixture(t);let s=f.service;const r=await send(s,f.agents[0],'A');await f.submit(r);await handle(s,r);
 const x={humanRequestId:r.humanRequestId,workId:r.workId,operationId:randomUUID(),instruction:'late'};
 const first=await s.flow.supplement(x);assert.deepEqual(await s.flow.supplement(x),first);
 await assert.rejects(s.flow.supplement({...x,instruction:'different'}));await f.complete(r);
 assert.equal(s.flow.root(r.humanRequestId).requestGraph.nodes[0].state.kind,'active');
 s=await f.restart();assert(s.flow.inputs(r.humanRequestId,r.workId).some(i=>i.id===first.id&&!i.handledBy));
 await assert.rejects(handle(s,r,{ids:[first.id]}));
});
test('foreign inputs and missing inputs rejected, failed run cannot confirm claims',async t=>{
 const f=await fixture(t),s=f.service;const a=await send(s,f.agents[0],'A'),b=await send(s,f.agents[1],'B');await f.submit(a);await f.submit(b);
 await assert.rejects(handle(s,a,{ids:s.flow.inputs(b.humanRequestId,b.workId).map(i=>i.id)}));
 await assert.rejects(s.flow.finish({humanRequestId:a.humanRequestId,workId:a.workId,runId:a.id,operationId:randomUUID(),results:[]}));
 await handle(s,a);await f.complete(a,'failed');assert(!s.flow.inputs(a.humanRequestId,a.workId)[0].handledBy);
});
test('normal child output without input claim is not a usable result; supplement invalidates earlier acceptance',async t=>{
 const f=await fixture(t),s=f.service,r=await send(s,f.agents[0],'A');await f.submit(r);
 const c=await f.delegate(r,f.agents[2]),cr=s.flow.run(c.currentRunId);await s.tick();await f.submit(cr);await f.complete(cr);
 assert.equal(s.flow.results(r.humanRequestId,r.workId).length,0);
 const repair=s.flow.run(s.flow.work(s.flow.root(r.humanRequestId),c.id).currentRunId);await f.submit(repair);await handle(s,repair);await f.complete(repair);
 const result=s.flow.results(r.humanRequestId,r.workId).find(e=>!e.superseded);const ref={requestId:result.requestId,resultId:result.id,version:result.version,decision:'accept'};
 await handle(s,r,{results:[ref]});
 await s.flow.amend({humanRequestId:r.humanRequestId,workId:c.id,actorRunId:r.id,operationId:randomUUID(),instruction:'new constraint'});
 await f.complete(r);
 assert.notEqual(s.flow.work(s.flow.root(r.humanRequestId),c.id).state.kind,'completed');
 assert.notEqual(s.flow.root(r.humanRequestId).requestGraph.nodes[0].state.kind,'completed');
});
test('slow monitor cannot hold a healthy secretary queue or supplemental receipt',async t=>{
 const f=await fixture(t),s=f.service,r=await send(s,f.agents[0],'A');await f.submit(r);await handle(s,r);
 const b=await send(s,f.agents[0],'B');let release;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 const poll=s.poll.bind(s);s.poll=async a=>{if(a.id===f.agents[3].id)await gate;return poll(a);};
 Object.assign(f.runtimes.get(r.agentId).turns.find(x=>x.id===r.turnId),{state:'completed',completionEvent:'done'});
 const tick=s.tick();try{
  const deadline=Date.now()+1500;while(!f.sent.some(x=>x.text.includes(b.id))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
  assert(f.sent.some(x=>x.text.includes(b.id)),'healthy work should dispatch before slow monitor ends');
  const input=await s.flow.supplement({humanRequestId:b.humanRequestId,workId:b.workId,operationId:randomUUID(),instruction:'queued input'});assert(input.id);
 }finally{release();await tick;}
});
test('workshop owns one pending task while secretary can switch',async t=>{
 const f=await fixture(t),s=f.service,r=await send(s,f.agents[2],'worker A');await f.submit(r);
 const b=await send(s,f.agents[2],'worker B');await f.complete(r);
 assert(!f.sent.some(x=>x.text.includes(b.id)));
 const repair=s.flow.run(s.flow.work(s.flow.root(r.humanRequestId),r.workId).currentRunId);await f.submit(repair);await handle(s,repair);await f.complete(repair);
 assert(f.sent.some(x=>x.text.includes(b.id)));
});
test('supplement during report reopens work and never publishes obsolete report',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service,r=await send(s,f.agents[0],'A');await f.submit(r);await handle(s,r);await f.complete(r);
 const q=s.flow.root(r.humanRequestId),report=s.flow.run(s.flow.work(q,r.workId).reportRunId);assert(report);await f.submit(report);
 const input=await s.flow.supplement({humanRequestId:q.id,workId:r.workId,operationId:randomUUID(),instruction:'new requirements'});
 await f.complete(report);assert.notEqual(q.requestGraph.nodes[0].state.kind,'completed');assert(!q.notification);
 const resumed=s.flow.run(s.flow.work(q,r.workId).currentRunId);assert.notEqual(resumed.id,r.id);await f.submit(resumed);await handle(s,resumed);await f.complete(resumed);
 assert(s.flow.inputs(q.id,r.workId).find(i=>i.id===input.id).handledBy);assert.notEqual(s.flow.work(q,r.workId).reportRunId,report.id);
});
test('failed supplement persistence does not acknowledge or duplicate the receipt',async t=>{
 const f=await fixture(t),s=f.service,r=await send(s,f.agents[0],'A');await f.submit(r);
 const x={humanRequestId:r.humanRequestId,workId:r.workId,operationId:randomUUID(),instruction:'durable input'},write=s.store.write;
 s.store.write=async()=>{throw Error('disk failed');};await assert.rejects(s.flow.supplement(x),/disk failed/);s.store.write=write;
 assert(!s.flow.inputs(r.humanRequestId,r.workId).some(i=>i.operationId===x.operationId));
 const received=await s.flow.supplement(x);assert.equal((await s.flow.supplement(x)).id,received.id);
 const restarted=await f.restart();assert.equal(restarted.flow.inputs(r.humanRequestId,r.workId).filter(i=>i.operationId===x.operationId).length,1);
});
