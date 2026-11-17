import {requestView,runView} from './state/projection.ts';
import {attachGraph,applyGraph,graphResults} from './unified-requests.mjs';
export const requestStatus=q=>q.integrity?'quarantined':requestView(q.requestModel).status;
export function bindRequest(data,q){return attachGraph(data,q);}
export function resultEntries(data,q){if(q.integrity)return [];if(q.requestGraph)return graphResults(data,q);return (q.requestModel?.runs||[]).filter(m=>m.parentRunId&&m.phase!=='report'&&['ended','cancelled'].includes(m.state.kind)).map(m=>{const r=data.runs.find(r=>r.id===m.id),w=q.works.find(w=>w.id===r.workId);return {id:m.id,workId:w.id,parentWorkId:w.parentWorkId,resultRunId:m.id,outcome:runView(m).state,deliveryRunId:q.requestModel.runs.find(d=>d.phase==='result'&&d.resultOf===m.id)?.id,superseded:!!m.supersededBy||q.requestModel.runs.some(n=>n.retryOf===m.id)};});}
export function observeRequest(data,q){if(!q.requestGraph)attachGraph(data,q);return applyGraph(data,q,{type:'observe',actor:'program'});}
