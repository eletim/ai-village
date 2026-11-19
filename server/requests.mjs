import {transitionRecovery,transitionDelivery,transitionReportDelivery} from './state/auxiliary.ts';
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
import {runState,accepted,initializeSupplement,initializeRun,initializeRetry,initializeResume,changeRun} from './run-lifecycle.mjs';
import {canCancelQueued} from '../src/queued-run.js';
import {terminalBoundary,correlate} from './runtime-events.mjs';
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
  for(const name of ['report','deadline','humanDeadline','plan','launch','assignPlan','discard','humanCompose','amend','supplement','delegate','respond','finish','complete','continue','cancelQueued','cancel']){
   const command=this[name].bind(this);
   this[name]=(x,...args)=>this.d.units.run(x.humanRequestId,()=>command(x,...args));
  }
  const start=this.start.bind(this);this.start=(id,...args)=>this.d.units.agent(id,()=>start(id,...args));
 }
 init(){
  this.d.data.requests ||= [];
  // Never mint tickets or replay notifications for historical/untracked turns.
  for(const r of this.d.data.runs)if(!r.humanRequestId)r.notificationPolicy ||= 'legacy-untracked';
  for(const q of this.d.data.requests)if(!q.integrity&&q.notification?.status==='attempting')q.notification=transitionDelivery(q.notification,{type:'unknown',reason:'restart-during-delivery'});
 }
 reportStatus(){return {enabled:this.d.data.reportSettings?.enabled!==false};}
 async configureReport(enabled){
  if(typeof enabled!=='boolean')fail('報告モードはtrue/falseで指定してください',400);
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
   this.d.data.reportSettings={enabled};await this.d.save();
   return this.reportStatus();
  }));
 }
 reportCurrent(r){const q=this.root(r.humanRequestId),w=this.work(q,r.workId);return !!q.report&&w.reportRunId===r.id&&true;}
 reportPrompt(q){return this.d.rules.reportData(q,this.run(q.report.sourceRunId),this.d.data.runs.filter(r=>r.humanRequestId===q.id&&r.origin==='steering'&&!r.queueCancelledAt).map(r=>r.instruction).concat((rootNode(q).inbox||[]).filter(i=>i.kind==='supplement').map(i=>i.text)));}
 get requests(){return this.d.data.requests;}
 root(id){return this.requests.find(q=>q.id===id)||fail('依頼がありません',404);}
 work(q,id){if(q.integrity)fail('依頼の参照不整合を修復してください: '+q.integrity.reasons.join(', '));return q.requestGraph.nodes.find(w=>w.id===id)||fail('この依頼の作業ではありません',404);}
 run(id){return this.d.data.runs.find(r=>r.id===id);}
 active(q){if(requestStatus(q)!=='active')fail('依頼は受付中ではありません: '+requestStatus(q));}
 version(q,revision){if(!Number.isInteger(revision)||revision!==q.revision)fail('依頼が更新されています。requests getでrevisionを再取得してください');}
 list(agentId){return structuredClone(this.requests.filter(q=>!agentId||q.requestGraph?.nodes?.some?.(w=>w.assignee===agentId)).map(q=>projectRequest(this.d.data,q)));}
 get(id){const q=this.root(id);return structuredClone({...projectRequest(this.d.data,q),runs:this.d.data.runs.filter(r=>r.humanRequestId===id).map(projectRun)});}
 results(id,workId){const q=this.root(id);this.work(q,workId);return structuredClone(resultEntries(this.d.data,q).filter(e=>e.parentWorkId===workId).map(e=>({...e,output:this.run(e.resultRunId)?.output||'',error:this.run(e.resultRunId)?.error||null})));}
 enqueue(q,w,text,op,origin,extra={}){
  const previous=this.run(extra.phase==='report'&&w.reportRunId?w.reportRunId:w.currentRunId)||(w.parentId?this.run(this.work(q,w.parentId).currentRunId):null);
  const r={id:randomUUID(),requestId:runKey(q.id,op),agentId:w.assignee,humanRequestId:q.id,workId:w.id,origin,instruction:text,travelContexts:structuredClone(previous?.contextTravelContexts||previous?.travelContexts||q.travelContexts||[]),attachments:structuredClone(previous?.contextAttachments||previous?.attachments||q.attachments||[]),createdAt:now(),achievement:'unverified',recoveryPolicy:1,...extra};
  if(origin==='inbox')initializeResume(r,previous);
  else if(extra.steerTarget)initializeSupplement(r,this.run(extra.steerTarget.runId));
  else if(extra.retryFrom)initializeRetry(r,this.run(extra.retryFrom),{actor:extra.autoRecoveryFrom?'program':extra.legacyAgentRunId?'agent':'human',legacyAgentRunId:extra.legacyAgentRunId,leafRoot:!w.parentId&&!q.requestGraph.nodes.some(c=>c.parentId===w.id),boundaryConfirmed:!!extra.autoRecoveryFrom,agentIdle:!!extra.autoRecoveryFrom});
  else initializeRun(r,{actor:r.phase==='report'||origin==='result'?'program':origin==='delegation'||origin==='agent'||extra.legacyAgentRunId?'agent':'human',parentRunId:w.parentId?this.work(q,w.parentId).currentRunId:null,resultOf:extra.resultId||null,recipientRunId:previous?.id||null});
  if(previous&&previous.workId===w.id&&r.phase!=='report'&&!r.runModel.retryOf)r.runModel={...r.runModel,retryOf:previous.id};
  this.d.data.runs.push(r);
  if(w.inbox&&['human','agent','delegation'].includes(origin)&&!w.inbox.length)w.inbox.push({id:randomUUID(),kind:'request',text,createdAt:r.createdAt,attempts:[r.id]});
  if(!node(q.requestGraph,w.id)){w.runIds.push(r.id);w.currentRunId=r.id;w.runAgents[r.id]=w.assignee;applyGraph(this.d.data,q,{type:'add',actor:w.createdBy||(w.parentId?'agent':'human'),request:w});}
  else applyGraph(this.d.data,q,{type:'attempt',actor:r.runModel.createdBy,requestId:w.id,runId:r.id,report:r.phase==='report',resolveReview:r.runModel.createdBy==='human'&&['retry','continuation'].includes(origin)});
  if(w.inbox&&['retry','continuation'].includes(origin)){for(const i of w.inbox.filter(i=>!i.handledBy&&!i.retiredBy))i.attempts.push(r.id);}
  return r;
 }
 context(r){const q=this.root(r.humanRequestId),w=this.work(q,r.workId);return this.d.rules.dynamic(r)+(w.metadata.reporting?'\n依頼の期限と最新報告: '+JSON.stringify({version:w.metadata.reporting.version,completionAt:w.metadata.reporting.completionAt,reportAt:w.metadata.reporting.reportAt,expired:w.metadata.reporting.expired,latestReport:w.metadata.reporting.reports.at(-1)})+'\n期限延長は依頼元の判断。子依頼には報告期限を指定し、未報告の期限通知が届いたら状況確認・期限変更を判断する。完了前でもreportで進捗・相談を届ける。':'')+(w.inbox&&r.phase!=='report'?'\n今回の対象入力: '+JSON.stringify(this.inputs(q.id,w.id).filter(i=>i.attempts.includes(r.id)).map(({id,kind,text,result,textSourceUnavailable})=>({id,kind,text:text.slice(0,2000),truncated:text.length>2000,textSourceUnavailable,result})))+'\ninputProtocol=1: truncatedの入力はrequests inputsで全文を確認する。textSourceUnavailable=trueは元結果を取得できないため、抜粋を全文と扱わない。通常回答でも requests finish または respond に inputs:[対応した入力ID] と results を明示する。委任して結果待ちならrespondして応答を終え、村の再開を待つ。本文の完了宣言は状態を変えない。今回以外の依頼を操作しない。result.outcomeは実行の事実で、成果の採否ではない。resultsのdecisionは内容を確認してacceptまたはreworkを明示する。':'')+this.d.rules.context({humanRequestId:q.id,workId:w.id,runId:r.id,origin:r.origin,phase:r.phase||'work'},this.d.agent(r.agentId).inputEnvelope?.mode==='startup-v1');}
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
   if(input.steerTarget){
    const a=this.d.writableAgent(this.d.agent(agentId));
    const snapshot=await this.d.locked(a.id,()=>this.d.observe(a));
    if(!agentControls(a).canSteer||JSON.stringify(input.steerTarget)!==JSON.stringify(a.steerTarget))fail('補足対象が変わったか、native受付・実行状態を確認できません。再確認してください');
    if(this.d.data.runs.some(r=>r.requestId===input.requestId)||this.requests.some(q=>q.clientRequestId===input.requestId))fail('requestIdの再利用です');
    const r=await this.d.persist(async()=>{
    const previous=this.run(a.steerTarget.runId);let q=this.root(previous.humanRequestId),w=this.work(q,previous.workId);
    if(requestStatus(q)!=='active'){
     if(a.provider==='claude')fail('補足対象の依頼は受付中ではありません');
     q={commonRequests:true,inputProtocol:this.protocol,projectId:a.projectId||null,reportMode:this.reportStatus().enabled,id:randomUUID(),clientRequestId:input.requestId,instruction:input.instruction,travelContexts,attachments,originAgentId:agentId,finalAgentId:agentId,initialDeadlines:{completionAt:deadline(input.completionAt),reportAt:deadline(input.reportAt)},revision:0,createdAt:now(),requestGraph:{version:3,nodes:[],operations:[]}};
     w=newNode(q,{id:randomUUID(),assignee:agentId});q.rootWorkId=w.id;q.requestGraph.rootId=w.id;this.requests.push(q);
    }

    // A successor keeps the one human request/ticket and invalidates any old finish.
    if(q.requestGraph.nodes.length)this.active(q);q.revision++;

    const r=this.enqueue(q,w,input.instruction,'steer:'+input.requestId,'steering',{...(q.report&&previous.phase==='report'?{phase:'report'}:{}),requestId:input.requestId,steeringProvider:a.provider,steerTarget:structuredClone(a.steerTarget),priorInputs:snapshot.inputs.filter(i=>i.turnId===previous.turnId).map(({id,offset})=>({id,offset})),travelContexts,attachments,contextAttachments:[...new Map([...(previous.contextAttachments||previous.attachments||[]),...attachments].map(a=>[a.id,a])).values()],contextTravelContexts:structuredClone(travelContexts.length?travelContexts:previous.contextTravelContexts||previous.travelContexts||[])});
    q.initialRunId ||= r.id;changeRun(previous,{type:'supersede',actor:'human',successorId:r.id});
    await this.d.save();return r;
    });
    return r;
   }
   const legacy=this.d.data.runs.find(r=>r.requestId===input.requestId&&!r.humanRequestId);
   if(legacy){if(legacy.agentId!==agentId||legacy.instruction!==input.instruction||!sameTravelContexts(legacy.travelContexts,travelContexts)||JSON.stringify((legacy.attachments||[]).map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return legacy;}
   let q=this.requests.find(q=>q.clientRequestId===input.requestId);
   if(q){if(JSON.stringify(q.initialDeadlines||{completionAt:null,reportAt:null})!==JSON.stringify({completionAt:deadline(input.completionAt),reportAt:deadline(input.reportAt)})||q.originAgentId!==agentId||q.instruction!==input.instruction||!sameTravelContexts(q.travelContexts,travelContexts)||JSON.stringify((q.attachments||[]).map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return this.run(q.initialRunId);}
   const a=this.d.writableAgent(this.d.agent(agentId));if(!a.tabId||['terminated','stopping'].includes(agentControls(a).state))fail('Agentは送信可能ではありません');
   const r=await this.d.persist(async()=>{
   q={commonRequests:true,inputProtocol:this.protocol,projectId:a.projectId||null,reportMode:this.reportStatus().enabled,id:randomUUID(),clientRequestId:input.requestId,instruction:input.instruction,travelContexts,attachments,originAgentId:agentId,finalAgentId:agentId,initialDeadlines:{completionAt:deadline(input.completionAt),reportAt:deadline(input.reportAt)},revision:0,createdAt:now(),requestGraph:{version:3,nodes:[],operations:[]}};
   const w=newNode(q,{id:randomUUID(),assignee:agentId,metadata:{reporting:initialDeadlines(input)}});q.rootWorkId=w.id;q.requestGraph.rootId=w.id;this.requests.push(q);
   const r=this.enqueue(q,w,input.instruction,'human',originKind);r.requestId=input.requestId;q.initialRunId=r.id;
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
  await this.d.save();return structuredClone(input);
 }));}
 schedulable(r){
  if(!r.humanRequestId)return true;const a=this.d.agent(r.agentId);if(a.location==='mayor'||!this.root(r.humanRequestId).inputProtocol)return true;
  const owners=this.requests.filter(q=>requestStatus(q)==='active').flatMap(q=>q.requestGraph.nodes.filter(n=>n.assignee===a.id&&!n.planned&&n.state.kind==='active').map(n=>({n,at:this.run(n.runIds[0])?.createdAt||q.createdAt})));
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
 async continue(x,retry=false){return this.d.locked('request-graph',()=>this.continueLocked(x,retry));}
 async continueLocked(x,retry=false,extra={}){return this.d.persist(async()=>{
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);operation(x.operationId);instruction(x.instruction);
  const key=runKey(q.id,(retry?'retry:':'resume:')+x.operationId),old=this.d.data.runs.find(r=>r.requestId===key);
  if(old){if(old.workId!==w.id||(old.retryInstruction||old.instruction)!==x.instruction)fail('operationIdの再利用です');return old;}
  this.active(q);this.version(q,x.revision);
  if(q.report&&w.parentId)fail('報告工程では子作業を再開できません');
  const last=this.run(q.report?w.reportRunId:w.currentRunId);
  if(retry?!['failed','interrupted','terminated'].includes((last&&runState(last))):(last&&runState(last))!=='completed')fail('未受付・不明・実行中の入力は再送できません。resumeは途中応答完了後、retryは失敗/中断後です');

  if(x.agentId&&x.agentId!==w.assignee){for(let ancestor=w.parentId?this.work(q,w.parentId):null;ancestor;ancestor=ancestor.parentId?this.work(q,ancestor.parentId):null)if(ancestor.assignee===x.agentId)fail('祖先Agentへの担当交代はできません');for(const candidate of q.requestGraph.nodes.filter(c=>c.assignee===x.agentId)){let descendant=candidate;while(descendant.parentId&&descendant.parentId!==w.id)descendant=this.work(q,descendant.parentId);if(descendant.parentId===w.id)fail('子孫Agentへの担当交代はできません');}const target=this.d.writableAgent(this.d.agent(x.agentId));if(!target.tabId||['terminated','stopping'].includes(agentControls(target).state))fail('交代先Agentを利用できません');applyGraph(this.d.data,q,{type:'assign',actor:'human',requestId:w.id,agentId:x.agentId});if(!w.parentId)q.finalAgentId=x.agentId;}
  this.d.writableAgent(this.d.agent(w.assignee));
  delete w.metadata.latestResultId;
  const r=this.enqueue(q,w,q.report&&!w.parentId?this.reportPrompt(q):x.instruction,(retry?'retry:':'resume:')+x.operationId,retry?'retry':'continuation',{...extra,...(retry?{retryFrom:last.id}:{}),...(q.report&&!w.parentId?{phase:'report',retryInstruction:x.instruction}:{} )});q.revision++;await this.d.save();return r;
 });}
 async cancelQueued(x){return this.d.locked('request-graph',async()=>{
  const r=this.run(x.runId);if(!r||r.agentId!==x.agentId||r.humanRequestId!==x.humanRequestId)fail('対象Agent・依頼・runが一致しません',404);
  return this.d.locked(r.agentId,()=>this.d.persist(async()=>{
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
 async cancel(x){return this.d.locked('request-graph',()=>this.d.persist(async()=>{
  const q=this.root(x.humanRequestId);if(q.integrity)fail('依頼の参照不整合を修復してください');if(requestStatus(q)==='cancelled')return this.get(q.id);
  this.version(q,x.revision);if(requestStatus(q)==='completed')fail('完了した依頼はキャンセルできません');
  applyGraph(this.d.data,q,{type:'withdraw',actor:'human',requestId:q.rootWorkId,reason:x.reason||'人間が取り下げ'});q.cancelledAt=now();q.revision++;
  for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&runState(r)==='queued')){changeRun(r,{type:'cancel',actor:'human'});r.error='request-cancelled-before-dispatch';}
  for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&['sent','running'].includes(r.runModel?.state.kind)))changeRun(r,{type:'close-tracking',actor:'human',reason:'request-cancelled'});
  await this.d.save();return this.get(q.id);
 }));}
 async settle(requests=this.requests){return this.d.persist(()=>this.settleChanges(requests));}
 async settleChanges(requests=this.requests){
  let changed=false;
  for(const q of requests){
   if(q.integrity||requestStatus(q)!=='active'&&(requestStatus(q)!=='completed'||q.completedAt))continue;
   const before=JSON.stringify(q);
   for(const w of q.requestGraph.nodes)if(w.inbox?.some(i=>i.result&&('decision' in i.result||!i.result.outcome))){const inputs=this.inputs(q.id,w.id);for(const i of w.inbox)if(i.result)i.result=inputs.find(x=>x.id===i.id).result;}
   const root=rootNode(q),head=this.run(root.currentRunId);
   observeRequest(this.d.data,q);
   await settleHumanDelivery(this,q);
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
    q.notification=transitionDelivery(q.notification,{type:'prepare',id:'request:'+q.id});
   }

   if(before!==JSON.stringify(q)){q.revision++;changed=true;}
  }
  if(changed)await this.d.save();
 }
 recoveryBoundary(r,snapshot,status){
  const observed=r&&correlate(r,snapshot);
  return observed?.state==='failed'&&observed.errorCode==='server_overloaded'&&terminalBoundary(snapshot,status)&&snapshot.sessionId===r.sessionId&&snapshot.turns.at(-1).id===r.turnId&&
   (!r.baselineRuntime?.fileIdentity||snapshot.fileIdentity===r.baselineRuntime.fileIdentity);
 }
 recoveryPrompt(q,w){return this.d.rules.recovery(q,w);}
 async recover(requests=this.requests){
  // Read-only host observations stay outside the short persistence boundary.
  for(const q of requests.filter(q=>requestStatus(q)==='active'))for(const w of q.requestGraph.nodes){
   const a=this.d.data.agents.find(a=>a.id===w.assignee);if(!a||this.d.agentDeleting(a))continue;
   const r=this.run(w.currentRunId);if((r&&runState(r))!=='failed'||r.recovery?.status==='enqueued')continue;
   let reason=r.phase==='report'?'報告生成に失敗しました。元回答は非表示です。確認して報告のみ再試行してください':r.steerTarget?'補足を含む作業は内容・副作用を確認して手動で復旧してください':r.recoveryPolicy!==1?'このrunは自動復旧導入前です':r.errorCode!=='server_overloaded'?'自動再試行対象外のエラーです':
    !accepted(r)||!r.inputId||!r.sessionId||!r.turnId?'受付照合が不完全です':
    w.parentId||q.requestGraph.nodes.some(c=>c.parentId===w.id)?'子作業または委任元との確認が必要です':null;
   const budget=w.metadata.autoRetry;
   if(!reason&&budget&&(budget.attempts>=2||Date.now()-budget.firstFailureAt>=600000))reason='自動再試行の上限（2回・10分）に達しました';
   if(reason){if(r.recovery?.status!=='manual'||r.recovery.reason!==reason)await this.d.persist(async()=>{r.recovery=transitionRecovery(r.recovery,{type:'manual',reason});await this.d.save();});continue;}
   if(!w.metadata.autoRetry||!r.recovery)await this.d.persist(async()=>{
    w.metadata.autoRetry ||= {attempts:0,firstFailureAt:Date.now()};
    r.recovery=transitionRecovery(r.recovery,{type:'schedule',at:Date.now()+[30000,120000][w.metadata.autoRetry.attempts]});await this.d.save();
   });
   if(r.recovery.status!=='scheduled'||r.recovery.nextAt>Date.now())continue;
   const snapshot=await this.d.locked(a.id,()=>this.d.observe(a));
   await this.d.persist(async()=>{
    if(!this.recoveryBoundary(r,snapshot,a.runtime)){r.recovery=transitionRecovery(r.recovery,{type:'manual',reason:'終了後の入力またはセッションを確認できません。手動で復旧してください'});await this.d.save();return;}
    if(!agentControls(a).canSend)return;
    r.recovery=transitionRecovery(r.recovery,{type:'enqueue'});w.metadata.autoRetry.attempts++;
    await this.continueLocked({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:'auto-recovery-'+r.id,instruction:this.recoveryPrompt(q,w)},true,{autoRecoveryFrom:r.id,recoveryDeadline:w.metadata.autoRetry.firstFailureAt+600000});
   });
  }
 }
 async pump(wait=true,requests=this.requests,dispatch=true){const queued=await this.d.locked('request-graph',async()=>{
  await this.settle(requests);await this.recover(requests);
  for(const q of requests.filter(q=>requestStatus(q)==='active')){
   for(const w of q.requestGraph.nodes.filter(w=>w.inbox&&w.state.kind==='active')){
    await this.d.persist(async()=>{
     observeRequest(this.d.data,q);
     const previous=this.run(w.currentRunId),agent=this.d.data.agents.find(a=>a.id===w.assignee);
     if(!agent||this.d.agentDeleting(agent))return;
     if(w.state.kind!=='active'||!previous||runState(previous)!=='completed'||!this.schedulable(previous)||!agentControls(agent).canSend)return;
     const batch=w.inbox.filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.length<2).slice(0,24);if(!batch.length)return;
     const handover={previousOutput:(previous.finalOutput||previous.output||'').slice(0,3000),previousOutputTruncated:(previous.finalOutput||previous.output||'').length>3000,children:q.requestGraph.nodes.filter(c=>c.parentId===w.id).map(c=>({requestId:c.id,state:c.state,assignee:c.assignee})),handledInputs:w.inbox.filter(i=>i.handledBy).map(i=>({id:i.id,kind:i.kind,text:i.text.slice(0,500),truncated:i.text.length>500})).slice(-12)};
     const r=this.enqueue(q,w,'依頼を再開してください。元の目的: '+(w.metadata.instruction||q.instruction)+'\n引継ぎ抜粋（全文はrequests get/inputs）: '+JSON.stringify(handover)+'\n未対応入力を確認し、必要な判断のみ進めてください。既存の外部操作をやり直さない。','inbox:'+randomUUID(),'inbox',{inboxBatch:batch.map(i=>i.id),...(batch.some(i=>i.attachments?.length)?{attachments:[...new Map(batch.flatMap(i=>i.attachments||[]).map(a=>[a.id,a])).values()]}:{}),...(batch.some(i=>i.travelContexts?.length)?{travelContexts:batch.flatMap(i=>i.travelContexts||[])}:{})});
     for(const item of batch)w.inbox.find(i=>i.id===item.id).attempts.push(r.id);await this.d.save();
    });
   }
   for(const e of resultEntries(this.d.data,q).filter(e=>!e.superseded&&!e.handled&&!e.deliveryRunId)){
    const parent=this.work(q,e.parentWorkId);if(parent.inbox)continue;const previous=this.run(parent.currentRunId),agent=this.d.data.agents.find(a=>a.id===parent.assignee);
    if(!agent||this.d.agentDeleting(agent)||!terminal(previous)||!agentControls(agent).canSend)continue;
    if(!steps(this.d.data,q).some(step=>step.type==='deliver-result'&&step.childRunId===e.resultRunId))continue;
    const output=this.run(e.resultRunId)?.output||this.run(e.resultRunId)?.error||'出力なし';
    const text=this.d.rules.result(q,parent,e,output);
    await this.d.persist(async()=>{this.enqueue(q,parent,text,'result:'+e.id,'result',{resultId:e.id});await this.d.save();});
   }
  }
  const queued=[];
  for(const r of this.d.data.runs.filter(r=>runState(r)==='queued'&&requests.some(q=>q.id===r.humanRequestId))){
   if(quarantinedRun(this.d.data,r))continue;
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
 async dispatchReady(queued=this.d.data.runs.filter(r=>runState(r)==='queued'&&r.humanRequestId),wait=false){
 const first=new Map();for(const r of queued.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))if(this.schedulable(r)&&!first.has(r.agentId))first.set(r.agentId,r);
 const dispatched=Promise.allSettled([...first.values()].map(r=>this.d.units.run(r.humanRequestId,()=>this.dispatchQueued(r))));
 if(wait){await dispatched;await Promise.allSettled([...this.dispatching.values()]);}
 }
 async notifications(requests=this.requests){
  for(const q of requests.filter(q=>requestStatus(q)==='completed'&&q.notification?.status==='pending')){
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
