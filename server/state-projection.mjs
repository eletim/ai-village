import {waitingReason} from './state/requests.ts';
import {compatibilityDTO} from './request-compatibility.mjs';
import {rootNode,evidence} from './unified-requests.mjs';
import {integrityView} from './request-integrity.mjs';
import {runView,requestView,agentView} from './state/projection.ts';
import {resultEntries} from './request-lifecycle.mjs';
export const projectRun=r=>({...r,...runView(r.runModel)});
const displayAgent=a=>({...agentView(a.agentModel),...(a.deletedAt?{state:'terminated',lifecycle:'terminated'}:{})});
export const projectAgent=a=>({...a,...displayAgent(a)});
const deliveryView=(data,q)=>{if(q.integrity||!q.report)return {};const root=rootNode(q),r=data.runs.find(r=>r.id===root.reportRunId);return {delivery:{sourceRunId:q.report.sourceRunId,runId:r?.id,state:r?runView(r.runModel).state:'pending'}};};
const conversationReturn=(data,q)=>{if(!q.conversationId)return {};const c=data.conversations?.find(c=>c.id===q.conversationId),e=c?.deliveries.findLast(e=>e.humanRequestId===q.id),r=e&&data.runs.find(r=>r.id===e.runId);return {returnDelivery:r?{id:e.id,runId:r.id,kind:e.kind,...runView(r.runModel)}:null};};
export const projectRequest=(data,q)=>({...q,...conversationReturn(data,q),...compatibilityDTO(data,q),...deliveryView(data,q),...(q.integrity?{}:{...requestView(rootNode(q)),waiting:Object.fromEntries(q.requestGraph.nodes.map(n=>[n.id,waitingReason(q.requestGraph,n,evidence(data,q))]))}),...integrityView(q),results:resultEntries(data,q)});
export const projectState=data=>({...data,agents:data.agents.map(projectAgent),runs:data.runs.map(projectRun),requests:(data.requests||[]).map(q=>projectRequest(data,q))});

export function apiValue(value){
 if(Array.isArray(value))return value.map(apiValue);
 if(!value||typeof value!=='object')return value;
 const fields=value.integrity?{}:value.runModel?runView(value.runModel):value.agentModel?displayAgent(value):value.requestModel?requestView(value.requestModel):{};
 return Object.fromEntries(Object.entries({...value,...(value.requestModel?{requestModel:value.requestModel}:{}),...fields,...integrityView(value)}).map(([k,v])=>[k,apiValue(v)]));
}
