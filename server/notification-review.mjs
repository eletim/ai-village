import {createHash} from 'node:crypto';
import {conversationNotificationTarget} from './conversation-notification.mjs';
import {requestNotificationTarget} from './request-lifecycle.mjs';
import {completedEntries} from '../src/completions.js';
export const reviewRevision=keys=>createHash('sha256').update(JSON.stringify(keys.slice().sort())).digest('hex');
export function notificationEntries(data){
 return [
  ...data.runs.filter(r=>conversationNotificationTarget(data,r)).map(r=>({agentId:r.agentId,key:'conversation-answer:'+r.id})),
  // Prepared request notifications survive same-work continuation. Their IDs
  // and original answer authorship do not change with later work/ownership.
  ...(data.requests||[]).filter(q=>!q.conversationId&&q.notification?.id==='request:'+q.id).map(q=>({agentId:data.runs.find(r=>r.id===q.finalRunId)?.agentId||q.finalAgentId,key:'request:'+q.id})),
 ];
}
// Translate only a provably current old read receipt, in the existing field.
// Unmatched (unread/stale) receipts stay unmatched; no history or delivery changes.
export function migrateNotificationReviews(data,view){
 const previous=completedEntries(view),next=notificationEntries(data);
 for(const q of (data.requests||[]).filter(requestNotificationTarget))previous.push({agentId:q.finalAgentId,key:'request:'+q.id+':'+q.finalRunId});
 const legacy=new Set(data.reviewedCompletions||[]);
 for(const a of data.agents){
  const keys=previous.filter(e=>e.agentId===a.id).map(e=>e.key);
  if(data.agentReviews?.[a.id]===reviewRevision(keys)||(!data.agentReviews?.[a.id]&&keys.every(k=>legacy.has(k)))){
   data.agentReviews ||= {};
   data.agentReviews[a.id]=reviewRevision(next.filter(e=>e.agentId===a.id).map(e=>e.key));
  }
 }
}
