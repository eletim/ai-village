import {projectRequest,projectRun} from './state-projection.mjs';
import {agentControls} from './agent-lifecycle.mjs';
import {bindRequest,requestChange,observeRequest,requestStatus,resultEntries} from './request-lifecycle.mjs';
import {nextSteps} from './state/progress.ts';
import {runState,accepted,initializeSupplement,initializeRun,initializeRetry,changeRun,unconfirmed} from './run-lifecycle.mjs';
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
 constructor(direct){this.d=direct;}
 init(){
  this.d.data.requests ||= [];
  for(const q of this.d.data.requests)bindRequest(this.d.data,q);
  // Never mint tickets or replay notifications for historical/untracked turns.
  for(const r of this.d.data.runs)if(!r.humanRequestId)r.notificationPolicy ||= 'legacy-untracked';
  for(const q of this.d.data.requests)if(q.notification?.status==='attempting')q.notification={...q.notification,status:'delivery_unknown',reason:'restart-during-delivery'};
 }
 reportStatus(){return {enabled:this.d.data.reportSettings?.enabled!==false};}
 async configureReport(enabled){
  if(typeof enabled!=='boolean')fail('報告モードはtrue/falseで指定してください',400);
  return this.d.locked('request-graph',async()=>{
   const previous=this.d.data.reportSettings;this.d.data.reportSettings={enabled};
   try{await this.d.save();}catch(e){this.d.data.reportSettings=previous;throw e;}
   return this.reportStatus();
  });
 }
 reportPrompt(q){return this.d.rules.reportData(q,this.run(q.report.sourceRunId),this.d.data.runs.filter(r=>r.humanRequestId===q.id&&r.origin==='steering'&&!r.queueCancelledAt).map(r=>r.instruction));}
 get requests(){return this.d.data.requests;}
 root(id){return this.requests.find(q=>q.id===id)||fail('依頼がありません',404);}
 work(q,id){return q.works.find(w=>w.id===id)||fail('この依頼の作業ではありません',404);}
 run(id){return this.d.data.runs.find(r=>r.id===id);}
 active(q){if(requestStatus(q)!=='active')fail('依頼は受付中ではありません: '+requestStatus(q));}
 version(q,revision){if(!Number.isInteger(revision)||revision!==q.revision)fail('依頼が更新されています。requests getでrevisionを再取得してください');}
 list(agentId){return structuredClone(this.requests.filter(q=>!agentId||q.works.some(w=>w.agentId===agentId)).map(q=>projectRequest(this.d.data,q)));}
 get(id){const q=this.root(id);return structuredClone({...projectRequest(this.d.data,q),runs:this.d.data.runs.filter(r=>r.humanRequestId===id).map(projectRun)});}
 results(id,workId){const q=this.root(id);this.work(q,workId);return structuredClone(resultEntries(this.d.data,q).filter(e=>e.parentWorkId===workId).map(e=>({...e,output:this.run(e.resultRunId)?.output||'',error:this.run(e.resultRunId)?.error||null})));}
 enqueue(q,w,text,op,origin,extra={}){
  const previous=this.run(w.currentRunId)||(w.parentWorkId?this.run(this.work(q,w.parentWorkId).currentRunId):null);
  const r={id:randomUUID(),requestId:runKey(q.id,op),agentId:w.agentId,humanRequestId:q.id,workId:w.id,origin,instruction:text,travelContexts:structuredClone(previous?.contextTravelContexts||previous?.travelContexts||q.travelContexts||[]),attachments:structuredClone(previous?.contextAttachments||previous?.attachments||q.attachments||[]),createdAt:now(),achievement:'unverified',recoveryPolicy:1,...extra};
  if(extra.steerTarget)initializeSupplement(r,this.run(extra.steerTarget.runId));
  else if(extra.retryFrom)initializeRetry(r,this.run(extra.retryFrom),{actor:extra.autoRecoveryFrom?'program':extra.legacyAgentRunId?'agent':'human',legacyAgentRunId:extra.legacyAgentRunId,leafRoot:!w.parentWorkId&&!q.works.some(c=>c.parentWorkId===w.id),boundaryConfirmed:!!extra.autoRecoveryFrom,agentIdle:!!extra.autoRecoveryFrom});
  else initializeRun(r,{actor:r.phase==='report'||origin==='result'?'program':origin==='delegation'||origin==='agent'||extra.legacyAgentRunId?'agent':'human',parentRunId:w.parentWorkId?this.work(q,w.parentWorkId).currentRunId:null,resultOf:extra.resultId||null,recipientRunId:previous?.id||null});
  if(q.requestModel){
   // Result/steering/continuation attempts supersede the recipient's current response.
   if(previous&&previous.workId===w.id&&r.phase!=='report'&&!r.runModel.retryOf)r.runModel={...r.runModel,retryOf:previous.id};
   requestChange(q,{type:'append-run',actor:r.runModel.createdBy,run:r.runModel,resolveReview:['retry','continuation'].includes(origin)});
  }
  this.d.data.runs.push(r);w.runIds.push(r.id);w.currentRunId=r.id;
  if(!q.requestModel)bindRequest(this.d.data,q);
  return r;
 }
 context(r){const q=this.root(r.humanRequestId),w=this.work(q,r.workId);return this.d.rules.dynamic(r)+this.d.rules.context({humanRequestId:q.id,workId:w.id,runId:r.id,agentId:w.agentId,parentWorkId:w.parentWorkId,originAgentId:q.originAgentId,finalAgentId:q.finalAgentId,origin:r.origin,phase:r.phase||'work'},this.d.agent(r.agentId).inputEnvelope?.mode==='startup-v1');}
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
  return this.d.locked('request-graph',async()=>{
   const prior=this.d.data.runs.find(r=>r.requestId===input.requestId&&r.steerTarget);
   if(prior){if(prior.agentId!==agentId||prior.instruction!==input.instruction||JSON.stringify(prior.steerTarget)!==JSON.stringify(input.steerTarget)||!sameTravelContexts(prior.travelContexts,travelContexts)||JSON.stringify(prior.attachments.map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return prior;}
   if(input.steerTarget){
    const a=this.d.writableAgent(this.d.agent(agentId));
    const snapshot=await this.d.locked(a.id,()=>this.d.observe(a));
    if(!agentControls(a).canSteer||JSON.stringify(input.steerTarget)!==JSON.stringify(a.steerTarget))fail('補足対象が変わったか、native受付・実行状態を確認できません。再確認してください');
    if(this.d.data.runs.some(r=>r.requestId===input.requestId)||this.requests.some(q=>q.clientRequestId===input.requestId))fail('requestIdの再利用です');
    const previous=this.run(a.steerTarget.runId);let q=this.root(previous.humanRequestId),w=this.work(q,previous.workId);
    if(requestStatus(q)!=='active'){
     if(a.provider==='claude')fail('補足対象の依頼は受付中ではありません');
     q={reportMode:this.reportStatus().enabled,id:randomUUID(),clientRequestId:input.requestId,instruction:input.instruction,travelContexts,attachments,originAgentId:agentId,finalAgentId:agentId,revision:0,createdAt:now(),works:[]};
     w={id:randomUUID(),parentWorkId:null,agentId,runIds:[]};q.rootWorkId=w.id;q.works.push(w);this.requests.push(q);
    }

    // A successor keeps the one human request/ticket and invalidates any old finish.
    if(q.requestModel)this.active(q);q.revision++;

    const r=this.enqueue(q,w,input.instruction,'steer:'+input.requestId,'steering',{...(q.report&&previous.phase==='report'?{phase:'report'}:{}),requestId:input.requestId,steeringProvider:a.provider,steerTarget:structuredClone(a.steerTarget),priorInputs:snapshot.inputs.filter(i=>i.turnId===previous.turnId).map(({id,offset})=>({id,offset})),travelContexts,attachments,contextAttachments:[...new Map([...(previous.contextAttachments||previous.attachments||[]),...attachments].map(a=>[a.id,a])).values()],contextTravelContexts:structuredClone(travelContexts.length?travelContexts:previous.contextTravelContexts||previous.travelContexts||[])});
    q.initialRunId ||= r.id;changeRun(previous,{type:'supersede',actor:'human',successorId:r.id});
    await this.d.save();await this.d.attemptRun(r);return r;
   }
   const legacy=this.d.data.runs.find(r=>r.requestId===input.requestId&&!r.humanRequestId);
   if(legacy){if(legacy.agentId!==agentId||legacy.instruction!==input.instruction||!sameTravelContexts(legacy.travelContexts,travelContexts)||JSON.stringify((legacy.attachments||[]).map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return legacy;}
   let q=this.requests.find(q=>q.clientRequestId===input.requestId);
   if(q){if(q.originAgentId!==agentId||q.instruction!==input.instruction||!sameTravelContexts(q.travelContexts,travelContexts)||JSON.stringify((q.attachments||[]).map(a=>a.id))!==JSON.stringify(attachments.map(a=>a.id)))fail('requestIdの再利用です');return this.run(q.initialRunId);}
   const a=this.d.writableAgent(this.d.agent(agentId));if(!a.tabId||['terminated','stopping'].includes(agentControls(a).state))fail('Agentは送信可能ではありません');
   q={reportMode:this.reportStatus().enabled,id:randomUUID(),clientRequestId:input.requestId,instruction:input.instruction,travelContexts,attachments,originAgentId:agentId,finalAgentId:agentId,revision:0,createdAt:now(),works:[]};
   const w={id:randomUUID(),parentWorkId:null,agentId,runIds:[]};q.rootWorkId=w.id;q.works.push(w);this.requests.push(q);
   const r=this.enqueue(q,w,input.instruction,'human',originKind);r.requestId=input.requestId;q.initialRunId=r.id;
   await this.d.save();await this.d.attemptRun(r);return r;
  });
 }
 async actor(q,w,runId){
  if(w.currentRunId!==runId)fail('現在の作業runを指定してください');
  const r=this.run(runId);if(!r||r.humanRequestId!==q.id||r.workId!==w.id||r.agentId!==w.agentId)fail('runの所属が一致しません');
  const a=this.d.writableAgent(this.d.agent(w.agentId));
  if(!terminal(r)&&!['terminated','stopping'].includes(agentControls(a).state))await this.d.locked(a.id,()=>this.d.observe(a));
  this.d.writableAgent(a);
  if(!accepted(r)||!r.inputId||!r.turnId||!r.sessionId)fail('native prompt-submit/turnの受付をまだ照合できません');
  if(!['running','completed'].includes(runState(r)))fail('正常な実行runではありません: '+runState(r));
  return r;
 }
 async delegate(x){return this.d.locked('request-graph',async()=>{
  const q=this.root(x.humanRequestId),parent=this.work(q,x.parentWorkId);operation(x.operationId);instruction(x.instruction);
  const old=q.works.find(w=>w.operationId===x.operationId);
  if(old){if(old.parentWorkId!==parent.id||old.agentId!==x.agentId||old.instruction!==x.instruction)fail('operationIdの再利用です');return structuredClone(old);}
  this.active(q);if(!['sent','running'].includes(this.run(parent.currentRunId)?.runModel.state.kind))fail('親作業は委任受付中ではありません');
  if(q.report)fail('報告工程では委任できません');
  await this.actor(q,parent,x.actorRunId);observeRequest(this.d.data,q);this.active(q);if(this.run(x.actorRunId).runModel?.state.kind!=='running')fail('委任元は実行中ではありません');const target=this.d.writableAgent(this.d.agent(x.agentId));if(!target.tabId||['terminated','stopping'].includes(agentControls(target).state))fail('宛先Agentを利用できません');
  for(let ancestor=parent;ancestor;ancestor=ancestor.parentWorkId?this.work(q,ancestor.parentWorkId):null)if(ancestor.agentId===x.agentId)fail('祖先と同じAgentへの循環委任はできません');
  const w={id:randomUUID(),parentWorkId:parent.id,agentId:x.agentId,operationId:x.operationId,instruction:x.instruction,runIds:[]};q.works.push(w);q.revision++;
  this.enqueue(q,w,x.instruction,'delegate:'+x.operationId,'delegation');await this.d.save();return structuredClone(w);
 });}
 async finish(x){return this.d.locked('request-graph',async()=>{
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);operation(x.operationId);
  const r=this.run(x.runId);if(!r||r.humanRequestId!==q.id||r.workId!==w.id)fail('runの所属が一致しません');
  const old=q.requestModel.declarations.find(d=>d.id===x.operationId);
  if(old){if(old.runId!==x.runId)fail('operationIdの再利用です');return structuredClone(w);}
  // Record the claim even before native acceptance, after a decision, or with an old revision.
  requestChange(q,{type:'declare-complete',actor:'agent',id:x.operationId,runId:x.runId,at:Date.now()});
  q.revision++;
  await this.d.save();await this.settle();return structuredClone(w);
 });}
 async complete(x){return this.d.locked('request-graph',async()=>{
  const q=this.root(x.humanRequestId);this.version(q,x.revision);
  requestChange(q,{type:'complete-as-human',actor:'human',reason:x.reason||'人間が成果を確認して完了扱い'});
  q.revision++;await this.settle();await this.d.save();return this.get(q.id);
 });}
 async continue(x,retry=false){return this.d.locked('request-graph',()=>this.continueLocked(x,retry));}
 async continueLocked(x,retry=false,extra={}){
  const q=this.root(x.humanRequestId),w=this.work(q,x.workId);operation(x.operationId);instruction(x.instruction);
  const key=runKey(q.id,(retry?'retry:':'resume:')+x.operationId),old=this.d.data.runs.find(r=>r.requestId===key);
  if(old){if(old.workId!==w.id||(old.retryInstruction||old.instruction)!==x.instruction)fail('operationIdの再利用です');return old;}
  this.active(q);this.version(q,x.revision);
  if(q.report&&w.parentWorkId)fail('報告工程では子作業を再開できません');
  const last=this.run(w.currentRunId);
  if(retry?!['failed','interrupted','terminated'].includes((last&&runState(last))):(last&&runState(last))!=='completed')fail('未受付・不明・実行中の入力は再送できません。resumeは途中応答完了後、retryは失敗/中断後です');

  this.d.writableAgent(this.d.agent(w.agentId));
  delete w.latestResultId;
  const r=this.enqueue(q,w,q.report&&!w.parentWorkId?this.reportPrompt(q):x.instruction,(retry?'retry:':'resume:')+x.operationId,retry?'retry':'continuation',{...extra,...(retry?{retryFrom:last.id}:{}),...(q.report&&!w.parentWorkId?{phase:'report',retryInstruction:x.instruction}:{} )});q.revision++;await this.d.save();return r;
 }
 async cancelQueued(x){return this.d.locked('request-graph',async()=>{
  const r=this.run(x.runId);if(!r||r.agentId!==x.agentId||r.humanRequestId!==x.humanRequestId)fail('対象Agent・依頼・runが一致しません',404);
  return this.d.locked(r.agentId,async()=>{
  const q=this.root(r.humanRequestId),w=this.work(q,r.workId);
  if(r.queueCancelledAt)return structuredClone(r);
  if(!canCancelQueued(r)||w.currentRunId!==r.id||requestStatus(q)!=='active')fail('未送信の入力だけ取り消せます。送信状態を再確認してください');
  const previous=r.steerTarget&&this.run(r.steerTarget.runId);
  if(r.steerTarget&&(!previous||runState(previous)!=='superseded'||previous.runModel.supersededBy!==r.id))fail('補足元の状態を確認できません');
  const undo=[r,previous].filter(Boolean).map(value=>[value,structuredClone(value)]);
  const workRunBefore=w.currentRunId;
  const rootBefore={requestModel:structuredClone(q.requestModel),revision:q.revision,cancelledAt:q.cancelledAt};
  changeRun(r,{type:'cancel',actor:'human'});r.queueCancelledAt=now();r.error=null;
  if(previous){
   // The supplement never reached the provider. Restore ownership of the
   // ongoing turn, but never restore an invalidated finish declaration.
   changeRun(previous,{type:'restore',actor:'human',successorId:r.id});w.currentRunId=previous.id;observeRequest(this.d.data,q);if(!w.parentWorkId)requestChange(q,{type:'restore-root',actor:'human',id:previous.id});
  }else{requestChange(q,{type:'withdraw',actor:'human',reason:'未送信の依頼を取り下げ'});q.cancelledAt=now();}
  q.revision++;
  try{await this.d.save();}catch(error){
   for(const [value,saved] of undo){for(const key of Object.keys(value))delete value[key];Object.assign(value,saved);}
   w.currentRunId=workRunBefore;Object.assign(q,rootBefore);if(rootBefore.cancelledAt===undefined)delete q.cancelledAt;
   throw error;
  }
  return structuredClone(r);
 });});}
 async cancel(x){return this.d.locked('request-graph',async()=>{
  const q=this.root(x.humanRequestId);if(requestStatus(q)==='cancelled')return this.get(q.id);
  this.version(q,x.revision);if(requestStatus(q)==='completed')fail('完了した依頼はキャンセルできません');
  requestChange(q,{type:'withdraw',actor:'human',reason:x.reason||'人間が取り下げ'});q.cancelledAt=now();q.revision++;
  for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&runState(r)==='queued')){changeRun(r,{type:'cancel',actor:'human'});r.error='request-cancelled-before-dispatch';}
  for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&['sent','running'].includes(r.runModel?.state.kind)))changeRun(r,{type:'close-tracking',actor:'human',reason:'request-cancelled'});
  await this.d.save();return this.get(q.id);
 });}
 async settle(){
  let changed=false;
  for(const q of this.requests){
   const before=JSON.stringify(q);
   observeRequest(this.d.data,q);
   if(requestStatus(q)==='active'){
    for(const step of nextSteps(q.requestModel)){
     const child=step.type==='deliver-result'?this.run(step.childRunId):null;
     const target=child?this.work(q,this.work(q,child.workId).parentWorkId):this.work(q,q.rootWorkId);
     const agent=this.d.data.agents.find(a=>a.id===target.agentId);
     if(!agent||this.d.agentDeleting(agent)||['terminated','stopping'].includes(agentControls(agent).state))requestChange(q,{type:'review',actor:'program',reason:'next-step-agent-unavailable'});
    }
    if(nextSteps(q.requestModel).some(step=>step.type==='prepare-report')){
     const w=this.work(q,q.rootWorkId),r=this.run(q.requestModel.rootRunId);
     q.report={sourceRunId:r.id,createdAt:now()};

     const report=this.enqueue(q,w,this.reportPrompt(q),'final-report','report',{phase:'report',attachments:[],travelContexts:[]});
     q.report.initialRunId=report.id;
    }
   }
   if(requestStatus(q)==='completed'&&!q.completedAt){
    q.completedAt=now();q.finalRunId=q.requestModel.reportRunId||q.requestModel.rootRunId;

    // Stable delivery key; historical notification records are never reset.
    q.notification ||= {status:'pending',messageId:'request:'+q.id};
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
 async recover(){
  let changed=false;
  // Only new, tracked leaf root runs may retry automatically. Child recovery retains
  // the existing parent actor checks and is deliberately a manual operation.
  for(const q of this.requests.filter(q=>requestStatus(q)==='active'))for(const w of q.works){
   const r=this.run(w.currentRunId);if((r&&runState(r))!=='failed'||r.recovery?.status==='enqueued')continue;
   let reason=r.phase==='report'?'報告生成に失敗しました。元回答は非表示です。確認して報告のみ再試行してください':r.steerTarget?'補足を含む作業は内容・副作用を確認して手動で復旧してください':r.recoveryPolicy!==1?'このrunは自動復旧導入前です':r.errorCode!=='server_overloaded'?'自動再試行対象外のエラーです':
    !accepted(r)||!r.inputId||!r.sessionId||!r.turnId?'受付照合が不完全です':
    w.parentWorkId||q.works.some(c=>c.parentWorkId===w.id)?'子作業または委任元との確認が必要です':null;
   const budget=w.autoRetry;
   if(!reason&&budget&&(budget.attempts>=2||Date.now()-budget.firstFailureAt>=600000))reason='自動再試行の上限（2回・10分）に達しました';
   if(reason){if(r.recovery?.status!=='manual'||r.recovery.reason!==reason){r.recovery={status:'manual',reason};changed=true;}continue;}
   if(!w.autoRetry||!r.recovery)changed=true;
   w.autoRetry ||= {attempts:0,firstFailureAt:Date.now()};
   r.recovery ||= {status:'scheduled',nextAt:Date.now()+[30000,120000][w.autoRetry.attempts]};
   if(r.recovery.status!=='scheduled'||r.recovery.nextAt>Date.now())continue;
   const a=this.d.agent(w.agentId);
   const snapshot=await this.d.locked(a.id,()=>this.d.observe(a));
   if(!this.recoveryBoundary(r,snapshot,a.runtime)){
    r.recovery={status:'manual',reason:'終了後の入力またはセッションを確認できません。手動で復旧してください'};changed=true;continue;
   }
   if(!agentControls(a).canSend)continue;
   r.recovery.status='enqueued';w.autoRetry.attempts++;
   await this.continueLocked({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:'auto-recovery-'+r.id,instruction:this.recoveryPrompt(q,w)},true,{autoRecoveryFrom:r.id,recoveryDeadline:w.autoRetry.firstFailureAt+600000});
  }
  if(changed)await this.d.save();
 }
 async pump(){return this.d.locked('request-graph',async()=>{
  await this.settle();await this.recover();
  for(const q of this.requests.filter(q=>requestStatus(q)==='active')){
   for(const e of resultEntries(this.d.data,q).filter(e=>!e.superseded&&!e.deliveryRunId)){
    const parent=this.work(q,e.parentWorkId),previous=this.run(parent.currentRunId),agent=this.d.data.agents.find(a=>a.id===parent.agentId);
    if(!agent||this.d.agentDeleting(agent)||!terminal(previous)||!agentControls(agent).canSend)continue;
    if(!nextSteps(q.requestModel).some(step=>step.type==='deliver-result'&&step.childRunId===e.resultRunId))continue;
    const output=this.run(e.resultRunId)?.output||this.run(e.resultRunId)?.error||'出力なし';
    const text=this.d.rules.result(q,parent,e,output);
    const r=this.enqueue(q,parent,text,'result:'+e.id,'result',{resultId:e.id});await this.d.save();
   }
  }
  for(const r of this.d.data.runs.filter(r=>runState(r)==='queued'&&r.humanRequestId)){
   const q=this.root(r.humanRequestId),a=this.d.data.agents.find(a=>a.id===r.agentId);if(!a){changeRun(r,{type:'dispatch-blocked',actor:'program',at:Date.now(),reason:'agent-missing'});await this.d.save();continue;}if(requestStatus(q)==='active'&&(this.d.agentDeleting(a)||r.steerTarget||agentControls(a).canSend||['terminated','stopping'].includes(agentControls(a).state)))await this.d.attemptRun(r);
  }
 });}
 async notifications(){
  for(const q of this.requests.filter(q=>requestStatus(q)==='completed'&&q.notification?.status==='pending')){
   await this.d.locked('notify:'+q.id,async()=>{
    if(q.notification.status!=='pending')return;
    q.notification={...q.notification,status:'attempting',attemptedAt:now()};await this.d.save();
    try{
     const r=this.run(q.finalRunId);
     const result=await this.d.notifier.enqueue({id:'request:'+q.id,role:'assistant',kind:'request',agentId:q.finalAgentId,content:'依頼全体が完了しました。\n'+(r?.finalOutput||r?.output||'最終報告を村で確認してください。')});
     q.notification={...q.notification,...result};await this.d.save();
    }catch(error){q.notification={...q.notification,status:'delivery_unknown',reason:'notification-outcome-unknown'};await this.d.save();}
   });
  }
 }
}
