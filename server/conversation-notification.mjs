import {accepted,runState} from './run-lifecycle.mjs';
import {conversationDisplayMode,decisionState,deliveryOf,purposeDecisionRequired,REPORT_DELIVERY_KINDS} from './conversation-purpose.mjs';
// External notification policy for a normally completed secretary conversation run.
// It decides only whether to notify; on-screen display (conversationDisplayMode) is unchanged.
// A quick answer (within this window of the human's own utterance or action) is not notified
// while the human is actually viewing that secretary in the village UI.
export const HUMAN_PRESENT_WINDOW_MS=3*60*1000;
// The UI reports viewing (visible, focused, secretary selected) every 15s and reports leaving at
// once; a report older than this (e.g. a lost leave on a locked phone) no longer counts.
export const HUMAN_PRESENCE_TTL_MS=40*1000;
// Operations that only hand work to the leader or correct it; they are not a human-facing outcome.
export const WORK_DISPATCH_ACTIONS=['job','followup','amend','withdraw'];
const operationsOf=(c,r)=>(c?.operations||[]).flatMap(o=>{try{const p=JSON.parse(o.payload);return (o.receipt?.actorRunId||p.input?.actorRunId)===r.id?[p.action]:[];}catch{return [];}});
const completedAt=r=>r.runModel?.facts?.findLast(f=>f.type==='terminal')?.at??Date.parse(r.completedAt||'');
// presentAt: last time the human UI reported viewing r.agentId (in memory; unknown after restart).
export function conversationNotification(data,r,{presentAt,now=Date.now()}={}){
 const c=data.conversations?.find(c=>c.id===r.conversationId);
 // A human input saved before this terminal makes this notification stale.
 // Already completed-before-input answers and already attempted notifications stand.
 if(data.runs?.some(x=>x.conversationId===r.conversationId&&x.conversationSource?.kind==='human'&&!x.queueCancelledAt&&x.conversationSequence>r.conversationSequence&&Date.parse(x.createdAt)<=completedAt(r)))return {notify:false,reason:'human-input-before-answer-ended'};
 const watching=Number.isFinite(presentAt)&&now-presentAt>=0&&now-presentAt<=HUMAN_PRESENCE_TTL_MS;
 const quickAfter=at=>{const elapsed=completedAt(r)-at;return Number.isFinite(elapsed)&&elapsed>=0&&elapsed<=HUMAN_PRESENT_WINDOW_MS;};
 if(conversationDisplayMode(data,r)==='progress')return {notify:false,reason:purposeDecisionRequired(data,r)?'purpose-decision-progress':r.conversationDisplay?.mode==='progress'?'explicit-conversation-progress':'purpose-continuation-progress'};
 // An explicit reply from the secretary keeps its documented meaning: normal display and notification.
 if(r.conversationDisplay?.mode==='reply')return {notify:true,reason:'explicit-conversation-reply'};
 // Failure explanations and state changes are important reports to the human, except the
 // answer to the human's own closure while they are still looking at the village.
 const delivery=deliveryOf(c,r);
 if(REPORT_DELIVERY_KINDS.includes(delivery?.kind)){
  // The human just closed it in the village UI (human-only route); the answer within 3 minutes
  // of that action is theirs to read there. Timed from the action, not from presence.
  if(delivery.id?.startsWith('human-closure:')&&quickAfter(Date.parse(delivery.createdAt)))return {notify:false,reason:'human-closure-own-action'};
  return {notify:true,reason:'work-report'};
 }
 if(r.conversationSource?.kind==='human'&&quickAfter(Date.parse(r.createdAt))){
  if(watching)return {notify:false,reason:'human-present-quick-reply'};
 }
 const decided=(c?.purposeDecisions||[]).some(d=>d.actorRunId===r.id&&['accept','question'].includes(d.kind)&&decisionState(data,c,d)==='committed');
 if(!decided&&operationsOf(c,r).some(a=>WORK_DISPATCH_ACTIONS.includes(a)))return {notify:false,reason:'work-dispatch-only'};
 return {notify:true,reason:decided?'purpose-decision':'conversation-reply'};
}

// Shared terminal boundary; transport reservations/results are not display facts.
export const conversationNotificationReady=r=>!!r.conversationId&&r.notificationPolicy==='conversation'&&accepted(r)&&runState(r)==='completed';
export function conversationNotificationTarget(data,r){
 if(!conversationNotificationReady(r))return false;
 // Preserve settled semantic exclusions, including older policies. Presence is
 // delivery suppression only; without presentAt the same policy decides meaning.
 if(r.notificationSuppressed&&r.notificationSuppressed.reason!=='human-present-quick-reply')return false;
 // A claimed reservation already passed the policy. Keep that decision across
 // later history changes, regardless of transport success, OFF, failure or delay.
 if(r.notification&&r.notification.status!=='pending')return true;
 return conversationNotification(data,r).notify;
}
