// Request decisions have one authority: state/request.ts. Compatibility fields are getters.
import {transitionRequest} from './state/request.ts';
import {checkProgress} from './state/progress.ts';
import {migrateDirect} from './state/migrate.ts';
import {modelOf} from './run-lifecycle.mjs';
export function bindRequest(data,q){
 if(!q.requestModel){
  const imported=migrateDirect({...data,requests:[{...q,status:q.status||'active'}]},{resumeInFlight:true}).requests[0];
  q.requestModel={...imported,runs:data.runs.filter(r=>r.humanRequestId===q.id).map(modelOf)};
 }
 Object.defineProperty(q,'toJSON',{configurable:true,enumerable:false,value(){
  const {status,needsReview,...saved}=this;
  return {...saved,works:this.works.map(({state,...work})=>work)};
 }});
 Object.defineProperty(q,'status',{configurable:true,enumerable:true,get(){return ({active:'active',completed:'completed',withdrawn:'cancelled'})[this.requestModel.state.kind];}});
 Object.defineProperty(q,'needsReview',{configurable:true,enumerable:true,get(){return this.requestModel.state.kind==='active'&&this.requestModel.state.review.length>0;}});
 for(const w of q.works)bindWork(data,q,w);
 return q;
}
export function bindWork(data,q,w){
 Object.defineProperty(w,'state',{configurable:true,enumerable:true,get(){
  const r=data.runs.find(r=>r.id===this.currentRunId);
  if(!r)return 'terminated';
  return ['completed','failed','interrupted','terminated'].includes(r.state)?r.state:'active';
 }});
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
