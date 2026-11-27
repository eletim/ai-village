import {continuationBoundary} from './purpose-continuation.mjs';
import {initialRelayObservation} from './relay-initial-launch.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {checkRelayRecheck} from './secretary-relay-recheck.mjs';
import {accepted,runState} from './run-lifecycle.mjs';
import {confirmedInterruption} from './state/run.ts';
import {resolveFollowup} from './conversation-followup.mjs';
import {rootNode,applyGraph} from './unified-requests.mjs';
import {purposeId,purposeLeaf,purposeView} from './conversation-purpose.mjs';
const fail=(m,status=409)=>{throw Object.assign(Error(m),{status});};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=(x,allowed)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail('指定外の中継引数です',400);};
const text=x=>{if(typeof x!=='string'||!x.trim()||x.length>12000)fail('本文は1〜12000文字です',400);return x;};
const key=x=>{if(typeof x!=='string'||! /^[\w-]{8,100}$/.test(x))fail('操作IDが必要です',400);};
const humanSequence=(d,c)=>Math.max(0,...d.data.runs.filter(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&!r.queueCancelledAt).map(r=>r.conversationSequence));
export const relayRunId=e=>e.recovery?.receipt.runId||e.runId;
const stopped=r=>{const input=r?.runModel?.facts.findLast(f=>f.type==='input');return r?.runModel&&confirmedInterruption(r.runModel)&&accepted(r)&&r.inputId===input.inputId&&r.sessionId===input.sessionId&&r.turnId===input.turnId;};
function target(d,t){
 const c=d.conversations.record(t.conversationId),a=d.writableAgent(d.agent(c.agentId));d.writableProject(c.projectId);
 if(c.agentId!==t.secretaryId||c.projectId!==t.projectId||a.projectId!==c.projectId||a.location!=='mayor')fail('配送先の秘書・Project・会話が一致しません',403);
 const original=d.flow.root(t.purposeId),q=purposeLeaf(d.data,original);
 if(original.id!==purposeId(original)||q.id!==t.requestId||q.conversationId!==c.id||original.conversationId!==c.id||original.integrity||q.integrity)fail('指定目的の所有関係が一致しません',403);
 const w=rootNode(q),r=d.flow.run(w.currentRunId);
 if(q.revision!==t.revision||r?.id!==t.currentRunId||w.id!==t.workId)fail('対象のrevision/current runが変わりました');
 if(w.state.kind!=='active'||q.report||purposeView(d.data,q).decision?.kind==='question')fail('停止中・質問待ち・終了済みの目的はこの操作では変更できません');
 if(t.mode==='resume-interrupted'? !stopped(r):t.mode!=='followup'||!['queued','awaiting_input','running','completed'].includes(runState(r)))fail('確認済み中断または通常の進行中目的だけを対象にできます');
 if(t.mode==='resume-interrupted'&&w.state.review.some(reason=>reason!=='run-needs-review:'+r.id))fail('別の未解決事項があるため再開できません');
 if(t.mode==='resume-interrupted'&&d.data.runs.some(x=>x.agentId===w.assignee&&x.id!==r.id&&['queued','sent','running'].includes(x.runModel?.state.kind)))fail('担当に別の未終了runがあります');
 return {c,a,original,q,w,r};
}
export class SecretaryRelay {
 constructor(d){this.d=d;}
 validate(){
  const d=this.d;
  for(const c of d.data.conversations){
   const inbox=c.relayInbox||[],sent=c.relaySent||[];
   if(new Set(inbox.map(e=>e.id)).size!==inbox.length||new Set(sent.map(e=>e.operationId)).size!==sent.length)fail('Duplicate secretary relay record');
   for(const e of inbox){
    const source=d.data.conversations.find(s=>s.id===e.sourceConversationId),receipt=source?.relaySent?.find(s=>s.receipt.deliveryId===e.id),r=d.flow.run(e.runId),sender=d.flow.run(e.sourceRunId);
    if(!receipt||receipt.receipt.runId!==e.runId||receipt.actorRunId!==e.sourceRunId||sender?.conversationId!==source.id||!accepted(sender)||r?.conversationId!==c.id||r.conversationSource?.relayId!==e.id||r.conversationSource.kind!=='secretary'||e.target.conversationId!==c.id)fail('Invalid secretary relay linkage');
    for(const recovery of [...(e.recoveryHistory||[]),...(e.recovery?[e.recovery]:[])]){
     const rr=d.flow.run(recovery.receipt.runId);
     if(recovery.previousRunId!==e.runId||rr?.conversationId!==c.id||rr.conversationSource?.relayId!==e.id||rr.conversationSource.kind!=='secretary'||rr.relayRecoveryOf!==e.runId||!recovery.proof?.inputHash)fail('Invalid secretary recovery linkage');
     if(rr.relayInitial){const i=rr.relayInitial,l=i.launch,a=d.agent(rr.agentId);if(l?.runId!==rr.id||l.operationId!==recovery.initialLaunchId||l.tabId!=='tab-relay-'+l.operationId||createHash('sha256').update(l.body).digest('hex')!==rr.inputCorrelation?.digest||!a.retainedRelayRuntimes?.some(old=>old.operationId===l.operationId&&old.runId===rr.id&&hash(old.runtime)===hash(i.oldRuntime)))fail('Invalid initial relay linkage');}
    }
    if(e.recovery?.supersedes){
     const h=e.recoveryHistory,previous=d.flow.run(e.recovery.supersedes.runId),next=d.flow.run(e.recovery.receipt.runId);
     if(h?.length!==1||h[0].receipt.runId!==previous?.id||h[0].initialLaunchId!==e.recovery.supersedes.operationId||previous.relaySuperseded?.successorRunId!==next?.id||previous.relaySuperseded.operationId!==e.recovery.operationId||hash(next.relayInitial?.proofRuntime)!==hash(previous.relayInitial?.oldRuntime))fail('Invalid successor recovery linkage');
    }else if(e.recoveryHistory?.length)fail('Orphan recovery history');
    if(e.actionReceipt?.action==='resume-interrupted'){
     const resumed=d.flow.run(e.actionReceipt.runId);
     if((resumed?.purposeContinuation?.deliveryId||resumed?.secretaryRecovery?.deliveryId)!==e.id||(resumed.purposeContinuation||resumed.secretaryRecovery).previousRunId!==e.target.currentRunId||resumed.humanRequestId!==e.target.requestId||resumed.workId!==e.target.workId||resumed.runModel.createdBy!=='agent')fail('Invalid secretary resume receipt');
    }
    for(const recovery of [...(e.recoveryHistory||[]),...(e.recovery?[e.recovery]:[])].filter(h=>h.returnRunId)){const rr=d.flow.run(recovery.returnRunId);if(rr?.conversationId!==source.id||rr.conversationSource?.relayReturnId!==e.id)fail('Invalid recovery return receipt');}
    if(e.returnRunId){const r=d.flow.run(e.returnRunId);if(r?.conversationId!==source.id||r.conversationSource?.relayReturnId!==e.id)fail('Invalid secretary return receipt');}
   }
   for(const s of sent)if(!d.data.conversations.some(target=>target.relayInbox?.some(e=>e.id===s.receipt.deliveryId&&e.sourceConversationId===c.id)))fail('Missing secretary relay delivery');
  }
 }
 // Bind the one historical recovery subject, not IDs invented in a new message.
 evidence(c,actor,x,recheck,{compact=false,frozen=false}={}){
  const d=this.d,authorization=d.conversations.authorize(c,actor,x.authorization),human=d.flow.run(authorization.runId);
  if(!recheck&&humanSequence(d,c)!==human.conversationSequence)fail('後着の人間入力があります。許可を再照合してください');
  const event=c.deliveries.find(e=>e.id===x.evidenceDeliveryId),review=event&&d.flow.run(event.runId);
  if(!review||review.conversationId!==c.id||review.conversationSource?.deliveryId!==event.id||review.conversationSource?.humanRequestId!==event.humanRequestId||event.decisionRecovery||(compact?review.conversationSequence>=human.conversationSequence:review.conversationSequence+1!==human.conversationSequence)||!accepted(review)||runState(review)!=='completed'||!['question','result'].includes(event.kind))fail('直前に正式配送・正常返答された復旧資料が必要です',403);
  const recovery=d.flow.root(event.humanRequestId),rw=rootNode(recovery),reportRun=d.flow.run(event.material.actorRunId||event.material.runId);
  if(recovery.integrity||recovery.conversationId!==c.id||rw.state.kind==='withdrawn'||!reportRun||reportRun.humanRequestId!==recovery.id||reportRun.workId!==rw.id||!accepted(reportRun)||runState(reportRun)!=='completed')fail('復旧依頼と報告runを照合できません',403);
  if(!rw.runIds.includes(reportRun.id)||rw.runAgents[reportRun.id]!==reportRun.agentId)fail('報告の担当関係が一致しません',403);
  const sourceActor=d.flow.run(recovery.requestedBy.actorRunId),creation=c.operations.find(o=>o.receipt?.humanRequestId===recovery.id&&o.receipt?.workId===rw.id);
  if(!sourceActor||sourceActor.conversationId!==c.id||!accepted(sourceActor)||!creation||JSON.parse(creation.payload).input.actorRunId!==sourceActor.id||JSON.parse(creation.payload).input.instruction!==recovery.instruction)fail('復旧依頼の正式作成記録がありません',403);
  if(event.kind==='question'){
   const report=rw.metadata.reporting?.reports.find(e=>e.id===event.material.id);
   if(!report||event.id!=='report:'+report.id||hash(report)!==hash(event.material)||report.kind!=='question')fail('正式報告と配送資料が一致しません',403);
  }else{
   const result=rw.submissions.find(s=>s.id===event.material.resultId&&s.version===event.material.version&&s.runId===reportRun.id&&s.outcome==='normal');
   if(!result||event.id!=='result:'+recovery.id+':'+result.id||event.material.output!==(reportRun.output||''))fail('正式成果と配送資料が一致しません',403);
  }
  const acceptedAt=r=>r.runModel.facts.findLast(f=>f.type==='input')?.at;
  if(!(acceptedAt(reportRun)<=acceptedAt(review)&&acceptedAt(review)<acceptedAt(human)))fail('報告・配送・人間入力の受付順序が一致しません',403);
  d.conversations.authorize(c,actor,recovery.requestedBy.authorization);
  // Full UUID tokens in the saved, originally dispatched instruction define the subject.
  const original=rw.inbox.find(i=>i.kind==='request');
  if(!original||original.text!==recovery.instruction||!original.attempts.some(id=>rw.runIds.includes(id)))fail('元の復旧依頼を照合できません',403);
  const ids=new Set(recovery.instruction.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)||[]);
  const candidates=d.flow.requests.filter(q=>ids.has(q.id));
  if(candidates.length!==1)fail('保存済み復旧依頼の対象が一意ではありません',403);
  const q=candidates[0];if(q.integrity||!q.conversationId||q.conversationId===c.id)fail('復旧対象の参照を検証できません',403);
  const w=rootNode(q),recipient=d.conversations.record(q.conversationId);
  if(![q.projectId,w.id,frozen?x.target.currentRunId:w.currentRunId].every(id=>ids.has(id)))fail('対象Project・仕事・旧実行の完全IDが必要です',403);
  if(d.data.conversations.some(other=>other.id!==recipient.id&&(event.material.text||event.material.output||'').includes(other.id)))fail('報告に別の会話参照があります',403);
  if(!(event.material.text||event.material.output||'').includes(recipient.id))fail('正式報告に返却先会話の根拠がありません',403);
  fields(x.target,['secretaryId','projectId','conversationId','purposeId','requestId','workId','currentRunId','revision','mode']);
  const t={secretaryId:recipient.agentId,projectId:q.projectId,conversationId:q.conversationId,purposeId:purposeId(q),requestId:q.id,workId:w.id,currentRunId:frozen?x.target.currentRunId:w.currentRunId,revision:frozen?x.target.revision:q.revision,mode:x.target.mode};
  if((compact?Object.keys(x.target):Object.keys(t)).some(k=>x.target[k]!==t[k]))fail('指定対象と保存された復旧対象が一致しません',403);
  if(!frozen)target(d,t);
  return {authorization,humanText:human.instruction,recoveryRequestId:recovery.id,evidenceDeliveryId:event.id,evidence:{recoveryInstruction:recovery.instruction,recoveryAuthorization:recovery.requestedBy.authorization,report:structuredClone(event.material),deliveredRunId:review.id},evidenceDigest:hash([recovery.instruction,original,event.material,review.id,review.conversationSequence,human.instruction]),target:t};
 }
 // The existing authorized recovery evidence remains the cross-Project bound.
 // New clients omit run/revision hashes: these are derived here, not guessed by
 // the secretary. A target plus arbitrary human quote is NOT sufficient.
 scopedEvidence(c,actor,x){
  const d=this.d,recipient=d.data.conversations.find(c=>c.id===x.target?.conversationId),original=d.data.requests.find(q=>q.id===x.target?.purposeId);
  if(!recipient||!original||original.conversationId!==recipient.id)fail('配送先会話・目的が一致しません',403);
  const q=purposeLeaf(d.data,original),w=rootNode(q),r=d.flow.run(w.currentRunId);
  const t={secretaryId:recipient.agentId,projectId:q.projectId,conversationId:recipient.id,purposeId:purposeId(q),requestId:q.id,workId:w.id,currentRunId:r?.id,revision:q.revision,mode:stopped(r)?'resume-interrupted':'followup'};
  if(Object.keys(x.target).some(k=>!(k in t)||x.target[k]!==t[k]))fail('指定対象と現在の目的が一致しません',403);
  const proof=this.evidence(c,actor,{...x,target:t},null,{compact:true});
  return {...proof,scopeVersion:2};
 }
 recheckEvidence(source,e){
  const recheck=e.recovery?.recheck?checkRelayRecheck(this.d,source,e,e.recovery.recheck,this.d.flow.run(e.recovery.actorRunId)):null;
  return this.evidence(source,this.d.flow.run(e.sourceRunId),{authorization:e.authorization,evidenceDeliveryId:e.evidenceDeliveryId,target:e.target},recheck,{compact:e.scopeVersion===2,frozen:e.scopeVersion===2});
 }
 event(c,actor,id){
  const e=(c.relayInbox||[]).find(e=>e.id===id&&relayRunId(e)===actor.id&&actor.conversationSource?.relayId===e.id);
  if(!e)fail('今回の正式中継だけを操作できます',403);return e;
 }
 dispatchBoundary(r){
  const d=this.d,c=d.conversations.record(r.conversationId),e=c.relayInbox?.find(e=>e.recovery?.receipt.runId===r.id);
  if(!e||e.actionReceipt||humanSequence(d,c)!==e.targetHumanSequence)fail('中継回復の配送境界が変わりました');
  const source=d.conversations.record(e.sourceConversationId);
  const recheck=e.recovery.recheck?checkRelayRecheck(d,source,e,e.recovery.recheck,d.flow.run(e.recovery.actorRunId)):null;
  const proof=this.evidence(source,d.flow.run(e.sourceRunId),{authorization:e.authorization,evidenceDeliveryId:e.evidenceDeliveryId,target:e.target},recheck);
  if(proof.evidenceDigest!==e.evidenceDigest)fail('保存許可が変わりました');
  if(d.data.runs.some(x=>(x.purposeContinuation||x.secretaryRecovery)?.previousRunId===e.target.currentRunId))fail('既に再開されています');
 }
}
