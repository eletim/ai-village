import {verifyInstructionsScript} from '../server/input-envelope.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DirectAgents} from '../server/direct.mjs';
import {inputHash} from '../server/runtime-events.mjs';
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
  if(args[2]==='status')return JSON.stringify({alive:true,cliState:native.turns.at(-1)?.state==='running'?'busy':'idle',agentSessionId:'session-'+agent});
  if(args[2]==='send'){sent.push({agentId:agent,text:args.at(-1),transport:host?'ssh':'local'});if(lose)throw Error('response lost');return '{"status":"sent"}';}
  throw Error('unexpected '+args.slice(0,4));
 };
 const options={dir,remote:execute,localRun:(cmd,args)=>execute([cmd,...args]),notifier:{status:()=>({}),enqueue:async message=>{notifications.push(message);return {status:'sent'};}}};
 let service=new DirectAgents(options);await service.init({watch:false});await service.flow.configureReport(reportMode);
 const agents=Array.from({length:4},(_,i)=>({id:randomUUID(),name:i<2?'Secretary '+i:'Worker '+i,location:i<2?'mayor':'workshop',workshopId:'w'+i,connection:{connectionType:i===3?'ssh':'local',sshHost:i===3?'remote':null,name:'PC'+i},workspaceId:'',tabId:'tab'+i,sessionName:'pane'+i,provider:'codex',state:'idle'}));
 for(const a of agents){a.workspaceId='ws-'+a.id;service.data.agents.push(a);runtimes.set(a.id,{available:true,sessionId:'session-'+a.id,fileIdentity:'file-'+a.id,cursor:0,inputs:[],turns:[]});}
 await service.save();await service.tick();
 const submit=async(r,transform=x=>x)=>{
  const native=runtimes.get(r.agentId),text=sent.findLast(s=>s.agentId===r.agentId)?.text;
  assert.equal(inputHash(text),r.inputHash);const tid=randomUUID();native.cursor+=10;
  native.inputs.push({id:'input-'+tid,turnId:tid,hash:inputHash(transform(text)),offset:native.cursor,text:transform(text)});
  native.turns.push({id:tid,state:'running',output:''});await service.tick();assert.equal(r.acceptance,'accepted');return tid;
 };
 const complete=async(r,outcome='completed')=>{const native=runtimes.get(r.agentId);Object.assign(native.turns.find(t=>t.id===r.turnId),{state:outcome,output:'Output '+r.id,finalOutput:'Final '+r.id,completionEvent:'event-'+r.id});await service.tick();};
 const finish=async(r,op=randomUUID())=>service.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,revision:service.flow.root(r.humanRequestId).revision,operationId:op});
 const delegate=async(r,target,op=randomUUID())=>service.flow.delegate({humanRequestId:r.humanRequestId,parentWorkId:r.workId,actorRunId:r.id,agentId:target.id,instruction:'Child work '+op,operationId:op});
 const restart=async()=>{service.close();service=new DirectAgents(options);await service.init({watch:false});return service;};
 return {get service(){return service;},options,agents,runtimes,sent,notifications,promptState:v=>promptState=v,promptChecks:()=>promptChecks,submit,complete,finish,delegate,restart,offline:v=>offline=v,lose:v=>lose=v};
}
test('intermediate 0, multiple child completions 0, final native report 1, duplicate events 1; inbox waits for busy secretary',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{instruction:'Human request',requestId:'human-request-1'});
 assert.equal(root.acceptance,'pending');assert.equal(root.state,'awaiting_input');await f.submit(root);
 assert.match(f.sent[0].text,/requests finish/);assert.match(f.sent[0].text,new RegExp(root.humanRequestId));
 const children=await Promise.all([f.delegate(root,f.agents[2]),f.delegate(root,f.agents[3])]);await s.tick();
 for(const child of children){const r=s.flow.run(child.currentRunId);await f.submit(r);await f.finish(r);await f.complete(r);}
 assert.equal(f.notifications.length,0);const q=s.flow.root(root.humanRequestId);
 assert.equal(q.inbox.length,2);assert(q.inbox.every(e=>e.state==='queued'));assert.equal(f.sent.filter(x=>x.agentId===root.agentId).length,1);
 await assert.rejects(f.finish(root),/最新結果未確認/);
 await f.complete(root);assert.equal(f.notifications.length,0);assert.equal(q.status,'active');
 const delivery=s.flow.run(q.inbox[0].deliveryRunId);assert(delivery);assert.equal(delivery.origin,'result');assert.equal(delivery.humanRequestId,root.humanRequestId);
 assert.equal(q.inbox[0].state,'dispatching');assert.equal(delivery.acceptance,'pending');await s.tick();assert.equal(q.inbox[0].state,'dispatching');
 await assert.rejects(s.flow.acknowledge({humanRequestId:q.id,workId:root.workId,actorRunId:delivery.id,resultIds:q.inbox.map(e=>e.id)}),/受付をまだ/);
 await f.submit(delivery);assert.equal(q.inbox[0].state,'accepted');
 const results=s.flow.results(q.id,root.workId);assert.equal(results.length,2);assert(results.every(e=>e.output.startsWith('Output')));
 await s.flow.acknowledge({humanRequestId:q.id,workId:root.workId,actorRunId:delivery.id,resultIds:results.map(e=>e.id)});
 assert.equal(f.notifications.length,0);const op=randomUUID();await f.finish(delivery,op);await f.finish(delivery,op);
 assert.equal(q.status,'finalizing');assert.equal(f.notifications.length,0);
 await f.complete(delivery);assert.equal(q.status,'completed');assert.equal(q.ticket.state,'consumed');assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].agentId,root.agentId);assert.equal(f.notifications[0].content,'依頼全体が完了しました。\nFinal '+delivery.id);
 await Promise.all([s.tick(),s.tick(),f.finish(delivery,op)]);assert.equal(f.notifications.length,1);assert.equal(s.data.requests.length,1);
 assert.equal(s.snapshot().reviews[root.agentId].attention,true);assert.equal(s.snapshot().reviews[f.agents[2].id].attention,false);
 const restored=await f.restart();await restored.tick();assert.equal(f.notifications.length,1);
 assert(f.sent.some(x=>x.transport==='ssh'));assert(f.sent.some(x=>x.transport==='local'));
});
test('successful send response with text still in input box never accepts, finalizes, resends or notifies',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'buffered',requestId:'human-buffered'});
 for(let i=0;i<3;i++)await s.tick();
 assert.equal(r.state,'awaiting_input');assert.equal(r.acceptance,'pending');assert.equal(f.sent.length,1);
 await assert.rejects(f.finish(r),/受付をまだ/);
 const restored=await f.restart();await restored.tick();assert.equal(restored.flow.run(r.id).acceptance,'pending');assert.equal(f.sent.length,1);assert.equal(f.notifications.length,0);
 // A later actual Enter produces matching native input; then (and only then) accepted.
 const current=restored.flow.run(r.id);await f.submit(current);assert.equal(current.acceptance,'accepted');await f.finish(current);await f.complete(current);assert.equal(f.notifications.length,1);
});
test('lost transport response reconciles by exact native input without resending',async t=>{
 const f=await fixture(t);f.lose(true);const r=await f.service.send(f.agents[2].id,{instruction:'Direct human',requestId:'human-worker'});
 assert.equal(r.state,'send_unknown');assert.equal(r.acceptance,'pending');await f.submit(r);await f.finish(r);await f.complete(r);
 assert.equal(f.sent.length,1);assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].agentId,f.agents[2].id);
});
test('failure, retry, interrupted finalization and cancellation do not consume a success ticket',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'work',requestId:'human-failures'});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await s.tick();const cr=s.flow.run(child.currentRunId);await f.submit(cr);await f.complete(cr,'failed');
 const q=s.flow.root(r.humanRequestId);assert.equal(q.works[1].state,'failed');assert.equal(q.inbox[0].outcome,'failed');assert.equal(q.ticket.state,'available');
 await s.flow.acknowledge({humanRequestId:q.id,workId:r.workId,actorRunId:r.id,resultIds:[q.inbox[0].id]});await assert.rejects(f.finish(r),/未完了/);
 const retry=await s.flow.continue({humanRequestId:q.id,workId:child.id,actorRunId:r.id,revision:q.revision,operationId:'retry-child-one',instruction:'Try again'},true);await s.tick();await f.submit(retry);await f.finish(retry);await f.complete(retry);
 const event=q.inbox.find(e=>e.resultRunId===retry.id);assert(event);assert.equal(q.inbox[0].superseded,true);await s.flow.acknowledge({humanRequestId:q.id,workId:r.workId,actorRunId:r.id,resultIds:[event.id]});
 await f.finish(r);await f.complete(r,'interrupted');assert.equal(q.status,'active');assert.equal(q.ticket.state,'available');assert.equal(f.notifications.length,0);
 await s.flow.cancel({humanRequestId:q.id,revision:q.revision});await s.tick();assert.equal(q.ticket.state,'cancelled');assert.equal(f.notifications.length,0);
 await assert.rejects(s.flow.delegate({humanRequestId:q.id,parentWorkId:r.workId,actorRunId:r.id,agentId:f.agents[3].id,instruction:'no',operationId:'after-cancel'}),/受付中では/);
});
test('an acknowledged child terminated before dispatch (its agent was stopped) never blocks parent finish once a successor child completes',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'work',requestId:'human-terminated-child'});await f.submit(r);
 const stale=await f.delegate(r,f.agents[2]);f.agents[2].state='terminated';await s.tick();await s.tick();
 const q=s.flow.root(r.humanRequestId),staleRun=s.flow.run(stale.currentRunId);
 assert.equal(staleRun.state,'terminated');assert.equal(staleRun.error,'target-unavailable-before-dispatch');
 assert.equal(q.works.find(w=>w.id===stale.id).state,'terminated');assert.equal(q.inbox[0].outcome,'terminated');
 // Unacknowledged, it still blocks exactly like a real pending/failed child would.
 await assert.rejects(f.finish(r),/未完了/);
 await s.flow.acknowledge({humanRequestId:q.id,workId:r.workId,actorRunId:r.id,resultIds:[q.inbox[0].id]});
 const redo=await f.delegate(r,f.agents[3]);await s.tick();const redoRun=s.flow.run(redo.currentRunId);
 // A second, still-active child keeps blocking even though the acknowledged terminated one no longer does.
 await assert.rejects(f.finish(r),/未完了/);
 await f.submit(redoRun);await f.finish(redoRun);await f.complete(redoRun);
 const redoEvent=q.inbox.find(e=>e.workId===redo.id);await s.flow.acknowledge({humanRequestId:q.id,workId:r.workId,actorRunId:r.id,resultIds:[redoEvent.id]});
 await f.finish(r);await f.complete(r);assert.equal(q.status,'completed');assert.equal(q.ticket.state,'consumed');
});
test('multiple human requests and secretaries keep exact ownership; nested delegation remains attached',async t=>{
 const f=await fixture(t),s=f.service,a=await s.send(f.agents[0].id,{instruction:'A',requestId:'request-owner-a'}),b=await s.send(f.agents[1].id,{instruction:'B',requestId:'request-owner-b'});
 await f.submit(a);await f.submit(b);const wa=await f.delegate(a,f.agents[2]);await s.tick();const ca=s.flow.run(wa.currentRunId);await f.submit(ca);const wb=await f.delegate(ca,f.agents[3]);await s.tick();const cb=s.flow.run(wb.currentRunId);await f.submit(cb);await f.finish(cb);await f.complete(cb);
 const qa=s.flow.root(a.humanRequestId),qb=s.flow.root(b.humanRequestId);assert.equal(qa.inbox[0].recipientAgentId,ca.agentId);assert.equal(qb.inbox.length,0);
 await assert.rejects(s.flow.acknowledge({humanRequestId:qb.id,workId:b.workId,actorRunId:b.id,resultIds:[qa.inbox[0].id]}),/この作業の結果では/);
 await assert.rejects(s.flow.finish({humanRequestId:qa.id,workId:a.workId,runId:b.id,revision:qa.revision,operationId:'wrong-owner'}),/現在の作業run/);
 await f.finish(b);await f.complete(b);assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].agentId,b.agentId);assert.equal(qa.status,'active');
});
test('final attention uses request completion revision, not prior viewed native output; stale view cannot clear it',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'simple',requestId:'request-attention'});await f.submit(r);await f.complete(r);
 const old=s.snapshot().reviews[r.agentId].revision;await s.viewAgent(r.agentId,{revision:old});assert.equal(s.snapshot().reviews[r.agentId].attention,false);
 await f.finish(r);await s.tick();assert.equal(f.notifications.length,1);assert.equal(s.snapshot().reviews[r.agentId].attention,true);
 await assert.rejects(s.viewAgent(r.agentId,{revision:old}),{status:409});const current=s.snapshot().reviews[r.agentId].revision;
 await s.viewAgent(r.agentId,{revision:current});assert.equal(s.snapshot().reviews[r.agentId].attention,false);assert.equal(s.flow.root(r.humanRequestId).ticket.state,'consumed');await s.tick();assert.equal(f.notifications.length,1);
});
test('historical runs never acquire tickets or trigger a wave of notifications; uncertain outbox is not replayed',async t=>{
 const f=await fixture(t);f.service.data.runs.push({id:'legacy',agentId:f.agents[0].id,requestId:'legacy-key',instruction:'old',state:'completed',output:'old'});
 delete f.service.data.runStateVersion;await f.service.save();let s=await f.restart();await s.tick();assert.equal(f.notifications.length,0);assert.equal(s.data.requests.length,0);assert.equal(s.flow.run('legacy').notificationPolicy,'legacy-untracked');
 const r=await s.send(f.agents[0].id,{instruction:'new',requestId:'request-new-one'});await f.submit(r);await f.complete(r);await f.finish(r);
 const q=s.flow.root(r.humanRequestId);q.notification.status='attempting';await s.save();s=await f.restart();await s.tick();assert.equal(f.notifications.length,0);assert.equal(s.flow.root(q.id).notification.status,'delivery_unknown');
});
test('official CLI exposes delegation, results and finalization using the same persisted graph',async t=>{
 const f=await fixture(t),s=f.service,ops=new VillageOperations({dir:f.options.dir},null,{direct:s});
 const r=await s.send(f.agents[0].id,{instruction:'CLI request',requestId:'request-cli-one'});await f.submit(r);
 const help=(await ops.execute(['help'])).result;for(const name of ['requests delegate','requests results','requests acknowledge','requests finish','requests cancel'])assert(help.some(c=>c.name===name));
 const get=await ops.execute(['requests','get',r.humanRequestId]);assert.equal(get.result.finalAgentId,r.agentId);
 const payload={humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,revision:0,operationId:'cli-finish-one'};
 const receipt=await ops.execute(['requests','finish',JSON.stringify(payload)]);assert.equal(receipt.ok,true);assert.equal(f.notifications.length,0);
 await f.complete(r);assert.equal(f.notifications.length,1);assert.equal((await ops.execute(['requests','finish',JSON.stringify(payload)])).ok,true);await s.tick();assert.equal(f.notifications.length,1);
});
test('requests start reached through the CLI/API is tagged origin agent, never human, while the browser/office relay path stays human',async t=>{
 const f=await fixture(t),s=f.service,ops=new VillageOperations({dir:f.options.dir},null,{direct:s});
 const human=await s.send(f.agents[0].id,{instruction:'Browser or office relay',requestId:'origin-check-human'});
 assert.equal(human.origin,'human');
 const payload={agentId:f.agents[1].id,requestId:'origin-check-agent',instruction:'Agent to Agent'};
 const started=await ops.execute(['requests','start',JSON.stringify(payload)]);assert.equal(started.ok,true);
 const agentRun=s.flow.run(started.result.id);assert.equal(agentRun.origin,'agent');assert.equal(agentRun.humanRequestId,started.result.humanRequestId);
 // Steering always tags its own origin regardless of which path dispatched the follow-up.
 await f.submit(agentRun);
 const steerPayload={agentId:f.agents[1].id,requestId:'origin-check-agent-steer',instruction:'follow up',steerTarget:structuredClone(s.agent(f.agents[1].id).steerTarget)};
 const steered=await ops.execute(['requests','start',JSON.stringify(steerPayload)]);assert.equal(steered.ok,true);
 assert.equal(s.flow.run(steered.result.id).origin,'steering');
});
test('same Agent queues distinct human requests; resume keeps its original ticket and cannot complete another request',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];
 const r1=await s.send(a.id,{instruction:'First',requestId:'queued-first-request'});await f.submit(r1);
 const r2=await s.send(a.id,{instruction:'Second',requestId:'queued-second-request'});
 assert.equal(r2.state,'queued');assert.equal(f.sent.length,1);assert.notEqual(r1.humanRequestId,r2.humanRequestId);
 const repeated=await s.send(a.id,{instruction:'Second',requestId:'queued-second-request'});assert.equal(repeated.id,r2.id);
 await f.complete(r1);assert.equal(r2.state,'awaiting_input');await f.submit(r2);assert.equal(f.notifications.length,0);
 const q1=s.flow.root(r1.humanRequestId),ticket=q1.ticket.id;
 const resumed=await s.flow.continue({humanRequestId:q1.id,workId:r1.workId,revision:q1.revision,operationId:'resume-original',instruction:'Continue original'});
 await s.tick();assert.equal(resumed.state,'queued');assert.equal(f.sent.length,2);
 await f.finish(r2);await f.complete(r2);assert.equal(f.notifications.length,1);assert.equal(q1.status,'active');
 await f.submit(resumed);await f.finish(resumed);await f.complete(resumed);
 assert.equal(f.notifications.length,2);assert.equal(q1.ticket.id,ticket);assert.equal(s.data.requests.length,2);
 assert.equal(new Set(f.notifications.map(m=>m.id)).size,2);
});
test('attachment transfer failure never dispatches a prompt; retry retains one request and its exact attachments',async t=>{
 const {AttachmentStore}=await import('../server/attachments.mjs');const f=await fixture(t),s=f.service;s.attachments=new AttachmentStore(f.options.dir);await s.attachments.init();const record=await s.attachments.save(Buffer.from('data'),'data.txt','text/plain');
 s.transferAttachment=async()=>{throw Error('SSH unavailable');};const r=await s.send(f.agents[3].id,{instruction:'',attachments:[record.id],requestId:'attachment-only-request'});
 assert.equal(r.state,'queued');assert.equal(f.sent.length,0);assert(r.attachmentError);assert.equal(s.data.requests.length,1);
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
 let q=s.flow.root(r.humanRequestId),w=q.works[0];assert.equal(q.status,'active');assert.equal(w.finish.status,'failed');assert.equal(q.ticket.state,'available');assert.equal(f.notifications.length,0);
 assert.equal(r.recovery.status,'scheduled');assert(r.recovery.nextAt>Date.now());assert.equal(f.sent.length,1);
 r.recovery.nextAt=0;await s.save();s=await f.restart();await Promise.all([s.tick(),s.tick()]);
 q=s.flow.root(r.humanRequestId);w=q.works[0];let retry=s.flow.run(w.currentRunId);
 assert.notEqual(retry.id,r.id);assert.equal(retry.workId,r.workId);assert.equal(retry.origin,'retry');assert.equal(w.autoRetry.attempts,1);assert.equal(w.finish,undefined);assert.equal(f.sent.length,2);
 assert.match(retry.instruction,/既存変更/);assert.match(retry.instruction,/再委任せず/);
 await s.tick();await s.tick();assert.equal(f.sent.length,2);assert.equal(retry.state,'awaiting_input');
 s=await f.restart();await s.tick();retry=s.flow.run(retry.id);assert.equal(retry.state,'awaiting_input');assert.equal(f.sent.length,2);
 // A late old terminal is not the retry's native acknowledgement.
 await f.complete(r,'completed');assert.equal(retry.acceptance,'pending');assert.equal(f.notifications.length,0);
 await f.submit(retry);await f.finish(retry);await f.complete(retry);await s.tick();assert.equal(f.notifications.length,1);
 const completed=JSON.stringify(s.flow.root(q.id));s=await f.restart();await s.tick();assert.equal(JSON.stringify(s.flow.root(q.id)),completed);assert.equal(f.notifications.length,1);assert.equal(f.sent.length,2);
});
test('automatic retries stop after two attempts or ten minutes and never retry ambiguous acceptance',async t=>{
 const f=await fixture(t),s=f.service;let r=await s.send(f.agents[0].id,{instruction:'Work',requestId:'retry-budget-root'});
 for(let attempt=0;attempt<3;attempt++){
  await f.submit(r);await overload(f,r);
  if(attempt===2){assert.equal(r.recovery.status,'manual');assert.match(r.recovery.reason,/上限/);break;}
  assert.equal(r.recovery.status,'scheduled');assert(r.recovery.nextAt-Date.now()>=(attempt===0?29000:119000));r.recovery.nextAt=0;await s.tick();r=s.flow.run(s.flow.root(r.humanRequestId).works[0].currentRunId);
 }
 assert.equal(f.sent.length,3);await s.tick();assert.equal(f.sent.length,3);assert.equal(f.notifications.length,0);
 const other=await s.send(f.agents[1].id,{instruction:'Other',requestId:'retry-time-root'});await f.submit(other);await overload(f,other);
 s.flow.root(other.humanRequestId).works[0].autoRetry.firstFailureAt=Date.now()-600001;await s.tick();assert.equal(other.recovery.status,'manual');
 const pending=await s.send(f.agents[2].id,{instruction:'Unaccepted',requestId:'retry-unknown-root'});await s.tick();await s.tick();assert.equal(pending.state,'awaiting_input');assert.equal(s.flow.root(pending.humanRequestId).works[0].runIds.length,1);
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
  if(['authentication','legacy','child','new-input'].includes(scenario))assert.equal(r.recovery.status,'manual',scenario);
 }
});
test('historically completed requests and runs are not reinterpreted when an old native error appears',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{instruction:'Old',requestId:'historic-root'});
 await f.submit(r);await f.finish(r);await f.complete(r);const q=s.flow.root(r.humanRequestId),before=JSON.stringify(q),runBefore=JSON.stringify(r);
 const native=f.runtimes.get(r.agentId);Object.assign(native.turns[0],{state:'failed',errorCode:'server_overloaded',error:'old error'});
 await s.tick();await s.tick();assert.equal(JSON.stringify(q),before);assert.equal(JSON.stringify(r),runBefore);assert.equal(f.sent.length,1);assert.equal(f.notifications.length,1);
});
async function steer(f,r,text='Supplement',requestId=randomUUID()){
 const a=f.service.agent(r.agentId);assert.equal(a.canSteer,true);
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
 await f.finish(root);const q=s.flow.root(root.humanRequestId);assert.equal(q.status,'finalizing');
 const second=await steer(f,root);assert.equal(f.sent.length,2);assert.equal(second.state,'awaiting_input');assert.equal(second.humanRequestId,root.humanRequestId);assert.equal(second.workId,root.workId);assert.equal(q.works.length,1);assert.equal(s.data.requests.length,1);assert.equal(q.ticket.state,'available');assert.equal(root.state,'superseded');assert.equal(q.status,'active');
 await assert.rejects(f.finish(root),/現在の作業run/);await assert.rejects(f.finish(second),/受付をまだ/);
 await acceptSteer(f,second);assert.equal(second.acceptance,'accepted');assert.equal(second.turnId,root.turnId);
 const third=await steer(f,second,'Second supplement');await acceptSteer(f,third);assert.equal(third.state,'running');await assert.rejects(f.finish(second),/現在の作業run/);
 await f.finish(third);await f.complete(third);assert.equal(f.notifications.length,1);assert.equal(q.finalRunId,third.id);await s.tick();await s.tick();assert.equal(f.notifications.length,1);assert.equal(s.data.requests.length,1);
});
test('steering receipt is idempotent across restart, uncertain delivery never resends, wrong turn never completes',async t=>{
 const f=await fixture(t),root=await f.service.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const input={requestId:randomUUID(),instruction:'More',steerTarget:structuredClone(f.service.agent(root.agentId).steerTarget)};f.lose(true);
 const r=await f.service.send(root.agentId,input);assert.equal(r.state,'send_unknown');const count=f.sent.length;await f.service.tick();assert.equal(f.service.agent(root.agentId).canSteer,false);
 await f.restart();await f.service.tick();assert.equal((await f.service.send(root.agentId,input)).id,r.id);assert.equal(f.sent.length,count);
 await assert.rejects(f.service.send(root.agentId,{...input,instruction:'changed'}),/requestId/);
 const restarted=f.service.flow.run(r.id);await acceptSteer(f,restarted,{otherTurn:true});assert.equal(restarted.acceptance,'pending');await assert.rejects(f.finish(restarted),/受付をまだ/);assert.equal(f.notifications.length,0);assert.equal(f.sent.length,count);
});
test('unsafe steering targets reject without dispatch; cancellation never turns steering into queue',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const target=structuredClone(s.agent(root.agentId).steerTarget),input={requestId:randomUUID(),instruction:'More',steerTarget:target};
 await assert.rejects(s.send(root.agentId,{...input,steerTarget:{...target,turnId:'wrong'}}),/補足対象/);f.offline(true);await assert.rejects(s.send(root.agentId,input),/補足対象/);f.offline(false);await s.tick();
 s.agent(root.agentId).provider='claude';await assert.rejects(s.send(root.agentId,input),/補足対象/);s.agent(root.agentId).provider='codex';await s.tick();
 const q=s.flow.root(root.humanRequestId);await s.flow.cancel({humanRequestId:q.id,revision:q.revision});await assert.rejects(s.send(root.agentId,input),/補足対象/);assert.equal(f.sent.length,1);assert.equal(f.notifications.length,0);
});
test('unattributed supplement or external same-turn input prevents finish and further steering',async t=>{
 const f=await fixture(t),root=await f.service.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);const r=await steer(f,root);await acceptSteer(f,r,{explicitTurn:false});assert.equal(r.acceptance,'pending');assert.equal(f.service.agent(r.agentId).canSteer,false);assert.equal(f.notifications.length,0);
});
test('steering preserves original replay, attachments and child graph; later native stranger blocks finish',async t=>{
 const f=await fixture(t),s=f.service;
 s.attachments={select:async ids=>ids.map(id=>({id,name:id})),content:async()=>Buffer.from('test')};s.transferAttachment=async(a,record)=>({id:record.id,path:'/test/'+record.id});
 const initial={requestId:randomUUID(),instruction:'Original',attachments:['first']};const root=await s.send(f.agents[0].id,initial);await f.submit(root);const child=await f.delegate(root,f.agents[2]);
 const target=structuredClone(s.agent(root.agentId).steerTarget),r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'Supplement',steerTarget:target,attachments:['second']});await acceptSteer(f,r);assert.equal((await s.send(root.agentId,initial)).id,root.id);assert.equal(s.flow.root(root.humanRequestId).works.length,2);assert.equal(s.flow.work(s.flow.root(root.humanRequestId),child.id).currentRunId,child.currentRunId);
 const next=await f.delegate(r,f.agents[3]);const nextRun=s.flow.run(next.currentRunId);assert.deepEqual(nextRun.attachments.map(a=>a.id),['first','second']);
 const n=f.runtimes.get(r.agentId);n.cursor+=10;n.inputs.push({id:'stranger',turnId:r.turnId,offset:n.cursor,hash:inputHash('foreign'),explicitTurn:true});await s.tick();assert.equal(r.state,'unknown');assert.equal(s.agent(r.agentId).canSteer,false);await assert.rejects(f.finish(r));assert.equal(f.notifications.length,0);
});
test('target ending during attachment transfer does not send or fall back to a new idle turn',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 s.attachments={select:async ids=>ids.map(id=>({id})),content:async()=>Buffer.from('test')};s.transferAttachment=async()=>{f.runtimes.get(root.agentId).turns.at(-1).state='completed';return {path:'/test/file'};};
 const r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:s.agent(root.agentId).steerTarget,attachments:['a']});assert.equal(r.state,'interrupted');assert.equal(f.sent.length,1);await s.tick();assert.equal(f.sent.length,1);assert.equal(f.notifications.length,0);
});
test('permission, setup/unknown transport, incomplete native tail and pending input disable steering',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});assert.equal(s.agent(root.agentId).canSteer,false);await f.submit(root);const target=structuredClone(s.agent(root.agentId).steerTarget),original=s.localRun;
 for(const status of [{alive:true,cliState:'busy',agentSessionId:'session-'+root.agentId,permissionRequest:{id:'permission'}},{alive:true,cliState:'unknown',agentSessionId:'session-'+root.agentId},{alive:true,cliState:'busy',agentSessionId:null},{alive:false,cliState:'busy',agentSessionId:'session-'+root.agentId}]){
  s.localRun=(cmd,args)=>args[1]==='status'?Promise.resolve(JSON.stringify(status)):original(cmd,args);
  await assert.rejects(s.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:target}),/補足対象/);assert.equal(f.sent.length,1);
 }
 s.localRun=original;f.runtimes.get(root.agentId).incompleteTail=true;await assert.rejects(s.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:target}),/補足対象/);assert.equal(f.sent.length,1);
});
test('accepted steering survives restart and only its final run consumes the original ticket',async t=>{
 const f=await fixture(t),root=await f.service.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);await assert.rejects(f.service.send(root.agentId,{requestId:randomUUID(),instruction:'More',steerTarget:{runId:root.id}}),{status:400});const r=await steer(f,root);await acceptSteer(f,r);const count=f.sent.length;await f.restart();await f.service.tick();const restored=f.service.flow.run(r.id);assert.equal(restored.acceptance,'accepted');assert.equal(restored.state,'running');await f.finish(restored);await f.complete(restored);await f.service.tick();assert.equal(f.sent.length,count);assert.equal(f.notifications.length,1);assert.equal(f.service.flow.root(root.humanRequestId).finalRunId,r.id);
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
 assert.equal(q.ticket.state,'available');assert.equal(q.status,'active');assert.equal(f.notifications.length,0);
 let report=s.flow.run(q.works[0].currentRunId);assert.equal(report.phase,'report');assert.equal(report.workId,source.workId);
 assert.match(report.instruction,/元の質問/);assert.match(report.instruction,/追加作業/);
 // finish must come before the report body is written, so a trailing habitual remark can
 // never become the run's last message and clobber the report in finalOutput.
 assert.match(report.instruction,/まず今回のrunで正式finishを登録し、その後に報告本文を書いて/);
 assert.match(report.instruction,/本文の後には（finish登録済みの確認や一言なども含め）何も書き加えないで/);
 assert(JSON.stringify(s.snapshot()).includes('Output '+source.id));
 assert(!JSON.stringify(s.snapshot()).includes('人間向けの報告だけを作成'));
 assert.equal(s.snapshot().reviews[source.agentId].attention,false);
 const count=f.sent.length;await s.tick();await s.tick();assert.equal(f.sent.length,count);
 s=await f.restart();await s.tick();assert.equal(f.sent.length,count);
 report=s.flow.run(report.id);await assert.rejects(f.finish(report),/受付をまだ/);
 await f.submit(report);assert.equal(s.agent(report.agentId).canSteer,false);
 await assert.rejects(f.delegate(report,f.agents[2]),/報告工程/);
 await f.finish(report);assert.equal(f.notifications.length,0);await f.complete(report);
 assert.equal(f.notifications.length,1);assert.match(f.notifications[0].content,new RegExp('Final '+report.id));
 assert.equal(s.flow.root(q.id).ticket.state,'consumed');assert.equal(s.snapshot().reviews[source.agentId].attention,true);
 assert.equal(s.snapshot().runs.find(r=>r.id===source.id).collapsedHistory,true);assert.equal(s.snapshot().runs.find(r=>r.id===source.id).finalOutput,'Final '+source.id);assert(JSON.stringify(s.snapshot()).includes('Final '+report.id));
 await s.tick();await s.tick();await f.restart();await f.service.tick();assert.equal(f.notifications.length,1);
 assert.equal(f.service.data.runs.filter(r=>r.phase==='report').length,1);
});
test('report failure retries only report; cancelled or unknown reports never redispatch/notify',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;
 const source=await s.send(f.agents[0].id,{requestId:'report-failed-request',instruction:'work'});await f.submit(source);await f.finish(source);await f.complete(source);
 const q=s.flow.root(source.humanRequestId),report=s.flow.run(q.works[0].currentRunId);
 await f.submit(report);await f.finish(report);await f.complete(report,'failed');
 assert.equal(q.status,'active');assert.equal(q.ticket.state,'available');assert.equal(f.notifications.length,0);
 assert(JSON.stringify(s.snapshot()).includes('Output '+source.id));
 const x={humanRequestId:q.id,workId:report.workId,revision:q.revision,operationId:'report-retry-operation',instruction:'Do work again'};
 const retry=await s.flow.continue(x,true);assert.equal(retry.phase,'report');assert.match(retry.instruction,/再実行は禁止/);assert.equal(await s.flow.continue(x,true),retry);
 f.lose(true);await s.tick();assert.equal(retry.state,'send_unknown');const count=f.sent.length;
 await s.tick();await f.restart();await f.service.tick();assert.equal(f.sent.length,count);
 const restored=f.service.flow.root(q.id);await f.service.flow.cancel({humanRequestId:q.id,revision:restored.revision});await f.service.tick();
 assert.equal(f.sent.length,count);assert.equal(f.notifications.length,0);
});
test('child results remain intact and do not get report runs; source failure does not create report',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;
 const r=await s.send(f.agents[0].id,{requestId:'report-children',instruction:'work'});await f.submit(r);
 const child=await f.delegate(r,f.agents[2]);await s.tick();const c=s.flow.run(child.currentRunId);
 await f.submit(c);await f.finish(c);await f.complete(c);assert.equal(s.flow.work(s.flow.root(r.humanRequestId),child.id).state,'completed');assert.equal(child.runIds.length,1);
 const q=s.flow.root(r.humanRequestId);
 await s.flow.acknowledge({humanRequestId:q.id,workId:r.workId,actorRunId:r.id,resultIds:[c.id]});
 assert.equal(s.flow.results(q.id,r.workId)[0].output,'Output '+c.id);
 await f.finish(r);await f.complete(r,'failed');assert.equal(q.report,undefined);assert.equal(f.notifications.length,0);
});
test('report snapshot is pinned, supplements stay same work until report, new request during report is queued separately',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;
 const r=await s.send(f.agents[0].id,{requestId:'report-queue-root',instruction:'元質問'});await f.submit(r);
 await s.flow.configureReport(false);
 await f.finish(r);await f.complete(r);const q=s.flow.root(r.humanRequestId),report=s.flow.run(q.works[0].currentRunId);
 await f.submit(report);
 await assert.rejects(s.send(r.agentId,{requestId:'report-invalid-steer',instruction:'補足',steerTarget:{runId:report.id,sessionId:report.sessionId,turnId:report.turnId}}),/補足対象/);
 const later=await s.send(r.agentId,{requestId:'report-next-request',instruction:'次の独立依頼'});
 assert.equal(later.state,'queued');assert.notEqual(later.humanRequestId,q.id);assert.equal(s.flow.root(later.humanRequestId).reportMode,false);
 const count=f.sent.length;await s.tick();assert.equal(f.sent.length,count);
 await f.finish(report);await f.complete(report);assert.equal(f.notifications.length,1);assert.equal(later.state,'awaiting_input');
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
 const q2=s.flow.root(r2.humanRequestId),report=s.flow.run(q2.works[0].currentRunId);assert.equal(report.state,'queued');
 await s.flow.cancel({humanRequestId:q2.id,revision:q2.revision});const count=f.sent.length;await s.tick();await f.restart();await f.service.tick();
 assert.equal(f.sent.length,count);assert.equal(f.notifications.length,0);
});
test('report completed without finish remains hidden and resume is report-only; notification disabled does not skip report',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service;s.notifier.enqueue=async()=>({status:'disabled'});
 const r=await s.send(f.agents[0].id,{requestId:'report-no-finish',instruction:'question'});await f.submit(r);await f.finish(r);await f.complete(r);
 const q=s.flow.root(r.humanRequestId),report=s.flow.run(q.works[0].currentRunId);await f.submit(report);await f.complete(report);
 assert.equal(q.status,'active');assert.equal(q.ticket.state,'available');assert(!JSON.stringify(s.snapshot()).includes('Final '+report.id));
 const next=await s.flow.continue({humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:'report-resume-op',instruction:'resume'});
 assert.equal(next.phase,'report');await s.tick();await f.submit(next);await f.finish(next);await f.complete(next);
 assert.equal(q.status,'completed');assert.equal(q.notification.status,'disabled');assert.equal(q.ticket.state,'consumed');
});
test('both report settings survive restart; failed persistence does not falsely apply the switch',async t=>{
 const f=await fixture(t);assert.equal((await f.restart()).flow.reportStatus().enabled,false);
 await f.service.flow.configureReport(true);assert.equal((await f.restart()).flow.reportStatus().enabled,true);
 const s=f.service,save=s.save;s.save=async()=>{throw Error('disk unavailable');};
 await assert.rejects(s.flow.configureReport(false),/disk unavailable/);assert.equal(s.flow.reportStatus().enabled,true);s.save=save;
});

test('compact work context retains completion and receipt rules with discoverable detailed operations',async t=>{
 const f=await fixture(t),r=await f.service.send(f.agents[0].id,{instruction:'context test',requestId:'compact-context-test'});
 const text=f.service.flow.context(r);
 assert(text.length<2200);
 for(const token of ['requests finish','revision','operationId','native正常終了','acknowledge','生purplemux tab send禁止','受付不明','server_overloaded','/api/village','["help"]','/api/direct/requests/get','village-image:UUID'])assert(text.includes(token),token);
 assert(text.includes(r.id));assert(text.includes(r.workId));assert(text.includes(r.humanRequestId));
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
 const r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'queued'});assert.equal(r.state,'queued');
 const x={humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id};
 await assert.rejects(s.flow.cancelQueued({...x,agentId:f.agents[1].id}),/一致/);
 await Promise.all([s.flow.cancelQueued(x),s.flow.cancelQueued(x)]);assert.equal(r.acceptance,'cancelled');assert.equal(s.flow.root(r.humanRequestId).ticket.state,'cancelled');
 await f.restart();await f.service.flow.cancelQueued(x);await f.complete(f.service.flow.run(root.id));await f.service.tick();assert.equal(f.sent.length,1);assert.equal(f.notifications.length,0);
 for(const state of ['sending','send_unknown','running','awaiting_input']){const run=f.service.flow.run(root.id);run.state=state;await assert.rejects(f.service.flow.cancelQueued({humanRequestId:run.humanRequestId,agentId:run.agentId,runId:run.id}),/未送信/);}
});
test('cancellation serializes against dispatch and cannot claim a send that already started',async t=>{
 const f=await fixture(t),s=f.service,r=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'sent'});
 // Recreate a queued boundary with deterministic fake transport; no real Agent.
 r.runModel={...r.runModel,state:{kind:'queued'}};r.state='queued';r.acceptance='queued';delete r.dispatchAttemptedAt;r.dispatchConfirmed=false;
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),observe=s.observe.bind(s);
 s.observe=async a=>{enter();await gate;await observe(a);a.canSend=true;return {sessionId:'session-'+a.id,cursor:0};};
 const dispatch=s.attemptRun(r);await entered;const cancel=s.flow.cancelQueued({humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id});release();await dispatch;
 await assert.rejects(cancel,/未送信/);assert.equal(r.state,'awaiting_input');
});
test('queued supplement cancellation restores the original work without sending or restoring old finish',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);await f.finish(root);
 const attempt=s.attemptRun.bind(s);s.attemptRun=async r=>r;const r=await steer(f,root);s.attemptRun=attempt;
 await s.flow.cancelQueued({humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id});const q=s.flow.root(r.humanRequestId);assert.equal(q.works[0].currentRunId,root.id);assert.equal(q.works[0].finish,undefined);await s.tick();assert.equal(f.sent.length,1);assert.equal(root.state,'running');assert.equal(q.ticket.state,'available');
});
test('failed persistence cannot turn a later duplicate cancellation into false success',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Active'});await f.submit(root);
 const r=await s.send(root.agentId,{requestId:randomUUID(),instruction:'Queued'}),x={humanRequestId:r.humanRequestId,agentId:r.agentId,runId:r.id};
 const save=s.save.bind(s);s.save=async()=>{throw Error('disk unavailable');};await assert.rejects(s.flow.cancelQueued(x),/disk/);assert.equal(r.state,'queued');assert.equal(r.queueCancelledAt,undefined);assert.equal(s.flow.root(r.humanRequestId).ticket.state,'available');s.save=save;await s.flow.cancelQueued(x);assert(r.queueCancelledAt);
});
test('event-to-response upgrade preserves Direct steering boundary and superseded output partitions',async t=>{
 const f=await fixture(t),s=f.service,root=await s.send(f.agents[0].id,{requestId:randomUUID(),instruction:'Original'});await f.submit(root);
 const n=f.runtimes.get(root.agentId),turn=n.turns[0];turn.messageOffsets=true;turn.messages=[];
 const emit=async text=>{n.cursor+=2;turn.messages.push({id:'m'+n.cursor,offset:n.cursor,text});turn.output=turn.messages.map(m=>m.text).join('\n\n');await f.service.tick();};
 const upgrade=run=>{const i=n.inputs.find(i=>i.id===run.inputId),old={id:i.id,offset:i.offset};n.cursor+=2;Object.assign(i,{id:'response-'+i.id,offset:n.cursor,aliases:[old]});};
 await emit('before');upgrade(root);await s.tick();assert.equal(root.state,'running');assert.equal(s.agent(root.agentId).canSteer,true);
 const second=await steer(f,root);await acceptSteer(f,second);await emit('between');
 // The next send snapshots the event ID, then its canonical response arrives
 // before attemptRun's second native observation (dispatch race).
 const runtime=s.runtime.bind(s);let observations=0;
 s.runtime=async(...args)=>{observations++;if(observations===2)upgrade(second);return runtime(...args);};
 const third=await steer(f,second);s.runtime=runtime;assert.equal(third.state,'awaiting_input');
 await acceptSteer(f,third);await emit('after');
 assert.equal(root.output,'before');assert.equal(second.output,'between');assert.equal(third.output,'after');
 await f.restart();await f.service.tick();assert.equal(f.service.flow.run(second.id).output,'between');
 await f.finish(f.service.flow.run(third.id));await f.complete(f.service.flow.run(third.id));assert.equal(f.notifications.length,1);
});

test('startup envelope retains literal human input and dynamic identity; report and legacy fallback retain finish rules',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service,a=f.agents[0];
 a.inputEnvelope={mode:'startup-v1'};
 const human='  本文 <pasted_content>\nそのまま  ';
 const r=await s.send(a.id,{instruction:human,requestId:randomUUID()});
 const delivered=f.sent.at(-1).text;
 assert(delivered.startsWith(human+'\n'));assert(delivered.includes(r.inputMarker));
 assert(delivered.includes('ai-village-discovery'));assert(delivered.includes(a.id));
 assert(!delivered.includes('requests finish'));assert(!delivered.includes('図は必要時のみ'));
 assert(s.startupInstructions().includes('requests finish'));assert(s.startupInstructions().includes('phase=report'));
 assert(s.startupInstructions().includes('projects guide PROJECT_ID'));
 await f.submit(r);await f.finish(r);await f.complete(r);await s.tick();
 const q=s.flow.get(r.humanRequestId),report=s.flow.run(q.works[0].currentRunId);
 assert.equal(report.phase,'report');assert(report.instruction.startsWith('報告資料'));
 assert(!s.flow.context(report).includes('requests finish'));
 a.inputEnvelope={mode:'legacy'};
 assert(s.flow.context(report).includes('requests finish'));
 assert(s.flow.context(r).includes('requests delegate'));
});

test('startup envelope uses latest metadata and retains attachments/travel; changed native session downgrades to legacy',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];a.inputEnvelope={mode:'startup-v1',sessionId:'previous-session'};
 await s.tick();assert.equal(a.inputEnvelope.mode,'legacy');assert.equal(a.inputEnvelope.reason,'native-session-changed');
 a.inputEnvelope={mode:'startup-v1'};a.projectId='current-project';a.metadataRevision=42;
 const context=s.secretaryContext(a,true);assert(context.includes('current-project'));assert(context.includes('42'));assert(!context.includes('所属は'));
 assert(s.flow.dynamicContext({attachmentFiles:[{path:'/attachment',sha256:'verified'}],travelContexts:[]}).includes('/attachment'));
 await s.save();await f.restart();assert.equal(f.service.agent(a.id).inputEnvelope.mode,'startup-v1');
});

for(const state of ['intact','missing','error'])test('pre-dispatch prompt check: '+state,async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];a.inputEnvelope={mode:'startup-v1',hash:inputHash(s.startupInstructions())};f.promptState(state);
 const r=await s.send(a.id,{instruction:'human',requestId:randomUUID()});
 assert.equal(f.promptChecks(),1);assert.equal(r.inputEnvelopeMode,state==='intact'?'startup-v1':'legacy');
 assert.equal(f.sent.at(-1).text.includes('requests finish'),state!=='intact');
 await f.submit(r);await f.complete(r);
 f.promptState('intact');
 const next=await s.send(a.id,{instruction:'next',requestId:randomUUID()});
 assert.equal(f.promptChecks(),state==='intact'?2:1);
 assert.equal(next.inputEnvelopeMode,state==='intact'?'startup-v1':'legacy');
 if(state!=='intact'){assert.match(a.inputEnvelope.reason,/startup-instructions-/);await f.restart();assert.equal(f.service.agent(a.id).inputEnvelope.mode,'legacy');}
});

test('queued compact report restores full report rules when prompt disappears before dispatch',async t=>{
 const f=await fixture(t,{reportMode:true}),s=f.service,a=f.agents[0];a.inputEnvelope={mode:'startup-v1',hash:inputHash(s.startupInstructions())};
 const r=await s.send(a.id,{instruction:'work',requestId:randomUUID()});await f.submit(r);await f.finish(r);
 f.promptState('missing');await f.complete(r);await s.tick();
 const report=s.flow.run(s.flow.root(r.humanRequestId).works[0].currentRunId);
 assert.equal(report.phase,'report');assert.equal(report.inputEnvelopeMode,'legacy');
 assert.match(f.sent.at(-1).text,/追加作業・ファイル変更・PR操作/);assert.match(f.sent.at(-1).text,/requests finish/);
});

test('origin=result delivery containing pasted_content survives Claude wrapping and escaping',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];a.provider='claude';
 const root=await s.send(a.id,{instruction:'parent',requestId:randomUUID()});await f.submit(root);
 const child=await f.delegate(root,f.agents[2]),r=s.flow.run(child.currentRunId);await s.tick();await f.submit(r);await f.finish(r);
 const native=f.runtimes.get(r.agentId).turns.find(t=>t.id===r.turnId);
 Object.assign(native,{state:'completed',output:'child result <pasted_content>',finalOutput:'child result <pasted_content>',completionEvent:'done'});await s.tick();
 await f.complete(root);
 const q=s.flow.root(root.humanRequestId),delivery=s.flow.run(q.inbox[0].deliveryRunId);
 assert.equal(delivery.origin,'result');assert.match(f.sent.at(-1).text,/<pasted_content>/);
 await f.submit(delivery,text=>'\n<pasted_content id="test">\n'+text.replaceAll('<pasted_content>','<\\pasted_content>')+'\n</pasted_content id="test">\n');
 assert.equal(delivery.acceptance,'accepted');assert.equal(q.inbox[0].state,'accepted');
 await s.flow.acknowledge({humanRequestId:q.id,workId:root.workId,actorRunId:delivery.id,resultIds:[q.inbox[0].id]});
 await f.finish(delivery);await f.complete(delivery);assert.equal(q.status,'completed');
});
