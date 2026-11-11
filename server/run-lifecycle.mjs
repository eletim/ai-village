import {runView} from './state/projection.ts';
// Model transitions only. Display labels are generated separately, never saved.
import {transitionRun,newRun,retryRun,supplementRun} from './state/run.ts';
import {resolveInputPosition} from './runtime-events.mjs';

function commit(r,model){r.runModel=model;return r;}
export const runState=r=>runView(modelOf(r)).state;
export const accepted=r=>!!r?.runModel?.facts.some(f=>f.type==='input');
export function initializeRun(r,{actor='human',parentRunId=null,resultOf=null,recipientRunId=null}={}){
 const kind=r.phase==='report'?{phase:'report'}:r.origin==='result'?{phase:'result',resultOf,recipientRunId}:{phase:'work'};
 const result=newRun(r.id,r.humanRequestId||r.requestId,actor,parentRunId,kind,{allowAgentRoot:r.origin==='agent'});
 if(!result.ok)throw Error('run creation rejected: '+result.reason);
 return commit(r,result.value);
}
export function importRun(r,model){return commit(r,model);}
// Missing models are invalid; legacy data is handled only by the explicit migration.
export function modelOf(r){if(!r?.runModel)throw Error('Missing run model: '+r?.id);return r.runModel;}
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
  changeRun(r,{type:'input',actor:'program',at:Date.now(),sessionId:observation.sessionId,turnId:observation.turnId,inputId:input.id,text:input.text||'',competing:false});
 }
 if(['completed','failed','interrupted'].includes(observation.state))changeRun(r,{type:'terminal',actor:'program',at:Date.now(),sessionId:observation.sessionId,turnId:observation.turnId,outcome:observation.state==='completed'?'normal':observation.state,...(observation.errorCode?{errorCode:observation.errorCode}:{})});
}
export const tracking=r=>['sent','running'].includes(modelOf(r).state.kind)&&!modelOf(r).supersededBy;
export const unconfirmed=r=>r.runModel?.state.kind==='ended'&&r.runModel.state.outcome==='unconfirmed';

export function initializeRetry(r,previous,{actor,at=Date.now(),leafRoot=false,boundaryConfirmed=false,agentIdle=false,legacyAgentRunId}){
 const result=retryRun(modelOf(previous),{type:'retry',actor,id:r.id,at,leafRoot,boundaryConfirmed,agentIdle},{legacyAgentRunId});
 if(!result.ok)throw Error('run retry rejected: '+result.reason);
 return commit(r,result.value);
}

export function initializeSupplement(r,previous){const result=supplementRun(modelOf(previous),r.id,'human');if(!result.ok)throw Error(result.reason);return commit(r,result.value.requestId===r.humanRequestId?result.value:{...result.value,requestId:r.humanRequestId,parentRunId:null,retryOf:null,phase:'work'});}
