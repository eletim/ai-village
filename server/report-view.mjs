import {conversationDisplayMode} from './conversation-purpose.mjs';
import {conversationControl,conversationSummary,conversationTurn,answerJobs,conversationJob} from './conversation-status.mjs';
import {accepted,runState} from './run-lifecycle.mjs';
import {projectState} from './state-projection.mjs';
import {recoveryRequests} from '../src/run-recovery.js';
// Human-facing projection only. requests get/results retain the immutable source.
// Work stays visible until the final report commits. Unpublished report output
// is withheld; input bodies and original work remain available in disclosures.
const firstAfter=(a,session,cursor)=>(a.nativeTurns||[]).filter(t=>(t.sessionId||a.observedSessionId)===session&&Number.isFinite(t.offset)&&t.offset>cursor).sort((x,y)=>x.offset-y.offset)[0];
export function humanProjection(data){
 data=projectState(data);
 const view=structuredClone(data),protectedRequests=new Map((data.requests||[]).filter(q=>q.reportMode===true&&!q.integrity).map(q=>[q.id,q]));
 const protectedRuns=data.runs.filter(r=>protectedRequests.has(r.humanRequestId));
 for(const a of view.agents){
  if(a.location==='mayor'&&a.projectId){a.conversationControl=conversationControl(a);a.conversationWork=conversationSummary(data,a);}
  const owned=protectedRuns.filter(r=>r.agentId===a.id);
  const hidden=owned.filter(r=>r.phase==='report'||protectedRequests.get(r.humanRequestId).status==='completed');
  a.nativeTurns=(a.nativeTurns||[]).filter(t=>!hidden.some(r=>{
   const session=t.sessionId||a.observedSessionId;
   if(r.dispatchAttemptedAt&&!r.turnId&&protectedRequests.get(r.humanRequestId).status!=='completed'&&session!==(r.baselineRuntime?.sessionId||r.agentSessionId))return true;
   if(r.turnId===t.id&&(r.sessionId||r.agentSessionId)===session)return true;
   if(r.turnId&&['completed','failed','interrupted','superseded','terminated'].includes(r.state))return false;
   const b=r.baselineRuntime;
   if(!b||(b.sessionId&&b.sessionId!==session))return false;
   // An ended run that was never matched to a turn owns at most the first turn after its
   // baseline. Hiding every later turn would blank the Agent's history (and its colour) forever.
   if(['completed','failed','interrupted','superseded','terminated'].includes(r.state))return t.id===firstAfter(a,session,b.cursor)?.id;
   return !Number.isFinite(t.offset)||t.offset>b.cursor;
  }));

 }
 for(const r of view.runs){
  const inherited=data.agents.find(a=>a.id===r.agentId)?.secretaryHandover;if(inherited){r.originalAgentId=r.agentId;r.agentId=inherited.targetAgentId;}
  if(r.conversationId){const c=data.conversations.find(c=>c.id===r.conversationId);if(c?.agentId!==r.agentId&&(c?.handoverHistory||[]).some(h=>h.fromAgentId===r.agentId&&h.historicalRunIds.includes(r.id))){r.originalAgentId=r.agentId;r.agentId=c.agentId;}r.conversationLifecycle=conversationTurn(r);r.answerJobs=answerJobs(data,r);r.conversationAnswer=accepted(r)&&runState(r)==='completed';r.displayMode=r.conversationAnswer?conversationDisplayMode(data,r):'reply';r.conversationStatus=r.conversationSource?.kind==='human'?'秘書との会話':'リーダーの資料への返答';if(r.conversationSource?.kind!=='human')r.suppressUser=true;r.reportStatus=r.conversationLifecycle.label;}
  if(r.origin==='inbox')r.suppressUser=true;
  const q=protectedRequests.get(r.humanRequestId);if(!q)continue;
  if(q.status!=='completed'&&r.phase!=='report'){r.hiddenCompletion=true;continue;}
  const original=data.runs.find(x=>x.id===r.id);
  const show=q.status==='completed'&&q.finalRunId===r.id&&r.phase==='report';
  // Whitelist the presentation fields: hashes/checkpoints/retry prompts must not
  // inadvertently appear as chat content. Input bodies remain available to expand.
  for(const key of Object.keys(r))if(!['id','requestId','agentId','humanRequestId','workId','origin','phase','state','needsReview','runModel','createdAt','completedAt','turnId','sessionId','agentSessionId','instruction','travelContexts','attachments','output','error','errorCode','recovery'].includes(key))delete r[key];
  const archive=q.status==='completed'&&r.phase!=='report';
  r.output=show?(original.finalOutput||original.output||''):archive?(original.output||original.finalOutput||''):'';
  if(show)r.finalOutput=r.output;
  if(archive){r.collapsedHistory=true;r.finalOutput=original.finalOutput||'';}
  r.suppressUser=!['human','steering'].includes(r.origin);
  // Keep input bodies for the chat's disclosure; suppressUser selects an internal
  // bubble rather than deleting the text needed to expand it.
  const current=q.requestGraph.nodes.find(w=>w.id===r.workId)?.currentRunId===r.id;
  r.hideEntry=r.suppressUser&&!current&&!show&&!r.collapsedHistory;
  r.reportStatus=q.status==='cancelled'?'依頼キャンセル':q.status==='completed'&&!show?'作業完了（報告に統合済み）':show?'報告完了':r.phase==='report'?
   ['failed','interrupted','terminated'].includes(r.state)?'報告生成に失敗しました。元回答を引き続き表示しています。':
   r.runModel?.state.kind==='sent'?'報告の受付・実行状態を確認中です。再送せず接続先を確認してください。':
   r.state==='completed'?'報告の正常終了を確認しています。':'人間向けの報告を作成中…':
   current&&['failed','interrupted','terminated'].includes(r.state)?'作業が停止しました（元回答は非表示）':
   current&&r.runModel?.state.kind==='sent'?'作業の受付・実行状態を確認中（元回答は非表示）':
   current?'作業中（完成した報告を表示します）':'元作業完了（報告待ち）';
  r.hiddenCompletion=!show;
  // Runtime error text can contain output snippets. Show only structured code.
  if(r.error)r.error='受付・停止理由をrequests getで確認してください';
  if(r.recovery)r.recovery={status:r.recovery.status,reason:r.phase==='report'?'報告のみ再試行できます。元作業は再実行しません。':'停止理由を確認して復旧してください'};
 }
 for(const q of view.requests)if(q.conversationId){const s=conversationJob(data,q);q.purposeStatus={code:s.code,label:s.label,reason:s.reason};}
 view.recoveryRequests=recoveryRequests(data);
 return view;
}
