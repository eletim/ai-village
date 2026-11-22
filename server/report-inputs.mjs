// Read-only projection. No content/name heuristics, and no repair of legacy records.
export function reportInputs(q,runs=[]){
 const inputs=[],seen=new Set(),nodes=q.requestGraph?.nodes||[];
 const add=item=>{const key=item.operationId?'operation:'+item.operationId:item.id;if(seen.has(key))return;seen.add(key);inputs.push(item);};
 for(const n of nodes)for(const i of n.inbox||[]){
  if(i.kind!=='supplement'||i.retiredBy)continue;
  let actor=i.source?.actor,proof=actor?'transition-actor':'unknown';
  if(!actor&&i.operationId){
   const op=q.requestGraph.operations?.find(o=>o.id===i.operationId&&o.inputId===i.id);let p;try{p=JSON.parse(op?.payload);}catch{}
   if(p?.type==='supplement'&&p.requestId===n.id&&p.text===i.text&&Object.hasOwn(p,'actorRunId')){actor=p.actorRunId===null?'human':typeof p.actorRunId==='string'?'agent':undefined;proof='supplement-operation';}
  }
  add({id:i.id,workId:n.id,operationId:i.operationId,createdAt:i.createdAt,actor:actor||'unknown',proof,text:i.text,source:'inbox'});
 }
 for(const r of runs){
  if(r.humanRequestId!==q.id||r.queueCancelledAt||r.id===q.initialRunId||!['steering','continuation','retry'].includes(r.origin))continue;
  const actor=r.instructionSource?.actor||r.runModel?.createdBy||'unknown',proof=r.instructionSource?'instruction-source':r.runModel?.createdBy?'run-createdBy':'unknown';
  // Report retries carry a generated report instruction; only the separate human text is usable.
  const text=r.phase==='report'&&r.origin!=='steering'?r.retryInstruction:r.instruction;
  if(typeof text!=='string')continue;
  add({id:r.id,workId:r.workId,...(r.origin==='steering'&&r.requestId?{operationId:r.requestId}:{}),createdAt:r.createdAt,actor,proof,text,source:'run'});
 }
 inputs.sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id));
 return {human:inputs.filter(i=>i.actor==='human'),material:inputs.filter(i=>i.actor!=='human')};
}
