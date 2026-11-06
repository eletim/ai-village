import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DirectAgents} from '../server/direct.mjs';
import {inputHash} from '../server/runtime-events.mjs';
import {VillageOperations} from '../server/operations.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'request-flow-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtimes=new Map(),sent=[],notifications=[];let offline=false,lose=false;
 const execute=async(args,host,id)=>{
  if(offline)throw Error('offline');
  const agent=[...runtimes.keys()].find(a=>args.includes('ws-'+a)||args.at(-1)==='session-'+a)||id;
  const native=runtimes.get(agent);
  if(args[0]==='python3')return JSON.stringify(native);
  if(args[2]==='status')return JSON.stringify({alive:true,cliState:native.turns.at(-1)?.state==='running'?'busy':'idle',agentSessionId:'session-'+agent});
  if(args[2]==='send'){sent.push({agentId:agent,text:args.at(-1),transport:host?'ssh':'local'});if(lose)throw Error('response lost');return '{"status":"sent"}';}
  throw Error('unexpected '+args.slice(0,4));
 };
 const options={dir,remote:execute,localRun:(cmd,args)=>execute([cmd,...args]),notifier:{status:()=>({}),enqueue:async message=>{notifications.push(message);return {status:'sent'};}}};
 let service=new DirectAgents(options);await service.init({watch:false});
 const agents=Array.from({length:4},(_,i)=>({id:randomUUID(),name:i<2?'Secretary '+i:'Worker '+i,location:i<2?'mayor':'workshop',workshopId:'w'+i,connection:{connectionType:i===3?'ssh':'local',sshHost:i===3?'remote':null,name:'PC'+i},workspaceId:'',tabId:'tab'+i,sessionName:'pane'+i,provider:'codex',state:'idle'}));
 for(const a of agents){a.workspaceId='ws-'+a.id;service.data.agents.push(a);runtimes.set(a.id,{available:true,sessionId:'session-'+a.id,fileIdentity:'file-'+a.id,cursor:0,inputs:[],turns:[]});}
 await service.save();await service.tick();
 const submit=async r=>{
  const native=runtimes.get(r.agentId),text=sent.findLast(s=>s.agentId===r.agentId)?.text;
  assert.equal(inputHash(text),r.inputHash);const tid=randomUUID();native.cursor+=10;
  native.inputs.push({id:'input-'+tid,turnId:tid,hash:inputHash(text),offset:native.cursor,text});
  native.turns.push({id:tid,state:'running',output:''});await service.tick();assert.equal(r.acceptance,'accepted');return tid;
 };
 const complete=async(r,outcome='completed')=>{const native=runtimes.get(r.agentId);Object.assign(native.turns.find(t=>t.id===r.turnId),{state:outcome,output:'Output '+r.id,finalOutput:'Final '+r.id,completionEvent:'event-'+r.id});await service.tick();};
 const finish=async(r,op=randomUUID())=>service.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,revision:service.flow.root(r.humanRequestId).revision,operationId:op});
 const delegate=async(r,target,op=randomUUID())=>service.flow.delegate({humanRequestId:r.humanRequestId,parentWorkId:r.workId,actorRunId:r.id,agentId:target.id,instruction:'Child work '+op,operationId:op});
 const restart=async()=>{service.close();service=new DirectAgents(options);await service.init({watch:false});return service;};
 return {get service(){return service;},options,agents,runtimes,sent,notifications,submit,complete,finish,delegate,restart,offline:v=>offline=v,lose:v=>lose=v};
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
 await f.service.save();let s=await f.restart();await s.tick();assert.equal(f.notifications.length,0);assert.equal(s.data.requests.length,0);assert.equal(s.flow.run('legacy').notificationPolicy,'legacy-untracked');
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
