import {SecretaryRelay} from './secretary-relay.mjs';
import {recoverMissingDecision,resultSourceEvent,retireDecisionReminder} from './conversation-decision-recovery.mjs';
import {resolveFollowup} from './conversation-followup.mjs';
import {conversationContext,conversationMaterial} from './conversation-context.mjs';
import {conversationRunOwner} from './conversation-request-owner.mjs';
import {purposeId,purposeView,conversationDisplayMode,REPORT_DELIVERY_KINDS} from './conversation-purpose.mjs';
import {startupContract} from './input-envelope.mjs';
import {conversationNotification} from './conversation-notification.mjs';
import {conversationJob,conversationTurn,conversationControl,SETTLED_JOB_CODES} from './conversation-status.mjs';
import {responseText} from '../src/response-text.js';
import {transitionDelivery} from './state/auxiliary.ts';
import {randomUUID} from 'node:crypto';
import {initializeRun,runState,accepted,changeRun} from './run-lifecycle.mjs';
import {agentControls} from './agent-lifecycle.mjs';
import {newNode,rootNode,applyGraph} from './unified-requests.mjs';
import {latest} from './state/requests.ts';
import {initialDeadlines} from './request-reports.mjs';
import {normalizeTravelContexts} from '../src/travel-context.js';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const now=()=>new Date().toISOString();
const text=value=>{if(typeof value!=='string'||!value.trim()||value.length>16000)fail('本文を1〜16000文字で指定してください',400);return value;};
const key=value=>{if(typeof value!=='string'||! /^[\w-]{8,100}$/.test(value))fail('operationId/requestIdを8〜100文字で指定してください',400);return value;};
// Conversations are not request nodes. Only an explicit job crosses into the graph.
// Plain-words delivery for contract 3 (4.3): who sent what, for which purpose, then the body.
const DELIVERY_BODY_LIMIT=10000;
const STOP_REASONS={rate_limit:'利用上限で',interrupted:'中断で',failed:'失敗で',terminated:'応答を確認できず'};
function purposeLabel(data,c,q){
 const p=data.projects.find(p=>p.id===c.projectId),original=data.requests.find(x=>x.id===purposeId(q))||q;
 const line=String(original.instruction||'').split('\n').find(l=>l.trim())?.trim()||'';
 return (p?.name?p.name+'：':'')+(line.length>40?line.slice(0,40)+'…':line);
}
function plainDelivery(data,c,q,kind,material,id){
 const label=purposeLabel(data,c,q),worker=data.agents.find(a=>a.id===rootNode(q).assignee),sender='担当（'+(worker?.name||rootNode(q).assignee)+'）';
 const body=text=>{text=String(text||'');return text.length<=DELIVERY_BODY_LIMIT?text:text.slice(0,DELIVERY_BODY_LIMIT)+'\n\n（長いため途中までです。全文：conversations read '+c.id+' RUN_ID \'{"kind":"delivery","id":"'+id+'"}\'。RUN_ID は末尾のタグの値）';};
 if(kind==='result')return sender+'から報告が届きました（'+label+'）。\n\n'+body(material.output);
 if(kind==='question')return sender+'から質問が届きました（'+label+'）。\n\n'+body(material.text);
 if(kind==='extension')return sender+'から期限の延長の提案が届きました（'+label+'）。\n\n'+body(material.text);
 if(kind==='attention'){const how=STOP_REASONS[material.reason]||STOP_REASONS[material.outcome]||'';return sender+'の作業が'+how+'止まりました（'+label+'）。'+(material.reason?'理由：'+String(material.reason).slice(0,200):'');}
 return '人間がこの仕事を'+(material.state?.kind==='withdrawn'?'取り下げ':'終了し')+'ました（'+label+'）。';
}
export class Conversations {
 constructor(d){this.d=d;this.relayService=new SecretaryRelay(d);}
 init(){for(const r of this.d.data.runs.filter(r=>r.conversationId&&r.notification?.status==='attempting'))r.notification=transitionDelivery(r.notification,{type:'unknown',reason:'restart-during-delivery'});this.validate();}
 validate(){
  const ids=new Set();
  for(const c of this.d.data.conversations){
   if(!c.id||ids.has(c.id)||!Number.isSafeInteger(c.sequence)||!Array.isArray(c.operations)||!Array.isArray(c.deliveries))throw Error('Invalid conversation record');ids.add(c.id);
   const runs=this.d.data.runs.filter(r=>r.conversationId===c.id),sequences=new Set(runs.map(r=>r.conversationSequence));
   if(sequences.size!==runs.length||runs.some(r=>!conversationRunOwner(this.d.data,c,r)||r.humanRequestId||r.runModel.phase!=='conversation'||!Number.isSafeInteger(r.conversationSequence)||r.conversationSequence<1||r.conversationSequence>c.sequence||!['human','leader','program','secretary'].includes(r.conversationSource?.kind)||r.runModel.createdBy!==(r.conversationSource.kind==='human'?'human':'program')))throw Error('Invalid conversation run');
   if(runs.some(r=>r.conversationDisplay&&(!['reply','progress'].includes(r.conversationDisplay.mode)||!Number.isSafeInteger(r.conversationDisplay.version)||r.conversationDisplay.version<1)))throw Error('Invalid conversation display');
   if(new Set(c.deliveries.map(e=>e.id)).size!==c.deliveries.length||c.deliveries.some(e=>!runs.some(r=>r.id===e.runId&&r.conversationSource.deliveryId===e.id)||!this.d.flow.requests.some(q=>q.id===e.humanRequestId&&q.conversationId===c.id)))throw Error('Invalid conversation delivery');
   for(const r of runs.filter(r=>r.conversationSource?.kind==='secretary'))if(!(c.relayInbox||[]).some(e=>e.id===r.conversationSource.relayId&&e.runId===r.id&&e.target.conversationId===c.id))throw Error('Invalid secretary relay run');
   for(const e of c.deliveries.filter(e=>e.decisionRecovery))if(!resultSourceEvent(c,e))throw Error('Invalid decision recovery delivery');
   for(const d of c.purposeDecisions||[]){
    if(!['accept','continue','resume','question'].includes(d.kind)||!runs.some(r=>r.id===d.actorRunId)||!c.deliveries.some(e=>e.id===d.deliveryId&&e.humanRequestId===d.humanRequestId)||!this.d.flow.requests.some(q=>q.id===d.purposeId&&q.conversationId===c.id)||!Number.isSafeInteger(d.humanSequence))throw Error('Invalid purpose decision');
    if(d.kind==='continue'&&!this.d.flow.requests.some(q=>q.id===d.successorRequestId&&q.continuesRequestId===d.humanRequestId&&q.purposeId===d.purposeId))throw Error('Invalid purpose continuation');
   }
   if(new Set(c.operations.map(o=>o.id)).size!==c.operations.length)throw Error('Duplicate conversation operation');
  }
  for(const q of this.d.flow.requests.filter(q=>q.purposeId)){
   const root=this.d.flow.requests.find(x=>x.id===q.purposeId&&x.conversationId===q.conversationId);
   const previous=q.continuesRequestId&&this.d.flow.requests.find(x=>x.id===q.continuesRequestId&&x.conversationId===q.conversationId&&purposeId(x)===q.purposeId);
   if(!root||q.id!==q.purposeId&&!previous||this.d.flow.requests.filter(x=>x.continuesRequestId===q.id).length>1)throw Error('Invalid purpose lineage');
  }
  if(this.d.data.runs.some(r=>(r.conversationId||r.runModel.phase==='conversation')&&!ids.has(r.conversationId)))throw Error('Conversation run owner missing');
  this.relayService.validate();
 }
 pendingForAgent(id){const ids=new Set((this.d.data.conversations||[]).filter(c=>c.agentId===id).map(c=>c.id));return this.d.flow.requests.some(q=>ids.has(q.conversationId)&&(q.integrity||['active','submitted'].includes(rootNode(q).state.kind)||q.purposeId&&!SETTLED_JOB_CODES.includes(conversationJob(this.d.data,q).code)))||this.d.data.runs.some(r=>ids.has(r.conversationId)&&['queued','sent','running'].includes(r.runModel.state.kind));}
 async read(id,actorRunId){
  const c=this.record(id),r=actorRunId&&this.d.data.runs.find(r=>r.id===actorRunId&&r.conversationId===id&&r.agentId===c.agentId);
  // An Agent can call get before the event monitor has observed its first input.
  // Refresh only a dispatched, still-unbound run; never reopen terminal unknowns.
  if(r&&r.runModel.state.kind==='sent'&&!accepted(r))await this.d.locked(c.agentId,()=>this.d.observe(this.d.agent(c.agentId)));
  const current=this.currentActor(r);const view=this.get(id,current?.id||actorRunId);return actorRunId?conversationContext(view,current?.id||actorRunId):view;
 }
 async material(id,actorRunId,selector){
  if(!actorRunId)fail('現在の会話runを指定してください',403);
  await this.read(id,actorRunId);const current=this.currentActor(this.d.flow.run(actorRunId));return conversationMaterial(this.get(id,current.id),current.id,selector);
 }
 get(id,actorRunId){
  const c=this.record(id),all=this.d.data.runs.filter(r=>r.conversationId===id);
  const actor=actorRunId?this.currentActor(all.find(r=>r.id===actorRunId&&accepted(r))):null;
  if(actorRunId&&!actor)fail('この会話で受付照合済みのrunを指定してください',403);
  const runs=actor?all.filter(r=>r.conversationSequence<=actor.conversationSequence):all;
  const deliveries=c.deliveries.filter(e=>runs.some(r=>r.id===e.runId));
  const visibleData=actor?{...this.d.data,requests:this.d.data.requests.filter(q=>q.conversationId!==c.id||runs.some(r=>r.id===q.requestedBy?.actorRunId)),conversations:this.d.data.conversations.map(x=>x.id===c.id?{...x,deliveries,purposeDecisions:(x.purposeDecisions||[]).filter(d=>runs.some(r=>r.id===d.actorRunId))}:x)}:this.d.data;
  const jobs=this.d.flow.requests.filter(q=>q.conversationId===id&&(!actor||runs.some(r=>r.id===q.requestedBy?.actorRunId))).map(q=>{
   const full=this.d.flow.get(q.id);
   const lifecycle=conversationJob(visibleData,q);
   if(!actor)return {...full,purpose:purposeView(this.d.data,q),lifecycle};
   // Status is available immediately; materials for a later turn are not injected here.
   return {id:q.id,purpose:purposeView(visibleData,q),authorization:q.requestedBy?.authorization,lifecycle,status:full.status,instruction:q.instruction,assigneeAgentId:q.integrity?null:rootNode(q).assignee,leaderAgentId:q.integrity?null:rootNode(q).assignee,returnPending:c.deliveries.some(e=>e.humanRequestId===q.id&&!deliveries.includes(e)),availableDeliveries:deliveries.filter(e=>e.humanRequestId===q.id).map(e=>e.id),materials:'後続の正式配送ターンで確認してください'};
  });
  return structuredClone({id:c.id,agentId:c.agentId,projectId:c.projectId,createdAt:c.createdAt,sequence:actor?.conversationSequence??c.sequence,relaySent:(c.relaySent||[]).filter(s=>!actor||runs.some(r=>r.id===s.actorRunId)).map(s=>s.receipt),relayInbox:(c.relayInbox||[]).filter(e=>runs.some(r=>r.id===e.runId)),relayReturns:(c.relayReturns||[]).filter(e=>runs.some(r=>r.id===e.runId)),operations:actor?c.operations.filter(o=>runs.some(r=>r.id===JSON.parse(o.payload).input.actorRunId)).map(o=>({id:o.id,receipt:o.receipt})):c.operations,deliveries,purposeDecisions:(c.purposeDecisions||[]).filter(d=>!actor||runs.some(r=>r.id===d.actorRunId)),control:conversationControl(this.d.data.agents.find(a=>a.id===c.agentId)),runs:runs.map(r=>({...actor?{id:r.id,conversationSequence:r.conversationSequence,conversationSource:r.conversationSource,instruction:r.conversationSource.kind==='human'?r.instruction:undefined,attachments:r.attachments,travelContexts:r.travelContexts,createdAt:r.createdAt}:{...r},lifecycle:conversationTurn(r),state:runState(r),displayMode:conversationDisplayMode(this.d.data,r),displayVersion:r.conversationDisplay?.version||0,humanAnswer:accepted(r)&&runState(r)==='completed'&&conversationDisplayMode(this.d.data,r)!=='progress'?responseText(r).answer:null,progressText:accepted(r)&&runState(r)==='completed'&&conversationDisplayMode(this.d.data,r)==='progress'?responseText(r).answer:null})),jobs});
 }
 record(id){return this.d.data.conversations.find(c=>c.id===id)||fail('会話がありません',404);}
 enqueue(c,{requestId,instruction,source,attachments=[],travelContexts=[]}){
  const r={id:randomUUID(),requestId,agentId:c.agentId,conversationId:c.id,conversationSequence:++c.sequence,conversationSource:source,origin:source.kind==='human'?'human':'conversation-delivery',instruction,attachments,travelContexts,createdAt:now(),notificationPolicy:'conversation'};
  initializeRun(r,{actor:source.kind==='human'?'human':'program'});this.d.data.runs.push(r);return r;
 }
 async start(agentId,x,origin='human'){
  if(origin!=='human')fail('会話の人間発言は人間用送信口から作成してください',403);
  if(x.steerTarget)fail('会話の追記先は送信直前に基盤が照合します。steerTargetは指定できません',400);
  key(x.requestId);text(x.instruction);
  if(x.attachments!==undefined&&(!Array.isArray(x.attachments)||x.attachments.length>4))fail('添付は4件までです',400);
  const attachments=x.attachments?.length?await this.d.attachments?.select(x.attachments):[];
  if(!attachments)fail('添付機能がありません');
  const travelContexts=normalizeTravelContexts(x.travelContexts);
  const payload=JSON.stringify({agentId,conversationId:x.conversationId||null,instruction:x.instruction,attachments,travelContexts});
  const r=await this.d.locked('request-graph',()=>this.d.persist(async()=>{
   const old=this.d.data.runs.find(r=>r.requestId===x.requestId);
   if(old){if(old.conversationPayload!==payload)fail('requestIdの再利用です');return old;}
   const a=this.d.writableAgent(this.d.agent(agentId));
   if(a.location!=='mayor'||!a.projectId)fail('Project所属の秘書で会話を開始してください');
   this.d.writableProject(a.projectId);
   if(a.inputEnvelope?.mode!=='startup-v2'||a.runtimeUpgrade?.state==='prepared')fail('会話にはstartup-v2の正式なセッションが必要です。プロフィールの起動契約から移行を確認してください。');
   const control=conversationControl(a);if(!control.canAccept)fail(control.label+'。'+control.next);
   // A secretary can own several conversations after a handover; continue the newest one
   // explicitly by creation time, never by storage order.
   let c=x.conversationId?this.record(x.conversationId):this.d.data.conversations.filter(c=>c.agentId===a.id&&c.projectId===a.projectId).reduce((latest,c)=>!latest||Date.parse(c.createdAt)>=Date.parse(latest.createdAt)?c:latest,null);
   if(c&&(c.agentId!==a.id||c.projectId!==a.projectId))fail('会話の所属が一致しません',403);
   if(!c){c={id:randomUUID(),agentId:a.id,projectId:a.projectId,createdAt:now(),sequence:0,operations:[],deliveries:[]};this.d.data.conversations.push(c);}
   const r=this.enqueue(c,{requestId:x.requestId,instruction:x.instruction,source:{kind:'human'},attachments,travelContexts});r.conversationPayload=payload;
   await this.d.save();return r;
  }));
  await this.d.flow.dispatchReady(undefined,true);return r;
 }
 // Only accepted successors in the exact native turn extend an actor's authority.
 // A saved, sent-but-unaccepted or adjacent-turn input cannot grant permissions.
 currentActor(r){
  const seen=new Set();
  while(r?.conversationId&&r.runModel.supersededBy&&!seen.has(r.id)){
   seen.add(r.id);const next=this.d.flow.run(r.runModel.supersededBy);
   if(!next||next.steerTarget?.runId!==r.id||next.conversationId!==r.conversationId||next.agentId!==r.agentId||!accepted(next)||next.sessionId!==r.sessionId||next.turnId!==r.turnId)break;
   r=next;
  }
  return r;
 }
 actor(c,id){
  const r=this.currentActor(this.d.flow.run(id)),a=this.d.writableAgent(this.d.agent(c.agentId));
  if(a.location!=='mayor'||a.projectId!==c.projectId||!r||r.agentId!==a.id||r.conversationId!==c.id||!accepted(r)||!r.inputId||!r.turnId||!r.sessionId||runState(r)!=='running')fail('受付照合済みの実行中秘書会話runだけが操作できます',403);
  return r;
 }
 authorize(c,r,authorization){
  const source=this.d.flow.run(authorization?.runId);
  if(!source||source.conversationId!==c.id||source.conversationSource?.kind!=='human'||source.conversationSequence>r.conversationSequence||!accepted(source)||typeof authorization?.quote!=='string'||!authorization.quote.trim()||!source.instruction.includes(authorization.quote))fail('配送された人間発言のrunIdと正確な引用が必要です',403);
  return {runId:source.id,quote:authorization.quote};
 }
 // Optional presentation preference, independent of work authorization and achievement.
 async display(x){
  key(x.operationId);
  if(!['progress','reply'].includes(x.mode)||!Number.isSafeInteger(x.expectedVersion)||x.expectedVersion<0)fail('mode: progress|reply と expectedVersion（初回0）が必要です',400);
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
   const c=this.record(x.conversationId),payload=JSON.stringify({action:'display',input:x});
   const old=c.operations.find(o=>o.id===x.operationId);
   if(old){if(old.payload!==payload)fail('operationIdの再利用です');return structuredClone(old.receipt);}
   const r=this.actor(c,x.actorRunId);
   if((r.conversationDisplay?.version||0)!==x.expectedVersion)fail('表示指定のversionが変わりました。conversations getで確認してください');
   r.conversationDisplay={mode:x.mode,version:x.expectedVersion+1,at:now(),operationId:x.operationId};
   const receipt={conversationId:c.id,runId:r.id,...r.conversationDisplay};
   c.operations.push({id:x.operationId,payload,receipt:structuredClone(receipt),at:now()});
   await this.d.save();return structuredClone(receipt);
  }));
 }

 currentPurposeInput(c,actor,x){
  if(x.humanRequestId!==undefined||x.continuesRequestId!==undefined||x.deliveryId!==undefined||x.expectedPurposeVersion!==undefined)return x;
  const event=resultSourceEvent(c,c.deliveries.find(e=>e.runId===actor.id&&e.id===actor.conversationSource?.deliveryId));
  if(!event)fail('今回の正式配送資料がありません。別対象は詳細指定で確認してください');
  const q=this.d.flow.root(event.humanRequestId);
  return {...x,humanRequestId:q.id,deliveryId:event.id,expectedPurposeVersion:purposeView(this.d.data,q).version};
 }
 purposeBoundary(c,actor,x,{continuation=false}={}){
  if(x.humanRequestId&&x.continuesRequestId&&x.humanRequestId!==x.continuesRequestId)fail('対象の依頼IDが一致しません',400);
  const q=this.d.flow.root(x.humanRequestId||x.continuesRequestId);
  if(q.conversationId!==c.id)fail('この会話の目的ではありません',403);
  const view=purposeView(this.d.data,q);
  if(view.currentRequestId!==q.id)fail('この目的には後続の仕事があります');
  if(!Number.isSafeInteger(x.expectedPurposeVersion)||x.expectedPurposeVersion!==view.version)fail('目的のversionが変わりました。conversations getで確認してください');
  const event=resultSourceEvent(c,c.deliveries.find(e=>e.id===x.deliveryId&&e.humanRequestId===q.id));
  const source=event&&this.d.flow.run(event.runId);
  if(!source||source.conversationSequence>actor.conversationSequence||!accepted(source))fail('正式配送済みの資料だけを評価してください',403);
  if(this.d.data.runs.some(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&r.conversationSequence>actor.conversationSequence&&!r.queueCancelledAt))fail('後着の人間入力があります。配送後に判断してください');
  const w=rootNode(q);
  if(continuation||x.decision==='accept'||x.resultOnly===true){
   const latestResult=latest(w);
   if(event.kind!=='result'||w.state.kind!=='completed'||w.state.by==='human'||!latestResult||latestResult.id!==event.material.resultId||latestResult.version!==event.material.version)fail('現在の正常な提出結果だけを採用・継続できます');
  }
  if(view.decision?.state==='pending')fail('前の判断の正常終了を待ってください');
  if(view.decision?.state==='committed'&&view.decision.kind==='accept'){
   const reopen=x.reopenRunId&&this.d.flow.run(x.reopenRunId),deciding=this.d.flow.run(view.decision.actorRunId);
   if(!continuation||!reopen||reopen.conversationId!==c.id||reopen.conversationSource?.kind!=='human'||!accepted(reopen)||reopen.conversationSequence<=deciding.conversationSequence||reopen.conversationSequence>actor.conversationSequence)fail('達成報告後の追加修正は正式配送済みの人間入力reopenRunIdを明示してください');
  }
  return {q,event,view};
 }
 recordPurpose(c,actor,x,b,kind,successor){
  const d={id:x.operationId,purposeId:purposeId(b.q),humanRequestId:b.q.id,deliveryId:b.event.id,actorRunId:actor.id,kind,reason:text(x.reason),...(kind==='question'?{question:text(x.question)}:{}),...(successor?{successorRequestId:successor.id}:{}),humanSequence:Math.max(0,...this.d.data.runs.filter(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&r.conversationSequence<=actor.conversationSequence).map(r=>r.conversationSequence)),...(x.reopenRunId?{reopenRunId:x.reopenRunId}:{}),at:now()};
  (c.purposeDecisions||=[]).push(d);return d;
 }
 async decide(x){
  key(x.operationId);
  if(!['accept','question'].includes(x.decision))fail('decisionはacceptまたはquestionです',400);
  text(x.reason);if(x.decision==='question')text(x.question);
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
   const c=this.record(x.conversationId),payload=JSON.stringify({action:'decide',input:x}),old=c.operations.find(o=>o.id===x.operationId);
   if(old){if(old.payload!==payload)fail('operationIdの再利用です');return structuredClone(old.receipt);}
   const actor=this.actor(c,x.actorRunId);if(actor.conversationSource?.kind==='secretary')fail('中継runは指定目的のrelayApplyだけを実行できます',403);x=this.currentPurposeInput(c,actor,x);const b=this.purposeBoundary(c,actor,x);
   const d=this.recordPurpose(c,actor,x,b,x.decision);
   const receipt={...d,version:b.view.version+1};
   c.operations.push({id:x.operationId,payload,receipt,at:now()});await this.d.save();return structuredClone(receipt);
  }));
 }
 async mutate(action,x){
  key(x.operationId);
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
   const c=this.record(x.conversationId),payload=JSON.stringify({action,input:x});
   const old=c.operations.find(o=>o.id===x.operationId);
   if(old){if(old.payload!==payload)fail('operationIdの再利用です');return structuredClone(old.receipt);}
   const actor=this.actor(c,x.actorRunId);
   if(actor.conversationSource?.kind==='secretary')fail('中継runは指定目的のrelayApplyだけを実行できます',403);
   if(x.assigneeAgentId!==undefined&&(action!=='job'||x.continue===true||['continuesRequestId','humanRequestId','purposeId','deliveryId','expectedPurposeVersion','reopenRunId'].some(k=>x[k]!==undefined)))fail('担当指定は新規依頼だけで使えます。継続の担当は既存依頼から照合します',400);
   if(action==='followup'){
    if(Object.keys(x).some(k=>!['conversationId','actorRunId','operationId','purposeId','instruction'].includes(k)))fail('追加指示は目的IDと残作業を指定してください。追加権限は新規依頼で扱います');
    const duplicate=c.operations.find(o=>{try{const p=JSON.parse(o.payload);return p.action==='followup'&&p.input.actorRunId===x.actorRunId&&p.input.purposeId===x.purposeId&&p.input.instruction===x.instruction;}catch{return false;}});
    if(duplicate){c.operations.push({id:x.operationId,payload,receipt:structuredClone(duplicate.receipt),at:now()});await this.d.save();return structuredClone(duplicate.receipt);}
    const resolved=resolveFollowup(this,c,actor,x);action=resolved.action;x=resolved.input;
   }
   if(x.continue!==undefined&&x.continue!==true)fail('continueはtrueを指定してください',400);
   if(x.continue===true){
    if(action!=='job'||x.authorization!==undefined||x.continuesRequestId!==undefined||x.humanRequestId!==undefined||x.deliveryId!==undefined||x.expectedPurposeVersion!==undefined)fail('簡易継続に別の対象や許可は指定できません',400);
    x=this.currentPurposeInput(c,actor,x);
    const original=this.d.flow.root(purposeId(this.d.flow.root(x.humanRequestId)));
    x={...x,continuesRequestId:x.humanRequestId,authorization:original.requestedBy.authorization,reason:x.instruction};
   }
   const authorization=this.authorize(c,actor,x.authorization);
   text(x.instruction);
   let receipt;
   if(action==='job'){
    if(x.continuesRequestId!==undefined&&(typeof x.continuesRequestId!=='string'||!x.continuesRequestId))fail('継続元の依頼IDを指定してください',400);
    const previous=x.continuesRequestId?this.purposeBoundary(c,actor,x,{continuation:true}):null;
    if(previous){
     text(x.reason);
     const original=this.d.flow.root(purposeId(previous.q));
     if(JSON.stringify(authorization)!==JSON.stringify(original.requestedBy.authorization))fail('継続は元の許可を参照してください。追加権限は新しい依頼で扱います',403);
    }
    const p=this.d.writableProject(c.projectId);
    if(x.assigneeAgentId!==undefined&&(typeof x.assigneeAgentId!=='string'||!x.assigneeAgentId.trim()))fail('assigneeAgentIdに担当AgentのIDを指定してください',400);
    // Continue the root's current assignee, including a formal handover. Child
    // assignees and later Project leader edits never redirect this purpose.
    const assignee=previous?rootNode(previous.q).assignee:x.assigneeAgentId??p.leaderAgentId;
    if(!assignee){if(previous)fail('継続元の担当を確認できません');fail('Projectのリーダーが未設定です');}
    const a=this.d.writableAgent(this.d.agent(assignee));
    if(this.d.instructionStatus(a.id).requiresFreshSession)fail('担当の起動契約の移行が必要です。正式なstartup-v2セッションを採用してください');
    if(a.id===c.agentId||a.projectId!==p.id||a.location!=='workshop'||!a.tabId||a.runtimeUpgrade?.state==='prepared'||a.agentModel?.intent==='stop'||['terminated','stopping','unknown'].includes(agentControls(a).state))fail('指定された担当を利用できません。担当と稼働状態を確認してください');
    const q={id:randomUUID(),commonRequests:true,inputProtocol:1,projectId:c.projectId,conversationId:c.id,requestedBy:{kind:'agent',agentId:c.agentId,actorRunId:actor.id,authorization},reportMode:false,clientRequestId:'conversation:'+c.id+':'+x.operationId,instruction:x.instruction,travelContexts:[],attachments:[],originAgentId:a.id,finalAgentId:a.id,revision:0,createdAt:now(),requestGraph:{version:3,nodes:[],operations:[]}};
    q.purposeId=previous?purposeId(previous.q):q.id;
    if(previous)q.continuesRequestId=previous.q.id;
    const w=newNode(q,{id:randomUUID(),assignee:a.id,createdBy:'agent',metadata:{reporting:initialDeadlines({})}});
    w.recipient={kind:'conversation',conversationId:c.id};w.requester={kind:'conversation',conversationId:c.id,agentId:c.agentId};q.rootWorkId=w.id;q.requestGraph.rootId=w.id;
    this.d.data.requests.push(q);
    const r=this.d.flow.enqueue(q,w,x.instruction,'conversation-job','agent');q.initialRunId=r.id;
    w.inbox[0].source={actor:'agent'};
    if(previous)this.recordPurpose(c,actor,x,previous,'continue',q);
    receipt={humanRequestId:q.id,workId:w.id,runId:r.id,actorRunId:actor.id,assigneeAgentId:a.id,leaderAgentId:a.id,conversationId:c.id,purposeId:q.purposeId};
   }else{
    const q=this.d.flow.root(x.humanRequestId),w=rootNode(q);
    if(q.conversationId!==c.id)fail('この会話が依頼した仕事ではありません',403);
    if(action==='amend'){
     const id=randomUUID();
     applyGraph(this.d.data,q,{type:'supplement',actor:'agent',requestId:w.id,input:{id,kind:'supplement',text:x.instruction,createdAt:now(),attempts:[]}});
     const current=rootNode(q);if(current.conversationWait)current.conversationWait.answerInputId=id;
     const pv=purposeView(this.d.data,q),previous=pv.decision;
     if(previous?.kind==='question'&&previous.humanRequestId===q.id){
      this.recordPurpose(c,actor,{...x,reason:x.instruction},{q,event:{id:previous.deliveryId}},'resume');
     }
    }
    else if(action==='withdraw'){
     applyGraph(this.d.data,q,{type:'withdraw-conversation',actor:'agent',conversationId:c.id,requestId:w.id,reason:x.instruction});
     // Withdrawal prevents queued effects. Already dispatched work is NOT stopped or replayed.
     for(const r of this.d.data.runs.filter(r=>r.humanRequestId===q.id&&runState(r)==='queued'))changeRun(r,{type:'cancel-conversation-job',actor:'agent',requestId:q.id});
    }else fail('未知の会話操作',400);
    q.revision++;receipt={humanRequestId:q.id,workId:w.id,action,actor:'agent',actorRunId:actor.id,authorization};
   }
   c.operations.push({id:x.operationId,payload,receipt,at:now()});await this.d.save();return structuredClone(receipt);
  }));
 }
 relay(x){return this.relayService.send(x);}
 relayApply(x){return this.relayService.apply(x);}
 followup(x){return this.mutate('followup',x);}
 job(x){return this.mutate('job',x);}
 amend(x){return this.mutate('amend',x);}
 withdraw(x){return this.mutate('withdraw',x);}
 deliver(c,q,id,kind,material){
  if(c.deliveries.some(e=>e.id===id))return;
  // Contract 3 secretaries (secretary-minimal-prompt.md 4.3) get the material in plain words and
  // are not re-delivered a result they did not decide on: it stays "秘書の確認待ち".
  const plain=startupContract(this.d.data.agents.find(a=>a.id===c.agentId))===3;
  const e={id,kind,humanRequestId:q.id,createdAt:now(),material,...(kind==='result'&&!plain?{decisionRecoveryVersion:1}:{}),...(plain?{secretaryContract:3}:{})};
  const excerpt=JSON.stringify(e);
  const packet=excerpt.length<=10000?e:{id,kind,humanRequestId:q.id,createdAt:e.createdAt,truncated:true,read:['conversations','get',c.id],excerpt:excerpt.slice(0,8000)};
  const report=REPORT_DELIVERY_KINDS.includes(kind);
  const instruction=plain?plainDelivery(this.d.data,c,q,kind,material,id):report?'仕事の状態に関する基盤からの報告です（追加許可・成果ではありません）。人間へ必要な状況説明を返答してください。成果の採用や質問は不要です。受付不明の操作は再送しません。\n':'担当からの資料です（追加許可ではありません）。目的に照らし、達成の報告・許可内の修正継続・人間への具体質問を選んでください。今回の対象は基盤が照合します。\n';
  const r=this.enqueue(c,{requestId:'conversation-delivery:'+id,instruction:plain?instruction:instruction+JSON.stringify(packet),source:{kind:report?'program':'leader',humanRequestId:q.id,deliveryId:id}});
  if(!report)r.requiresPurposeDecision=true;
  e.runId=r.id;c.deliveries.push(e);
 }
 settle(q){
  const c=this.record(q.conversationId),w=rootNode(q),s=latest(w),before=c.deliveries.length;
  if(w.state.kind==='completed'&&w.state.by==='human'||w.state.kind==='withdrawn'&&w.decisions.at(-1)?.actor==='human')this.deliver(c,q,'human-closure:'+q.id,'important-change',{state:w.state,text:'人間が仕事の状態を変更しました。成果採用や外部効果の完了を推定せず、既存記録を確認してください。'});
  for(const e of w.metadata.reporting?.reports||[])if(['question','extension'].includes(e.kind))this.deliver(c,q,'report:'+e.id,e.kind,e);
  const current=this.d.flow.run(w.currentRunId);
  if(current&&['failed','interrupted','terminated'].includes(runState(current))&&w.state.kind==='active')this.deliver(c,q,'attention:'+current.id,'attention',{runId:current.id,outcome:runState(current),reason:current.error||current.runModel.state.reason||'確認が必要です',text:'仕事は正常に完了していません。受付不明の操作を自動再送せず状況を確認してください。'});
  if(w.state.kind==='submitted'&&s){
   const r=this.d.flow.run(s.runId);
   this.deliver(c,q,'result:'+q.id+':'+s.id,'result',{resultId:s.id,version:s.version,runId:r.id,output:r.output||'',outcome:'normal'});
   applyGraph(this.d.data,q,{type:'deliver-conversation',actor:'program',requestId:w.id,resultId:s.id});
  }
  return c.deliveries.length!==before;
 }
 async recoverDecisions(){
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
   let changed=false;
   for(const r of this.d.data.runs)if(retireDecisionReminder(this.d.data,r))changed=true;
   for(const c of this.d.data.conversations)for(const q of this.d.data.requests.filter(q=>q.conversationId===c.id))if(recoverMissingDecision(this,c,q))changed=true;
   if(changed)await this.d.save();return changed;
  }));
 }
 async notifications(){
  for(const r of this.d.data.runs.filter(r=>r.conversationId&&r.notificationPolicy==='conversation'&&accepted(r)&&runState(r)==='completed')){
   await this.d.locked('notify-conversation:'+r.id,async()=>{
    let suppressed=null;
    // Read the settled state under the writer barrier: an in-flight save may
    // still roll back. Already handled history needs no rollback checkpoint.
    const claimed=await this.d.persistence.run(()=>{
     if(r.notificationSuppressed||r.notification&&r.notification.status!=='pending')return false;
     return this.d.persist(async()=>{
     if(r.notificationSuppressed)return false;
     // Only a not-yet-attempted notification is decided here; sent/attempting/unknown are never revisited.
     const policy=!r.notification||r.notification.status==='pending'?conversationNotification(this.d.data,r,{presentAt:this.d.presentAt?.(r.agentId)}):null;
     if(policy&&!policy.notify){
      r.notificationSuppressed={reason:policy.reason,at:now(),displayVersion:r.conversationDisplay?.version||0};
      // A pending reservation has not attempted an external effect. Do not leave it pending forever.
      if(r.notification?.status==='pending')delete r.notification;
      await this.d.save();suppressed=r.notificationSuppressed;return false;
     }
     if(!r.notification)r.notification=transitionDelivery(null,{type:'prepare',id:'conversation-answer:'+r.id});
     if(r.notification.status!=='pending')return false;
     r.notification=transitionDelivery(r.notification,{type:'claim',at:now()});await this.d.save();return true;
     });
    });
    // Explainable afterwards: the journal records why nothing was sent (best effort, after the durable decision).
    if(suppressed)try{await this.d.notifier.suppress?.({id:'conversation-answer:'+r.id,kind:'conversation',agentId:r.agentId,reason:suppressed.reason});}catch{}
    if(!claimed)return;
    try{const result=await this.d.notifier.enqueue({id:'conversation-answer:'+r.id,role:'assistant',kind:'conversation',agentId:r.agentId,content:'秘書からの返答\n'+(responseText(r).answer||'会話を村で確認してください。')});await this.d.persist(async()=>{r.notification=transitionDelivery(r.notification,{type:'result',result});await this.d.save();});}
    catch{await this.d.persist(async()=>{r.notification=transitionDelivery(r.notification,{type:'unknown',reason:'notification-outcome-unknown'});await this.d.save();});}
   });
  }
 }
 // Contract 3 (4.1): the turn carries only <village run="RUN_ID"/> after its own attachments.
 context(r){if(startupContract(this.d.data.agents.find(a=>a.id===r.agentId))===3)return this.d.rules.dynamic(r)+'\n<village run="'+r.id+'"/>';return this.d.rules.dynamic(r)+this.d.rules.context({mode:'conversation',conversationId:r.conversationId,runId:r.id,phase:'work',historyRead:['conversations','get',r.conversationId,r.id],source:r.conversationSource,sequence:r.conversationSequence});}
}
