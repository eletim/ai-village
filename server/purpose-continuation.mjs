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
// Read-only explanation shared by UI and secretary status. Saved facts establish
// what was observed; only a fresh native boundary can offer an actual followup.
export function continuationStatus(r,{run,agentId,snapshot,status,error,agent}={}){
 if(!r?.runModel||!Array.isArray(r.runModel.facts))return null;
 const model=r.runModel,s=model.state;
 if(s.kind==='cancelled'||s.kind==='ended'&&s.outcome==='normal')return null;
 const basis=continuationBasis(model),input=model.facts.findLast(f=>f.type==='input'),terminal=model.facts.findLast(f=>f.type==='terminal');
 const ended=!!input&&s.kind==='ended'&&s.reason==='native-terminal'&&terminal?.sessionId===input.sessionId&&terminal?.turnId===input.turnId&&terminal?.outcome===s.outcome;
 const disconnected=agent?.agentModel?.observation?.connected===false||agent?.runtime?.alive===false;
 const cause=error||r.error||null;
 const observe=agent&&model.phase==='work'&&s.kind!=='queued'?{operation:'status',...(run?{command:['status','--run',run]}:{}),responsible:'secretary',instruction:'秘書がstatusで登録先の受付・終端を再確認してください。接続設定の修正が必要なら、権限のある環境担当へ依頼してください。受付不明の入力は再送しません。'}:{operation:agent?'agents instructions':'agents list',...(agent?{agentId:agent.id}:{}),responsible:'authorized-runtime-operator',instruction:agent?'権限のある環境担当がAgentプロフィールとagents instructionsで登録・起動契約を確認し、登録先への接続を診断してください。この表示は保存記録で、statusによる秘書自身の再観測は行いません。再送・停止はしていません。':'秘書がagents listで担当の登録を確認してください。担当を確認できるまで送信しません。'};
 const known=basis==='before-dispatch'?'この入力は送信前に拒否されました':ended?'保存記録では、この入力の終端を確認済みです':input?'入力受付を確認済みです。実作業の着手・成果・目的達成の証拠とは別です':'入力受付は確認できていません';
 const unknown=basis==='before-dispatch'?[]:['外部操作の実施範囲は成果資料で照合が必要です'];
 if(basis==='before-dispatch'&&agent?.initialInput&&agent.inputEnvelope?.mode!=='startup-v2'&&!agent.deletedAt&&!agent.deletion&&!agent.runtimeRetiredTo)return {available:false,observed:basis,cause: cause||agent.inputEnvelope?.reason,known,unresolved:'未起動workspaceの起動契約を修復する必要があります',next:{operation:'agents prepare-runtime',agentId,responsible:'authorized-runtime-operator',arguments:{revision:agent.metadataRevision||0},instruction:'このAgentの設定修正権限を持つ担当がprepare-runtimeを実行してください。村が未起動・所有を再確認します。修復後は秘書が通常followupで未完了分を継続できます。'},unknown};
 if(basis&&continuationBoundary(r,snapshot,status))return {available:'followup-after-observation',observed:basis,cause,known:basis==='before-dispatch'?known:'管理対象の同じ入力・turnの終端と現在の所有境界を確認済みです',unresolved:basis==='before-dispatch'?'':'既存成果と残作業の意味判断は必要です',unknown,next:{operation:'followup',responsible:'secretary',instruction:'秘書が元の許可範囲で成果を照合し、未完了分を指定してください。実行時に村が受付・所有を再照合します。'}};
 if(s.kind==='running'&&!disconnected&&!cause)return {available:false,observed:'input-accepted',known,unresolved:'実行結果はまだ確認できていません',unknown:[],next:null};
 if(s.kind==='queued'&&!disconnected&&!cause)return null;
 return {available:false,observed:basis||s.reason||s.kind,cause,known,unresolved:disconnected?'登録先への接続・現在の実行状態を確認できません。時間経過だけでは停止と判定しません。':ended||basis?'現在の実行権限・所有境界の再確認が必要です':input?'受付後の実行結果・終端を確認できません':'受付と実行権限の閉鎖を確認できません。未実行とは確定していません',next:observe,unknown};
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
