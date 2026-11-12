import {integrityView} from './request-integrity.mjs';
import {runView,requestView,agentView} from './state/projection.ts';
import {resultEntries} from './request-lifecycle.mjs';
export const projectRun=r=>({...r,...runView(r.runModel)});
export const projectAgent=a=>({...a,...agentView(a.agentModel)});
export const projectRequest=(data,q)=>({...q,...(q.integrity?{}:requestView(q.requestModel)),...integrityView(q),results:resultEntries(data,q)});
export const projectState=data=>({...data,agents:data.agents.map(projectAgent),runs:data.runs.map(projectRun),requests:(data.requests||[]).map(q=>projectRequest(data,q))});

export function apiValue(value){
 if(Array.isArray(value))return value.map(apiValue);
 if(!value||typeof value!=='object')return value;
 const fields=value.integrity?{}:value.runModel?runView(value.runModel):value.agentModel?agentView(value.agentModel):value.requestModel?requestView(value.requestModel):{};
 return Object.fromEntries(Object.entries({...value,...fields,...integrityView(value)}).map(([k,v])=>[k,apiValue(v)]));
}
