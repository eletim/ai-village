import {continuationBoundary} from './purpose-continuation.mjs';
import {initializePurposeContinuation} from './run-lifecycle.mjs';
import {reconcileObservation} from './request-observation-reconcile.mjs';
import {retirementRunAllowed} from './legacy-retirement.mjs';
import {updateProcedureGuidance,operationGuidance} from './procedure-guidance.mjs';
import {selfResume} from './request-self-resume.mjs';
import {reportInputs} from './report-inputs.mjs';
import {transitionDelivery,transitionReportDelivery} from './state/auxiliary.ts';
import {RequestReports,initialDeadlines,deadline} from './request-reports.mjs';
import {compose} from './request-composition.mjs';
import {settleHumanDelivery} from './request-delivery.mjs';
import {workDTO} from './request-compatibility.mjs';
import {applyGraph,newNode,steps,rootNode} from './unified-requests.mjs';
import {node} from './state/requests.ts';
import {quarantinedRun} from './request-integrity.mjs';
import {projectRequest,projectRun} from './state-projection.mjs';
import {agentControls} from './agent-lifecycle.mjs';
import {observeRequest,requestStatus,resultEntries} from './request-lifecycle.mjs';
import {runState,accepted,initializeRun,initializeResume,changeRun} from './run-lifecycle.mjs';
import {canCancelQueued} from '../src/queued-run.js';
import {normalizeTravelContexts,sameTravelContexts} from '../src/travel-context.js';
import {randomUUID,createHash} from 'node:crypto';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const now=()=>new Date().toISOString();
const terminal=r=>r&&['completed','failed','interrupted','terminated'].includes(runState(r));
const operation=id=>{if(typeof id!=='string'||!/^[\w-]{8,100}$/.test(id))fail('operationIdを8〜100文字で指定してください',400);return id;};
const instruction=text=>{if(typeof text!=='string'||!text.trim()||text.length>16000)fail('指示を1〜16000文字で指定してください',400);return text;};
const runKey=(root,op)=>'flow-'+createHash('sha256').update(root+':'+op).digest('hex');
export class RequestFlow {
 constructor(direct){this.d=direct;this.protocol=1;this.dispatching=new Map();this.reporting=new RequestReports(this);
  for(const name of ['reconcileObservation','selfResume','report','deadline','humanDeadline','plan','launch','assignPlan','discard','humanCompose','amend','supplement','delegate','respond','finish','complete','continue','continueChild','cancelQueued','cancel']){
   const command=this[name].bind(this);
   this[name]=(x,...args)=>this.d.units.run(x.humanRequestId,()=>command(x,...args)).catch(error=>{throw operationGuidance(error,name);});
  }
  const start=this.start.bind(this);this.start=(id,...args)=>this.d.units.agent(id,()=>start(id,...args));
 }
 init(){
  this.d.data.requests ||= [];
  // Never mint tickets or replay notifications for historical/untracked turns.
  for(const r of this.d.data.runs)if(!r.humanRequestId)r.notificationPolicy ||= 'legacy-untracked';
  for(const q of this.d.data.requests)if(!q.integrity&&q.notification?.status==='attempting')q.notification=transitionDelivery(q.notification,{type:'unknown',reason:'restart-during-delivery'});
 }
 reportStatus(){return {enabled:this.d.data.reportSettings?.enabled===true};}
 async configureReport(enabled){
  if(typeof enabled!=='boolean')fail('報告モードはtrue/falseで指定してください',400);
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
   this.d.data.reportSettings={enabled};await this.d.save();
   return this.reportStatus();
  }));
 }
 reportCurrent(r){const q=this.root(r.humanRequestId),w=this.work(q,r.workId);return !!q.report&&w.reportRunId===r.id&&true;}
 reportPrompt(q){return this.d.rules.reportData(q,this.run(q.report.sourceRunId),reportInputs(q,this.d.data.runs));}
 get requests(){return this.d.data.requests;}
 root(id){return this.requests.find(q=>q.id===id)||fail('依頼がありません',404);}
 work(q,id){if(q.integrity)fail('依頼の参照不整合を修復してください: '+q.integrity.reasons.join(', '));return q.requestGraph.nodes.find(w=>w.id===id)||fail('この依頼の作業ではありません',404);}
 run(id){return this.d.data.runs.find(r=>r.id===id);}
 active(q){if(requestStatus(q)!=='active')fail('依頼は受付中ではありません: '+requestStatus(q));}
 version(q,revision){if(!Number.isInteger(revision)||revision!==q.revision)fail('依頼が更新されています。requests getでrevisionを再取得してください');}
 list(agentId){return structuredClone(this.requests.filter(q=>!agentId||q.requestGraph?.nodes?.some?.(w=>w.assignee===agentId)).map(q=>projectRequest(this.d.data,q)));}
 get(id){const q=this.root(id);return structuredClone({...projectRequest(this.d.data,q),runs:this.d.data.runs.filter(r=>r.humanRequestId===id).map(projectRun)});}
 results(id,workId){const q=this.root(id);this.work(q,workId);return structuredClone(resultEntries(this.d.data,q).filter(e=>e.parentWorkId===workId).map(e=>({...e,output:this.run(e.resultRunId)?.output||'',error:this.run(e.resultRunId)?.error||null})));}
 createWork(q,{assignee,parentId=null,createdBy='human',metadata={},recipient,requester},text,op,origin){
  const w=newNode(q,{id:randomUUID(),assignee,parentId,createdBy,metadata});
  if(!parentId){q.rootWorkId=w.id;q.requestGraph.rootId=w.id;}
  if(recipient)w.recipient=recipient;if(requester)w.requester=requester;
  const r=this.enqueue(q,w,text,op,origin);
  return {work:this.work(q,w.id),run:r};
 }
 enqueue(q,w,text,op,origin,extra={}){
  const previous=this.run(extra.phase==='report'&&w.reportRunId?w.reportRunId:w.currentRunId)||(w.parentId?this.run(this.work(q,w.parentId).currentRunId):null);
  const r={id:randomUUID(),requestId:runKey(q.id,op),agentId:w.assignee,humanRequestId:q.id,workId:w.id,origin,instruction:text,travelContexts:structuredClone(previous?.contextTravelContexts||previous?.travelContexts||q.travelContexts||[]),attachments:structuredClone(previous?.contextAttachments||previous?.attachments||q.attachments||[]),createdAt:now(),achievement:'unverified',...extra};
  if(origin==='inbox')initializeResume(r,previous);
  else if(extra.purposeContinuation)initializePurposeContinuation(r,previous,extra.purposeContinuation.human?'human':'agent');

  else initializeRun(r,{actor:r.phase==='report'||origin==='result'?'program':origin==='delegation'||origin==='agent'?'agent':'human',parentRunId:w.parentId?this.work(q,w.parentId).currentRunId:null,resultOf:extra.resultId||null,recipientRunId:previous?.id||null});
  if(previous&&previous.workId===w.id&&r.phase!=='report'&&!r.runModel.retryOf)r.runModel={...r.runModel,retryOf:previous.id};
  this.d.data.runs.push(r);
  if(w.inbox&&['human','agent','delegation'].includes(origin)&&!w.inbox.length)w.inbox.push({id:randomUUID(),kind:'request',text,createdAt:r.createdAt,attempts:[r.id]});
  if(!node(q.requestGraph,w.id)){w.runIds.push(r.id);w.currentRunId=r.id;w.runAgents[r.id]=w.assignee;applyGraph(this.d.data,q,{type:'add',actor:w.createdBy||(w.parentId?'agent':'human'),request:w});}
  else applyGraph(this.d.data,q,{type:'attempt',actor:r.runModel.createdBy,requestId:w.id,runId:r.id,report:r.phase==='report',resolveReview:r.runModel.createdBy==='human'&&['retry','continuation'].includes(origin),...(extra.purposeContinuation?{resolveContinuationRunId:extra.purposeContinuation.previousRunId}:{})});
  if(w.inbox&&['retry','continuation'].includes(origin)){for(const i of w.inbox.filter(i=>!i.handledBy&&!i.retiredBy))i.attempts.push(r.id);}
  return r;
 }
 context(r){
  if(r.conversationId)return this.d.conversations.context(r);
  const q=this.root(r.humanRequestId),w=this.work(q,r.workId);
  const inputs=w.inbox&&r.phase!=='report'?this.inputs(q.id,w.id).filter(i=>i.attempts.includes(r.id)).map(({id,kind,text,result,textSourceUnavailable})=>({id,kind,...(text&&r.instruction.includes(text)?{textInInstruction:true}:{text:text.slice(0,2000),truncated:text.length>2000}),textSourceUnavailable,result})):undefined;
  return this.d.rules.dynamic(r)+this.d.rules.context({humanRequestId:q.id,workId:w.id,runId:r.id,origin:r.origin,phase:r.phase||'work',inputProtocol:q.inputProtocol||0,...(q.conversationId?{requester:q.requestedBy,...(q.purposeId?{purpose:{id:q.purposeId,previousRequestId:q.continuesRequestId||null,objective:this.root(q.purposeId).instruction,authorization:this.root(q.purposeId).requestedBy?.authorization}}:{}),recipient:{kind:'conversation',conversationId:q.conversationId}}:{}),...(r.runtimeHandover?{sessionHandover:r.runtimeHandover}:{}),...(w.metadata.reporting?{deadline:{version:w.metadata.reporting.version,completionAt:w.metadata.reporting.completionAt,reportAt:w.metadata.reporting.reportAt,expired:w.metadata.reporting.expired,latestReport:w.metadata.reporting.reports.at(-1)}}:{}),...(inputs?{inputs}:{})});
 }
 // originKind tags who actually dispatched this independent new request. The browser's own
 // /api/direct/agents/:id/runs route does not pass
 // a third argument, so it keeps the default 'human'; the generic CLI/API 'requests start'
 // operation is the one path an Agent can also reach directly (bypassing requests delegate), so
 // it is the only caller that overrides this to 'agent'. Steering already tags its own origin
 // regardless of this value, since who may supplement an active turn is unrelated to who may
 // start a brand-new one.
 async start(agentId,input,originKind='human'){
  if(input.steerTarget!==undefined){
   const t=input.steerTarget;
   if(!t||typeof t!=='object'||Array.isArray(t)||['runId','sessionId','turnId'].some(k=>typeof t[k]!=='string'||!t[k]||t[k].length>200)||Object.keys(t).length!==3)fail('steerTargetにはrunId/sessionId/turnIdを指定してください',400);
   input={...input,steerTarget:{runId:t.runId,sessionId:t.sessionId,turnId:t.turnId}};
  }

  if(input.attachments!==undefined&&(!Array.isArray(input.attachments)||input.attachments.length>4))fail('添付は4件までです',400);
  if(input.attachments?.length&&!this.d.attachments)fail('添付の保存機能が利用できません',409);
  const attachments=input.attachments?.length?await this.d.attachments.select(input.attachments):[];
  if(typeof input.instruction!=='string'||input.instruction.length>16000||(!input.instruction.trim()&&!attachments.length))fail('指示または添付が必要です',400);operation(input.requestId);const travelContexts=normalizeTravelContexts(input.travelContexts);
  if(input.steerTarget){const previous=this.run(input.steerTarget.runId),q=previous&&this.root(previous.humanRequestId),w=q&&this.work(q,previous.workId);if(w?.inbox){if(attachments.length||travelContexts.length)fail('補足先を選択して添付を送信してください',400);return this.supplement({humanRequestId:q.id,workId:w.id,operationId:input.requestId,instruction:input.instruction});}}
  return this.d.locked('request-graph',async()=>{
   const prior=this.d.data.runs.find(r=>r.requestId===input.requestId&&r.steerTarget);
   if(prior){if(prior.agentId!==agentId||prior.instruction!==input.instruction||JSON.stringify(prior.steerTarget)!==JSON.stringify(input.steerTarget)||!sameTravelContexts(prior.travelContexts,travelContexts)||JSON.stringify(prior.attachments.map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return prior;}
   if(input.steerTarget)fail('旧形式の実行へ補足を送れません。履歴を確認し、移行できる実行境界を確認してください');
   const legacy=this.d.data.runs.find(r=>r.requestId===input.requestId&&!r.humanRequestId);
   if(legacy){if(legacy.agentId!==agentId||legacy.instruction!==input.instruction||!sameTravelContexts(legacy.travelContexts,travelContexts)||JSON.stringify((legacy.attachments||[]).map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return legacy;}
   let q=this.requests.find(q=>q.clientRequestId===input.requestId);
   if(q){if(JSON.stringify(q.initialDeadlines||{completionAt:null,reportAt:null})!==JSON.stringify({completionAt:deadline(input.completionAt),reportAt:deadline(input.reportAt)})||q.originAgentId!==agentId||q.instruction!==input.instruction||!sameTravelContexts(q.travelContexts,travelContexts)||JSON.stringify((q.attachments||[]).map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return this.run(q.initialRunId);}
   const a=this.d.writableAgent(this.d.agent(agentId));if(!a.tabId||['terminated','stopping'].includes(agentControls(a).state))fail('Agentは送信可能ではありません');
   const r=await this.d.persist(async()=>{
   q={commonRequests:true,inputProtocol:this.protocol,projectId:a.projectId||null,reportMode:this.reportStatus().enabled,id:randomUUID(),clientRequestId:input.requestId,instruction:input.instruction,travelContexts,attachments,originAgentId:agentId,finalAgentId:agentId,initialDeadlines:{completionAt:deadline(input.completionAt),reportAt:deadline(input.reportAt)},revision:0,createdAt:now(),requestGraph:{version:3,nodes:[],operations:[]}};
   this.requests.push(q);
   const {run:r}=this.createWork(q,{assignee:agentId,metadata:{reporting:initialDeadlines(input)}},input.instruction,'human',originKind);r.requestId=input.requestId;q.initialRunId=r.id;
   await this.d.save();return r;
   });
   return r;
  }).then(async r=>{if(!this.dispatching.has(r.agentId))await this.dispatchQueued(r);return r;});
 }
 // Admission already committed: a later persistence error must not claim the
 // request was rejected. Return the durable queued/sent receipt for this same ID.
 async dispatchAdmitted(r){
  try{await this.d.attemptRun(r);}catch(error){if(!error.persistenceFailure)throw error;}
  return r;
 }
 reconcileObservation(x){return reconcileObservation(this,x);}
 selfResume(x){return selfResume(this,x);}
 report(x){return this.reporting.report(x);}
 deadline(x){return this.reporting.change(x);}
 humanDeadline(x){return this.reporting.change(x,'human');}
 plan(x){return compose(this,x,'plan','agent');}
 launch(x){return compose(this,x,'launch','agent');}
 assignPlan(x){return compose(this,x,'assignPlan','agent');}
 discard(x){return compose(this,x,'discard','agent');}
 humanCompose(x,action){return compose(this,x,action,'human');}
 async amend(x){if(!x.actorRunId)fail('actorRunIdが必要です',400);return this.supplement(x);}
 resultReference(e){const state=this.run(e.resultRunId)?.runModel?.state;return {requestId:e.requestId,resultId:e.id,version:e.version,outcome:state?.kind==='ended'?(state.outcome==='normal'?'completed':state.outcome):e.outcome,reason:state?.reason||null};}
 inputs(id,workId){const q=this.root(id),entries=resultEntries(this.d.data,q);return structuredClone((this.work(q,workId).inbox||[]).map(i=>{if(!i.result)return i;const {requestId,resultId,version}=i.result,e=entries.find(e=>e.id===resultId&&e.version===version&&e.requestId===requestId);const r=e&&this.run(e.resultRunId);return {...i,text:r?(r.output||r.finalOutput||r.error||'出力なし'):i.text,textSourceUnavailable:!r,result:e?this.resultReference(e):{requestId,resultId,version,outcome:'unknown'}};}));}
 async supplement(x){
  if(x.attachments!==undefined&&(!Array.isArray(x.attachments)||x.attachments.length>4))fail('添付は4件まで',400);
  const attachments=x.attachments?.length?await this.d.attachments.select(x.attachments):[];
  const travelContexts=normalizeTravelContexts(x.travelContexts);
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
  operation(x.operationId);if(typeof x.instruction!=='string'||x.instruction.length>16000||(!x.instruction.trim()&&!attachments.length))fail('指示または添付が必要です',400);
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);
  const payload=JSON.stringify({type:'supplement',requestId:w.id,text:x.instruction,attachments,travelContexts,actorRunId:x.actorRunId||null});
  const old=q.requestGraph.operations.find(o=>o.id===x.operationId);
  if(old){if(old.payload!==payload)fail('operationIdの再利用です');return structuredClone(w.inbox?.find(i=>i.id===old.inputId));}
  this.active(q);if(!['active','submitted'].includes(w.state.kind))fail('終了済みの依頼には新しい依頼を作成してください');
  if(x.actorRunId){const r=this.run(x.actorRunId),parent=r&&this.work(q,r.workId);if(!parent||w.parentId!==parent.id)fail('直接の子依頼にだけ補足できます');await this.actor(q,parent,r.id);}
  const input={id:randomUUID(),kind:'supplement',operationId:x.operationId,text:x.instruction,attachments,travelContexts,createdAt:now(),attempts:[]};
  const source=!w.parentId&&q.report?.sourceRunId;
  applyGraph(this.d.data,q,{type:'supplement',actor:x.actorRunId?'agent':'human',requestId:w.id,input,});
  if(source){for(const r of this.d.data.runs.filter(r=>r.workId===w.id&&r.phase==='report'&&runState(r)==='queued')){changeRun(r,{type:'cancel-report-reservation',actor:'program'});r.queueCancelledAt=now();}q.report=transitionReportDelivery(q.report,{type:'invalidate'});}

  q.requestGraph.operations.push({id:x.operationId,payload,inputId:input.id});q.revision++;
  await this.d.save();return structuredClone(w.inbox.find(i=>i.id===input.id));
 }));}
 schedulable(r){
  if(!r.humanRequestId)return true;const a=this.d.agent(r.agentId);if(a.location==='mayor'||!this.root(r.humanRequestId).inputProtocol)return true;
  // Conversation roots coordinate multiple jobs. Their unfinished graph is not
  // an execution lock; native receipt/idle checks still serialize every turn.
  // Ordinary workshop assignments retain exclusive ownership.
  const owners=this.requests.filter(q=>requestStatus(q)==='active').flatMap(q=>q.requestGraph.nodes.filter(n=>n.assignee===a.id&&!n.planned&&n.state.kind==='active'&&!(q.conversationId&&!n.parentId&&n.recipient?.kind==='conversation'&&n.recipient.conversationId===q.conversationId)).map(n=>({n,at:this.run(n.runIds[0])?.createdAt||q.createdAt})));
  owners.sort((a,b)=>a.at.localeCompare(b.at));return !owners.length||owners[0].n.id===r.workId;
 }
 async dispatchQueued(r){
  if(this.dispatching.has(r.agentId))return;
  const task=this.dispatchAdmitted(r);this.dispatching.set(r.agentId,task);
  try{await task;}finally{this.dispatching.delete(r.agentId);}
 }
 async actor(q,w,runId){
  if(w.currentRunId!==runId)fail('現在の作業runを指定してください');
  const r=this.run(runId);if(!r||r.humanRequestId!==q.id||r.workId!==w.id||r.agentId!==w.assignee)fail('runの所属が一致しません');
  const a=this.d.writableAgent(this.d.agent(w.assignee));
  // Native receipt is observed independently; never wait on transport under the graph lock.
  this.d.writableAgent(a);
  if(!accepted(r)||!r.inputId||!r.turnId||!r.sessionId)fail('native prompt-submit/turnの受付をまだ照合できません');
  if(!['running','completed'].includes(runState(r)))fail('正常な実行runではありません: '+runState(r));
  return r;
 }
 async delegate(x){return compose(this,x,'delegate','agent');}
 async respond(x){return this.respondOrFinish(x,false);}
 async finish(x){return this.respondOrFinish(x,true);}
 async respondOrFinish(x,finish){return this.d.locked('request-graph',async()=>{
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);operation(x.operationId);
  if(x.inputs!==undefined&&(!Array.isArray(x.inputs)||x.inputs.length>100||x.inputs.some(id=>typeof id!=='string')))fail('inputsは入力IDの配列です',400);
  const r=this.run(x.runId);if(!r||r.humanRequestId!==q.id||r.workId!==w.id)fail('runの所属が一致しません');
  if(x.results!==undefined&&(!Array.isArray(x.results)||x.results.length>100||x.results.some(s=>!s||typeof s.requestId!=='string'||typeof s.resultId!=='string'||!Number.isInteger(s.version)||!['accept','rework'].includes(s.decision))))fail('resultsにはrequestId/resultId/version/decisionを指定してください',400);
  const old=q.requestGraph.operations.find(o=>o.id===x.operationId);
  if(old){const prior=JSON.parse(old.acceptedPayload||old.payload);if(x.results===undefined&&!old.allowOmittedResults)fail('resultsを明示してください。対応申告なしはresults:[]です',400);if(prior.runId!==r.id||prior.type!==(finish?'finish':'respond')||(x.results!==undefined&&JSON.stringify(prior.results)!==JSON.stringify(x.results))||JSON.stringify(prior.inputs)!==JSON.stringify(x.inputs))fail('operationIdの再利用です');return workDTO(this.work(q,w.id));}
  if(!Array.isArray(x.results))fail('resultsを明示してください。requests resultsで取得しrequestId/resultId/version/decisionを指定。対応申告なしはresults:[]です',400);
  if(x.results.some(e=>e.decision==='rework'))fail('旧rework申告は廃止しました。修正は同じ仕事へのfollowupで指示してください',400);
  const reserved=this.run(w.currentRunId),reservation=reserved?.runModel.phase==='result'&&reserved.runModel.state.kind==='queued'&&reserved.runModel.retryOf===r.id;
  if(r.phase==='report'&&this.reportCurrent(r)){
    if(!accepted(r)||!['running','completed'].includes(runState(r))||x.inputs?.length||x.results.length)fail('報告処理では作業の入力・結果を変更できません');
    return this.d.persist(async()=>{q.requestGraph.operations.push({id:x.operationId,payload:JSON.stringify({type:finish?'finish':'respond',runId:r.id,inputs:x.inputs,results:x.results})});await this.d.save();return workDTO(w);});
  }
  if(!finish||x.results?.length)await this.actor(q,reservation?{...w,currentRunId:r.id}:w,x.runId);
  return this.d.persist(async()=>{
   observeRequest(this.d.data,q);
   applyGraph(this.d.data,q,{type:finish?'finish':'respond',actor:'agent',requestId:w.id,runId:r.id,operationId:x.operationId,results:x.results,...(x.inputs!==undefined?{inputs:x.inputs}:{}),at:Date.now()});
   // Reservation may be cancelled; an external send is never rewritten as unsent.
   for(const delivery of this.d.data.runs.filter(d=>d.humanRequestId===q.id&&d.workId===w.id&&d.runModel.phase==='result'&&d.runModel.state.kind==='queued')){
    if(resultEntries(this.d.data,q).some(e=>e.id===delivery.runModel.resultOf&&e.handled)){changeRun(delivery,{type:'cancel-result-reservation',actor:'program',resultId:delivery.runModel.resultOf,reason:'handled'});delivery.queueCancelledAt=now();delivery.error='result-handled-before-dispatch';}
   }
   q.revision++;await this.d.save();await this.settle();return workDTO(this.work(q,w.id));
  });
 });}
 async complete(x){return this.d.locked('request-graph',()=>this.d.persist(async()=>{
  const q=this.root(x.humanRequestId);if(q.integrity)fail('依頼の参照不整合を修復してください');this.version(q,x.revision);
  applyGraph(this.d.data,q,{type:'complete',actor:'human',requestId:q.rootWorkId,reason:x.reason||'人間が成果を確認して完了扱い'});
  q.revision++;await this.settle();await this.d.save();return this.get(q.id);
 }));}
 // This Agent boundary never exposes human retry/assignment privileges.
 async continueChild(x){return this.d.locked('request-graph',async()=>{
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);operation(x.operationId);instruction(x.instruction);
  if(x.agentId!==undefined)fail('継続は同じ仕事・担当です。担当変更はこの操作では行いません',400);
  if(!w.inbox)fail('旧形式の仕事は閲覧専用です。継続前に移行判断が必要です');
  if(!w.parentId)fail('直接委任した子依頼だけ継続できます');
  const parent=this.work(q,w.parentId),actor=await this.actor(q,parent,x.actorRunId);
  if(actor.runModel.state.kind!=='running'||actor.phase==='report')fail('現在実行中の依頼元runが必要です');
  const payload=JSON.stringify({workId:w.id,actorRunId:actor.id,targetRunId:x.targetRunId,revision:x.revision,instruction:x.instruction});
  const target=this.run(x.targetRunId);if(!target)fail('対象の最新runをrequests getで確認してください');
  const key=runKey(q.id,(runState(target)==='completed'?'resume:':'retry:')+x.operationId),old=this.d.data.runs.find(r=>r.requestId===key);
  if(old){if(old.purposeContinuation?.payload!==payload)fail('operationIdの再利用です');return structuredClone(old);}
  this.active(q);this.version(q,x.revision);
  if(q.report||!(['active','submitted'].includes(w.state.kind)||w.state.kind==='completed'&&w.state.by==='agent')||w.replacementId)fail('継続可能な子依頼ではありません');
  const last=this.run(w.currentRunId);
  if(!last||last.id!==x.targetRunId)fail('対象の最新runをrequests getで確認してください');
  if(last.runModel.state.kind!=='ended'||!['normal','failed','interrupted'].includes(last.runModel.state.outcome)||!last.runModel.facts.some(f=>f.type==='terminal')||last.runModel.supersededBy)fail('実行の終了が確認できません。実行中・受付不明は再送しません');
  const result=w.submissions.find(s=>s.runId===last.id);
  const effective=id=>{const r=this.run(id);return r&&!parent.invalidatedRuns.includes(id)&&!r.runModel.supersededBy&&((r.id===parent.currentRunId&&r.runModel.state.kind==='running')||(r.runModel.state.kind==='ended'&&r.runModel.state.outcome==='normal'));};
  if(result){
   const handled=parent.handling.some(h=>h.resultId===result.id&&h.decision!=='review'&&h.actorRunId===actor.id);
   const claimed=parent.claims.some(c=>c.resultId===result.id&&!c.invalidated&&c.decision!=='review'&&c.actorRunId===actor.id&&effective(c.actorRunId));
   // A replacement already launched is an external fact even if its parent failed.
   const replacement=w.replacements.some(c=>c.resultId===result.id&&(effective(c.actorRunId)||q.requestGraph.nodes.some(n=>n.id===c.replacementId&&n.state.kind!=='withdrawn')));
   if(handled||claimed||replacement)fail('結果への対応申告・置換予約と継続は併用できません');
  }
  const a=this.d.writableAgent(this.d.agent(w.assignee)),parentInputIds=(parent.inbox||[]).map(i=>i.id);
  return this.d.locked(a.id,async()=>{
   const snapshot=await this.d.observe(a);
   if(parent.currentRunId!==actor.id||actor.runModel.supersededBy||JSON.stringify((parent.inbox||[]).map(i=>i.id))!==JSON.stringify(parentInputIds))fail('照会中に親仕事の入力が変わりました。新しい入力を確認してください');
   if(!a.tabId||!agentControls(a).canSend||!continuationBoundary(last,snapshot,a.runtime,a))fail('担当の終了境界とidleを確認できません。再送せず状況を確認してください');
   if(this.d.data.runs.some(r=>r.agentId===a.id&&r.id!==last.id&&['queued','sent','running'].includes(r.runModel?.state.kind)))fail('担当に別の未終了runがあります');
   return this.continueLocked({...x,agentId:undefined},runState(last)!=='completed',{purposeContinuation:{previousRunId:last.id,actorRunId:actor.id,parentWorkId:parent.id,parentInputIds,revision:q.revision+1,payload}},'agent');
  });
 });}
 async continue(x,retry=false){return this.d.locked('request-graph',async()=>{
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);
  const previous=this.d.data.runs.find(r=>r.requestId===runKey(q.id,(retry?'retry:':'resume:')+x.operationId));
  if(previous)return this.continueLocked(x,retry,{},'human');
  this.version(q,x.revision);
  if(!w.inbox)fail('旧形式の仕事は閲覧専用です。継続前に移行判断が必要です');
  if(q.report)fail('旧報告専用実行は新方式へ移せません。保存された成果を確認してください');
  if(x.agentId&&x.agentId!==w.assignee)fail('継続は同じ仕事・担当を使います。担当変更とは分けて判断してください');
  const last=this.run(w.currentRunId),a=this.d.writableAgent(this.d.agent(w.assignee));
  return this.d.locked(a.id,async()=>{
   const snapshot=await this.d.observe(a);
   if(!continuationBoundary(last,snapshot,a.runtime,a)||!agentControls(a).canSend)fail('現在の受付・終端・所有を確認できません。入力は再送しません');
   if(this.d.data.runs.some(r=>r.agentId===a.id&&r.id!==last.id&&['queued','sent','running'].includes(r.runModel.state.kind)))fail('担当に別の未終了入力があります');
   this.version(q,x.revision);
   return this.continueLocked(x,retry,{purposeContinuation:{human:true,previousRunId:last.id,revision:q.revision+1}},'human');
  });
 });}
 async continueLocked(x,retry,extra,actor,{deferSave=false}={}){return this.d.persist(async()=>{
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);operation(x.operationId);instruction(x.instruction);
  const key=runKey(q.id,(retry?'retry:':'resume:')+x.operationId),old=this.d.data.runs.find(r=>r.requestId===key);
  if(old){if(old.workId!==w.id||(old.retryInstruction||old.instruction)!==x.instruction)fail('operationIdの再利用です');return old;}
  if(!(extra.purposeContinuation&&w.state.kind==='completed'&&w.state.by!=='human'))this.active(q);
  this.version(q,x.revision);
  if(q.report&&w.parentId)fail('報告工程では子作業を再開できません');
  const last=this.run(q.report?w.reportRunId:w.currentRunId);
  if(retry?!['failed','interrupted','terminated'].includes((last&&runState(last))):(last&&runState(last))!=='completed')fail('未受付・不明・実行中の入力は再送できません。resumeは途中応答完了後、retryは失敗/中断後です');

  if(x.agentId&&x.agentId!==w.assignee)fail('継続は同じ仕事・担当です');
  this.d.writableAgent(this.d.agent(w.assignee));
  delete w.metadata.latestResultId;
  const r=this.enqueue(q,w,q.report&&!w.parentId?this.reportPrompt(q):x.instruction,(retry?'retry:':'resume:')+x.operationId,retry?'retry':'continuation',{...extra,instructionSource:{actor,...(extra.purposeContinuation?.actorRunId?{actorRunId:extra.purposeContinuation.actorRunId}:{})},...(q.report&&!w.parentId?{phase:'report',retryInstruction:x.instruction}:{} )});
  if(w.inbox&&r.phase!=='report')applyGraph(this.d.data,q,{type:'supplement',actor,requestId:w.id,input:{id:randomUUID(),kind:'supplement',text:x.instruction,createdAt:r.createdAt,attempts:[r.id]}});
  // Include this newly accepted correction before the report can be dispatched.
  if(r.phase==='report')r.instruction=this.reportPrompt(q);q.revision++;if(!deferSave)await this.d.save();return r;
 });}
 async cancelQueued(x){return this.d.locked('request-graph',async()=>{
  const r=this.run(x.runId);if(!r||r.agentId!==x.agentId||r.humanRequestId!==x.humanRequestId)fail('対象Agent・依頼・runが一致しません',404);
  return this.d.locked(r.agentId,()=>this.d.persist(async()=>{
  if(r.conversationId){
   if(r.conversationSource?.kind!=='human'||r.humanRequestId)fail('人間の未送信会話だけ取り消せます');
   if(r.queueCancelledAt)return structuredClone(r);
   if(!canCancelQueued(r))fail('未送信の入力だけ取り消せます。送信状態を再確認してください');
   changeRun(r,{type:'cancel',actor:'human'});r.queueCancelledAt=now();r.error=null;
   await this.d.save();return structuredClone(r);
  }
  const q=this.root(r.humanRequestId),w=this.work(q,r.workId);
  if(r.queueCancelledAt)return structuredClone(r);
  if(!canCancelQueued(r)||w.currentRunId!==r.id||requestStatus(q)!=='active')fail('未送信の入力だけ取り消せます。送信状態を再確認してください');
  const previous=r.steerTarget&&this.run(r.steerTarget.runId);
  if(r.steerTarget&&(!previous||runState(previous)!=='superseded'||previous.runModel.supersededBy!==r.id))fail('補足元の状態を確認できません');
  changeRun(r,{type:'cancel',actor:'human'});r.queueCancelledAt=now();r.error=null;
  if(previous){
   // The supplement never reached the provider. Restore ownership of the
   // ongoing turn, but never restore an invalidated finish declaration.
   changeRun(previous,{type:'restore',actor:'human',successorId:r.id});w.currentRunId=previous.id;observeRequest(this.d.data,q);
  }else{applyGraph(this.d.data,q,{type:'withdraw',actor:'human',requestId:w.id,reason:'未送信の依頼を取り下げ'});if(!w.parentId)q.cancelledAt=now();}
  q.revision++;
  await this.d.save();
  return structuredClone(r);
 }));});}
 withdrawLocked(q,w,{actor,reason,...authority}){
  applyGraph(this.d.data,q,{type:'withdraw',actor,requestId:w.id,reason,...authority});
  const targets=new Set([w.id]);for(let changed=true;changed;){changed=false;for(const child of q.requestGraph.nodes)if(targets.has(child.parentId)&&!targets.has(child.id)){targets.add(child.id);changed=true;}}
  // The reservation can be cancelled. A dispatched input remains an observed fact.
  for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&targets.has(r.workId)&&runState(r)==='queued'))changeRun(r,actor==='human'?{type:'cancel',actor:'human'}:{type:'cancel-conversation-job',actor:'agent',requestId:q.id});
 }
 async withdrawChild(x){return this.d.locked('request-graph',()=>this.d.persist(async()=>{
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId),payload=JSON.stringify(x),old=q.requestGraph.operations.find(o=>o.id===x.operationId);
  if(old){if(old.payload!==payload)fail('operationIdの再利用です');return structuredClone(old.receipt);}
  if(!w.parentId)fail('直接依頼した子仕事だけ中止できます');const parent=this.work(q,w.parentId);await this.actor(q,parent,x.actorRunId);
  if(typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>16000)fail('中止理由を指定してください');
  this.withdrawLocked(q,w,{actor:'agent',reason:x.reason,parentWorkId:parent.id,actorRunId:x.actorRunId});q.revision++;
  const receipt={workId:w.id,state:'withdrawn',actorRunId:x.actorRunId};q.requestGraph.operations.push({id:x.operationId,payload,receipt});await this.d.save();return structuredClone(receipt);
 }));}
 async cancel(x){return this.d.locked('request-graph',()=>this.d.persist(async()=>{
  const q=this.root(x.humanRequestId);if(q.integrity)fail('依頼の参照不整合を修復してください');if(requestStatus(q)==='cancelled')return this.get(q.id);
  this.version(q,x.revision);if(requestStatus(q)==='completed')fail('完了した依頼はキャンセルできません');
  this.withdrawLocked(q,this.work(q,q.rootWorkId),{actor:'human',reason:x.reason||'人間が取り下げ'});q.cancelledAt=now();q.revision++;
  for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&['sent','running'].includes(r.runModel?.state.kind)))changeRun(r,{type:'close-tracking',actor:'human',reason:'request-cancelled'});
  await this.d.save();return this.get(q.id);
 }));}
 async settle(requests=this.requests){return this.d.persist(()=>this.settleChanges(requests));}
 async settleChanges(requests=this.requests){
  let changed=false;
  for(const q of requests){
   if(!q.integrity){const prior=JSON.stringify(q);observeRequest(this.d.data,q);updateProcedureGuidance(this,q);if(prior!==JSON.stringify(q))changed=true;}
   if(!q.integrity)for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&r.origin==='inbox'&&r.runModel.state.kind==='queued')){
    const w=this.work(q,r.workId),ids=new Set([...(w.selfResume?.history.map(e=>e.reservation.id)||[]),...(w.inbox||[]).filter(i=>i.procedure).map(i=>i.id)]);
    if(!r.inboxBatch?.some(id=>ids.has(id)))continue;
    if(['completed','withdrawn'].includes(w.state.kind)||r.inboxBatch.every(id=>w.inbox.find(i=>i.id===id)?.retiredBy)){
     changeRun(r,{type:'cancel-inbox-reservation',actor:'program'});r.queueCancelledAt=now();r.error='scheduled-input-retired';
     if(w.currentRunId===r.id&&w.state.kind==='active')w.currentRunId=r.runModel.retryOf;
     changed=true;
    }
   }
   if(!q.integrity&&q.conversationId&&this.d.conversations.settle(q))changed=true;
   if(q.integrity||requestStatus(q)!=='active'&&(requestStatus(q)!=='completed'||q.completedAt))continue;
   const before=JSON.stringify(q);
   for(const w of q.requestGraph.nodes)if(w.inbox?.some(i=>i.result&&('decision' in i.result||!i.result.outcome))){const inputs=this.inputs(q.id,w.id);for(const i of w.inbox)if(i.result)i.result=inputs.find(x=>x.id===i.id).result;}
   const root=rootNode(q),head=this.run(root.currentRunId);
   observeRequest(this.d.data,q);
   if(!q.conversationId)await settleHumanDelivery(this,q);
   for(const w of q.requestGraph.nodes)if(w.state.kind==='active'&&!w.planned&&!this.d.data.agents.some(a=>a.id===w.assignee))applyGraph(this.d.data,q,{type:'review',actor:'program',requestId:w.id,reason:'next-step-agent-unavailable'});
   if(requestStatus(q)==='active'){
    for(const e of resultEntries(this.d.data,q).filter(e=>!e.superseded&&!e.handled)){
     const parent=this.work(q,e.parentWorkId);if(!parent.inbox||parent.inbox.some(i=>i.result?.resultId===e.id))continue;
     parent.inbox.push({id:randomUUID(),kind:'result',text:(this.run(e.resultRunId)?.output||this.run(e.resultRunId)?.error||'出力なし').slice(0,8000),createdAt:now(),attempts:[],result:this.resultReference(e)});
    }
    for(const step of steps(this.d.data,q)){
     const child=step.type==='deliver-result'?this.run(step.childRunId):null;
     const target=child?this.work(q,this.work(q,child.workId).parentId):this.work(q,q.rootWorkId);
     const agent=this.d.data.agents.find(a=>a.id===target.assignee);
     if(!agent||this.d.agentDeleting(agent)||['terminated','stopping'].includes(agentControls(agent).state))applyGraph(this.d.data,q,{type:'review',actor:'program',requestId:target.id,reason:'next-step-agent-unavailable'});
    }
   }
   if(requestStatus(q)==='completed'&&!q.completedAt){
    q.completedAt=now();q.finalRunId=rootNode(q).reportRunId||rootNode(q).currentRunId;

    // Stable delivery key; historical notification records are never reset.
    if(!q.conversationId)q.notification=transitionDelivery(q.notification,{type:'prepare',id:'request:'+q.id});
   }

   if(before!==JSON.stringify(q)){q.revision++;changed=true;}
  }
  if(changed)await this.d.save();
 }
 async pump(wait=true,requests=this.requests,dispatch=true){const queued=await this.d.locked('request-graph',async()=>{
  await this.settle(requests);
  for(const q of requests.filter(q=>requestStatus(q)==='active')){
   for(const w of q.requestGraph.nodes.filter(w=>w.inbox&&w.state.kind==='active')){
    await this.d.persist(async()=>{
     observeRequest(this.d.data,q);
     const previous=this.run(w.currentRunId),agent=this.d.data.agents.find(a=>a.id===w.assignee);
     if(!agent||this.d.agentDeleting(agent))return;
     if(w.state.kind!=='active'||!previous||runState(previous)!=='completed'||!this.schedulable(previous)||!agentControls(agent).canSend)return;
     const batch=w.inbox.filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.length<2).slice(0,24);if(!batch.length)return;
     const handover={previousOutput:(previous.finalOutput||previous.output||'').slice(0,3000),previousOutputTruncated:(previous.finalOutput||previous.output||'').length>3000,children:q.requestGraph.nodes.filter(c=>c.parentId===w.id).map(c=>({requestId:c.id,state:c.state,assignee:c.assignee})),handledInputs:w.inbox.filter(i=>i.handledBy).map(i=>({id:i.id,kind:i.kind,...(i.text===(w.metadata.instruction||q.instruction)?{textInPurpose:true}:{text:i.text.slice(0,500),truncated:i.text.length>500})})).slice(-12)};
     const r=this.enqueue(q,w,'依頼を再開してください。元の目的: '+(w.metadata.instruction||q.instruction)+'\n引継ぎ抜粋（全文はrequests get/inputs）: '+JSON.stringify(handover)+'\n未対応入力を確認し、必要な判断のみ進めてください。既存の外部操作をやり直さない。','inbox:'+randomUUID(),'inbox',{inboxBatch:batch.map(i=>i.id),...(batch.some(i=>i.attachments?.length)?{attachments:[...new Map(batch.flatMap(i=>i.attachments||[]).map(a=>[a.id,a])).values()]}:{}),...(batch.some(i=>i.travelContexts?.length)?{travelContexts:batch.flatMap(i=>i.travelContexts||[])}:{})});
     for(const item of batch)w.inbox.find(i=>i.id===item.id).attempts.push(r.id);await this.d.save();
    });
   }

  }
  const queued=[];
  for(const r of this.d.data.runs.filter(r=>runState(r)==='queued'&&requests.some(q=>q.id===r.humanRequestId))){
   if(quarantinedRun(this.d.data,r))continue;
   const owner=this.d.data.agents.find(a=>a.id===r.agentId);
   if(owner&&!retirementRunAllowed(this.d.data,owner,r)){await this.d.holdRetiredRun(r);continue;}
   const q=this.root(r.humanRequestId);if(q.integrity)continue;
   if(r.runModel.phase==='result'&&!r.dispatchAttemptedAt){
    const result=resultEntries(this.d.data,q).find(e=>e.id===r.runModel.resultOf);
    if(result&&(result.handled||result.superseded)){
     await this.d.persist(async()=>{
      changeRun(r,{type:'cancel-result-reservation',actor:'program',resultId:result.id,reason:result.handled?'handled':'superseded'});r.queueCancelledAt=now();r.error='result-reservation-obsolete';
      const w=this.work(q,r.workId);if(w.currentRunId===r.id)w.currentRunId=r.runModel.retryOf;
      observeRequest(this.d.data,q);q.revision++;await this.d.save();
     });continue;
    }
   }
   const a=this.d.data.agents.find(a=>a.id===r.agentId);if(!a){await this.d.persist(async()=>{changeRun(r,{type:'dispatch-blocked',actor:'program',at:Date.now(),reason:'agent-missing'});await this.d.save();});continue;}if(requestStatus(q)==='active'&&(node(q.requestGraph,r.workId)?.state.kind==='active'||r.phase==='report'&&this.reportCurrent(r))&&(this.d.agentDeleting(a)||r.steerTarget||agentControls(a).canSend||['terminated','stopping'].includes(agentControls(a).state)))queued.push(r);
  }
  return queued;
 });
 if(!dispatch)return queued;
 await this.dispatchReady(queued,wait);
 }
 async dispatchReady(queued=this.d.data.runs.filter(r=>runState(r)==='queued'&&(r.humanRequestId||r.conversationId)),wait=false){
 const eligible=[];for(const r of queued){const a=this.d.data.agents.find(a=>a.id===r.agentId);if(a&&!retirementRunAllowed(this.d.data,a,r)){await this.d.holdRetiredRun(r);continue;}eligible.push(r);}
 const first=new Map();for(const r of eligible.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))if(this.schedulable(r)&&!first.has(r.agentId))first.set(r.agentId,r);
 const dispatched=Promise.allSettled([...first.values()].map(r=>r.conversationId?this.d.units.agent(r.agentId,()=>this.dispatchQueued(r)):this.d.units.run(r.humanRequestId,()=>this.dispatchQueued(r))));
 if(wait){await dispatched;await Promise.allSettled([...this.dispatching.values()]);}
 }
 async notifications(requests=this.requests){
  for(const q of requests.filter(q=>!q.conversationId&&requestStatus(q)==='completed'&&q.notification?.status==='pending')){
   await this.d.locked('notify:'+q.id,async()=>{
    const claimed=await this.d.persist(async()=>{
     // Recheck after waiting for any in-flight settlement to commit or roll back.
     if(requestStatus(q)!=='completed'||q.notification?.status!=='pending')return false;
     q.notification=transitionDelivery(q.notification,{type:'claim',at:now()});await this.d.save();return true;
    });
    if(!claimed)return;
    try{
     const r=this.run(q.finalRunId);
     const result=await this.d.notifier.enqueue({id:'request:'+q.id,role:'assistant',kind:'request',agentId:q.finalAgentId,content:'依頼全体が完了しました。\n'+(r?.finalOutput||r?.output||'最終報告を村で確認してください。')});
     await this.d.persist(async()=>{q.notification=transitionDelivery(q.notification,{type:'result',result});await this.d.save();});
    }catch(error){await this.d.persist(async()=>{q.notification=transitionDelivery(q.notification,{type:'unknown',reason:'notification-outcome-unknown'});await this.d.save();});}
   });
  }
 }
}
