import {EventEmitter} from 'node:events';import {EventMonitor} from '../server/event-monitor.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
const handle=(s,r,finish=true)=>s.flow[finish?'finish':'respond']({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id),results:s.flow.results(r.humanRequestId,r.workId).filter(e=>!e.handled&&!e.superseded).map(e=>({requestId:e.workId,resultId:e.id,version:e.version,decision:'accept'}))});
const setup=async(t,options)=>{const f=await fixture(t,options),[a,b]=f.agents;a.cwd='/fixture/work';f.service.data.workshops.push({id:a.workshopId,...a.connection,workplaces:[a.cwd]});Object.assign(b,{workshopId:a.workshopId,location:a.location,projectId:a.projectId,cwd:a.cwd,connection:structuredClone(a.connection)});return {...f,a,b};};
const adopt=(s,a,b,op=randomUUID())=>s.adoptRuntime(a.id,{operationId:op,revision:a.metadataRevision||0,replacementRevision:b.metadataRevision||0,replacementAgentId:b.id,handover:'既存成果を維持。外部操作の成否不明は再実行せず確認。'});
test('queued initial run adopts new runtime under the same Agent entry and dispatches once, including restart',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f;a.inputEnvelope={mode:'legacy'};
 const r=await s.send(a.id,{instruction:'queued once',requestId:randomUUID()}),id=r.id,requestId=r.humanRequestId;
 assert.equal(r.runModel.state.kind,'queued');assert.equal(r.dispatchAttemptedAt,undefined);assert.equal(f.sent.length,0);
 const x={operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id},before=JSON.stringify(s.flow.root(requestId));
 const receipt=await s.adoptRuntime(a.id,x);assert.equal(JSON.stringify(s.flow.root(requestId)),before);assert.equal(a.name,'Secretary 0');assert.equal(a.id,f.agents[0].id);assert.equal(b.runtimeRetiredTo,a.id);
 assert.deepEqual(await s.adoptRuntime(a.id,x),receipt);await assert.rejects(s.send(b.id,{instruction:'retired',requestId:randomUUID()}),/旧ランタイム/);
 await s.tick();assert.equal(f.sent.length,1);assert.equal(s.flow.run(id).agentId,a.id);assert.deepEqual(r.runtimeHandover.requiredReads,[['requests','get',requestId],['requests','inputs',requestId,r.workId],['requests','results',requestId,r.workId]]);assert(f.sent[0].text.includes('sessionHandover'));await f.submit(r);await handle(s,r);await f.complete(r);
 const restarted=await f.restart();assert.equal(restarted.agent(a.id).inputEnvelope.mode,'startup-v2');assert.deepEqual(await restarted.adoptRuntime(a.id,x),receipt);assert.equal(f.sent.length,1);
 const next=await restarted.send(a.id,{instruction:'same existing entry',requestId:randomUUID()});assert.equal(next.agentId,a.id);assert.equal(f.sent.length,2);assert.equal(next.runtimeHandover,undefined);
});
test('parent waiting for child adopts runtime and receives result without changing parent/child links',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f,r=await s.send(a.id,{instruction:'parent',requestId:randomUUID()});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await handle(s,r,false);await f.complete(r);a.inputEnvelope={mode:'legacy'};
 await assert.rejects(s.adoptRuntime(a.id,{operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id}),/handover/);await adopt(s,a,b);const cr=s.flow.run(child.currentRunId);await f.submit(cr);await handle(s,cr);await f.complete(cr);await s.tick();
 const q=s.flow.root(r.humanRequestId),parent=s.flow.work(q,r.workId),next=s.flow.run(parent.currentRunId);assert.notEqual(next.id,r.id);assert.equal(parent.assignee,a.id);assert.equal(s.flow.work(q,child.id).parentId,parent.id);
 assert(next.runtimeHandover.operatorNotes.includes('既存成果'));assert(s.flow.get(q.id).runs.some(old=>old.id===r.id&&old.finalOutput==='Final '+r.id));assert(s.flow.inputs(q.id,r.workId).some(i=>i.text==='parent'));assert(s.flow.results(q.id,r.workId).some(e=>e.id===cr.id));await f.submit(next);await handle(s,next);await f.complete(next);assert.equal(parent.state.kind,'completed');assert.equal(f.notifications.length,1);
});
test('already generated queued report resumes on adopted runtime and notifies once',async t=>{
 const f=await setup(t,{reportMode:true}),s=f.service,{a,b}=f,r=await s.send(a.id,{instruction:'report task',requestId:randomUUID()});await f.submit(r);await handle(s,r);a.inputEnvelope={mode:'legacy'};await f.complete(r);
 const q=s.flow.root(r.humanRequestId),report=s.flow.run(q.requestGraph.nodes[0].reportRunId);assert.equal(report.runModel.state.kind,'queued');const rid=report.id;
 await adopt(s,a,b);await s.tick();assert.equal(report.id,rid);assert(report.runtimeHandover);assert(f.sent.at(-1).text.includes('sessionHandover'));await f.submit(report);await f.complete(report);await s.tick();assert.equal(f.notifications.length,1);assert.equal(s.data.runs.filter(r=>r.phase==='report').length,1);
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

test('old delayed wakeups observe only the adopted runtime, never import old native results',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f,oldSession='session-'+a.id,newSession='session-'+b.id;
 const hosts=[];const monitor=new EventMonitor(s,{hostFactory:()=>{const h=new EventEmitter();h.ready=true;h.start=()=>{};h.close=()=>{};hosts.push(h);return h;}});t.after(()=>monitor.close());
 monitor.start(); // pending old-identity invalidations are coalesced, not observation payloads
 await adopt(s,a,b);monitor.update();
 const old=f.runtimes.get(a.id);old.turns.push({id:'late-old-turn',state:'completed',output:'OLD LATE OUTPUT'});
 for(const h of hosts)h.emit('changed',{agentIds:[a.id],paths:['/sessions/'+oldSession+'.jsonl']});
 await new Promise(resolve=>setTimeout(resolve,180));
 assert.equal(a.runtime.agentSessionId,newSession);assert.equal(a.observedSessionId,newSession);assert(!a.nativeTurns.some(t=>t.id==='late-old-turn'));assert.equal(a.inputEnvelope.mode,'startup-v2');assert.equal(f.sent.length,0);
});
test('failed save and lost adoption response retry the same operation without duplicating queued work',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f;a.inputEnvelope={mode:'legacy'};
 const r=await s.send(a.id,{instruction:'preserve purpose',requestId:randomUUID()});
 const supplement=await s.flow.supplement({humanRequestId:r.humanRequestId,workId:r.workId,operationId:randomUUID(),instruction:'Keep prior PR; do not repeat the push. '+ '補足'.repeat(2000)});
 const x={operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id,handover:'PR already pushed; delivery status unknown. Verify, never replay.'};
 const before=s.data.runs.map(r=>r.id),old=a.workspaceId,fresh=b.workspaceId,save=s.save.bind(s);let fail=true;
 s.save=async()=>{if(fail&&a.runtimeMigrations?.length)throw Error('adoption disk failure');return save();};
 await assert.rejects(s.adoptRuntime(a.id,x),/disk failure/);assert.equal(a.workspaceId,old);assert.equal(b.workspaceId,fresh);assert.deepEqual(s.data.runs.map(r=>r.id),before);
 fail=false;const receipt=await s.adoptRuntime(a.id,x); // simulate discarded HTTP response, then restart/retry
 const restarted=await f.restart();assert.deepEqual(await restarted.adoptRuntime(a.id,x),receipt);assert.equal(restarted.agent(a.id).workspaceId,fresh);assert.equal(restarted.agent(b.id).workspaceId,old);assert.deepEqual(restarted.data.runs.map(r=>r.id),before);
 await restarted.tick();const current=restarted.flow.run(r.id);assert.equal(current.runtimeHandover.operatorNotes,x.handover);assert.equal(f.sent.length,1);
 assert.equal(restarted.flow.inputs(r.humanRequestId,r.workId).find(i=>i.id===supplement.id).text,supplement.text);assert.equal(restarted.flow.get(r.humanRequestId).instruction,'preserve purpose');
 assert.deepEqual(await restarted.adoptRuntime(a.id,x),receipt);await restarted.tick();assert.equal(f.sent.length,1);
});

test('adoption receipt is immutable when the new native session identity becomes known later',async t=>{
 const f=await setup(t),s=f.service,{a,b}=f,observe=s.observe.bind(s);
 s.observe=async agent=>{const result=await observe(agent);if(agent.id===b.id)delete agent.inputEnvelope.sessionId;return result;};
 const x={operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id};const receipt=await s.adoptRuntime(a.id,x);assert.equal(receipt.newRuntime.inputEnvelope.sessionId,undefined);
 a.inputEnvelope.sessionId='new-native-session-observed-after-adoption';await s.save();assert.deepEqual(await s.adoptRuntime(a.id,x),receipt);
 const restarted=await f.restart();assert.deepEqual(await restarted.adoptRuntime(a.id,x),receipt);assert.equal(restarted.agent(a.id).inputEnvelope.sessionId,'new-native-session-observed-after-adoption');
});

test('Agent CLI prepares and adopts with long handover, audit and durable idempotency',async t=>{
 const {VillageOperations}=await import('../server/operations.mjs');
 const {readFile}=await import('node:fs/promises');
 const f=await setup(t),s=f.service,{a,b}=f,ops=new VillageOperations({dir:s.dir},null,{direct:s});
 const prepare=['agents','prepare-runtime',a.id,JSON.stringify({operationId:randomUUID(),revision:0})];
 assert.equal((await ops.execute(prepare)).ok,true);assert.equal(a.metadataRevision,1);
 assert.equal((await ops.execute(prepare)).ok,true);assert.equal(a.metadataRevision,1);
 const handover='過去の外部操作は再実行せず記録を確認。'.repeat(400);
 const payload={operationId:randomUUID(),revision:1,replacementRevision:0,replacementAgentId:b.id,handover};
 const args=['agents','adopt-runtime',a.id,JSON.stringify(payload)],old=a.workspaceId,fresh=b.workspaceId;
 const result=await ops.execute(args);assert.equal(result.ok,true);assert.equal(result.result.handover,handover);
 assert.equal(a.workspaceId,fresh);assert.equal(b.workspaceId,old);
 assert.deepEqual((await ops.execute(args)).result,result.result);
 const restarted=await f.restart(),next=new VillageOperations({dir:s.dir},null,{direct:restarted});
 assert.deepEqual((await next.execute(args)).result,result.result);
 const audit=(await readFile(s.dir+'/operations.jsonl','utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(audit.length,5);assert(audit.every(entry=>entry.issuer==='cli'&&entry.result.ok));
 assert.equal(audit.at(-1).argv[3],args[3]);
});
test('Agent CLI retains runtime adoption validation and cannot alter request lifecycle',async t=>{
 const {VillageOperations}=await import('../server/operations.mjs');
 const f=await setup(t),s=f.service,{a,b}=f,ops=new VillageOperations({dir:s.dir},null,{direct:s});
 const r=await s.send(a.id,{instruction:'inflight',requestId:randomUUID()});await f.submit(r);
 const before=JSON.stringify(s.flow.root(r.humanRequestId));
 const result=await ops.execute(['agents','adopt-runtime',a.id,JSON.stringify({operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id,handover:'Preserve ongoing task'})]);
 assert.equal(result.ok,false);assert.match(result.error,/受付不明・実行中/);
 assert.equal(JSON.stringify(s.flow.root(r.humanRequestId)),before);assert.equal(f.sent.length,1);
 assert.equal((await ops.execute(['agents','prepare-runtime',a.id,'{}'])).ok,false);
});
