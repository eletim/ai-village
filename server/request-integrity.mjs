// Preserve the source graph; isolation is an operational overlay, never a repair.
const rows=value=>Array.isArray(value)?value:[];
export function inspectRequests(data){
 const runs=new Map(data.runs.map(r=>[r.id,r])),agents=new Set(data.agents.map(a=>a.id));
 return (data.requests||[]).map(q=>{
  const reasons=[],bad=s=>reasons.push(s),works=new Map(rows(q.works).map(w=>[w.id,w])),owned=data.runs.filter(r=>r.humanRequestId===q.id);
  if(!Array.isArray(q.works))bad('works');
  const root=works.get(q.rootWorkId);
  if(!root||root.parentWorkId)bad('rootWorkId: '+q.rootWorkId);
  const ref=(id,label,work)=>{const r=runs.get(id);if(!r||r.humanRequestId!==q.id||work&&r.workId!==work)bad(label+': '+id);return r;};
  for(const w of works.values()){
   if(w.parentWorkId&&!works.has(w.parentWorkId))bad('parentWorkId: '+w.id+' → '+w.parentWorkId);
   const visited=new Set();let p=w;while(p){if(visited.has(p.id)){bad('work-cycle: '+w.id);break;}visited.add(p.id);p=works.get(p.parentWorkId);}
   if(!agents.has(w.agentId))bad('work.agentId: '+w.id+' → '+w.agentId);
   if(!Array.isArray(w.runIds)||new Set(w.runIds).size!==w.runIds.length)bad('runIds: '+w.id);
   for(const id of rows(w.runIds))ref(id,'work.runIds',w.id);
   ref(w.currentRunId,'currentRunId',w.id);
   if(!w.runIds?.includes(w.currentRunId))bad('currentRunId-not-in-runIds: '+w.id);
  }
  if(works.size!==rows(q.works).length)bad('duplicate-work');
  for(const r of owned){
   const w=works.get(r.workId);if(!w||!w.runIds?.includes(r.id))bad('run.workId: '+r.id+' → '+r.workId);
   if(!agents.has(r.agentId)||w&&r.agentId!==w.agentId)bad('run.agentId: '+r.id);
   if(r.runModel&&r.runModel.requestId!==q.id)bad('runModel.requestId: '+r.id);
   for(const k of ['retryOf','supersededBy','parentRunId','resultOf','recipientRunId'])if(r.runModel?.[k])ref(r.runModel[k],'runModel.'+k);
   const parent=r.runModel?.parentRunId&&runs.get(r.runModel.parentRunId);
   if(parent&&parent.workId!==w?.parentWorkId)bad('parentRunId.workId: '+r.id);
   for(const key of ['retryOf','supersededBy','recipientRunId']){const target=runs.get(r.runModel?.[key]);if(target&&target.workId!==r.workId)bad(key+'.workId: '+r.id);}
   if(r.runModel?.phase==='result'){
    const child=runs.get(r.runModel.resultOf),childWork=child&&works.get(child.workId);
    if(!child||childWork?.parentWorkId!==r.workId)bad('resultOf.parentWorkId: '+r.id);
   }
   if(r.steerTarget?.runId)ref(r.steerTarget.runId,'steerTarget.runId',r.workId);
   if(r.resultId)ref(rows(q.inbox).find(e=>e.id===r.resultId)?.resultRunId||r.resultId,'resultId');
  }
  for(const key of ['initialRunId','finalRunId'])if(q[key])ref(q[key],key,q.rootWorkId);
  if(q.report){ref(q.report.sourceRunId,'report.sourceRunId',q.rootWorkId);if(q.report.initialRunId)ref(q.report.initialRunId,'report.initialRunId',q.rootWorkId);}
  for(const key of ['originAgentId','finalAgentId'])if(q[key]&&!agents.has(q[key]))bad(key+': '+q[key]);
  for(const e of rows(q.inbox)){
   if(!works.has(e.workId)||!works.has(e.parentWorkId))bad('inbox.workId: '+e.id);
   if(e.resultRunId)ref(e.resultRunId,'inbox.resultRunId',e.workId);
   if(e.deliveryRunId)ref(e.deliveryRunId,'inbox.deliveryRunId',e.parentWorkId);
  }
  for(const w of works.values())if(w.finish?.runId)ref(w.finish.runId,'work.finish.runId',w.id);
  const m=q.requestModel;
  if(m){
   if(m.id!==q.id||!['active','completed','withdrawn'].includes(m.state?.kind)||!Array.isArray(m.declarations)||!Array.isArray(m.decisions))bad('requestModel.shape');
   ref(m.rootRunId,'requestModel.rootRunId',q.rootWorkId);if(m.reportRunId){const report=ref(m.reportRunId,'requestModel.reportRunId',q.rootWorkId);if(report&&report.phase!=='report')bad('reportRunId.phase: '+report.id);}
   if(!Array.isArray(m.runs)||m.runs.length!==owned.length||new Set(m.runs.map(r=>r.id)).size!==owned.length)bad('requestModel.runs');
   for(const r of rows(m.runs))ref(r.id,'requestModel.runs');
   for(const d of rows(m.declarations))ref(d.runId,'declaration.runId');
  }
  return {id:q.id,reasons:[...new Set(reasons)]};
 });
}
export function quarantineRequests(data){
 const results=inspectRequests(data);
 for(const result of results){const q=data.requests.find(q=>q.id===result.id);if(result.reasons.length)q.integrity={version:1,reasons:result.reasons};else if(q.integrity)delete q.integrity;}
 return results;
}
export const quarantinedRun=(data,r)=>!!(r.humanRequestId&&!(data.requests||[]).some(q=>q.id===r.humanRequestId))||(data.requests||[]).some(q=>q.integrity&&(q.id===r.humanRequestId||rows(q.works).some(w=>w.runIds?.includes(r.id))||rows(q.requestModel?.runs).some(m=>m.id===r.id)));
export const integrityView=q=>q.integrity?{status:'active',needsReview:true,quarantined:true}:{};
