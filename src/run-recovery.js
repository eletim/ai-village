export function recoveryReason(r){
 const reason=r.runModel?.state.reason;
 const messages={'session-changed':'接続先のセッションが変わり、実行結果を確認できません。','turn-ended-without-marker':'依頼の目印を照合できないまま実行が終了しました。','timeout':'照合できない状態が続いたため、追跡を終了しました。','agent-stopped':'Agentの停止を確認しましたが、この送信の結果は確認できません。','target-unavailable-before-dispatch':'送信先のAgentを利用できません。','agent-missing':'送信先のAgentがありません。','human-closed-tracking':'人間の操作により、この送信の追跡を終了しました。'};
 if(messages[reason])return messages[reason];
 if(reason?.startsWith('legacy-'))return '旧データに完了を確認できない送信が残っています。既存の成果・副作用を確認してください。';
 return '実行が停止したか、完了登録を確認できません。既存の成果・副作用を確認してください。';
}
export const requestRootState=q=>q?.requestGraph?.nodes.find(n=>n.id===q.requestGraph.rootId)?.state;
export const needsRunRecovery=(q,r,w)=>!q?.integrity&&!!w&&requestRootState(q)?.kind==='active'&&requestRootState(q).review.length>0;
export function requestReviewReason(q,r){
 const state=requestRootState(q),reasons=state?.kind==='active'?state.review:[];
 return reasons.map(reason=>reason.startsWith('run-needs-review:')?'送信が失敗・中断・確認できずで終了しました。既存の成果・副作用を確認してください。':reason.startsWith('declaration-conflict:')?'完了申告と観察した事実が一致しません。':reason==='progress-stalled'||reason==='dependencies-unresolved'?'実行と自動で進む手順が終了しています。結果への対応・完了申告・再作業の扱いを確認してください。':reason==='child-needs-review'?'子依頼に失敗・中断・確認できない結果があります。結果を確認してください。':reason==='needs-decision'||reason==='legacy-needs-decision'?'送信が終了しています。成果を確認し、次の扱いを決めてください。':reason).join(' / ')||recoveryReason(r);
}
export function recoveryRequests(data){
 return (data.requests||[]).flatMap(q=>{
  if(q.integrity)return [{id:q.id,revision:q.revision,agentId:q.originAgentId,agentName:data.agents.find(a=>a.id===q.originAgentId)?.name||'参照不整合',instruction:q.instruction,reason:'参照不整合のため隔離中: '+q.integrity.reasons.join(' / '),canRetry:false,quarantined:true}];
  const w=q.requestGraph.nodes.find(w=>w.id===q.rootWorkId)||q.requestGraph.nodes.find(w=>!w.parentId);
  const r=data.runs.find(r=>r.id===w?.currentRunId);if(!r||!needsRunRecovery(q,r,w))return [];
  const a=data.agents.find(a=>a.id===w.assignee);
  return [{id:q.id,revision:q.revision,runId:r.id,workId:w.id,agentId:w.assignee,agentName:a?.name||'削除済みAgent',instruction:q.instruction,phase:r.phase||'work',state:r.state,reason:requestReviewReason(q,r),canRetry:!!a&&!a.deletedAt&&!['terminated','stopping'].includes(a.state)&&!!a.tabId&&['completed','failed','interrupted','terminated'].includes(r.state)}];
 });
}

export function requestWaitingText(q,workId){
 const n=q?.requestGraph?.nodes.find(n=>n.id===workId);
 if(!n||n.state.kind!=='active'||n.state.review.length)return '';
 return ({'input-pending':'補足・結果への対応を待っています。秘書は順番に再開します。',dependencies:'子依頼の実行を待っています。','result-delivery':'子依頼の結果配送を待っています。','result-processing':'子依頼の結果を処理しています。','report-preparation':'人間向けの報告を準備しています。','report-processing':'人間向けの報告を作成しています。'})[q.waiting?.[workId]]||'';
}
