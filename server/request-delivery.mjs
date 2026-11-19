import {rootNode,applyGraph} from './unified-requests.mjs';
import {latest} from './state/requests.ts';
import {runState} from './run-lifecycle.mjs';
// Result delivery is a boundary policy. All workers submit the same way;
// report generation never replaces the work result or its current execution.
export async function settleHumanDelivery(flow,q){
 const w=rootNode(q),s=latest(w);
 if(w.recipient?.kind!=='human'||w.state.kind!=='submitted'||!s)return;
 if(q.reportMode){
  if(!q.report){
   if(!flow.d.data.agents.some(a=>a.id===w.assignee))return;
   q.report={sourceRunId:s.runId,createdAt:new Date().toISOString()};
   const r=flow.enqueue(q,w,flow.reportPrompt(q),'final-report:'+s.id,'report',{phase:'report',attachments:[],travelContexts:[]});q.report.initialRunId=r.id;
  }
  const report=flow.run(w.reportRunId);
  if(!report||runState(report)!=='completed')return;
 }
 applyGraph(flow.d.data,q,{type:'deliver-human',actor:'program',requestId:w.id,resultId:s.id});
}
