export function recoveryReason(r){
 const reason=r.runModel?.state.reason;
 const messages={'session-changed':'接続先のセッションが変わり、実行結果を確認できません。','turn-ended-without-marker':'依頼の目印を照合できないまま実行が終了しました。','timeout':'照合できない状態が続いたため、追跡を終了しました。','agent-stopped':'Agentの停止を確認しましたが、この送信の結果は確認できません。','target-unavailable-before-dispatch':'送信先のAgentを利用できません。','agent-missing':'送信先のAgentがありません。','human-closed-tracking':'人間の操作により、この送信の追跡を終了しました。'};
 if(messages[reason])return messages[reason];
 if(reason?.startsWith('legacy-'))return '旧データに完了を確認できない送信が残っています。既存の成果・副作用を確認してください。';
 return '実行が停止したか、完了登録を確認できません。既存の成果・副作用を確認してください。';
}
export const needsRunRecovery=(q,r,w)=>!!q&&['active','finalizing'].includes(q.status)&&!!w&&(['failed','interrupted','terminated'].includes(r.state)||(r.phase==='report'&&r.state==='completed'&&!w.finish));
export function recoveryRequests(data){
 return (data.requests||[]).flatMap(q=>q.works.filter(w=>!w.parentWorkId).flatMap(w=>{
  const r=data.runs.find(r=>r.id===w.currentRunId);if(!r||!needsRunRecovery(q,r,w))return [];
  const a=data.agents.find(a=>a.id===w.agentId);
  return [{id:q.id,revision:q.revision,runId:r.id,workId:w.id,agentId:w.agentId,agentName:a?.name||'削除済みAgent',instruction:q.instruction,phase:r.phase||'work',state:r.state,reason:recoveryReason(r),canRetry:!!a&&!a.deletedAt&&!['terminated','stopping','stop_unknown'].includes(a.state)&&!!a.tabId}];
 }));
}
