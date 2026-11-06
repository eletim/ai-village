// Human-facing projection only. requests get/results retain the immutable source.
// Work stays visible until the final report commits. Internal report turns are
// always withheld; afterwards the report replaces the original work output.
export function humanProjection(data){
 const view=structuredClone(data),protectedRequests=new Map((data.requests||[]).filter(q=>q.reportMode===true).map(q=>[q.id,q]));
 const protectedRuns=data.runs.filter(r=>protectedRequests.has(r.humanRequestId));
 for(const a of view.agents){
  const owned=protectedRuns.filter(r=>r.agentId===a.id);
  const hidden=owned.filter(r=>r.phase==='report'||protectedRequests.get(r.humanRequestId).status==='completed');
  a.nativeTurns=(a.nativeTurns||[]).filter(t=>!hidden.some(r=>{
   const session=t.sessionId||a.observedSessionId;
   if(r.dispatchAttemptedAt&&!r.turnId&&protectedRequests.get(r.humanRequestId).status!=='completed'&&session!==(r.baselineRuntime?.sessionId||r.agentSessionId))return true;
   if(r.turnId===t.id&&(r.sessionId||r.agentSessionId)===session)return true;
   if(r.turnId&&['completed','failed','interrupted','superseded','terminated'].includes(r.state))return false;
   const b=r.baselineRuntime;
   return b&&(!b.sessionId||b.sessionId===session)&&(!Number.isFinite(t.offset)||t.offset>b.cursor);
  }));
  if(hidden.length){delete a.runtime;delete a.currentAction;}
  const pending=owned.findLast(r=>r.phase==='report'&&protectedRequests.get(r.humanRequestId).status!=='completed'&&protectedRequests.get(r.humanRequestId).status!=='cancelled');
  if(pending){a.reportPending=true;a.canSteer=false;delete a.steerTarget;}
 }
 for(const r of view.runs){
  const q=protectedRequests.get(r.humanRequestId);if(!q)continue;
  if(q.status!=='completed'&&r.phase!=='report'){r.hiddenCompletion=true;continue;}
  const original=data.runs.find(x=>x.id===r.id);
  const show=q.status==='completed'&&q.finalRunId===r.id&&r.phase==='report';
  // Whitelist the presentation fields: hashes/checkpoints/retry prompts must not
  // inadvertently expose internal instructions or intermediate answers.
  for(const key of Object.keys(r))if(!['id','requestId','agentId','humanRequestId','workId','origin','phase','state','acceptance','createdAt','completedAt','turnId','sessionId','agentSessionId','instruction','travelContexts','attachments','output','error','errorCode','recovery'].includes(key))delete r[key];
  r.output=show?(original.finalOutput||original.output||''):'';
  r.suppressUser=!['human','steering'].includes(r.origin);
  if(r.suppressUser){r.instruction='';r.attachments=[];r.travelContexts=[];}
  const current=q.works.find(w=>w.id===r.workId)?.currentRunId===r.id;
  r.hideEntry=r.suppressUser&&!current&&!show;
  r.reportStatus=q.status==='cancelled'?'依頼キャンセル':q.status==='completed'&&!show?'作業完了（報告に統合済み）':show?'報告完了':r.phase==='report'?
   ['failed','interrupted','terminated'].includes(r.state)?'報告生成に失敗しました。元回答を引き続き表示しています。':
   ['unknown','send_unknown','awaiting_input','waiting_input'].includes(r.state)?'報告の受付・実行状態を確認中です。再送せず接続先を確認してください。':
   r.state==='completed'?'報告の完了登録が必要です。確認して報告のみ再開できます。':'人間向けの報告を作成中…':
   current&&['failed','interrupted','terminated'].includes(r.state)?'作業が停止しました（元回答は非表示）':
   current&&['unknown','send_unknown','waiting_input'].includes(r.state)?'作業の受付・実行状態を確認中（元回答は非表示）':
   current?'作業中（完成した報告を表示します）':'元作業完了（報告待ち）';
  r.hiddenCompletion=!show;
  // Runtime error text can contain output snippets. Show only structured code.
  if(r.error)r.error='受付・停止理由をrequests getで確認してください';
  if(r.recovery)r.recovery={status:r.recovery.status,reason:r.phase==='report'?'報告のみ再試行できます。元作業は再実行しません。':'停止理由を確認して復旧してください'};
 }
 return view;
}
