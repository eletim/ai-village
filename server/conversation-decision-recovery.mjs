import {accepted,runState,changeRun} from './run-lifecycle.mjs';
import {purposeView} from './conversation-purpose.mjs';
import {runtimeGate} from './conversation-status.mjs';
import {latest} from './state/requests.ts';

export const MAX_DECISION_RECOVERIES=2;
function retiredReminder(data,event){const r=data.runs.find(r=>r.id===event.runId);return r?.runModel?.state.kind==='cancelled'&&r.runModel.facts.length===0&&r.runModel.decisions.some(d=>d.actor==='program'&&d.reason==='decision-reminder-context-changed-before-dispatch');}
// A retry carries the saved material, but decisions always name its original
// result event. No text parsing, latest-job selection, or new execution work.
export function resultSourceEvent(c,event){
 if(!event?.decisionRecovery)return event;
 const recovery=event.decisionRecovery;
 if(recovery.version!==1||!Number.isSafeInteger(recovery.attempt)||recovery.attempt<1||recovery.attempt>MAX_DECISION_RECOVERIES||event.kind!=='result'||event.id!=='decision-recovery:'+recovery.sourceDeliveryId+':'+recovery.attempt)return null;
 const source=c.deliveries.find(e=>e.id===recovery.sourceDeliveryId);
 if(!source||source.kind!=='result'||source.decisionRecovery||source.decisionRecoveryVersion!==1||source.humanRequestId!==event.humanRequestId||JSON.stringify(source.material)!==JSON.stringify(event.material))return null;
 return source;
}
export function decisionRecoveryPlan(data,c,q){
 const stop=reason=>({ready:false,reason});
 if(q.integrity)return stop('request-integrity');
 const view=purposeView(data,q);
 if(view.currentRequestId!==q.id)return stop('superseded');
 const w=q.requestGraph?.nodes.find(w=>w.id===(q.rootWorkId||q.requestGraph.rootId));
 if(w?.state.kind!=='completed'||w.state.by==='human')return stop('not-agent-result');
 if(view.decision?.humanRequestId===q.id)return stop('decision-'+view.decision.state);
 const source=c.deliveries.findLast(e=>e.humanRequestId===q.id&&e.kind==='result'&&!e.decisionRecovery);
 if(!source||source.decisionRecoveryVersion!==1)return stop('not-enabled');
 const submission=latest(w);
 if(!submission||submission.id!==source.material?.resultId||submission.version!==source.material?.version)return stop('result-changed');
 const attempts=c.deliveries.filter(e=>e.decisionRecovery?.sourceDeliveryId===source.id);
 if(attempts.some((e,i)=>e.decisionRecovery.attempt!==i+1||resultSourceEvent(c,e)!==source||e.decisionRecovery.retired&&!retiredReminder(data,e)))return stop('invalid-recovery-chain');
 const previous=attempts.findLast(e=>!e.decisionRecovery.retired)||source,r=data.runs.find(r=>r.id===previous.runId),original=data.runs.find(r=>r.id===source.runId);
 if(!original||!accepted(original)||runState(original)!=='completed')return stop('source-not-normal');
 if(!r||!accepted(r)||runState(r)!=='completed')return stop('previous-not-normal');
 if(attempts.length>=MAX_DECISION_RECOVERIES)return stop('retry-limit');
 const laterHumans=data.runs.filter(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&!r.queueCancelledAt&&r.conversationSequence>original.conversationSequence);
 if(laterHumans.some(r=>['queued','awaiting_input','running'].includes(runState(r))))return stop('later-human-input');
 if(laterHumans.some(r=>runState(r)!=='completed'||!accepted(r)))return stop('later-human-unconfirmed');
 if(data.runs.some(r=>r.conversationId===c.id&&['queued','awaiting_input','running'].includes(runState(r))))return stop('conversation-busy');
 if(runtimeGate(data.agents.find(a=>a.id===c.agentId)).code!=='ready')return stop('secretary-unavailable');
 return {ready:true,source,attempt:attempts.length+1,id:'decision-recovery:'+source.id+':'+(attempts.length+1)};
}
// Caller holds request-graph lock and persistence transaction; enqueue + ledger
// must save atomically. The durable delivery ID makes subsequent ticks no-ops.
export function recoverMissingDecision(conversations,c,q){
 const plan=decisionRecoveryPlan(conversations.d.data,c,q);
 if(!plan.ready)return false;
 const {source,attempt,id}=plan;
 if(c.deliveries.some(e=>e.id===id))return false;
 const material=structuredClone(source.material);
 const event={id,kind:'result',humanRequestId:q.id,createdAt:new Date().toISOString(),material,decisionRecovery:{version:1,sourceDeliveryId:source.id,attempt}};
 const run=conversations.enqueue(c,{requestId:'conversation-delivery:'+id,source:{kind:'program',humanRequestId:q.id,deliveryId:id},instruction:'保存済み成果の判断が未完了です。成果を確認し、達成報告・許可内の追加修正・具体質問のいずれかを選んでください。旧作業の再送や追加許可ではありません。\n'+JSON.stringify({id,kind:'result',humanRequestId:q.id,sourceDeliveryId:source.id,read:['conversations','get',c.id]})});
 run.requiresPurposeDecision=true;event.runId=run.id;c.deliveries.push(event);
 return true;
}

// Read-only operational detail. Normal chat need only show evaluating while its
// queued/running recovery exists; failure/limit can retain the concise attention.
export function decisionRecoveryState(data,c,q){
 const source=c.deliveries.findLast(e=>e.humanRequestId===q.id&&e.kind==='result'&&!e.decisionRecovery);
 if(source?.decisionRecoveryVersion!==1)return null;
 const attempts=c.deliveries.filter(e=>e.decisionRecovery?.sourceDeliveryId===source.id),last=attempts.at(-1),r=last&&data.runs.find(r=>r.id===last.runId);
 const plan=decisionRecoveryPlan(data,c,q);
 return {sourceDeliveryId:source.id,attempts:attempts.length,limit:MAX_DECISION_RECOVERIES,pending:!!r&&['queued','awaiting_input','running'].includes(runState(r)),reason:plan.ready?'ready':plan.reason};
}

// Recheck immediately before dispatch as well as during settle. A queued
// reminder is only a reservation to review material, never a new human input.
export function decisionReminderGuard(data,r){
 const c=data.conversations.find(c=>c.id===r.conversationId),event=c?.deliveries.find(e=>e.runId===r.id&&e.id===r.conversationSource?.deliveryId);
 if(!event?.decisionRecovery)return {reminder:false,allowed:true};
 const stop=reason=>({reminder:true,allowed:false,reason});
 const source=resultSourceEvent(c,event),q=data.requests.find(q=>q.id===event.humanRequestId);
 if(!source||!q||q.integrity)return stop('invalid-source');
 const original=data.runs.find(x=>x.id===source.runId);
 if(!original||!accepted(original)||runState(original)!=='completed')return stop('source-not-normal');
 const view=purposeView(data,q),w=q.requestGraph?.nodes.find(w=>w.id===(q.rootWorkId||q.requestGraph.rootId)),submission=w&&latest(w);
 if(view.currentRequestId!==q.id)return stop('superseded');
 if(w?.state.kind!=='completed'||w.state.by==='human')return stop('request-closed-or-changed');
 if(!submission||submission.id!==source.material?.resultId||submission.version!==source.material?.version)return stop('result-changed');
 if(view.decision?.humanRequestId===q.id)return stop('decision-'+view.decision.state);
 if(data.runs.some(h=>h.conversationId===c.id&&h.conversationSource?.kind==='human'&&!h.queueCancelledAt&&h.conversationSequence>r.conversationSequence))return stop('later-human-input');
 if(r.agentId!==c.agentId)return stop('secretary-changed');
 return {reminder:true,allowed:true};
}
// Caller persists under the request graph lock. Already sent/accepted runs are
// never cancelled here, even if their context subsequently changes.
export function retireDecisionReminder(data,r){
 if(r.runModel?.state.kind!=='queued'||r.runModel.facts.length)return false;
 const gate=decisionReminderGuard(data,r);if(!gate.reminder||gate.allowed)return false;
 changeRun(r,{type:'cancel-decision-reminder',actor:'program'});
 const event=data.conversations.find(c=>c.id===r.conversationId).deliveries.find(e=>e.runId===r.id);
 event.decisionRecovery.retired={at:new Date().toISOString(),reason:gate.reason};
 r.queueCancelledAt=event.decisionRecovery.retired.at;r.error='decision-reminder-retired:'+gate.reason;
 return true;
}
