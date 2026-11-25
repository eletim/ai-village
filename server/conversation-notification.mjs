import {conversationDisplayMode,decisionState,deliveryOf,purposeDecisionRequired,REPORT_DELIVERY_KINDS} from './conversation-purpose.mjs';
// External notification policy for a normally completed secretary conversation run.
// It decides only whether to notify; on-screen display (conversationDisplayMode) is unchanged.
// A human who wrote within this window is treated as still looking at the conversation.
export const HUMAN_PRESENT_WINDOW_MS=3*60*1000;
// Operations that only hand work to the leader or correct it; they are not a human-facing outcome.
export const WORK_DISPATCH_ACTIONS=['job','followup','amend','withdraw'];
const operationsOf=(c,r)=>(c?.operations||[]).flatMap(o=>{try{const p=JSON.parse(o.payload);return p.input?.actorRunId===r.id?[p.action]:[];}catch{return [];}});
const completedAt=r=>r.runModel?.facts?.findLast(f=>f.type==='terminal')?.at??Date.parse(r.completedAt||'');
export function conversationNotification(data,r){
 const c=data.conversations?.find(c=>c.id===r.conversationId);
 if(conversationDisplayMode(data,r)==='progress')return {notify:false,reason:purposeDecisionRequired(data,r)?'purpose-decision-progress':r.conversationDisplay?.mode==='progress'?'explicit-conversation-progress':'purpose-continuation-progress'};
 // An explicit reply from the secretary keeps its documented meaning: normal display and notification.
 if(r.conversationDisplay?.mode==='reply')return {notify:true,reason:'explicit-conversation-reply'};
 // Failure explanations and state changes are important reports to the human.
 if(REPORT_DELIVERY_KINDS.includes(deliveryOf(c,r)?.kind))return {notify:true,reason:'work-report'};
 if(r.conversationSource?.kind==='human'){
  const elapsed=completedAt(r)-Date.parse(r.createdAt);
  if(Number.isFinite(elapsed)&&elapsed>=0&&elapsed<=HUMAN_PRESENT_WINDOW_MS)return {notify:false,reason:'human-present-quick-reply'};
 }
 const decided=(c?.purposeDecisions||[]).some(d=>d.actorRunId===r.id&&['accept','question'].includes(d.kind)&&decisionState(data,c,d)==='committed');
 if(!decided&&operationsOf(c,r).some(a=>WORK_DISPATCH_ACTIONS.includes(a)))return {notify:false,reason:'work-dispatch-only'};
 return {notify:true,reason:decided?'purpose-decision':'conversation-reply'};
}
