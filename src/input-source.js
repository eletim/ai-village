// Provenance only: never infer an actor from notification wording or display names.
export function supplementSource(q,n,i){
 if(i.source?.actor)return {actor:i.source.actor,proof:'transition-actor'};
 if(i.operationId){
  const op=q.requestGraph?.operations?.find(o=>o.id===i.operationId&&o.inputId===i.id);let p;try{p=JSON.parse(op?.payload);}catch{}
  if(p?.type==='supplement'&&p.requestId===n.id&&p.text===i.text&&Object.hasOwn(p,'actorRunId')){
   const actor=p.actorRunId===null?'human':typeof p.actorRunId==='string'?'agent':null;
   if(actor)return {actor,proof:'supplement-operation'};
  }
 }
 return {actor:'unknown',proof:'unknown'};
}
