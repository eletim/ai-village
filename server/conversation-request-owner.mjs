import {createHash} from 'node:crypto';
// Historical authorship never changes. These helpers resolve only the current
// mailbox, using the persisted official handover receipt rather than an Agent name.
function handover(data,sourceId,projectId){
 const source=data.agents.find(a=>a.id===sourceId),receipt=source?.secretaryHandover;
 if(!receipt)return null;
 const x=JSON.parse(receipt.payload),plan=receipt.plan,{planHash,...hashedPlan}=plan;
 const target=data.agents.find(a=>a.id===receipt.targetAgentId);
 if(source.projectId!==projectId||target?.projectId!==projectId||source.location!=='mayor'||target.location!=='mayor'||receipt.sourceAgentId!==sourceId||plan.sourceAgentId!==sourceId||plan.targetAgentId!==target.id||x.targetAgentId!==target.id||x.operationId!==receipt.operationId||x.actorRunId!==receipt.actorRunId||x.planHash!==planHash||planHash!==createHash('sha256').update(JSON.stringify(hashedPlan)).digest('hex'))return null;
 return receipt;
}
export function conversationRunOwner(data,c,r){
 if(!c||!r||r.conversationId!==c.id)return false;
 if(r.agentId===c.agentId)return true;
 try{
  if(r.runModel.phase!=='conversation'||r.runModel.state.kind!=='ended')return false;
  const history=c.handoverHistory||[],start=history.findIndex(h=>h.fromAgentId===r.agentId&&h.historicalRunIds.includes(r.id));
  if(start<0)return false;
  let owner=r.agentId;const seen=new Set([owner]);
  for(const h of history.slice(start)){
   const receipt=handover(data,owner,c.projectId),pc=receipt?.plan.conversations.find(p=>p.id===c.id);
   if(h.fromAgentId!==owner||seen.has(h.toAgentId)||!receipt||receipt.operationId!==h.operationId||receipt.at!==h.at||receipt.targetAgentId!==h.toAgentId||!pc||pc.sequence<r.conversationSequence||!h.historicalRunIds.includes(r.id))return false;
   if(owner===r.agentId&&!receipt.plan.runs.some(p=>p.id===r.id&&p.state.kind==='ended'))return false;
   owner=h.toAgentId;seen.add(owner);
  }
  return owner===c.agentId;
 }catch{return false;}
}
// Presentation routing only, never dispatch authority or a rewrite of stored runs.
export function currentRunMailbox(data,r){
 if(r.conversationId){const c=data.conversations.find(c=>c.id===r.conversationId);return conversationRunOwner(data,c,r)?c.agentId:r.agentId;}
 try{
  let owner=r.agentId;const seen=new Set([owner]);
  const projectId=data.agents.find(a=>a.id===owner)?.projectId;
  for(;;){
   const receipt=handover(data,owner,projectId);
   if(!receipt)return owner;
   // Only work explicitly included in the official responsibility transfer.
   if(!receipt.plan.works.some(w=>w.humanRequestId===r.humanRequestId&&w.workId===r.workId)||seen.has(receipt.targetAgentId))return owner;
   owner=receipt.targetAgentId;seen.add(owner);
  }
 }catch{return r.agentId;}
}
// Compatibility entry point for graph validation: original requester authority
// requires the originating job receipt as well as the shared mailbox proof.
export function conversationRequestOwner(data,c,q,n){
 if(!c)return false;
 if(c.agentId===n.requester.agentId)return true;
 try{
  const by=q.requestedBy,actor=data.runs.find(r=>r.id===by?.actorRunId);
  if(by?.kind!=='agent'||by.agentId!==n.requester.agentId||c.projectId!==q.projectId||actor?.agentId!==by.agentId||actor.conversationId!==c.id||actor.runModel.phase!=='conversation'||actor.runModel.state.kind!=='ended'||!actor.runModel.facts.some(f=>f.type==='input'))return false;
  const op=c.operations.find(o=>{if(o.receipt?.humanRequestId!==q.id)return false;const p=JSON.parse(o.payload);return p.action==='job'||p.action==='followup'&&p.input.purposeId===q.purposeId;});
  const input=op&&JSON.parse(op.payload).input;
  if(!input||input.actorRunId!==actor.id||input.conversationId!==c.id||q.clientRequestId!=='conversation:'+c.id+':'+op.id||op.receipt.workId!==n.id)return false;
  return conversationRunOwner(data,c,actor);
 }catch{return false;}
}
