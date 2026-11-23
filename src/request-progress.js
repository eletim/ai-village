// Display only: confirmed graph facts, never instruction/output wording or claims.
export function requestProgress(q,id,agents=[]){
 const nodes=q?.requestGraph?.nodes||[],n=nodes.find(n=>n.id===id);if(!n?.state)return null;
 const parent=nodes.find(p=>p.id===n.parentId),next=nodes.find(p=>p.id===n.replacementId&&p.parentId===n.parentId),previous=nodes.find(p=>p.replacementId===n.id&&p.parentId===n.parentId);
 const name=id=>agents.find(a=>a.id===id)?.name||'担当Agent';
 const result=n.submissions?.at(-1),handling=result?[...(parent?.handling||[])].reverse().find(h=>h.requestId===id&&h.resultId===result.id&&h.version===result.version):null;
 let label,waiting='';
 if(n.replacementId){label='差し戻し・再依頼済み';}
 else if(n.state.kind==='withdrawn')label='取り下げ';
 else if(n.state.kind==='completed')label=handling?.decision==='accept'?'承認済み':'完了';
 else if(handling?.decision==='rework'){label='差し戻し';waiting=(parent?name(parent.assignee):'依頼元')+'の再依頼待ち';}
 else if(n.planned){label=n.assignee?'開始前':'担当未定';waiting='依頼元の開始指示待ち';}
 else if(n.state.kind==='submitted'){label='成果提出済み';waiting=parent?name(parent.assignee)+'の確認待ち':'人間向けの報告待ち';}
 else if(!n.state.review?.length&&n.selfResume?.current?.status==='scheduled'){label=q.waiting?.[id]==='self-resume'?'再確認待ち':'再確認予約あり';waiting=new Date(n.selfResume.current.at).toLocaleString('ja-JP')+' に '+n.selfResume.current.text;}
 else {label='進行中';waiting=n.state.review?.length?name(n.assignee)+'の状況確認が必要':name(n.assignee)+'の作業・対応待ち';}
 return {label,waiting,...(next?{replacementId:next.id}:{}),...(previous?{replacesId:previous.id}:{})};
}
