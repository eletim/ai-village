// Stage 2 boundary: runModel is authoritative; state is the legacy UI/request projection.
// Only this adapter writes that projection. No provider output prose enters transitions.
import {transitionRun,newRun,retryRun,supplementRun} from './state/run.ts';
import {migrateDirect} from './state/migrate.ts';
import {inputHash,resolveInputPosition} from './runtime-events.mjs';

function commit(r,model){
 // Import legacy transport/native receipts once; thereafter getters use model facts only.
 const facts=[...model.facts];
 if(!Object.getOwnPropertyDescriptor(r,'dispatchConfirmed')?.get&&r.dispatchConfirmed===true&&!facts.some(f=>f.type==='transport-ack'))facts.push({type:'transport-ack',at:Date.parse(r.dispatchAttemptedAt)||0});
 if(!Object.getOwnPropertyDescriptor(r,'acceptance')?.get&&r.acceptance==='accepted'&&r.inputId&&r.turnId&&r.sessionId&&!facts.some(f=>f.type==='input'))facts.push({type:'input',at:Date.parse(r.acceptedAt)||0,inputId:r.inputId,turnId:r.turnId,sessionId:r.sessionId});
 r.runModel={...model,facts};
 bindRunProjections(r);
 const s=model.state;
 r.state=model.supersededBy?'superseded':s.kind==='queued'?'queued':s.kind==='sent'?'awaiting_input':s.kind==='running'?'running':s.kind==='cancelled'?'terminated':({normal:'completed',failed:'failed',interrupted:'interrupted',unconfirmed:'terminated'})[s.outcome];

 return r;
}
export function bindRunProjections(r){
 const getters={
  acceptance:()=>r.runModel.state.kind==='cancelled'?'cancelled':r.runModel.state.kind==='running'||r.runModel.facts.some(f=>f.type==='input')||r.runModel.state.kind==='ended'&&r.runModel.state.outcome==='normal'?'accepted':r.runModel.state.kind==='queued'?'queued':'pending',
  blocksInput:()=>['sent','running'].includes(r.runModel.state.kind)&&!r.runModel.supersededBy,
  dispatchConfirmed:()=>r.runModel.facts.some(f=>f.type==='transport-ack'),
  needsReview:()=>r.runModel.state.kind==='ended'&&r.runModel.state.outcome==='unconfirmed'
 };
 for(const [key,get] of Object.entries(getters))Object.defineProperty(r,key,{configurable:true,enumerable:true,get});
}
export function initializeRun(r,{actor='human',parentRunId=null,resultOf=null,recipientRunId=null}={}){
 const kind=r.phase==='report'?{phase:'report'}:r.origin==='result'?{phase:'result',resultOf,recipientRunId}:{phase:'work'};
 const result=newRun(r.id,r.humanRequestId||r.requestId,actor,parentRunId,kind,{allowAgentRoot:r.origin==='agent'});
 if(!result.ok)throw Error('run creation rejected: '+result.reason);
 return commit(r,result.value);
}
export function importRun(r,model){return commit(r,model);}
// Legacy in-memory fixtures/embedders use the same pure importer as persisted records.
export function modelOf(r){return r.runModel||migrateDirect({runs:[r]},{resumeInFlight:true}).runs[0];}
export function changeRun(r,event){
 const result=transitionRun(modelOf(r),event);
 if(!result.ok)throw Error('run transition rejected: '+r.id+' '+event.type+' '+result.reason);
 return commit(r,result.value);
}
export function observeRun(r,observation,snapshot){
 if(!observation.turnId)return;
 if(modelOf(r).state.kind==='sent'){
  const input=resolveInputPosition(snapshot.inputs,observation.inputId||r.inputId,observation.turnId);
  if(!input)throw Error('correlated native input missing');
  changeRun(r,{type:'input',actor:'program',at:Date.now(),sessionId:observation.sessionId,turnId:observation.turnId,inputId:input.id,text:input.text||'',competing:false,...(!r.inputMarker?{legacyHash:{expected:r.inputHash,observed:input.hash||inputHash(input.text||'')}}:{})});
 }
 if(['completed','failed','interrupted'].includes(observation.state))changeRun(r,{type:'terminal',actor:'program',at:Date.now(),sessionId:observation.sessionId,turnId:observation.turnId,outcome:observation.state==='completed'?'normal':observation.state,...(observation.errorCode?{errorCode:observation.errorCode}:{})});
}
export const tracking=r=>['sent','running'].includes(modelOf(r).state.kind)&&!modelOf(r).supersededBy;
export const unconfirmed=r=>r.runModel?.state.kind==='ended'&&r.runModel.state.outcome==='unconfirmed';

export function projectObservation(r,status){
 if(['sent','running'].includes(modelOf(r).state.kind))r.state=status;
}

export function initializeRetry(r,previous,{actor,at=Date.now(),leafRoot=false,boundaryConfirmed=false,agentIdle=false,legacyAgentRunId}){
 const result=retryRun(modelOf(previous),{type:'retry',actor,id:r.id,at,leafRoot,boundaryConfirmed,agentIdle},{legacyAgentRunId});
 if(!result.ok)throw Error('run retry rejected: '+result.reason);
 return commit(r,result.value);
}

export function initializeSupplement(r,previous){const result=supplementRun(modelOf(previous),r.id,'human');if(!result.ok)throw Error(result.reason);return commit(r,result.value.requestId===r.humanRequestId?result.value:{...result.value,requestId:r.humanRequestId,parentRunId:null,retryOf:null,phase:'work'});}
