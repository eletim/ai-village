import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {inspectRequests} from '../server/request-integrity.mjs';
async function setup(t){
 const f=await fixture(t,{commonRequests:true}),s=f.service;
 const r=await s.send(f.agents[0].id,{instruction:'Purpose',requestId:randomUUID()});await f.submit(r);
 const reportAt=new Date(Date.now()+60000).toISOString(),completionAt=new Date(Date.now()+120000).toISOString();
 const child=await s.flow.delegate({humanRequestId:r.humanRequestId,parentWorkId:r.workId,actorRunId:r.id,operationId:randomUUID(),agentId:f.agents[1].id,instruction:'Child',reportAt,completionAt});
 await s.tick();const cr=s.flow.run(child.currentRunId);await f.submit(cr);
 return {...f,s,r,cr,q:s.flow.root(r.humanRequestId),reportAt,completionAt};
}
test('progress reaches manager before run ends; proposal never extends deadlines; duplicate persists once',async t=>{
 const {s,r,cr,q,completionAt,reportAt}=await setup(t);
 const x={humanRequestId:q.id,workId:cr.workId,actorRunId:cr.id,operationId:randomUUID(),kind:'extension',text:'Need more time',proposedCompletionAt:new Date(Date.now()+600000).toISOString()};
 const event=await s.flow.report(x);assert.deepEqual(await s.flow.report(x),event);
 const child=s.flow.work(q,cr.workId),parent=s.flow.work(q,r.workId);
 assert.equal(child.metadata.reporting.completionAt,completionAt);assert.equal(child.metadata.reporting.reportAt,reportAt);
 assert.equal(child.metadata.reporting.reports.length,1);assert(parent.inbox.some(i=>i.id===event.id));assert.equal(cr.runModel.state.kind,'running');
 s.flow.reporting.clock=()=>Date.parse(reportAt)+1;await s.flow.reporting.expire();assert.equal(child.metadata.reporting.expired,undefined);
 assert.deepEqual(inspectRequests(s.data).flatMap(x=>x.reasons),[]);
});
test('expiry persists once and survives restart without killing or reexecuting work',async t=>{
 const {s,cr,q,reportAt,restart}=await setup(t);s.flow.reporting.clock=()=>Date.parse(reportAt)+1;
 await s.flow.reporting.expire();const child=s.flow.work(q,cr.workId),id=child.metadata.reporting.expired.report.id;
 await s.flow.reporting.expire();assert.equal(child.metadata.reporting.expired.report.id,id);assert.equal(child.metadata.reporting.history.length,1);assert.equal(cr.runModel.state.kind,'running');
 const next=await restart();next.flow.reporting.clock=()=>Date.parse(reportAt)+2;await next.flow.reporting.expire();assert.equal(next.flow.work(next.flow.root(q.id),cr.workId).metadata.reporting.history.length,1);
});
test('only manager changes deadline, stale versions rejected, clearing is explicit',async t=>{
 const {s,r,cr,q}=await setup(t),x={humanRequestId:q.id,workId:cr.workId,actorRunId:cr.id,operationId:randomUUID(),expectedVersion:1,completionAt:null,reportAt:null,reason:'Scope changed'};
 await assert.rejects(s.flow.deadline(x));
 await assert.rejects(s.flow.deadline({...x,workId:r.workId,actorRunId:r.id}));
 await s.flow.deadline({...x,actorRunId:r.id});assert.equal(s.flow.work(q,cr.workId).metadata.reporting.version,2);
 await assert.rejects(s.flow.deadline({...x,actorRunId:r.id,operationId:randomUUID()}));
 assert.equal(s.flow.reporting.pending().length,0);
 await s.flow.humanDeadline({...x,workId:r.workId,actorRunId:undefined,revision:q.revision,operationId:randomUUID()});
 assert.deepEqual(inspectRequests(s.data).flatMap(x=>x.reasons),[]);
});
test('manager can request a report after completion deadline without extending or clearing it',async t=>{
 const {s,r,cr,q,completionAt}=await setup(t);
 s.flow.reporting.clock=()=>Date.parse(completionAt)+1;await s.flow.reporting.expire();
 const child=s.flow.work(q,cr.workId),overdue=child.metadata.reporting.expired.completion;
 const x={humanRequestId:q.id,workId:cr.workId,actorRunId:r.id,operationId:randomUUID(),expectedVersion:1,completionAt,reportAt:new Date(Date.parse(completionAt)+60000).toISOString(),reason:'Ask status only'};
 await s.flow.deadline(x);
 assert.equal(child.metadata.reporting.completionAt,completionAt);
 assert.deepEqual(child.metadata.reporting.expired.completion,overdue);
 assert.equal(child.metadata.reporting.expired.report,undefined);
 await s.flow.reporting.expire();
 assert.equal(child.metadata.reporting.history.filter(e=>e.deadlineKind==='completion').length,1);
 await assert.rejects(s.flow.deadline({...x,operationId:randomUUID(),expectedVersion:2,completionAt:new Date(Date.parse(completionAt)-1000).toISOString()}));
});
test('deadline save failure rolls back and automatically retries without another update',async t=>{
 const {s,r,cr,q,reportAt}=await setup(t),scheduler=s.flow.reporting;
 t.after(()=>scheduler.close());scheduler.clock=()=>Date.parse(reportAt)+1+(Date.now()-started);const started=Date.now();scheduler.retryDelayMs=20;
 const save=s.store.save.bind(s.store);let failures=0;
 s.store.save=(...args)=>{if(!failures++){throw Error('temporary disk failure');}return save(...args);};
 scheduler.start();
 const child=s.flow.work(q,cr.workId),parent=s.flow.work(q,r.workId);
 for(let i=0;i<100&&!child.metadata.reporting.expired?.report;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(failures>=2,true);assert(child.metadata.reporting.expired?.report);
 assert.equal(parent.inbox.filter(i=>i.text.includes('deadline-exceeded')).length,1);
 assert.equal(child.metadata.reporting.history.filter(e=>e.kind==='deadline-exceeded').length,1);
 assert.equal(scheduler.retries.size,0);
});
test('retry respects backoff and clearing a deadline cancels recovery',async t=>{
 const {s,r,cr,q,reportAt}=await setup(t),scheduler=s.flow.reporting;
 let time=Date.parse(reportAt)+1;scheduler.clock=()=>time;
 const save=s.store.save.bind(s.store);s.store.save=()=>{throw Error('disk failure');};
 await assert.rejects(scheduler.expire());assert.equal(scheduler.retries.size,1);
 s.store.save=save;await scheduler.expire();assert.equal(s.flow.work(q,cr.workId).metadata.reporting.expired,undefined);
 await s.flow.deadline({humanRequestId:q.id,workId:cr.workId,actorRunId:r.id,operationId:randomUUID(),expectedVersion:1,completionAt:null,reportAt:null,reason:'No longer needed'});
 time+=2000;await scheduler.expire();assert.equal(s.flow.work(q,cr.workId).metadata.reporting.expired?.report,undefined);
});
test('one failing request does not prevent independent deadlines; restart restores overdue work',async()=>{
 const {RequestReports}=await import('../server/request-reports.mjs');
 const make=id=>({id,revision:0,requestGraph:{nodes:[{id,state:{kind:'active'},metadata:{reporting:{version:1,completionAt:null,reportAt:new Date(100).toISOString(),history:[],reports:[]}}}]}});
 const requests=[make('bad'),make('good')];let current,fail=true;
 const flow={requests,root:id=>requests.find(q=>q.id===id),d:{units:{run:(id,fn)=>{current=id;return fn();}},locked:(_id,fn)=>fn(),persist:fn=>{if(current==='bad'&&fail)throw Error('save unavailable');return fn();},save:async()=>{},progress:async()=>{}}};
 const scheduler=new RequestReports(flow,{clock:()=>200});
 await assert.rejects(scheduler.expire());assert.equal(requests[0].requestGraph.nodes[0].metadata.reporting.expired,undefined);assert(requests[1].requestGraph.nodes[0].metadata.reporting.expired.report);
 fail=false;
 const restarted=new RequestReports(flow,{clock:()=>200});await restarted.expire();
 for(const q of requests)assert.equal(q.requestGraph.nodes[0].metadata.reporting.history.length,1);
});
