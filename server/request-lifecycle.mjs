import {requestView,runView} from './state/projection.ts';
// Request decisions have one authority: state/request.ts. Compatibility fields are getters.
import {transitionRequest} from './state/request.ts';
import {checkProgress} from './state/progress.ts';
import {migrateDirect} from './state/migrate.ts';
import {modelOf} from './run-lifecycle.mjs';
export const requestStatus=q=>requestView(q.requestModel).status;
export function bindRequest(data,q){
 if(!q.requestModel){
  const runs=data.runs.filter(r=>r.humanRequestId===q.id).map(modelOf);
  q.requestModel={id:q.id,state:{kind:'active',review:[]},runs,rootRunId:q.works.find(w=>w.id===q.rootWorkId).currentRunId,reportRunId:null,reportMode:q.reportMode===true,delegated:false,declarations:[],decisions:[]};
 }
 return q;
}
export function resultEntries(data,q){
 return q.requestModel.runs.filter(m=>m.parentRunId&&m.phase!=='report'&&['ended','cancelled'].includes(m.state.kind)).map(m=>{
  const r=data.runs.find(r=>r.id===m.id),w=q.works.find(w=>w.id===r.workId),parent=q.works.find(p=>p.id===w.parentWorkId);
  return {id:m.id,workId:w.id,parentWorkId:w.parentWorkId,recipientAgentId:parent?.agentId,resultRunId:m.id,outcome:runView(m).state,createdAt:r.completedAt||r.createdAt,deliveryRunId:q.requestModel.runs.find(d=>d.phase==='result'&&d.resultOf===m.id)?.id,superseded:!!m.supersededBy||q.requestModel.runs.some(n=>n.retryOf===m.id)};
 });
}
export function requestChange(q,event){
 const result=transitionRequest(q.requestModel,event);
 if(!result.ok)throw Object.assign(Error('request transition rejected: '+event.type+' '+result.reason),{status:409});
 q.requestModel=result.value;
 if(!checkProgress(q.requestModel).ok)throw Error('Request progress invariant: '+q.id);
 return q;
}
export function observeRequest(data,q){
 if(!q.requestModel)bindRequest(data,q);
 return requestChange(q,{type:'observe-runs',actor:'program',runs:q.requestModel.runs.map(m=>modelOf(data.runs.find(r=>r.id===m.id)))});
}
