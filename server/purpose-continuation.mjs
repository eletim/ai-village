import {continuationBasis} from './state/run.ts';
import {correlate,terminalBoundary} from './runtime-events.mjs';
// Execution ownership is distinct from artifact processes. Never inspect or kill
// background Web/training processes to decide whether this managed turn has ended.
export function continuationBoundary(r,snapshot,status){
 const basis=r&&continuationBasis(r.runModel);
 if(!basis||!snapshot?.available||snapshot.incompleteTail||snapshot.more||!status?.alive||status.permissionRequest||!['idle','ready-for-review'].includes(status.cliState))return false;
 if(snapshot.sessionId!==status.agentSessionId)return false;
 if(basis==='before-dispatch')return snapshot.turns.length===0||terminalBoundary(snapshot,status);
 const input=r.runModel.facts.findLast(f=>f.type==='input');
 return terminalBoundary(snapshot,status)&&snapshot.sessionId===input.sessionId&&correlate(r,snapshot).state===r.runModel.state.outcome;
}
export function continuationStatus(r,{run,agentId,snapshot,status,error,agent}={}){
 if(!r)return null;
 const basis=continuationBasis(r.runModel);
 if(basis==='before-dispatch'&&agent?.initialInput&&agent.inputEnvelope?.mode!=='startup-v2')return {available:false,observed:basis,cause:r.error||agent.inputEnvelope?.reason,known:'この入力は起動前に拒否されました',unresolved:'未起動workspaceの起動契約を修復する必要があります',next:{operation:'agents prepare-runtime',agentId,responsible:'authorized-runtime-operator',arguments:{revision:agent.metadataRevision||0},instruction:'このAgentに対する設定修正の許可内で実行してください。村が未起動・所有を再確認して契約を再配置します。完了後は通常followupで継続できます。'},unknown:[]};
 if(basis&&continuationBoundary(r,snapshot,status))return {available:'followup-after-observation',observed:basis,known:basis==='before-dispatch'?'この入力は送信前に拒否されました':'管理対象の同じ入力・turnの終端を確認済みです',unknown:basis==='before-dispatch'?[]:['途中までの外部操作と残存する成果プロセスは成果資料で照合してください'],next:{operation:'followup',responsible:'secretary',instruction:'元の許可範囲で未完了分を指定してください。現在の受付・所有境界は村が再照合します'}};
 if(!basis&&!r.initialLaunch&&(r.runModel.state.kind!=='ended'||r.runModel.state.outcome==='normal'))return null;
 if(r.runModel.state.kind==='ended'&&r.runModel.state.outcome==='normal')return null;
 return {available:false,observed:r.runModel.state.reason||'initial-receipt-pending',cause:error||r.error||null,unresolved:'管理対象Agentの入力受付または実行権限の閉鎖を確認できません',next:{operation:'status',command:['status','--run',run],contractDiagnosis:['agents','instructions',agentId],responsible:'village-runtime',instruction:'登録済み接続先のnative受付と終端を再観測します。接続不能なら担当の接続設定を権限内で修正し再観測してください。受付不明の入力は再送しません。'},unknown:['外部効果なしとは確定していません']};
}

export function continuationScopeIntact(d,r){
 const b=r.purposeContinuation,q=d.data.requests.find(q=>q.id===r.humanRequestId),w=q?.requestGraph.nodes.find(w=>w.id===r.workId),actor=d.flow.run(b?.actorRunId);
 if(b?.deliveryId){
  const receiver=d.data.conversations.find(c=>c.id===b.conversationId),e=receiver?.relayInbox?.find(e=>e.id===b.deliveryId);
  if(!e||e.actionReceipt?.runId!==r.id)return false;
  try{if(d.conversations.relayService.recheckEvidence(d.conversations.record(e.sourceConversationId),e).evidenceDigest!==e.evidenceDigest)return false;}catch{return false;}
 }
 return !!b&&!!q&&!!w&&w.currentRunId===r.id&&w.assignee===r.agentId&&w.state.kind==='active'&&q.revision===b.revision&&!!actor&&!actor.runModel.supersededBy&&
  JSON.stringify(q.requestedBy?.authorization)===b.authorization&&
  !d.data.runs.some(x=>x.conversationId===b.conversationId&&x.conversationSource?.kind==='human'&&!x.queueCancelledAt&&x.conversationSequence>b.humanSequence);
}
