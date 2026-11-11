export function recoveryReason(r){
 const reason=r.runModel?.state.reason;
 const messages={'session-changed':'接続先のセッションが変わり、実行結果を確認できません。','turn-ended-without-marker':'依頼の目印を照合できないまま実行が終了しました。','timeout':'照合できない状態が続いたため、追跡を終了しました。','agent-stopped':'Agentの停止を確認しましたが、この送信の結果は確認できません。','target-unavailable-before-dispatch':'送信先のAgentを利用できません。','agent-missing':'送信先のAgentがありません。','human-closed-tracking':'人間の操作により、この送信の追跡を終了しました。'};
 if(messages[reason])return messages[reason];
 if(reason?.startsWith('legacy-'))return '旧データに完了を確認できない送信が残っています。既存の成果・副作用を確認してください。';
 return '実行が停止したか、完了登録を確認できません。既存の成果・副作用を確認してください。';
}
export const needsRunRecovery=(q,r,w)=>!!w&&q?.requestModel?.state.kind==='active'&&q.requestModel.state.review.length>0;
export function requestReviewReason(q,r){
 const reasons=q.requestModel?.state.kind==='active'?q.requestModel.state.review:[];
 return reasons.map(reason=>reason.startsWith('run-needs-review:')?'送信が失敗・中断・確認できずで終了しました。既存の成果・副作用を確認してください。':reason.startsWith('declaration-conflict:')?'完了申告と観察した事実が一致しません。':reason==='needs-decision'||reason==='legacy-needs-decision'?'送信が終了しています。成果を確認し、次の扱いを決めてください。':reason).join(' / ')||recoveryReason(r);
}
export function recoveryRequests(data){
 return (data.requests||[]).flatMap(q=>{
  const w=q.works.find(w=>w.id===q.rootWorkId)||q.works.find(w=>!w.parentWorkId);
  const r=data.runs.find(r=>r.id===w?.currentRunId);if(!r||!needsRunRecovery(q,r,w))return [];
  const a=data.agents.find(a=>a.id===w.agentId);
  return [{id:q.id,revision:q.revision,runId:r.id,workId:w.id,agentId:w.agentId,agentName:a?.name||'削除済みAgent',instruction:q.instruction,phase:r.phase||'work',state:r.state,reason:requestReviewReason(q,r),canRetry:!!a&&!a.deletedAt&&!['terminated','stopping'].includes(a.state)&&!!a.tabId&&['completed','failed','interrupted','terminated'].includes(r.state)}];
 });
}
