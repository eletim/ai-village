import {createHash} from 'node:crypto';
// A requester is historical authority; a conversation owner is the current recipient.
// Only a persisted official handover chain can bridge those distinct identities.
export function conversationRequestOwner(data,c,q,n){
 if(!c)return false;
 if(c.agentId===n.requester.agentId)return true;
 try{
  const by=q.requestedBy,actor=data.runs.find(r=>r.id===by?.actorRunId);
  if(by?.kind!=='agent'||by.agentId!==n.requester.agentId||c.projectId!==q.projectId||actor?.agentId!==by.agentId||actor.conversationId!==c.id||actor.runModel.phase!=='conversation'||actor.runModel.state.kind!=='ended'||!actor.runModel.facts.some(f=>f.type==='input'))return false;
  const op=c.operations.find(o=>o.receipt?.humanRequestId===q.id&&JSON.parse(o.payload).action==='job');
  const input=op&&JSON.parse(op.payload).input;
  if(!input||input.actorRunId!==actor.id||input.conversationId!==c.id||q.clientRequestId!=='conversation:'+c.id+':'+op.id||op.receipt.workId!==n.id)return false;
  const history=c.handoverHistory||[],start=history.findIndex(h=>h.fromAgentId===by.agentId&&h.historicalRunIds.includes(actor.id));
  if(start<0)return false;
  let owner=by.agentId;const seen=new Set([owner]);
  for(const h of history.slice(start)){
   const source=data.agents.find(a=>a.id===owner),target=data.agents.find(a=>a.id===h.toAgentId),receipt=source?.secretaryHandover;
   if(h.fromAgentId!==owner||seen.has(h.toAgentId)||source?.projectId!==c.projectId||target?.projectId!==c.projectId||source.location!=='mayor'||target.location!=='mayor'||!receipt)return false;
   const x=JSON.parse(receipt.payload),plan=receipt.plan,{planHash,...hashedPlan}=plan,pc=plan.conversations.find(p=>p.id===c.id);
   if(receipt.operationId!==h.operationId||x.operationId!==h.operationId||receipt.at!==h.at||receipt.sourceAgentId!==owner||receipt.targetAgentId!==h.toAgentId||x.targetAgentId!==h.toAgentId||plan.sourceAgentId!==owner||plan.targetAgentId!==h.toAgentId||x.actorRunId!==receipt.actorRunId||x.planHash!==planHash||x.planHash!==createHash('sha256').update(JSON.stringify(hashedPlan)).digest('hex')||!pc||pc.sequence<actor.conversationSequence)return false;
   if(owner===by.agentId&&!plan.runs.some(r=>r.id===actor.id&&r.state.kind==='ended'))return false;
   owner=h.toAgentId;seen.add(owner);
  }
  return owner===c.agentId;
 }catch{return false;}
}
