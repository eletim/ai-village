import {matchesRunInput} from './input-envelope.mjs';
import {changeRun} from './run-lifecycle.mjs';
// Conversation rows preserve human input and answer attribution. Superseding a
// row does not terminate the native turn and must not invent an unconfirmed end.
// Historical closed rows remain untouched. Only an actual native terminal settles
// an open row; the successor retains final answer / notification ownership.
export function settleSupersededConversation(r,snapshot,runs){
 if(!r.conversationId||!r.runModel.supersededBy||r.runModel.state.kind!=='running'||!snapshot.available||snapshot.incompleteTail||snapshot.more||snapshot.sessionId!==r.runModel.state.sessionId)return;
 const turn=snapshot.turns.find(t=>t.id===r.runModel.state.turnId);
 if(!turn||!['completed','failed','interrupted'].includes(turn.state)||!Number.isFinite(turn.completionOffset))return;
 const own=snapshot.inputs.filter(i=>i.turnId===turn.id&&matchesRunInput(r,i));
 if(own.length!==1||own[0].offset>=turn.completionOffset)return;
 let first=r;const ancestors=new Set([r.id]);
 while(first.steerTarget){const p=runs.find(x=>x.id===first.steerTarget.runId);if(!p||ancestors.has(p.id)||p.conversationId!==r.conversationId||p.agentId!==r.agentId||p.runModel.supersededBy!==first.id)break;ancestors.add(p.id);first=p;}
 const allowed=new Set([first.id]);let next=first;
 while(next.runModel.supersededBy){
  const child=runs.find(x=>x.id===next.runModel.supersededBy);
  if(!child||allowed.has(child.id)||child.conversationId!==r.conversationId||child.agentId!==r.agentId||child.steerTarget?.runId!==next.id)break;
  allowed.add(child.id);next=child;
 }
 if(snapshot.inputs.filter(i=>i.turnId===turn.id).some(i=>i.offset>turn.completionOffset||!runs.some(x=>allowed.has(x.id)&&matchesRunInput(x,i))))return;
 changeRun(r,{type:'terminal',actor:'program',at:Date.now(),sessionId:snapshot.sessionId,turnId:turn.id,outcome:turn.state==='completed'?'normal':turn.state});
 // No finalOutput copying: answers between input offsets remain attached to each
// input, while only the last row can own the final response.
}
