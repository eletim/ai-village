import {accepted,runState} from './run-lifecycle.mjs';
export const purposeId=q=>q.purposeId||q.id;
export function purposeJobs(data,q){return (data.requests||[]).filter(x=>x.conversationId===q.conversationId&&purposeId(x)===purposeId(q));}
export function purposeLeaf(data,q){const jobs=purposeJobs(data,q),parents=new Set(jobs.map(x=>x.continuesRequestId).filter(Boolean));return jobs.findLast(x=>!parents.has(x.id))||q;}
export function decisionState(data,c,d){
 if(['continue','resume'].includes(d.kind))return 'continued'; // atomic successor is durable even if the announcing turn fails
 const r=data.runs.find(r=>r.id===d.actorRunId);
 if(!r)return 'failed';
 const terminalAt=r.runModel?.facts.findLast(f=>f.type==='terminal')?.at;
 const horizon=terminalAt??Infinity;
 if(data.runs.some(x=>x.conversationId===c.id&&x.conversationSource?.kind==='human'&&!x.queueCancelledAt&&x.conversationSequence>d.humanSequence&&Date.parse(x.createdAt)<=horizon))return 'stale';
 if(runState(r)==='completed'&&accepted(r))return 'committed';
 return ['queued','awaiting_input','running'].includes(runState(r))?'pending':'failed';
}
export function purposeView(data,q){
 const c=(data.conversations||[]).find(c=>c.id===q.conversationId),id=purposeId(q),leaf=purposeLeaf(data,q);
 const ds=(c?.purposeDecisions||[]).filter(d=>d.purposeId===id),d=ds.at(-1);
 return {id,requestIds:purposeJobs(data,q).map(q=>q.id),currentRequestId:leaf.id,version:ds.length,decision:d?{...d,state:decisionState(data,c,d)}:null};
}
// Failure explanations and state changes are reports, not material to adopt.
// Only result/question/extension material asks the secretary for a purpose decision.
export const REPORT_DELIVERY_KINDS=['attention','important-change'];
export function deliveryOf(c,r){return c?.deliveries.find(e=>e.runId===r.id&&e.id===r.conversationSource?.deliveryId)||null;}
// Older records flagged every delivery; classify by the durable delivery kind instead.
export function purposeDecisionRequired(data,r){
 if(!r.requiresPurposeDecision)return false;
 const e=deliveryOf(data.conversations?.find(c=>c.id===r.conversationId),r);
 return !REPORT_DELIVERY_KINDS.includes(e?.kind);
}
export function conversationDisplayMode(data,r){
 const c=data.conversations?.find(c=>c.id===r.conversationId);
 const ds=(c?.purposeDecisions||[]).filter(d=>d.actorRunId===r.id);
 if(ds.some(d=>['accept','question'].includes(d.kind)&&decisionState(data,c,d)==='committed'))return 'reply';
 if(ds.some(d=>['continue','resume'].includes(d.kind)))return 'progress';
 if(purposeDecisionRequired(data,r)||ds.length)return 'progress';
 return r.conversationDisplay?.mode||'reply';
}
