// Outbound DTOs only. Never attach these views to persisted/core requests.
import {rootNode,evidence} from './unified-requests.mjs';
export function compatibilityModel(data,q){
 const n=rootNode(q);return {id:q.id,state:n.state,runs:evidence(data,q).map(e=>e.run),rootRunId:q.report?.sourceRunId||n.currentRunId,reportRunId:n.reportRunId,reportMode:n.reportMode,delegated:q.requestGraph.nodes.length>1,declarations:q.requestGraph.nodes.flatMap(n=>n.declarations),decisions:n.decisions};
}
export const workDTO=n=>structuredClone({...n.metadata,id:n.id,parentWorkId:n.parentId,agentId:n.assignee,runIds:n.runIds,currentRunId:n.currentRunId});
export const compatibilityDTO=(data,q)=>q.integrity?{}:{works:q.requestGraph.nodes.map(workDTO),requestModel:structuredClone(compatibilityModel(data,q))};
