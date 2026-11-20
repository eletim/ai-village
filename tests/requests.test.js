import {readPartitionSnapshot} from '../server/partition-store.mjs';
import {compatibilityDTO} from '../server/request-compatibility.mjs';
import {changeRun} from '../server/run-lifecycle.mjs';
import {inputHash} from './model-fixtures.mjs';
import {resultEntries} from '../server/request-lifecycle.mjs';
import {receipt} from './model-fixtures.mjs';
import {testView} from './model-fixtures.mjs';
import {verifyInstructionsScript} from '../server/input-envelope.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DirectAgents} from '../server/direct.mjs';
import {} from '../server/runtime-events.mjs';
import {VillageOperations} from '../server/operations.mjs';
async function fixture(t,{reportMode=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'request-flow-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtimes=new Map(),sent=[],notifications=[];let offline=false,lose=false,promptState='intact',promptChecks=0;
 const execute=async(args,host,id)=>{
  if(offline)throw Error('offline');
  const agent=[...runtimes.keys()].find(a=>args.includes('ws-'+a)||args.includes('session-'+a))||id;
  const native=runtimes.get(agent);
  if(args[0]==='python3'&&args[2]===verifyInstructionsScript){promptChecks++;if(promptState==='error')throw Error('read failed');return JSON.stringify({verified:promptState==='intact'});}
  if(args[0]==='python3')return JSON.stringify(native);
  if(args[2]==='status')return JSON.stringify({alive:true,cliState:testView(native.turns.at(-1))?.state==='running'?'busy':'idle',agentSessionId:'session-'+agent});
  if(args[2]==='send'){sent.push({agentId:agent,text:args.at(-1),transport:host?'ssh':'local'});if(lose)throw Error('response lost');return '{"status":"sent"}';}
  throw Error('unexpected '+args.slice(0,4));
 };
 const options={dir,remote:execute,localRun:(cmd,args)=>execute([cmd,...args]),notifier:{status:()=>({}),enqueue:async message=>{notifications.push(message);return {status:'sent'};}}};
 let service=new DirectAgents(options);await service.init({watch:false});service.flow.protocol=0;await service.flow.configureReport(reportMode);
 const agents=Array.from({length:4},(_,i)=>({id:randomUUID(),name:i<2?'Secretary '+i:'Worker '+i,location:i<2?'mayor':'workshop',workshopId:'w'+i,connection:{connectionType:i===3?'ssh':'local',sshHost:i===3?'remote':null,name:'PC'+i},workspaceId:'',tabId:'tab'+i,sessionName:'pane'+i,provider:'codex',state:'idle'}));
 for(const a of agents){a.inputEnvelope={mode:'startup-v2',hash:inputHash(service.startupInstructions())};a.workspaceId='ws-'+a.id;service.data.agents.push(a);runtimes.set(a.id,{available:true,sessionId:'session-'+a.id,fileIdentity:'file-'+a.id,cursor:0,inputs:[],turns:[]});}
 await service.save();await service.tick();
 const submit=async(r,transform=x=>x)=>{
  const native=runtimes.get(r.agentId),text=sent.findLast(s=>s.agentId===r.agentId)?.text;
  assert(text.includes(r.id));assert.equal(r.inputMarker,undefined);const tid=randomUUID();native.cursor+=10;
  native.inputs.push({id:'input-'+tid,turnId:tid,hash:inputHash(transform(text)),offset:native.cursor,source:service.agent(r.agentId).provider==='claude'?'claude-user':'response',text:transform(text)});
  native.turns.push({id:tid,state:'running',output:''});await service.tick();assert.equal(receipt(r).acceptance,'accepted');return tid;
 };
 const complete=async(r,outcome='completed')=>{const native=runtimes.get(r.agentId);Object.assign(native.turns.find(t=>t.id===r.turnId),{state:outcome,output:'Output '+r.id,finalOutput:'Final '+r.id,completionEvent:'event-'+r.id});await service.tick();};
 const finish=async(r,op=randomUUID())=>service.flow.finish({results:JSON.parse(service.flow.root(r.humanRequestId).requestGraph.operations.find(o=>o.id===op)?.payload||'null')?.results||service.flow.results(r.humanRequestId,r.workId).filter(e=>!e.handled&&!e.superseded&&e.outcome==='completed'&&!e.claims.some(c=>c.actorRunId===r.id&&!c.invalidated)).map(e=>({requestId:e.requestId,resultId:e.id,version:e.version,decision:'accept'})),humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,revision:service.flow.root(r.humanRequestId).revision,operationId:op});
 const delegate=async(r,target,op=randomUUID())=>service.flow.delegate({humanRequestId:r.humanRequestId,parentWorkId:r.workId,actorRunId:r.id,agentId:target.id,instruction:'Child work '+op,operationId:op});
 const restart=async()=>{service.close();service=new DirectAgents(options);await service.init({watch:false});service.flow.protocol=0;return service;};
 return {get service(){return service;},options,agents,runtimes,sent,notifications,promptState:v=>promptState=v,promptChecks:()=>promptChecks,submit,complete,finish,delegate,restart,offline:v=>offline=v,lose:v=>lose=v};
}
test('polling then finish handles both child results without redundant parent restart',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{instruction:'Human request',requestId:'human-request-1'});await f.submit(root);
 const children=await Promise.all([f.delegate(root,f.agents[2]),f.delegate(root,f.agents[3])]);await s.tick();
 for(const child of children){const r=s.flow.run(child.currentRunId);await f.submit(r);await f.complete(r);}
 const q=s.flow.root(root.humanRequestId),before=JSON.stringify(q);
 assert.equal(s.flow.results(q.id,root.workId).length,2);assert.equal(JSON.stringify(q),before);
 assert.equal(f.notifications.length,0);const op=randomUUID();await f.finish(root,op);await f.finish(root,op);
 assert(resultEntries(s.data,q).every(e=>!e.handled&&!e.deliveryRunId));await f.complete(root);assert(resultEntries(s.data,q).every(e=>e.handled));
 assert.equal(testView(q).status,'completed');assert.equal(f.notifications.length,1);assert.equal(f.sent.filter(x=>x.agentId===root.agentId).length,1);
 await f.restart();await f.service.tick();assert.equal(f.notifications.length,1);
});

test('successful send response with text still in input box never accepts, finalizes, resends or notifies',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'buffered',requestId:'human-buffered'});
 for(let i=0;i<3;i++)await s.tick();
 assert.equal(testView(r).state,'awaiting_input');assert.equal(receipt(r).acceptance,'pending');assert.equal(f.sent.length,1);
 await f.finish(r);
 const restored=await f.restart();await restored.tick();assert.equal(receipt(restored.flow.run(r.id)).acceptance,'pending');assert.equal(f.sent.length,1);assert.equal(f.notifications.length,0);
 // A later actual Enter produces matching native input; then (and only then) accepted.
 const current=restored.flow.run(r.id);await f.submit(current);assert.equal(receipt(current).acceptance,'accepted');await f.finish(current);await f.complete(current);assert.equal(f.notifications.length,1);
});
test('lost transport response reconciles by exact native input without resending',async t=>{
 const f=await fixture(t);f.lose(true);const r=await f.service.send(f.agents[2].id,{instruction:'Direct human',requestId:'human-worker'});
 assert.equal(testView(r).state,'awaiting_input');assert.equal(receipt(r).acceptance,'pending');await f.submit(r);await f.finish(r);await f.complete(r);
 assert.equal(f.sent.length,1);assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].agentId,f.agents[2].id);
});
test('failure, retry, interrupted finalization and cancellation do not consume a success ticket',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'work',requestId:'human-failures'});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await s.tick();const cr=s.flow.run(child.currentRunId);await f.submit(cr);await f.complete(cr,'failed');
 const q=s.flow.root(r.humanRequestId);assert.equal(testView(s.flow.run(q.requestGraph.nodes[1].currentRunId)).state,'failed');assert.equal(resultEntries(s.data,q)[0].outcome,'failed');assert.equal(testView(q).status,'active');
 await f.finish(r);
 const retry=await s.flow.continue({humanRequestId:q.id,workId:child.id,actorRunId:r.id,revision:q.revision,operationId:'retry-child-one',instruction:'Try again'},true);await s.tick();await f.submit(retry);await f.finish(retry);await f.complete(retry);
 assert.equal(retry.runModel.createdBy,'human');assert.equal(retry.runModel.decisions[0].actor,'human');const event=resultEntries(s.data,q).find(e=>e.resultRunId===retry.id);assert(event);assert.equal(resultEntries(s.data,q)[0].superseded,true);
 await f.finish(r);await f.complete(r,'interrupted');assert.equal(testView(q).status,'active');assert.equal(testView(q).status,'active');assert.equal(f.notifications.length,0);
 await s.flow.cancel({humanRequestId:q.id,revision:q.revision});await s.tick();assert.equal(testView(q).status,'cancelled');assert.equal(f.notifications.length,0);
 await assert.rejects(s.flow.delegate({humanRequestId:q.id,parentWorkId:r.workId,actorRunId:r.id,agentId:f.agents[3].id,instruction:'no',operationId:'after-cancel'}),/受付中では/);
});
test('an acknowledged child terminated before dispatch (its agent was stopped) never blocks parent finish once a successor child completes',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'work',requestId:'human-terminated-child'});await f.submit(r);
 const stale=await f.delegate(r,f.agents[2]);f.agents[2].agentModel={...f.agents[2].agentModel,intent:'stop',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}};await s.tick();await s.tick();
 const q=s.flow.root(r.humanRequestId),staleRun=s.flow.run(stale.currentRunId);
 assert.equal(testView(staleRun).state,'terminated');assert.equal(staleRun.error,'target-unavailable-before-dispatch');
 assert.equal(testView(s.flow.run(q.requestGraph.nodes.find(w=>w.id===stale.id).currentRunId)).state,'terminated');assert.equal(resultEntries(s.data,q)[0].outcome,'terminated');
 // Unacknowledged, it still blocks exactly like a real pending/failed child would.
 await f.finish(r);

 const redo=await f.delegate(r,f.agents[3]);await s.tick();const redoRun=s.flow.run(redo.currentRunId);
 // A second, still-active child keeps blocking even though the acknowledged terminated one no longer does.
 await f.finish(r);
 await f.submit(redoRun);await f.finish(redoRun);await f.complete(redoRun);
 const redoEvent=resultEntries(s.data,q).find(e=>e.workId===redo.id);
 await f.finish(r);await f.complete(r);assert.equal(testView(q).status,'active');assert.equal(testView(q).needsReview,true);await s.flow.complete({humanRequestId:q.id,revision:q.revision});assert.equal(testView(q).status,'completed');
});
test('multiple human requests and secretaries keep exact ownership; nested delegation remains attached',async t=>{
 const f=await fixture(t),s=f.service,a=await s.send(f.agents[0].id,{instruction:'A',requestId:'request-owner-a'}),b=await s.send(f.agents[1].id,{instruction:'B',requestId:'request-owner-b'});
 await f.submit(a);await f.submit(b);const wa=await f.delegate(a,f.agents[2]);await s.tick();const ca=s.flow.run(wa.currentRunId);await f.submit(ca);const wb=await f.delegate(ca,f.agents[3]);await s.tick();const cb=s.flow.run(wb.currentRunId);await f.submit(cb);await f.finish(cb);await f.complete(cb);
 const qa=s.flow.root(a.humanRequestId),qb=s.flow.root(b.humanRequestId);assert.equal(resultEntries(s.data,qa)[0].recipientAgentId,ca.agentId);assert.equal(resultEntries(s.data,qb).length,0);

 await assert.rejects(s.flow.finish({humanRequestId:qa.id,workId:a.workId,runId:b.id,revision:qa.revision,operationId:'wrong-owner'}),/runの所属/);
 await f.finish(b);await f.complete(b);assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].agentId,b.agentId);assert.equal(testView(qa).status,'active');
});
test('automatic completion creates final attention once, and a compatibility finish does not recreate it',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'simple',requestId:'request-attention'});await f.submit(r);
 const old=s.snapshot().reviews[r.agentId].revision;await f.complete(r);assert.equal(f.notifications.length,1);
 assert.equal(s.snapshot().reviews[r.agentId].attention,true);await assert.rejects(s.viewAgent(r.agentId,{revision:old}),{status:409});
 await s.viewAgent(r.agentId,{revision:s.snapshot().reviews[r.agentId].revision});await f.finish(r);await s.tick();assert.equal(s.snapshot().reviews[r.agentId].attention,false);assert.equal(f.notifications.length,1);
});

test('historical runs never acquire tickets or trigger a wave of notifications; uncertain outbox is not replayed',async t=>{
 const f=await fixture(t);f.service.data.runs.push({id:'legacy',agentId:f.agents[0].id,requestId:'legacy-key',instruction:'old',state:'completed',output:'old'});
 delete f.service.data.runStateVersion;await f.service.save();let s=await f.restart();await s.tick();assert.equal(f.notifications.length,0);assert.equal(s.data.requests.length,0);assert.equal(s.flow.run('legacy').notificationPolicy,'legacy-untracked');
 const r=await s.send(f.agents[0].id,{instruction:'new',requestId:'request-new-one'});await f.submit(r);await f.complete(r);await f.finish(r);
 const q=s.flow.root(r.humanRequestId);f.notifications.length=0;q.notification.status='attempting';await s.save();s=await f.restart();await s.tick();assert.equal(f.notifications.length,0);assert.equal(testView(s.flow.root(q.id).notification).status,'delivery_unknown');
});
test('official CLI exposes delegation, results and finalization using the same persisted graph',async t=>{
 const f=await fixture(t),s=f.service,ops=new VillageOperations({dir:f.options.dir},null,{direct:s});
 const r=await s.send(f.agents[0].id,{instruction:'CLI request',requestId:'request-cli-one'});await f.submit(r);
 const help=(await ops.execute(['help'])).result;for(const name of ['requests delegate','requests results','requests finish'])assert(help.some(c=>c.name===name));
 const get=await ops.execute(['requests','get',r.humanRequestId]);assert.equal(get.result.finalAgentId,r.agentId);
 const payload={humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,revision:0,operationId:'cli-finish-one',results:[]};
 const {results,...oldPayload}=payload;assert.equal((await ops.execute(['requests','finish',JSON.stringify(oldPayload)])).ok,false);
 const receipt=await ops.execute(['requests','finish',JSON.stringify(payload)]);assert.equal(receipt.ok,true);assert.equal(f.notifications.length,0);
 await f.complete(r);assert.equal(f.notifications.length,1);assert.equal((await ops.execute(['requests','finish',JSON.stringify(payload)])).ok,true);await s.tick();assert.equal(f.notifications.length,1);
});
test('Agent CLI cannot start independent work or perform human recovery operations',async t=>{
 const f=await fixture(t),ops=new VillageOperations({dir:f.options.dir},null,{direct:f.service});
 for(const action of ['start','retry','resume','cancel','cancel-queued'])assert.throws(()=>ops.resolve(['requests',action,'{}']),/未対応/);
 const names=(await ops.execute(['help'])).result.map(c=>c.name);assert(!names.includes('requests acknowledge'));
});

test('same Agent queues distinct requests; completed requests cannot resume and each notifies once',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];
 const r1=await s.send(a.id,{instruction:'First',requestId:'queued-first-request'});await f.submit(r1);
 const r2=await s.send(a.id,{instruction:'Second',requestId:'queued-second-request'});assert.equal(testView(r2).state,'queued');
 await f.complete(r1);assert.equal(f.notifications.length,1);assert.equal(testView(r2).state,'awaiting_input');
 const q=s.flow.root(r1.humanRequestId);await assert.rejects(s.flow.continue({humanRequestId:q.id,workId:r1.workId,revision:q.revision,operationId:'resume-original',instruction:'continue'}),/受付中では/);
 await f.submit(r2);await f.complete(r2);await s.tick();assert.equal(new Set(f.notifications.map(m=>m.id)).size,2);
});

test('attachment transfer failure never dispatches a prompt; retry retains one request and its exact attachments',async t=>{
 const {AttachmentStore}=await import('../server/attachments.mjs');const f=await fixture(t),s=f.service;s.attachments=new AttachmentStore(f.options.dir);await s.attachments.init();const record=await s.attachments.save(Buffer.from('data'),'data.txt','text/plain');
 s.transferAttachment=async()=>{throw Error('SSH unavailable');};const r=await s.send(f.agents[3].id,{instruction:'',attachments:[record.id],requestId:'attachment-only-request'});
 assert.equal(testView(r).state,'queued');assert.equal(f.sent.length,0);assert(r.attachmentError);assert.equal(s.data.requests.length,1);
 await assert.rejects(s.send(f.agents[3].id,{instruction:'',attachments:[],requestId:'attachment-only-request'}));
 await assert.rejects(s.send(f.agents[3].id,{instruction:'',attachments:[record.id,record.id],requestId:'attachment-duplicate'}));
 const again=await s.send(f.agents[3].id,{instruction:'',attachments:[record.id],requestId:'attachment-only-request'});assert.equal(again.id,r.id);
 s.transferAttachment=async(a,item,bytes)=>{assert.equal(a.connection.connectionType,'ssh');assert.equal(bytes.toString(),'data');return {...item,path:'/tmp/ai-village-attachment-fixture/data.txt'};};r.nextTransferAt=0;await s.tick();assert.equal(f.sent.length,1);assert(f.sent[0].text.includes('/tmp/ai-village-attachment-fixture/data.txt'));assert.equal(s.data.requests.length,1);await f.submit(r);await f.finish(r);await f.complete(r);assert.equal(f.notifications.length,1);
});

async function overload(f,r){
 const native=f.runtimes.get(r.agentId);native.cursor++;
 Object.assign(native.turns.find(t=>t.id===r.turnId),{error:'Selected model is at capacity',errorCode:'server_overloaded',runtimeError:{message:'Selected model is at capacity',codex_error_info:'server_overloaded'},completionOffset:native.cursor});
 await f.complete(r,'failed');
}
test('finish then overloaded failure never notifies; bounded durable retry sends once and needs a fresh finish',async t=>{
 const f=await fixture(t);let s=f.service;
 let r=await s.send(f.agents[0].id,{instruction:'Implement once',requestId:'auto-retry-root'});await f.submit(r);await f.finish(r);await overload(f,r);
 let q=s.flow.root(r.humanRequestId),w=q.requestGraph.nodes[0];assert.equal(testView(q).status,'active');assert.equal(q.requestGraph.nodes[0].declarations.some(d=>d.runId===r.id),true);assert.equal(testView(q).status,'active');assert.equal(f.notifications.length,0);
 assert.equal(testView(r.recovery).status,'scheduled');assert(r.recovery.nextAt>Date.now());assert.equal(f.sent.length,1);
 r.recovery.nextAt=0;await s.save();s=await f.restart();await Promise.all([s.tick(),s.tick()]);
 q=s.flow.root(r.humanRequestId);w=q.requestGraph.nodes[0];let retry=s.flow.run(w.currentRunId);
 assert.equal(retry.runModel.createdBy,'program');assert.notEqual(retry.id,r.id);assert.equal(retry.workId,r.workId);assert.equal(retry.origin,'retry');assert.equal(w.metadata.autoRetry.attempts,1);assert.equal(w.finish,undefined);assert.equal(f.sent.length,2);
 assert.match(retry.instruction,/既存変更/);assert.match(retry.instruction,/再委任を避け/);
 await s.tick();await s.tick();assert.equal(f.sent.length,2);assert.equal(testView(retry).state,'awaiting_input');
 s=await f.restart();await s.tick();retry=s.flow.run(retry.id);assert.equal(testView(retry).state,'awaiting_input');assert.equal(f.sent.length,2);
 // A late old terminal is not the retry's native acknowledgement.
 await f.complete(r,'completed');assert.equal(receipt(retry).acceptance,'pending');assert.equal(f.notifications.length,0);
 await f.submit(retry);await f.finish(retry);await f.complete(retry);await s.tick();assert.equal(f.notifications.length,1);
 const completed=JSON.stringify(s.flow.root(q.id));s=await f.restart();await s.tick();assert.equal(JSON.stringify(s.flow.root(q.id)),completed);assert.equal(f.notifications.length,1);assert.equal(f.sent.length,2);
});
test('automatic retries stop after two attempts or ten minutes and never retry ambiguous acceptance',async t=>{
 const f=await fixture(t),s=f.service;let r=await s.send(f.agents[0].id,{instruction:'Work',requestId:'retry-budget-root'});
 for(let attempt=0;attempt<3;attempt++){
  await f.submit(r);await overload(f,r);
  if(attempt===2){assert.equal(testView(r.recovery).status,'manual');assert.match(r.recovery.reason,/上限/);break;}
  assert.equal(testView(r.recovery).status,'scheduled');assert(r.recovery.nextAt-Date.now()>=(attempt===0?29000:119000));r.recovery.nextAt=0;await s.tick();r=s.flow.run(s.flow.root(r.humanRequestId).requestGraph.nodes[0].currentRunId);
 }
 assert.equal(f.sent.length,3);await s.tick();assert.equal(f.sent.length,3);assert.equal(f.notifications.length,0);
 const other=await s.send(f.agents[1].id,{instruction:'Other',requestId:'retry-time-root'});await f.submit(other);await overload(f,other);
 s.flow.root(other.humanRequestId).requestGraph.nodes[0].metadata.autoRetry.firstFailureAt=Date.now()-600001;await s.tick();assert.equal(testView(other.recovery).status,'manual');
 const pending=await s.send(f.agents[2].id,{instruction:'Unaccepted',requestId:'retry-unknown-root'});await s.tick();await s.tick();assert.equal(testView(pending).state,'awaiting_input');assert.equal(s.flow.root(pending.humanRequestId).requestGraph.nodes[0].runIds.length,1);
});
test('cancel, authentication failure, legacy runs, child work and newer input exclude automatic replay',async t=>{
 for(const scenario of ['cancel','authentication','legacy','child','new-input']){
  const f=await fixture(t),s=f.service;const r=await s.send(f.agents[0].id,{instruction:'Work',requestId:'exclude-'+scenario});await f.submit(r);
  if(scenario==='child')await f.delegate(r,f.agents[2]);
  if(scenario==='legacy')delete r.recoveryPolicy;
  await overload(f,r);
  if(scenario==='authentication'){r.errorCode='authentication_failed';await s.tick();}
  if(scenario==='cancel')await s.flow.cancel({humanRequestId:r.humanRequestId,revision:s.flow.root(r.humanRequestId).revision});
  if(scenario==='new-input'){const n=f.runtimes.get(r.agentId);n.inputs.push({id:'later',turnId:r.turnId,offset:++n.cursor,hash:'other'});}
  if(r.recovery)r.recovery.nextAt=0;
  await s.tick();await s.tick();
  assert.equal(f.sent.filter(x=>x.agentId===r.agentId).length,1,scenario);assert.equal(f.notifications.length,0,scenario);
  if(['authentication','legacy','child','new-input'].includes(scenario))assert.equal(testView(r.recovery).status,'manual',scenario);
 }
});
test('historically completed requests and runs are not reinterpreted when an old native error appears',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'Old',requestId:'historic-root'});
 await f.submit(r);await f.finish(r);await f.complete(r);const q=s.flow.root(r.humanRequestId),before=JSON.stringify(q),runBefore=JSON.stringify(r);
 const native=f.runtimes.get(r.agentId);Object.assign(native.turns[0],{state:'failed',errorCode:'server_overloaded',error:'old error'});
 await s.tick();await s.tick();assert.equal(JSON.stringify(q),before);assert.equal(JSON.stringify(r),runBefore);assert.equal(f.sent.length,1);assert.equal(f.notifications.length,1);
});
async function steer(f,r,text='Supplement',requestId=randomUUID()){
 const a=f.service.agent(r.agentId);assert.equal(testView(a).canSteer,true);
 return f.service.send(a.id,{requestId,instruction:text,steerTarget:structuredClone(a.steerTarget)});
}
async function acceptSteer(f,r,{otherTurn=false,explicitTurn=true}={}){
 const n=f.runtimes.get(r.agentId),text=f.sent.at(-1).text;n.cursor+=10;
 const turnId=otherTurn?randomUUID():r.steerTarget.turnId;
 n.inputs.push({id:randomUUID(),turnId,hash:inputHash(text),offset:n.cursor,text,explicitTurn});
 if(otherTurn)n.turns.push({id:turnId,state:'running',output:''});
 await f.service.tick();
}
test('multiple busy supplements replace the current run on one work/ticket, invalidate old finish, notify once',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 await f.finish(root);const q=s.flow.root(root.humanRequestId);assert.equal(testView(q).status,'active');
 const second=await steer(f,root);assert.equal(f.sent.length,2);assert.equal(testView(second).state,'awaiting_input');assert.equal(second.humanRequestId,root.humanRequestId);assert.equal(second.workId,root.workId);assert.equal(q.requestGraph.nodes.length,1);assert.equal(s.data.requests.length,1);assert.equal(testView(q).status,'active');assert.equal(testView(root).state,'superseded');assert.equal(testView(q).status,'active');
 await f.finish(root);await f.finish(second);
 await acceptSteer(f,second);assert.equal(receipt(second).acceptance,'accepted');assert.equal(second.turnId,root.turnId);
 const third=await steer(f,second,'Second supplement');await acceptSteer(f,third);assert.equal(testView(third).state,'running');await f.finish(second);
 await f.finish(third);await f.complete(third);assert.equal(f.notifications.length,1);assert.equal(q.finalRunId,third.id);await s.tick();await s.tick();assert.equal(f.notifications.length,1);assert.equal(s.data.requests.length,1);
});
test('steering receipt is idempotent across restart, uncertain delivery never resends, wrong turn never completes',async t=>{
 const f=await fixture(t),root=await f.service.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const input={requestId:randomUUID(),instruction:'More',steerTarget:structuredClone(f.service.agent(root.agentId).steerTarget)};f.lose(true);
 const r=await f.service.send(root.agentId,input);assert.equal(testView(r).state,'awaiting_input');const count=f.sent.length;await f.service.tick();assert.equal(testView(f.service.agent(root.agentId)).canSteer,false);
 await f.restart();await f.service.tick();assert.equal((await f.service.send(root.agentId,input)).id,r.id);assert.equal(f.sent.length,count);
 await assert.rejects(f.service.send(root.agentId,{...input,instruction:'changed'}),/requestId/);
 const restarted=f.service.flow.run(r.id);await acceptSteer(f,restarted,{otherTurn:true});assert.equal(receipt(restarted).acceptance,'pending');await f.finish(restarted);assert.equal(f.notifications.length,0);assert.equal(f.sent.length,count);
});
test('unsafe steering targets reject without dispatch; cancellation never turns steering into queue',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const target=structuredClone(s.agent(root.agentId).steerTarget),input={requestId:randomUUID(),instruction:'More',steerTarget:target};
 await assert.rejects(s.send(root.agentId,{...input,steerTarget:{...target,turnId:'wrong'}}),/補足対象/);f.offline(true);await assert.rejects(s.send(root.agentId,input),/補足対象/);f.offline(false);await s.tick();
 s.agent(root.agentId).provider='unsupported';await assert.rejects(s.send(root.agentId,input),/補足対象/);s.agent(root.agentId).provider='codex';await s.tick();
 const q=s.flow.root(root.humanRequestId);await s.flow.cancel({humanRequestId:q.id,revision:q.revision});await assert.rejects(s.send(root.agentId,input),/補足対象/);assert.equal(f.sent.length,1);assert.equal(f.notifications.length,0);
});
test('unattributed supplement or external same-turn input prevents finish and further steering',async t=>{
 const f=await fixture(t),root=await f.service.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);const r=await steer(f,root);await acceptSteer(f,r,{explicitTurn:false});assert.equal(receipt(r).acceptance,'pending');assert.equal(testView(f.service.agent(r.agentId)).canSteer,false);assert.equal(f.notifications.length,0);
});
test('steering preserves original replay, attachments and child graph; later native stranger blocks finish',async t=>{
 const f=await fixture(t),s=f.service;
 s.attachments={select:async ids=>ids.map(id=>({id,name:id})),content:async()=>Buffer.from('test')};s.transferAttachment=async(a,record)=>({id:record.id,path:'/test/'+record.id});
 const initial={requestId:randomUUID(),instruction:'Original',attachments:['first']};const root=await s.send(f.agents[0].id,initial);await f.submit(root);const child=await f.delegate(root,f.agents[2]);
 const target=structuredClone(s.agent(root.agentId).steerTarget),r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'Supplement',steerTarget:target,attachments:['second']});await acceptSteer(f,r);assert.equal((await s.send(root.agentId,initial)).id,root.id);assert.equal(s.flow.root(root.humanRequestId).requestGraph.nodes.length,2);assert.equal(s.flow.work(s.flow.root(root.humanRequestId),child.id).currentRunId,child.currentRunId);
 const next=await f.delegate(r,f.agents[3]);const nextRun=s.flow.run(next.currentRunId);assert.deepEqual(nextRun.attachments.map(a=>a.id),['first','second']);
 const n=f.runtimes.get(r.agentId);n.cursor+=10;n.inputs.push({id:'stranger',turnId:r.turnId,offset:n.cursor,hash:inputHash('foreign'),explicitTurn:true});await s.tick();assert.equal(testView(r).state,'running');assert.equal(testView(s.agent(r.agentId)).canSteer,false);await f.finish(r);assert.equal(f.notifications.length,0);
});
test('target ending during attachment transfer does not send or fall back to a new idle turn',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 s.attachments={select:async ids=>ids.map(id=>({id})),content:async()=>Buffer.from('test')};s.transferAttachment=async()=>{f.runtimes.get(root.agentId).turns.at(-1).state='completed';return {path:'/test/file'};};
 const r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:s.agent(root.agentId).steerTarget,attachments:['a']});assert.equal(testView(r).state,'interrupted');assert.equal(f.sent.length,1);await s.tick();assert.equal(f.sent.length,1);assert.equal(f.notifications.length,0);
});
test('permission, setup/unknown transport, incomplete native tail and pending input disable steering',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});assert.equal(testView(s.agent(root.agentId)).canSteer,false);await f.submit(root);const target=structuredClone(s.agent(root.agentId).steerTarget),original=s.localRun;
 for(const status of [{alive:true,cliState:'busy',agentSessionId:'session-'+root.agentId,permissionRequest:{id:'permission'}},{alive:true,cliState:'unknown',agentSessionId:'session-'+root.agentId},{alive:true,cliState:'busy',agentSessionId:null},{alive:false,cliState:'busy',agentSessionId:'session-'+root.agentId}]){
  s.localRun=(cmd,args)=>args[1]==='status'?Promise.resolve(JSON.stringify(status)):original(cmd,args);
  await assert.rejects(s.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:target}),/補足対象/);assert.equal(f.sent.length,1);
 }
 s.localRun=original;f.runtimes.get(root.agentId).incompleteTail=true;await assert.rejects(s.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:target}),/補足対象/);assert.equal(f.sent.length,1);
});
test('accepted steering survives restart and only its final run consumes the original ticket',async t=>{
 const f=await fixture(t),root=await f.service.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);await assert.rejects(f.service.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:{runId:root.id}}),{status:400});const r=await steer(f,root);await acceptSteer(f,r);const count=f.sent.length;await f.restart();await f.service.tick();const restored=f.service.flow.run(r.id);assert.equal(receipt(restored).acceptance,'accepted');assert.equal(testView(restored).state,'running');await f.finish(restored);await f.complete(restored);await f.service.tick();assert.equal(f.sent.length,count);assert.equal(f.notifications.length,1);assert.equal(f.service.flow.root(root.humanRequestId).finalRunId,r.id);
});


test('report mode default, persistence, validation, snapshot and OFF/legacy isolation',async t=>{
 const f=await fixture(t),s=f.service;
 delete s.data.reportSettings;assert.equal(s.flow.reportStatus().enabled,true);
 await assert.rejects(s.flow.configureReport('true'),/true\/false/);
 await s.flow.configureReport(false);
 const old=await s.send(f.agents[0].id,{requestId:'report-off-request',instruction:'OFF'});
 await s.flow.configureReport(true);await f.submit(old);await f.finish(old);await f.complete(old);
 assert.equal(s.flow.root(old.humanRequestId).report,undefined);assert.equal(f.notifications.length,1);
 assert.equal((await f.restart()).flow.reportStatus().enabled,true);
 const legacy=f.service.flow.root(old.humanRequestId);delete legacy.reportMode;await f.service.tick();
 assert.equal(legacy.report,undefined);assert.equal(f.notifications.length,1);
});
test('two-stage report replaces visible work after completion, waits for acceptance, notifies once and survives duplicate polls/restart',async t=>{
 const f=await fixture(t,{reportMode:true});let s=f.service;
 const source=await s.send(f.agents[0].id,{requestId:'report-on-request',instruction:'元の質問'});
 await f.submit(source);const q=s.flow.root(source.humanRequestId);
 f.runtimes.get(source.agentId).turns.at(-1).output='SECRET DRAFT';await s.tick();
 assert(JSON.stringify(s.snapshot()).includes('SECRET DRAFT'));
 assert(s.flow.get(q.id).runs[0].output.includes('SECRET DRAFT'));
 await f.finish(source);await f.complete(source);
 assert.equal(testView(q).status,'active');assert.equal(testView(q).status,'active');assert.equal(f.notifications.length,0);
 let report=s.flow.run(q.requestGraph.nodes[0].reportRunId);assert.equal(report.phase,'report');assert.equal(report.workId,source.workId);
 assert.match(report.instruction,/元の質問/);assert.match(s.rules.specification('report').text,/追加作業/);
 // finish must come before the report body is written, so a trailing habitual remark can
 // never become the run's last message and clobber the report in finalOutput.
 assert.match(s.rules.specification('report').text,/finishは不要/);
 assert.match(s.rules.specification('report').text,/その後は何も足さないで/);
 assert(JSON.stringify(s.snapshot()).includes('Output '+source.id));
 assert(!JSON.stringify(s.snapshot()).includes('人間が読む短い報告に書き直し'));
 assert.equal(s.snapshot().reviews[source.agentId].attention,false);
 const count=f.sent.length;await s.tick();await s.tick();assert.equal(f.sent.length,count);
 s=await f.restart();await s.tick();assert.equal(f.sent.length,count);
 report=s.flow.run(report.id);await assert.rejects(f.finish(report));
 await f.submit(report);assert.equal(testView(s.agent(report.agentId)).canSteer,true);
 await assert.rejects(f.delegate(report,f.agents[2]),/現在の作業run/);
 await f.finish(report);assert.equal(f.notifications.length,0);await f.complete(report);
 assert.equal(f.notifications.length,1);assert.match(f.notifications[0].content,new RegExp('Final '+report.id));
 assert.equal(testView(s.flow.root(q.id)).status,'completed');assert.equal(s.snapshot().reviews[source.agentId].attention,true);
 assert.equal(s.snapshot().runs.find(r=>r.id===source.id).collapsedHistory,true);assert.equal(s.snapshot().runs.find(r=>r.id===source.id).finalOutput,'Final '+source.id);assert(JSON.stringify(s.snapshot()).includes('Final '+report.id));
 await s.tick();await s.tick();await f.restart();await f.service.tick();assert.equal(f.notifications.length,1);
 assert.equal(f.service.data.runs.filter(r=>r.phase==='report').length,1);
});
test('report failure retries only report; cancelled or unknown reports never redispatch/notify',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;
 const source=await s.send(f.agents[0].id,{requestId:'report-failed-request',instruction:'work'});await f.submit(source);await f.finish(source);await f.complete(source);
 const q=s.flow.root(source.humanRequestId),report=s.flow.run(q.requestGraph.nodes[0].reportRunId);
 await f.submit(report);await f.finish(report);await f.complete(report,'failed');
 assert.equal(testView(q).status,'active');assert.equal(testView(q).status,'active');assert.equal(f.notifications.length,0);
 assert(JSON.stringify(s.snapshot()).includes('Output '+source.id));
 const x={humanRequestId:q.id,workId:report.workId,revision:q.revision,operationId:'report-retry-operation',instruction:'Do work again'};
 const retry=await s.flow.continue(x,true);assert.equal(retry.phase,'report');assert.match(s.rules.specification('report').text,/再実行は禁止/);assert.equal(await s.flow.continue(x,true),retry);
 f.lose(true);await s.tick();assert.equal(testView(retry).state,'awaiting_input');const count=f.sent.length;
 await s.tick();await f.restart();await f.service.tick();assert.equal(f.sent.length,count);
 const restored=f.service.flow.root(q.id);await f.service.flow.cancel({humanRequestId:q.id,revision:restored.revision});await f.service.tick();
 assert.equal(f.sent.length,count);assert.equal(f.notifications.length,0);
});
test('child results remain intact and do not get report runs; source failure does not create report',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;
 const r=await s.send(f.agents[0].id,{requestId:'report-children',instruction:'work'});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(child.currentRunId);
 await f.submit(c);await f.finish(c);await f.complete(c);assert.equal(testView(s.flow.run(s.flow.work(s.flow.root(r.humanRequestId),child.id).currentRunId)).state,'completed');assert.equal(child.runIds.length,1);
 const q=s.flow.root(r.humanRequestId);

 assert.equal(s.flow.results(q.id,r.workId)[0].output,'Output '+c.id);
 await f.finish(r);await f.complete(r,'failed');assert.equal(q.report,undefined);assert.equal(f.notifications.length,0);
});
test('report snapshot is pinned, supplements stay same work until report, new request during report is queued separately',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;
 const r=await s.send(f.agents[0].id,{requestId:'report-queue-root',instruction:'元質問'});await f.submit(r);
 await s.flow.configureReport(false);
 await f.finish(r);await f.complete(r);const q=s.flow.root(r.humanRequestId),report=s.flow.run(q.requestGraph.nodes[0].reportRunId);
 await f.submit(report);
 const supplement=await s.send(r.agentId,{requestId:'report-valid-steer',instruction:'補足',steerTarget:{runId:report.id,sessionId:report.sessionId,turnId:report.turnId}});assert.equal(supplement.phase,'report');await acceptSteer(f,supplement);
 const later=await s.send(r.agentId,{requestId:'report-next-request',instruction:'次の独立依頼'});
 assert.equal(testView(later).state,'queued');assert.notEqual(later.humanRequestId,q.id);assert.equal(s.flow.root(later.humanRequestId).reportMode,false);
 const count=f.sent.length;await s.tick();assert.equal(f.sent.length,count);
 await f.complete(supplement);assert.equal(f.notifications.length,1);assert.equal(testView(later).state,'awaiting_input');
 assert.equal(s.flow.root(q.id).reportMode,true);
});
test('cancel before source completion or queued report prevents creation/dispatch and final attention',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;
 const r=await s.send(f.agents[0].id,{requestId:'report-cancel-source',instruction:'work'});await f.submit(r);await f.finish(r);
 const q=s.flow.root(r.humanRequestId);await s.flow.cancel({humanRequestId:q.id,revision:q.revision});await f.complete(r);
 assert.equal(q.report,undefined);assert.equal(f.notifications.length,0);
 const r2=await s.send(f.agents[1].id,{requestId:'report-cancel-queued',instruction:'work'});await f.submit(r2);await f.finish(r2);
 // A native completion can be observed and settled while dispatch remains withheld.
 const native=f.runtimes.get(r2.agentId);native.turns.at(-1).state='completed';
 await s.observe(s.agent(r2.agentId));await s.flow.settle();
 const q2=s.flow.root(r2.humanRequestId),report=s.flow.run(q2.requestGraph.nodes[0].reportRunId);assert.equal(testView(report).state,'queued');
 await s.flow.cancel({humanRequestId:q2.id,revision:q2.revision});const count=f.sent.length;await s.tick();await f.restart();await f.service.tick();
 assert.equal(f.sent.length,count);assert.equal(f.notifications.length,0);
});
test('report completed without finish becomes visible and completes; disabled notifications do not skip report',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;s.notifier.enqueue=async()=>({status:'disabled'});
 const r=await s.send(f.agents[0].id,{requestId:'report-no-finish',instruction:'question'});await f.submit(r);await f.complete(r);
 const q=s.flow.root(r.humanRequestId),report=s.flow.run(q.requestGraph.nodes[0].reportRunId);assert.equal(report.phase,'report');
 await f.submit(report);await f.complete(report);assert.equal(testView(q).status,'completed');assert(JSON.stringify(s.snapshot()).includes('Final '+report.id));assert.equal(testView(q.notification).status,'disabled');
 await assert.rejects(s.flow.continue({humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:'no-resume-report',instruction:'resume'}),/受付中では/);
});

test('both report settings survive restart; failed persistence does not falsely apply the switch',async t=>{
 const f=await fixture(t);assert.equal((await f.restart()).flow.reportStatus().enabled,false);
 await f.service.flow.configureReport(true);assert.equal((await f.restart()).flow.reportStatus().enabled,true);
 const s=f.service,save=s.save;s.save=async()=>{throw Error('disk unavailable');};
 await assert.rejects(s.flow.configureReport(false),/disk unavailable/);assert.equal(s.flow.reportStatus().enabled,true);s.save=save;
});

test('compact work context retains completion and receipt rules with discoverable detailed operations',async t=>{
 const f=await fixture(t),r=await f.service.send(f.agents[0].id,{instruction:'context test',requestId:'compact-context-test'});
 const text=f.service.rules.specification().text;
 assert(text.length<4000);
 for(const token of ['requests finish','operationId','正常終了','委任','受付不明','/api/direct/requests/get','village-image:UUID'])assert(text.includes(token),token);
 const envelope=f.service.flow.context(r);assert(envelope.includes(r.id));assert(envelope.includes(r.workId));assert(envelope.includes(r.humanRequestId));
});
test('steering partitions progress at actual acceptance through multiple supplements and restart',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const n=f.runtimes.get(root.agentId),turn=n.turns[0];turn.messageOffsets=true;turn.messages=[];
 const emit=async text=>{n.cursor+=2;turn.messages.push({id:'m'+n.cursor,offset:n.cursor,text});turn.output=turn.messages.map(m=>m.text).join('\n\n');await f.service.tick();};
 await emit('before');const second=await steer(f,root);await emit('just before acceptance');assert(!second.output);await acceptSteer(f,second);
 assert.equal(root.output,'before\n\njust before acceptance');assert.equal(second.output,'');
 await emit('repeat');await emit('repeat');assert.equal(second.output,'repeat\n\nrepeat');
 const third=await steer(f,second);await acceptSteer(f,third);assert.equal(third.output,'');await f.restart();await f.service.tick();
 const restored=f.service.flow.run(third.id);await emit('after');assert.equal(restored.output,'after');assert.equal(f.service.flow.run(second.id).output,'repeat\n\nrepeat');
 await f.finish(restored);await f.complete(restored);assert.equal(f.notifications.length,1);assert.equal(restored.finalOutput,'Final '+restored.id);
});
test('unsent input cancellation validates identity, survives restart and never dispatches or notifies',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Active'});await f.submit(root);
 const r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'queued'});assert.equal(testView(r).state,'queued');
 const x={humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id};
 await assert.rejects(s.flow.cancelQueued({...x,agentId:f.agents[1].id}),/一致/);
 await Promise.all([s.flow.cancelQueued(x),s.flow.cancelQueued(x)]);assert.equal(receipt(r).acceptance,'cancelled');assert.equal(testView(s.flow.root(r.humanRequestId)).status,'cancelled');
 await f.restart();await f.service.flow.cancelQueued(x);await f.complete(f.service.flow.run(root.id));await f.service.tick();assert.equal(f.sent.length,1);assert.equal(f.notifications.length,1);
 for(const state of ['sending','send_unknown','running','awaiting_input']){const run=f.service.flow.run(root.id);run.state=state;await assert.rejects(f.service.flow.cancelQueued({humanRequestId:run.humanRequestId,agentId:run.agentId,runId:run.id}),/未送信/);}
});
test('cancellation serializes against dispatch and cannot claim a send that already started',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'sent'});
 // Recreate a queued boundary with deterministic fake transport; no real Agent.
 r.runModel={...r.runModel,state:{kind:'queued'}};r.state='queued';r.runModel.facts=[];delete r.dispatchAttemptedAt;
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),observe=s.observe.bind(s);
 s.observe=async a=>{enter();await gate;await observe(a);a.agentModel.observation={connected:true,process:'alive',activity:'idle',canSteer:false,inputPending:false};return {sessionId:'session-'+a.id,cursor:0};};
 const dispatch=s.attemptRun(r);await entered;const cancel=s.flow.cancelQueued({humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id});release();await dispatch;
 await assert.rejects(cancel,/未送信/);assert.equal(testView(r).state,'awaiting_input');
});
test('queued supplement cancellation restores the original work without sending or restoring old finish',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);await f.finish(root);
 const attempt=s.attemptRun.bind(s);s.attemptRun=async r=>r;const r=await steer(f,root);s.attemptRun=attempt;
 await s.flow.cancelQueued({humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id});const q=s.flow.root(r.humanRequestId);assert.equal(q.requestGraph.nodes[0].currentRunId,root.id);assert.equal(q.requestGraph.nodes[0].finish,undefined);await s.tick();assert.equal(f.sent.length,1);assert.equal(testView(root).state,'running');assert.equal(testView(q).status,'active');
});
test('failed persistence cannot turn a later duplicate cancellation into false success',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Active'});await f.submit(root);
 const r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'Queued'}),x={humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id};
 const save=s.save.bind(s);s.save=async()=>{throw Error('disk unavailable');};await assert.rejects(s.flow.cancelQueued(x),/disk/);assert.equal(testView(r).state,'queued');assert.equal(r.queueCancelledAt,undefined);assert.equal(testView(s.flow.root(r.humanRequestId)).status,'active');s.save=save;await s.flow.cancelQueued(x);assert(r.queueCancelledAt);
});
test('event-to-response upgrade preserves Direct steering boundary and superseded output partitions',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const n=f.runtimes.get(root.agentId),turn=n.turns[0];turn.messageOffsets=true;turn.messages=[];
 const emit=async text=>{n.cursor+=2;turn.messages.push({id:'m'+n.cursor,offset:n.cursor,text});turn.output=turn.messages.map(m=>m.text).join('\n\n');await f.service.tick();};
 const upgrade=run=>{const i=n.inputs.find(i=>i.id===run.inputId),old={id:i.id,offset:i.offset};n.cursor+=2;Object.assign(i,{id:'response-'+i.id,offset:n.cursor,aliases:[old]});};
 await emit('before');upgrade(root);await s.tick();assert.equal(testView(root).state,'running');assert.equal(testView(s.agent(root.agentId)).canSteer,true);
 const second=await steer(f,root);await acceptSteer(f,second);await emit('between');
 // The next send snapshots the event ID, then its canonical response arrives
 // before attemptRun's second native observation (dispatch race).
 const runtime=s.runtime.bind(s);let observations=0;
 s.runtime=async(...args)=>{observations++;if(observations===2)upgrade(second);return runtime(...args);};
 const third=await steer(f,second);s.runtime=runtime;assert.equal(testView(third).state,'awaiting_input');
 await acceptSteer(f,third);await emit('after');
 assert.equal(root.output,'before');assert.equal(second.output,'between');assert.equal(third.output,'after');
 await f.restart();await f.service.tick();assert.equal(f.service.flow.run(second.id).output,'between');
 await f.finish(f.service.flow.run(third.id));await f.complete(f.service.flow.run(third.id));assert.equal(f.notifications.length,1);
});

test('startup envelope retains literal human input and dynamic identity; report specifications remain discoverable',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service,a=f.agents[0];
 a.inputEnvelope={mode:'startup-v2',hash:inputHash(s.startupInstructions())};
 const human='  本文 <pasted_content>\nそのまま  ';
 const r=await s.send(a.id,{instruction:human,requestId:randomUUID()});
 const delivered=f.sent.at(-1).text;
 assert(delivered.startsWith(human+'\n'));assert(delivered.includes(r.id));assert.equal(r.inputMarker,undefined);
 assert(delivered.includes('ai-village-discovery'));assert(delivered.includes(a.id));
 assert(!delivered.includes('requests finish'));assert(!delivered.includes('図は必要時のみ'));
 assert(s.rules.specification().text.includes('requests finish'));assert(s.startupInstructions().includes('phase=report'));
 assert(s.rules.specification().text.includes('projects guide PROJECT_ID'));
 await f.submit(r);await f.finish(r);await f.complete(r);await s.tick();
 const q=s.flow.get(r.humanRequestId),report=s.flow.run(q.requestGraph.nodes[0].reportRunId);
 assert.equal(report.phase,'report');assert(report.instruction.startsWith('報告資料'));
 assert(!s.flow.context(report).includes('requests finish'));
 a.inputEnvelope={mode:'legacy'};
 assert(s.rules.specification('report').text.includes('finishは不要'));assert(!s.flow.context(report).includes('finishは不要'));
 assert(!s.flow.context(r).includes('requests delegate'));
});

test('startup envelope uses latest metadata and retains attachments/travel; changed native session requires migration',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];a.inputEnvelope={mode:'startup-v2',sessionId:'previous-session'};
 await s.tick();assert.equal(a.inputEnvelope.mode,'migration-required');assert.equal(a.inputEnvelope.reason,'native-session-changed');
 a.inputEnvelope={mode:'startup-v2',hash:inputHash(s.startupInstructions())};a.projectId='current-project';a.metadataRevision=42;
 const context=s.secretaryContext(a,true);assert(context.includes('current-project'));assert(!context.includes('metadataRevision'));assert(!context.includes('所属は'));
 assert(s.rules.dynamic({attachmentFiles:[{path:'/attachment',sha256:'verified'}],travelContexts:[]}).includes('/attachment'));
 await s.save();await f.restart();assert.equal(f.service.agent(a.id).inputEnvelope.mode,'startup-v2');
});

for(const state of ['intact','missing','error'])test('pre-dispatch prompt check: '+state,async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];a.inputEnvelope={mode:'startup-v2',hash:inputHash(s.startupInstructions())};f.promptState(state);
 const r=await s.send(a.id,{instruction:'human',requestId:randomUUID()});
 assert.equal(f.promptChecks(),1);
 if(state==='intact'){assert.equal(r.inputEnvelopeMode,'startup-v2');assert(!f.sent.at(-1).text.includes('requests finish'));await f.submit(r);await f.complete(r);}
 else {assert.equal(f.sent.length,0);assert.equal(r.runModel.state.reason,'startup-contract-migration-required');assert.equal(a.inputEnvelope.mode,'migration-required');await f.restart();assert.equal(f.service.agent(a.id).inputEnvelope.mode,'migration-required');}

});

test('queued compact report stops before sending when prompt disappears',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service,a=f.agents[0];a.inputEnvelope={mode:'startup-v2',hash:inputHash(s.startupInstructions())};
 const r=await s.send(a.id,{instruction:'work',requestId:randomUUID()});await f.submit(r);await f.finish(r);
 f.promptState('missing');await f.complete(r);await s.tick();
 const report=s.flow.run(s.flow.root(r.humanRequestId).requestGraph.nodes[0].reportRunId);
 assert.equal(report.phase,'report');assert.equal(report.inputEnvelopeMode,undefined);assert.equal(report.runModel.state.reason,'startup-contract-migration-required');assert.equal(f.sent.length,1);
});

test('origin=result delivery containing pasted_content survives Claude wrapping and escaping',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];a.provider='claude';
 const root=await s.send(a.id,{instruction:'parent',requestId:randomUUID()});await f.submit(root);
 const child=await f.delegate(root,f.agents[2]),r=s.flow.run(child.currentRunId);await s.tick();await f.submit(r);await f.finish(r);
 const native=f.runtimes.get(r.agentId).turns.find(t=>t.id===r.turnId);
 Object.assign(native,{state:'completed',output:'child result <pasted_content>',finalOutput:'child result <pasted_content>',completionEvent:'done'});await s.tick();
 await f.complete(root);
 const q=s.flow.root(root.humanRequestId),delivery=s.flow.run(resultEntries(s.data,q)[0].deliveryRunId);
 assert.equal(delivery.origin,'result');assert.match(f.sent.at(-1).text,/<pasted_content>/);
 await f.submit(delivery,text=>'\n<pasted_content id="test">\n'+text.replaceAll('<pasted_content>','<\\pasted_content>')+'\n</pasted_content id="test">\n');
 assert.equal(receipt(delivery).acceptance,'accepted');assert.equal(s.flow.run(resultEntries(s.data,q)[0].deliveryRunId).runModel.state.kind,'running');

 await f.finish(delivery);await f.complete(delivery);assert.equal(testView(q).status,'completed');
});

for(const decision of ['retry','complete','cancel'])test('stage3 human review decision: '+decision,async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'review me',requestId:randomUUID()});await f.submit(r);await f.complete(r,'failed');
 let q=s.flow.root(r.humanRequestId);assert.equal(testView(q).needsReview,true);assert.equal(s.snapshot().recoveryRequests.length,1);
 if(decision==='retry'){
  const retry=await s.flow.continue({humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:randomUUID(),instruction:'human checked side effects'},true);await s.tick();await f.submit(retry);await f.complete(retry);assert.equal(testView(q).status,'completed');assert(q.requestGraph.nodes[0].decisions.some(d=>d.actor==='human'));assert.equal(testView(r).state,'failed');
 }else{
  if(decision==='cancel')s.data.agents=[];
  await s.flow[decision]({humanRequestId:q.id,revision:q.revision});assert.equal(testView(q).status,decision==='complete'?'completed':'cancelled');assert.equal(q.requestGraph.nodes[0].decisions.at(-1).actor,'human');
 }
 assert.equal(s.snapshot().recoveryRequests.length,0);
});
test('stage3 no finish needed, early/late claims are recorded, and acknowledge has been removed',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'short',requestId:randomUUID()});
 await f.finish(r);assert.equal(s.flow.root(r.humanRequestId).requestGraph.nodes[0].declarations.length,1);assert.equal(f.notifications.length,0);
 await f.submit(r);await f.restart();const current=f.service.flow.run(r.id);await f.complete(current);
 assert.equal(testView(f.service.flow.root(r.humanRequestId)).status,'completed');const before=JSON.stringify(f.service.flow.root(r.humanRequestId));
 assert.equal(f.service.flow.acknowledge,undefined);assert.equal(JSON.stringify(f.service.flow.root(r.humanRequestId)),before);
 await f.finish(current);await f.service.tick();assert.equal(f.notifications.length,1);
});
test('stage3 failures in delegated children require human review and cannot be hidden by a finish',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'delegate',requestId:randomUUID()});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await s.tick();const cr=s.flow.run(child.currentRunId);await f.submit(cr);await f.finish(r);await f.complete(r);
 assert.equal(testView(s.flow.root(r.humanRequestId)).status,'active');await f.complete(cr,'failed');const q=s.flow.root(r.humanRequestId);
 assert.equal(testView(q).needsReview,true);const delivery=s.flow.run(resultEntries(s.data,q)[0].deliveryRunId);await f.submit(delivery);await f.finish(delivery);await f.complete(delivery);
 assert.equal(testView(q).status,'active');assert.equal(f.notifications.length,0);assert.equal(s.snapshot().recoveryRequests.length,1);
});
test('human can retry failed result delivery without creating another child result',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'delegation',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const cr=s.flow.run(w.currentRunId);await f.submit(cr);await f.complete(r);await f.complete(cr);
 const q=s.flow.root(r.humanRequestId),delivery=s.flow.run(resultEntries(s.data,q)[0].deliveryRunId);await f.submit(delivery);await f.complete(delivery,'failed');
 const retry=await s.flow.continue({humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:randomUUID(),instruction:'human-reviewed result'},true);await s.tick();await f.submit(retry);await f.finish(retry);await f.complete(retry);
 assert.equal(testView(q).status,'completed');assert.equal(resultEntries(s.data,q).length,1);assert.equal(testView(delivery).state,'failed');assert.equal(retry.runModel.phase,'result');
});

test('human completion never hides a physically valid supplement; terminal requests stay terminal',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const q=s.flow.root(root.humanRequestId);await s.flow.complete({humanRequestId:q.id,revision:q.revision});
 assert.equal(testView(q).status,'completed');assert.equal(testView(s.agent(root.agentId)).canSteer,true);
 const r=await steer(f,root);assert.notEqual(r.humanRequestId,q.id);assert.equal(testView(q).status,'completed');await acceptSteer(f,r);await f.complete(r);assert.equal(testView(s.flow.root(r.humanRequestId)).status,'completed');
});

for(const nextTurn of [false,true])test('Claude steering keeps request, finish and report across '+(nextTurn?'next user turn':'queued command'),async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;s.agent(f.agents[0].id).provider='claude';
 const root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const r=await steer(f,root);assert.equal(r.humanRequestId,root.humanRequestId);assert.equal(r.steeringProvider,'claude');assert.equal(testView(s.agent(root.agentId)).canSteer,false);
 const n=f.runtimes.get(root.agentId);const prior=n.turns[0];
 if(nextTurn){n.cursor+=1;Object.assign(prior,{state:'completed',completionOffset:n.cursor,output:'original final'});}
 n.cursor+=10;const tid=nextTurn?'next-claude-turn':prior.id;
 if(nextTurn)n.turns.push({id:tid,state:'running',output:'',messageOffsets:true,messages:[]});
 n.inputs.push({id:'supplement-input',turnId:tid,offset:n.cursor,text:'\n<pasted_content id="steer">\n'+f.sent.at(-1).text+'\n</pasted_content id="steer">\n',explicitTurn:true,source:nextTurn?'claude-user':'claude-queued'});
 await s.tick();assert.equal(receipt(r).acceptance,'accepted');assert.equal(r.turnId,tid);await f.finish(r);n.cursor+=10;n.turns.find(t=>t.id===tid).completionOffset=n.cursor;await f.complete(r);await s.tick();
 const q=s.flow.root(root.humanRequestId),report=s.flow.run(q.requestGraph.nodes[0].reportRunId);assert.equal(report.phase,'report');await f.submit(report);assert.equal(testView(s.agent(root.agentId)).canSteer,false);await f.complete(report);await s.tick();
 assert.equal(testView(q).status,'completed');assert.equal(s.data.requests.length,1);assert.equal(f.notifications.length,1);
});

// Fail the real persistence boundary before file replacement, not the transport.
function failWrites(s,predicate){
 const write=s.store.write;let failures=0;
 s.store.write=async value=>{if(predicate(s.data)){failures++;throw Error('injected save failure');}return write(value);};
 return {restore(){s.store.write=write;},get failures(){return failures;}};
}
test('failed request admission cannot leak into a concurrent save or later tick; same ID retries once',async t=>{
 const f=await fixture(t),s=f.service,input={requestId:'save-failed-request',instruction:'once'};
 const fault=failWrites(s,d=>d.requests.some(q=>q.clientRequestId===input.requestId));
 await assert.rejects(s.send(f.agents[0].id,input),/injected/);
 await s.tick();assert.equal(s.data.requests.length,0);assert.equal(f.sent.length,0);
 fault.restore();const r=await s.send(f.agents[0].id,input);assert.equal((await s.send(f.agents[0].id,input)).id,r.id);
 await f.submit(r);await f.complete(r);assert.equal(f.sent.length,1);assert.equal(f.notifications.length,1);
});
test('failed delegate and finish roll back identity and declaration; identical operation IDs retry once',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{requestId:'save-parent-request',instruction:'parent'});await f.submit(r);
 const q=s.flow.root(r.humanRequestId),fault=failWrites(s,d=>d.requests[0].requestGraph.nodes.length>1);
 await assert.rejects(f.delegate(r,f.agents[2],'save-delegate-op'),/injected/);await s.tick();
 assert.equal(q.requestGraph.nodes.length,1);assert.equal(f.sent.length,1);
 fault.restore();const w=await f.delegate(r,f.agents[2],'save-delegate-op');assert.equal((await f.delegate(r,f.agents[2],'save-delegate-op')).id,w.id);
 const claim=failWrites(s,d=>d.requests[0].requestGraph.nodes.flatMap(n=>n.declarations).some(x=>x.id==='save-finish-op'));
 await assert.rejects(f.finish(r,'save-finish-op'),/injected/);assert.equal(q.requestGraph.nodes[0].declarations.length,0);
 claim.restore();await f.finish(r,'save-finish-op');await f.finish(r,'save-finish-op');
 assert.equal(q.requestGraph.nodes[0].declarations.length,1);await s.tick();assert.equal(f.sent.length,2);
});
test('failed steering leaves original owned run intact and cannot dispatch the rejected supplement',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{requestId:'save-steer-parent',instruction:'parent'});await f.submit(r);
 const before=JSON.stringify(r.runModel),fault=failWrites(s,d=>d.runs.some(r=>r.origin==='steering'));
 await assert.rejects(steer(f,r,'extra','save-steer-input'),/injected/);assert.equal(JSON.stringify(r.runModel),before);
 await s.tick();assert.equal(f.sent.length,1);assert.equal(s.data.runs.length,1);
 fault.restore();const extra=await steer(f,r,'extra','save-steer-input');assert.equal((await s.send(r.agentId,{requestId:'save-steer-input',instruction:'extra',steerTarget:extra.steerTarget})).id,extra.id);
 await acceptSteer(f,extra);await f.complete(extra);assert.equal(f.sent.length,2);assert.equal(f.notifications.length,1);
});
for(const phase of ['result','report'])test('failed '+phase+' creation is not dispatched until durable, then created once',async t=>{
 const f=await fixture(t,{reportMode:phase==='report'}),s=f.service,r=await s.send(f.agents[0].id,{requestId:'save-auto-'+phase,instruction:'parent'});await f.submit(r);
 if(phase==='result'){
  const w=await f.delegate(r,f.agents[2]);await s.tick();const child=s.flow.run(w.currentRunId);await f.submit(child);await f.complete(child);
 }
 const native=f.runtimes.get(r.agentId);Object.assign(native.turns.at(-1),{state:'completed',output:'done',finalOutput:'done'});
 await s.observe(s.agent(r.agentId));const count=f.sent.length;
 const fault=failWrites(s,d=>d.runs.some(r=>r.origin===phase));
 await assert.rejects(s.tick(),/injected/);await assert.rejects(s.tick(),/injected/);
 assert.equal(s.data.runs.filter(r=>r.origin===phase).length,0);assert.equal(f.sent.length,count);
 fault.restore();await s.tick();await s.tick();
 const deliveries=s.data.runs.filter(r=>r.origin===phase);assert.equal(deliveries.length,1);assert.equal(f.sent.length,count+1);
 await f.submit(deliveries[0]);if(phase==='result')await f.finish(deliveries[0]);await f.complete(deliveries[0]);
 assert.equal(f.notifications.length,1);
});
test('notification pre-send save failure retries; post-send save failure never replays even on restart',async t=>{
 for(const after of [false,true]){
  const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{requestId:'save-notify-'+after,instruction:'work'});await f.submit(r);
  const native=f.runtimes.get(r.agentId);Object.assign(native.turns.at(-1),{state:'completed',output:'done'});await s.observe(s.agent(r.agentId));await s.flow.settle();
  const q=s.flow.root(r.humanRequestId),fault=failWrites(s,d=>{const n=d.requests[0].notification?.status;return after?['sent','delivery_unknown'].includes(n):n==='attempting';});
  await assert.rejects(s.flow.notifications(),/injected/);
  assert.equal(q.notification.status,after?'attempting':'pending');assert.equal(f.notifications.length,after?1:0);
  fault.restore();await s.flow.notifications();assert.equal(f.notifications.length,1);
  await f.restart();await f.service.tick();assert.equal(f.notifications.length,1);
 }
});
for(const decision of ['complete','cancel'])test('failed human '+decision+' preserves revision and permits retry',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{requestId:'save-human-'+decision,instruction:'work'});await f.submit(r);await f.complete(r,'failed');
 const q=s.flow.root(r.humanRequestId),revision=q.revision,state=JSON.stringify(q.requestGraph.nodes[0]);
 const fault=failWrites(s,d=>d.requests[0].requestGraph.nodes.find(n=>n.id===d.requests[0].rootWorkId).state.kind!=='active');
 await assert.rejects(s.flow[decision]({humanRequestId:q.id,revision}),/injected/);
 assert.equal(q.revision,revision);assert.equal(JSON.stringify(q.requestGraph.nodes[0]),state);assert.equal(f.notifications.length,0);
 fault.restore();await s.flow[decision]({humanRequestId:q.id,revision});await s.tick();assert.equal(f.notifications.length,decision==='complete'?1:0);
});
test('a second writer cannot commit failed admission while the first disk write is pending',async t=>{
 const f=await fixture(t),s=f.service,write=s.store.write;let entered,release;
 const pending=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 s.store.write=async value=>{if(s.data.requests.some(q=>q.clientRequestId==='concurrent-failed')){entered();await gate;throw Error('injected save failure');}return write(value);};
 const failed=s.send(f.agents[0].id,{requestId:'concurrent-failed',instruction:'rejected'});
 const rejected=assert.rejects(failed,/injected/);await pending;
 const successful=s.putProject({name:'unrelated success',requestId:'unrelated-project'});
 release();await rejected;await successful;await s.tick();
 const disk=readPartitionSnapshot(f.options.dir);
 assert.equal(disk.requests.length,0);assert.equal(s.data.requests.length,0);assert.equal(f.sent.length,0);assert.equal(disk.projects.length,1);
});
test('post-dispatch save failure retains durable sent intent across restart without resending',async t=>{
 const f=await fixture(t),s=f.service,write=s.store.write;let dispatched=false;
 const remote=s.localRun;s.localRun=async(...args)=>{const result=await remote(...args);if(args[1]?.includes('send'))dispatched=true;return result;};
 s.store.write=async value=>{if(dispatched)throw Error('injected save failure');return write(value);};
 const input={requestId:'post-dispatch-failure',instruction:'only once'};
 const admitted=await s.send(f.agents[0].id,input);assert.equal(admitted,s.data.runs[0]);
 assert.equal(s.data.runs[0].runModel.state.kind,'sent');assert.equal(f.sent.length,1);
 s.store.write=write;await f.restart();const r=await f.service.send(f.agents[0].id,input);await f.service.tick();assert.equal(f.sent.length,1);
 await f.submit(r);await f.complete(r);assert.equal(f.notifications.length,1);
});
test('uncertain file replacement fences subsequent mutations instead of dispatching',async t=>{
 const f=await fixture(t),s=f.service,write=s.store.write;
 s.store.write=async value=>{await write(value);throw Object.assign(Error('directory sync failure'),{persistenceUncertain:true});};
 await assert.rejects(s.send(f.agents[0].id,{requestId:'uncertain-replacement',instruction:'work'}),/directory sync/);
 await assert.rejects(s.putProject({name:'must not write'}),/directory sync/);assert.equal(f.sent.length,0);
});
test('failed dispatch-intent save returns durable queued admission, not a false rejection',async t=>{
 const f=await fixture(t),s=f.service,input={requestId:'failed-dispatch-intent',instruction:'once'};
 const fault=failWrites(s,d=>d.runs.some(r=>r.runModel.state.kind==='sent'));
 const r=await s.send(f.agents[0].id,input);assert.equal(r.runModel.state.kind,'queued');assert.equal(f.sent.length,0);
 assert.equal((await s.send(f.agents[0].id,input)).id,r.id);fault.restore();await s.tick();await s.tick();assert.equal(f.sent.length,1);
});
test('notification cannot claim a completion that rolls back while it waits for persistence',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{requestId:'notify-concurrent-claim',instruction:'work'});await f.submit(r);await f.complete(r,'failed');
 const q=s.flow.root(r.humanRequestId),write=s.store.write;let entered,release;
 const pending=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 s.store.write=async value=>{if(s.data.requests[0].notification?.status==='pending'){entered();await gate;throw Error('injected save failure');}return write(value);};
 const failed=assert.rejects(s.flow.complete({humanRequestId:q.id,revision:q.revision}),/injected/);await pending;
 const notification=s.flow.notifications();release();await failed;await notification;assert.equal(f.notifications.length,0);assert.equal(q.notification,undefined);
});
test('real database write failure rolls back admission and retry dispatches once',async t=>{
 const f=await fixture(t),s=f.service;
 s.store.db.exec('PRAGMA query_only=ON');
 const input={requestId:'real-database-failure',instruction:'once'};
 await assert.rejects(s.send(f.agents[0].id,input),/readonly/);
 assert.equal(s.data.requests.length,0);assert.equal(f.sent.length,0);
 s.store.db.exec('PRAGMA query_only=OFF');
 const r=await s.send(f.agents[0].id,input);assert.equal((await s.send(f.agents[0].id,input)).id,r.id);assert.equal(f.sent.length,1);
});
test('nested successful claim remains durable when later report creation fails',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service,r=await s.send(f.agents[0].id,{requestId:'nested-save-claim',instruction:'work'});await f.submit(r);
 const native=f.runtimes.get(r.agentId);Object.assign(native.turns.at(-1),{state:'completed',output:'done'});await s.observe(s.agent(r.agentId));
 const q=s.flow.root(r.humanRequestId),fault=failWrites(s,d=>d.runs.some(r=>r.phase==='report'));
 await assert.rejects(f.finish(r,'durable-claim-op'),/injected/);
 assert.equal(q.requestGraph.nodes[0].declarations.filter(d=>d.id==='durable-claim-op').length,1);assert.equal(q.report,undefined);
 fault.restore();await f.finish(r,'durable-claim-op');await s.tick();assert.equal(s.data.runs.filter(r=>r.phase==='report').length,1);
});

for(const mode of ['startup-v2'])test('lean '+mode+' input fields and same-text requests stay distinct through report and restart',async t=>{
 const f=await fixture(t,{reportMode:true}),a=f.agents[0];a.projectId='project';a.inputEnvelope={mode,hash:inputHash(f.service.startupInstructions())};
 const r=await f.service.send(a.id,{instruction:'repeat',requestId:randomUUID()});
 const check=(r,text)=>{
  assert.doesNotMatch(text,/ai-village-input|ai-village-run-|"(?:parentWorkId|originAgentId|finalAgentId|workshopId|metadataRevision)"/);
  const own=JSON.parse(text.match(/<ai-village-discovery>(.*?)<\/ai-village-discovery>/s)[1]);
  assert.deepEqual(own,{agentId:a.id,role:'secretary',location:'mayor',projectId:'project'});
  const request=JSON.parse(text.match(/<ai-village-request>([^\n]*)/)[1].split('</ai-village-request>')[0]);
  assert.equal(request.contract,2);assert.equal(request.rulesRevision,f.service.rules.specification(r.phase==='report'?'report':'work').revision);assert.equal(request.runId,r.id);
  assert.equal(r.inputMarker,undefined);assert.equal(r.inputCorrelation.version,1);
 };
 check(r,f.sent.at(-1).text);await f.submit(r);await f.complete(r);
 const report=f.service.flow.run(f.service.flow.root(r.humanRequestId).requestGraph.nodes[0].reportRunId);
 check(report,f.sent.at(-1).text);await f.submit(report);await f.complete(report);
 const next=await f.service.send(a.id,{instruction:'repeat',requestId:randomUUID()});
 assert.notDeepEqual(next.inputCorrelation,r.inputCorrelation);
 await f.restart();await f.service.tick();assert.equal(receipt(f.service.flow.run(next.id)).acceptance,'pending');
 await f.submit(f.service.flow.run(next.id));await f.complete(f.service.flow.run(next.id));
});

test('old installed contracts require migration after upgrade; previously dispatched marker runs still complete',async t=>{
 const f=await fixture(t),a=f.agents[0],r=await f.service.send(a.id,{instruction:'legacy in flight',requestId:randomUUID()});
 // Persist the pre-upgrade contract, then boot the new service without resending.
 delete r.inputCorrelation;r.inputMarker='ai-village-run-'+r.id;
 a.inputEnvelope={mode:'startup-v2',hash:inputHash('previous rules')};await f.service.save();
 await f.restart();const s=f.service,restored=s.flow.run(r.id),native=f.runtimes.get(a.id);
 assert.equal(s.agent(a.id).inputEnvelope.mode,'migration-required');assert.equal(s.agent(a.id).inputEnvelope.reason,'startup-contract-upgrade-required');
 native.cursor+=10;native.inputs.push({id:'old-input',turnId:'old-turn',offset:native.cursor,text:'old body '+r.inputMarker});
 native.turns.push({id:'old-turn',state:'completed',output:'old result',completionOffset:native.cursor+1});
 await s.tick();assert.equal(testView(restored).state,'completed');assert.equal(f.sent.length,1);
 const next=await s.send(a.id,{instruction:'new input',requestId:randomUUID()});
 assert.equal(next.inputEnvelopeMode,undefined);assert.equal(f.sent.length,1);assert.equal(next.runModel.state.reason,'startup-contract-migration-required');
});

test('unified nested requests require their own finish and direct dependency handling',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'nested',requestId:randomUUID()});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(child.currentRunId);await f.submit(c);
 const grand=await f.delegate(c,f.agents[3]);await s.tick();const g=s.flow.run(grand.currentRunId);await f.submit(g);await f.complete(g);
 const q=s.flow.root(r.humanRequestId);assert.equal(s.flow.results(q.id,r.workId).length,0);
 await f.finish(c);await f.complete(c);assert.equal(s.flow.results(q.id,r.workId).length,1);assert.equal(f.notifications.length,0);
 await f.finish(r);await f.complete(r);assert.equal(testView(q).status,'completed');assert(q.requestGraph.nodes.every(n=>n.state.kind==='completed'));assert.equal(f.notifications.length,1);
 const disk=readPartitionSnapshot(f.options.dir);assert.equal(disk.requests[0].requestModel,undefined);assert(disk.requests[0].requestGraph.nodes.every(n=>!('runs' in n)));
});
test('partial responses reject foreign/stale versions and leave other child results for delivery',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'parallel',requestId:randomUUID()});await f.submit(r);
 const children=await Promise.all([f.delegate(r,f.agents[2]),f.delegate(r,f.agents[3])]);await s.tick();
 for(const w of children){const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);}
 const q=s.flow.root(r.humanRequestId),[first,second]=s.flow.results(q.id,r.workId),ref={requestId:first.workId,resultId:first.id,version:first.version,decision:'accept'},payload={humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[ref]};
 await assert.rejects(s.flow.respond({...payload,results:[{...ref,version:999}]}),/stale-or-foreign/);
 await assert.rejects(s.flow.respond({...payload,results:[{...ref,requestId:r.workId}]}),/stale-or-foreign/);
 await s.flow.respond(payload);await s.flow.respond(payload);await assert.rejects(s.flow.respond({...payload,results:[]}),/再利用/);
 await s.flow.finish({humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[]});await f.complete(r);
 assert(!s.flow.results(q.id,r.workId).find(e=>e.id===first.id).deliveryRunId);
 const delivery=s.flow.run(s.flow.results(q.id,r.workId).find(e=>e.id===second.id).deliveryRunId);assert(delivery);await f.submit(delivery);await f.finish(delivery);await f.complete(delivery);assert.equal(testView(q).status,'completed');assert.equal(f.notifications.length,1);
});
test('explicit failed-result acceptance records judgment without changing native failure',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'failure decision',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c,'failed');
 const q=s.flow.root(r.humanRequestId),e=s.flow.results(q.id,r.workId)[0];
 await s.flow.finish({humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[{requestId:w.id,resultId:e.id,version:e.version,decision:'accept'}]});
 await f.complete(r);assert.equal(testView(q).status,'completed');assert.equal(c.runModel.state.outcome,'failed');assert.equal(q.requestGraph.nodes.find(n=>n.id===w.id).state.by,'agent');assert.equal(f.notifications.length,1);
});
test('result response save failure rolls back consumption; a new version cannot be consumed by an old reference',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'versions',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c,'failed');
 const q=s.flow.root(r.humanRequestId),e=s.flow.results(q.id,r.workId)[0],payload={humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[{requestId:w.id,resultId:e.id,version:e.version,decision:'accept'}]};
 const write=s.store.write;s.store.write=async()=>{throw Error('disk failure');};await assert.rejects(s.flow.respond(payload),/disk failure/);s.store.write=write;assert.equal(s.flow.results(q.id,r.workId)[0].handled,false);
 const retried=await s.flow.continue({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'retry'},true);await s.tick();await f.submit(retried);await f.complete(retried);
 await assert.rejects(s.flow.respond(payload),/stale-or-foreign/);const entries=s.flow.results(q.id,r.workId);assert.equal(entries.length,2);assert.equal(entries[1].version,2);assert.equal(entries[0].superseded,true);
});
test('human retry can reassign a child while preserving past run ownership across restart',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'handoff',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c,'failed');const q=s.flow.root(r.humanRequestId);
 const next=await s.flow.continue({humanRequestId:q.id,workId:w.id,agentId:f.agents[3].id,revision:q.revision,operationId:randomUUID(),instruction:'continue elsewhere'},true);await s.tick();await f.submit(next);await f.complete(next);assert.equal(c.agentId,f.agents[2].id);assert.equal(next.agentId,f.agents[3].id);
 await f.restart();assert(!f.service.flow.root(q.id).integrity);await f.service.tick();assert.equal(f.sent.filter(x=>x.agentId===f.agents[3].id).length,1);
});

test('rework delegation replaces an unresolved dependency and retains the rejected result history',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'rework',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);
 const q=s.flow.root(r.humanRequestId),e=s.flow.results(q.id,r.workId)[0],ops=new VillageOperations({dir:f.options.dir},null,{direct:s});
 const response={humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[{requestId:w.id,resultId:e.id,version:e.version,decision:'rework'}]};
 assert.equal((await ops.execute(['requests','respond',JSON.stringify(response)])).ok,true);
 const next=await s.flow.delegate({humanRequestId:q.id,parentWorkId:r.workId,actorRunId:r.id,agentId:f.agents[2].id,operationId:randomUUID(),instruction:'Fix the result',replacesRequestId:w.id});await s.tick();const cr=s.flow.run(next.currentRunId);await f.submit(cr);await f.complete(cr);
 await f.finish(r);await f.complete(r);assert.equal(testView(q).status,'completed');assert.equal(q.requestGraph.nodes.find(n=>n.id===w.id).state.kind,'withdrawn');assert.equal(c.runModel.state.outcome,'normal');assert.equal(f.notifications.length,1);
});
test('cancelling an unsent child withdraws that dependency, not the root request',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'cancel child',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]),c=s.flow.run(w.currentRunId),q=s.flow.root(r.humanRequestId);
 await s.flow.cancelQueued({agentId:c.agentId,humanRequestId:q.id,runId:c.id});assert.equal(testView(q).status,'active');assert.equal(q.requestGraph.nodes.find(n=>n.id===w.id).state.kind,'withdrawn');await s.flow.respond({humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:s.flow.results(q.id,r.workId).map(e=>({requestId:e.requestId,resultId:e.id,version:e.version,decision:'accept'}))});await f.finish(r);await f.complete(r);assert.equal(testView(q).status,'completed');assert.equal(f.sent.length,1);
});
test('explicit handling wins a queued delivery reservation atomically and never rewrites sent attempts',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'reservation race',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(r);
 const dispatch=s.attemptRun.bind(s);s.attemptRun=async run=>run.origin==='result'?run:dispatch(run);await f.complete(c);
 const q=s.flow.root(r.humanRequestId),e=s.flow.results(q.id,r.workId)[0],delivery=s.flow.run(e.deliveryRunId);assert.equal(delivery.runModel.state.kind,'queued');
 const payload={humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[{requestId:w.id,resultId:e.id,version:e.version,decision:'accept'}]};
 const write=s.store.write;s.store.write=async()=>{throw Error('reservation save failure');};await assert.rejects(s.flow.respond(payload),/reservation save failure/);s.store.write=write;assert.equal(delivery.runModel.state.kind,'queued');assert.equal(s.flow.work(q,r.workId).currentRunId,delivery.id);
 await s.flow.respond(payload);assert.equal(delivery.runModel.state.kind,'cancelled');assert.equal(delivery.runModel.decisions.at(-1).actor,'program');await f.finish(r);assert.equal(testView(q).status,'completed');assert.equal(f.sent.length,2);
 await f.restart();await f.service.tick();assert.equal(f.sent.length,2);assert.equal(f.service.flow.run(delivery.id).runModel.state.kind,'cancelled');
});
test('legacy in-flight parent and child migrate with exact input ownership and later finish without replay',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'migration in progress',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);
 const source=structuredClone(s.data);for(const q of source.requests){Object.assign(q,compatibilityDTO(s.data,s.flow.root(q.id)));delete q.requestGraph;}delete source.unifiedRequestVersion;
 f.service.close();await rm(join(f.options.dir,'village.sqlite'),{force:true});await writeFile(join(f.options.dir,'direct.json'),JSON.stringify(source));await rm(join(f.options.dir,'direct.pre-unified-requests-v3.json'),{force:true});const sends=f.sent.length;
 await f.restart();assert.equal(f.sent.length,sends);const next=f.service,parent=next.flow.run(r.id),child=next.flow.run(c.id);assert.deepEqual(parent.inputCorrelation,r.inputCorrelation);assert.deepEqual(child.runModel,c.runModel);
 await f.complete(child);await f.finish(parent);await f.complete(parent);assert.equal(testView(next.flow.root(r.humanRequestId)).status,'completed');assert.equal(f.sent.length,sends);assert.equal(f.notifications.length,1);
 await f.restart();await f.service.tick();assert.equal(f.notifications.length,1);assert.equal(f.sent.length,sends);
});
test('a newer child attempt retires only the obsolete unsent delivery reservation',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'new result version',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(r);
 const dispatch=s.attemptRun.bind(s);s.attemptRun=async run=>run.origin==='result'?run:dispatch(run);await f.complete(c,'failed');
 const q=s.flow.root(r.humanRequestId),old=s.flow.run(s.flow.results(q.id,r.workId)[0].deliveryRunId);assert.equal(old.runModel.state.kind,'queued');
 const retry=await s.flow.continue({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),instruction:'retry child'},true);await s.tick();assert.equal(old.runModel.state.kind,'cancelled');assert.equal(old.runModel.decisions.at(-1).reason,'result-superseded-before-dispatch');
 await f.submit(retry);await f.complete(retry);const result=s.flow.results(q.id,r.workId).find(e=>e.id===retry.id);assert.equal(result.version,2);assert.notEqual(result.deliveryRunId,old.id);assert.equal(s.flow.run(result.deliveryRunId).runModel.state.kind,'queued');assert.equal(f.sent.filter(e=>e.agentId===r.agentId).length,1);
});

async function loseObservedRun(f,r){
 changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'turn-ended-without-marker'});
 const native=f.runtimes.get(r.agentId);native.turns=[];await f.service.save();await f.service.tick();
}
for(const action of ['respond','finish','migrated-finish'])for(const outcome of ['failed','interrupted','terminated'])test(`pending ${action} survives restart without handling after ${outcome}`,async t=>{
 const f=await fixture(t);let s=f.service,r=await s.send(f.agents[0].id,{instruction:'declaration is not completion',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);
 const qid=r.humanRequestId,ref=s.flow.results(qid,r.workId)[0],payload={humanRequestId:qid,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[{requestId:w.id,resultId:ref.id,version:ref.version,decision:'accept'}]};
 const method=action==='respond'?'respond':'finish';await s.flow[method](payload);assert.equal(s.flow.results(qid,r.workId)[0].handled,false);
 if(action==='migrated-finish'){
  const source=structuredClone(s.data);source.unifiedRequestVersion=2;
  for(const q of source.requests){q.works=compatibilityDTO(s.data,s.flow.root(q.id)).works;q.requestGraph.version=2;for(const n of q.requestGraph.nodes){delete n.metadata;for(const claim of n.claims)claim.legacy=true;}}
  await rm(join(f.options.dir,'direct.pre-unified-requests-v3.json'),{force:true});f.service.close();await rm(join(f.options.dir,'village.sqlite'),{force:true});await writeFile(join(f.options.dir,'direct.json'),JSON.stringify(source));
 }
 s=await f.restart();r=s.flow.run(r.id);assert.equal(s.flow.results(qid,r.workId)[0].handled,false);
 if(outcome==='terminated')await loseObservedRun(f,r);else await f.complete(r,outcome);assert.equal(s.flow.results(qid,r.workId)[0].handled,false);assert.equal(s.flow.root(qid).requestGraph.nodes.find(n=>n.id===w.id).state.kind,'submitted');
 s=await f.restart();await s.tick();assert.equal(s.flow.results(qid,r.workId)[0].handled,false);
 const delivery=s.flow.run(s.flow.results(qid,r.workId)[0].deliveryRunId);assert(delivery);await f.submit(delivery);await f.finish(delivery);await loseObservedRun(f,delivery);
 const sends=f.sent.length;s=await f.restart();await s.tick();await s.tick();assert.equal(f.sent.length,sends);assert.equal(s.flow.results(qid,r.workId)[0].handled,false);assert.equal(f.notifications.length,0);
 const retry=await s.flow.continue({humanRequestId:qid,workId:r.workId,revision:s.flow.root(qid).revision,operationId:randomUUID(),instruction:'human explicitly authorizes recovery'},true);await s.tick();await f.submit(retry);await f.finish(retry);await f.complete(retry);assert.equal(s.flow.results(qid,r.workId)[0].handled,true);assert.equal(testView(s.flow.root(qid)).status,'completed');
});
test('confirmation save failure rolls back handling and completion; restart reconfirms native facts once',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'atomic confirmation',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);await f.finish(r);
 const fault=failWrites(s,d=>d.requests[0].requestGraph.nodes.some(n=>n.handling.length));
 await assert.rejects(f.complete(r),/injected/);assert.equal(s.flow.results(r.humanRequestId,r.workId)[0].handled,false);assert.equal(f.notifications.length,0);
 fault.restore();await f.restart();await f.service.tick();assert.equal(f.service.flow.results(r.humanRequestId,r.workId)[0].handled,true);assert.equal(f.notifications.length,1);
 await f.restart();await f.service.tick();assert.equal(f.notifications.length,1);
});
test('cancelled supplement preserves invalidation across restart and needs a fresh finish',async t=>{
 const f=await fixture(t);let s=f.service;const r=await s.send(f.agents[0].id,{instruction:'cancel supplement',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);await f.finish(r);
 const dispatch=s.attemptRun.bind(s);s.attemptRun=async run=>run.origin==='steering'?run:dispatch(run);
 const supplement=await steer(f,r,'new direction');
 await s.flow.cancelQueued({agentId:r.agentId,humanRequestId:r.humanRequestId,runId:supplement.id});s=await f.restart();await f.complete(s.flow.run(r.id));
 assert.equal(s.flow.results(r.humanRequestId,r.workId)[0].handled,false);assert.equal(f.notifications.length,0);
});

test('v1 pending-response restart upgrades before integrity validation and preserves pending evidence',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'v1 upgrade',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);await f.finish(r);
 const source=structuredClone(s.data);source.unifiedRequestVersion=1;source.requests[0].works=compatibilityDTO(s.data,s.data.requests[0]).works;const graph=source.requests[0].requestGraph;graph.version=1;
 for(const n of graph.nodes){n.handling.push(...n.claims.map(({legacy,invalidated,...claim})=>claim));delete n.claims;delete n.replacements;delete n.invalidatedRuns;}
 graph.nodes[1].state={kind:'completed',by:'agent',reason:'result-accepted:'+c.id};
 f.service.close();await rm(join(f.options.dir,'village.sqlite'),{force:true});await writeFile(join(f.options.dir,'direct.json'),JSON.stringify(source));await rm(join(f.options.dir,'direct.pre-unified-requests-v3.json'),{force:true});
 const restarted=await f.restart(),q=restarted.flow.root(r.humanRequestId);assert.equal(q.integrity,undefined);assert.equal(restarted.data.unifiedRequestVersion,3);assert.equal(restarted.flow.results(q.id,r.workId)[0].handled,false);assert.equal(q.requestGraph.nodes[0].claims.length,1);assert.equal(f.sent.length,2);
 await f.restart();assert.equal(f.service.flow.root(q.id).integrity,undefined);
});
test('failed rework reservation preserves both dependencies and a later valid run can explicitly adopt it',async t=>{
 const f=await fixture(t);let s=f.service;const r=await s.send(f.agents[0].id,{instruction:'rework confirmation',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);const e=s.flow.results(r.humanRequestId,r.workId)[0];
 const ref={requestId:w.id,resultId:e.id,version:e.version,decision:'rework'};
 await s.flow.respond({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[ref]});
 const next=await s.flow.delegate({humanRequestId:r.humanRequestId,parentWorkId:r.workId,actorRunId:r.id,agentId:f.agents[2].id,operationId:randomUUID(),instruction:'Fix it',replacesRequestId:w.id});await s.tick();const cr=s.flow.run(next.currentRunId);await f.submit(cr);
 await f.complete(r,'failed');s=await f.restart();let q=s.flow.root(r.humanRequestId);assert.equal(q.requestGraph.nodes.find(n=>n.id===w.id).replacementId,undefined);
 const delivery=s.flow.run(s.flow.results(q.id,r.workId)[0].deliveryRunId);await f.submit(delivery);await s.flow.respond({humanRequestId:q.id,workId:r.workId,runId:delivery.id,operationId:randomUUID(),results:[ref]});await f.complete(delivery);
 assert.equal(q.requestGraph.nodes.find(n=>n.id===w.id).replacementId,next.id);assert.equal(testView(q).status,'active');assert.equal(f.notifications.length,0);
 await f.restart();q=f.service.flow.root(q.id);assert.equal(q.integrity,undefined);assert.equal(q.requestGraph.nodes.find(n=>n.id===w.id).replacementId,next.id);
});

test('results contract rejects stale clients without observation or mutation; outbound DTO cannot own core state',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'contract',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c);
 const q=s.flow.root(r.humanRequestId),payload={humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID()},before=JSON.stringify(s.data),disk=await readFile(join(f.options.dir,'direct.json'),'utf8');
 const observe=s.observe;s.observe=()=>{throw Error('must not observe rejected input');};
 for(const method of ['respond','finish'])await assert.rejects(s.flow[method](payload),/results/);
 s.observe=observe;assert.equal(JSON.stringify(s.data),before);assert.equal(await readFile(join(f.options.dir,'direct.json'),'utf8'),disk);
 const dto=s.flow.get(q.id);dto.works[0].agentId='forged';dto.works[0].runIds.push('fake');dto.requestModel.state={kind:'completed'};
 assert.equal(JSON.stringify(s.data),before);assert(!Object.hasOwn(q,'works'));assert(!Object.hasOwn(q,'requestModel'));
 await s.flow.finish({...payload,results:[]});await assert.rejects(s.flow.finish(payload),/results/);await f.complete(r);
 assert.equal(testView(q).status,'active');assert.equal(s.flow.results(q.id,r.workId)[0].handled,false);
});

for(const implicit of [true,false])test(`saved v2 failed-result declaration preserves ${implicit?'implicit review':'explicit acceptance'} and operation replay`,async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'old client',requestId:randomUUID()});await f.submit(r);
 const w=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(w.currentRunId);await f.submit(c);await f.complete(c,'failed');
 const q=s.flow.root(r.humanRequestId),ref=s.flow.results(q.id,r.workId)[0],payload={humanRequestId:q.id,workId:r.workId,runId:r.id,operationId:randomUUID(),results:[{requestId:w.id,resultId:ref.id,version:ref.version,decision:'accept'}]};
 await s.flow.finish(payload);
 const source=structuredClone(s.data);source.unifiedRequestVersion=2;
 for(const old of source.requests){old.works=compatibilityDTO(s.data,q).works;old.requestGraph.version=2;for(const n of old.requestGraph.nodes){delete n.metadata;for(const claim of n.claims)claim.legacy=implicit;}}
 await rm(join(f.options.dir,'direct.pre-unified-requests-v3.json'),{force:true});f.service.close();await rm(join(f.options.dir,'village.sqlite'),{force:true});await writeFile(join(f.options.dir,'direct.json'),JSON.stringify(source));
 await f.restart();const next=f.service,nq=next.flow.root(q.id),before=JSON.stringify(next.data);const {results,...omitted}=payload;
 await next.flow.finish(omitted);await next.flow.finish(payload);assert.equal(JSON.stringify(next.data),before);
 assert.equal(nq.requestGraph.nodes[0].claims[0].decision,implicit?'review':'accept');assert(!JSON.stringify(nq.requestGraph).includes('"legacy"'));
 await assert.rejects(next.flow.finish({...omitted,operationId:randomUUID()}),/results/);
 await f.complete(next.flow.run(r.id));assert.equal(next.flow.results(q.id,r.workId)[0].handled,true);assert.equal(nq.requestGraph.nodes.find(n=>n.id===w.id).state.kind,implicit?'active':'completed');assert.equal(testView(nq).status,implicit?'active':'completed');
 await f.restart();assert.equal(f.service.flow.root(q.id).integrity,undefined);
});


test('API projection and restart keep parent and child waiting for a running grandchild out of recovery',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'nested waiting',requestId:'normal-nested-wait'});await f.submit(r);
 const c=await f.delegate(r,f.agents[2]);await s.tick();const cr=s.flow.run(c.currentRunId);await f.submit(cr);
 const gc=await f.delegate(cr,f.agents[3]);await s.tick();await f.submit(s.flow.run(gc.currentRunId));
 await f.complete(cr);await f.complete(r);
 for(const service of [s,await f.restart()]){
  const q=service.flow.get(r.humanRequestId);assert.equal(q.needsReview,false);assert.equal(q.waiting[r.workId],'dependencies');assert.equal(q.waiting[c.id],'dependencies');
  assert(q.requestGraph.nodes.every(n=>n.state.kind==='active'&&n.state.review.length===0));assert.equal(f.notifications.length,0);
 }
});
