import { accept, reject, unreachable } from './common.ts';
import type { Actor, Command, Result } from './common.ts';
export type Outcome = 'normal' | 'failed' | 'interrupted' | 'unconfirmed';
export type RunState = { kind:'queued' } | { kind:'sent'; sessionId:string|null; sentAt:number }
 | { kind:'running'; sessionId:string; turnId:string; inputId:string }
 | { kind:'ended'; outcome:Outcome; reason:string; errorCode?:string }
 | { kind:'cancelled' };
export type Fact = Readonly<{ type:string; at:number; sessionId?:string; turnId?:string; inputId?:string; outcome?:Outcome; errorCode?:string }>;
export type Run = Readonly<{
 id:string; requestId:string; parentRunId:string|null; retryOf:string|null; phase:'work'|'report'|'result'; resultOf:string|null; recipientRunId:string|null;
 state:RunState; facts:readonly Fact[]; decisions:readonly {actor:Actor; reason:string}[];
 retryBudget:Readonly<{count:number; firstFailureAt:number|null}>;
}>;
export type RunEvent =
 | Command<'dispatch','program',{at:number; sessionId:string|null; agentIdle:boolean}>
 | Command<'input','program',{at:number; sessionId:string; turnId:string; inputId:string; text:string; competing:boolean}>
 | Command<'terminal','program',{at:number; sessionId:string; turnId:string; outcome:'normal'|'failed'|'interrupted'; errorCode?:string}>
 | Command<'lost','program',{at:number; reason:'session-changed'|'turn-ended-without-marker'|'timeout'}>
 | Command<'cancel','human'> | Command<'close-tracking','human',{reason:string}>;
export const runAuthorities = {dispatch:['program'],input:['program'],terminal:['program'],lost:['program'],cancel:['human'],'close-tracking':['human']} as const;
export type RunKind = {phase:'work'} | {phase:'report'} | {phase:'result'; resultOf:string; recipientRunId:string};
export const creationAuthorities = {work:['human','agent'],report:['program'],result:['program']} as const;
export function newRun(id:string, requestId:string, actor:Actor, parentRunId:string|null=null, kind:RunKind={phase:'work'}): Result<Run> {
 if (!id || !requestId) return reject('missing-id');
 if (!(creationAuthorities[kind.phase] as readonly string[]).includes(actor) || (actor==='agent'&&!parentRunId)) return reject('actor-forbidden');
 if(kind.phase==='result'&&(!kind.resultOf||!kind.recipientRunId))return reject('missing-result-reference');
 return accept({id,requestId,parentRunId,retryOf:null,phase:kind.phase,resultOf:kind.phase==='result'?kind.resultOf:null,recipientRunId:kind.phase==='result'?kind.recipientRunId:null,state:{kind:'queued'},facts:[],decisions:[],retryBudget:{count:0,firstFailureAt:null}});
}
export const isTerminal = (r:Run):boolean => r.state.kind==='ended'||r.state.kind==='cancelled';
export function transitionRun(r:Run,e:RunEvent):Result<Run> {
 if (!(runAuthorities[e.type] as readonly string[]).includes(e.actor)) return reject('actor-forbidden');
 if (isTerminal(r)) return reject('run-terminal');
 const record=(state:RunState):Result<Run>=>accept({...r,state,facts:[...r.facts,{type:e.type,at:'at' in e?e.at:0,...('sessionId' in e&&e.sessionId?{sessionId:e.sessionId}:{}),...('turnId' in e?{turnId:e.turnId}:{}),...('inputId' in e?{inputId:e.inputId}:{}),...('outcome' in e?{outcome:e.outcome}:{}),...('errorCode' in e?{errorCode:e.errorCode}:{})}]});
 switch(e.type) {
  case 'dispatch': return r.state.kind==='queued'&&e.agentIdle&&Number.isFinite(e.at)
   ? record({kind:'sent',sessionId:e.sessionId,sentAt:e.at}) : reject('dispatch-requires-idle-and-queued');
  case 'input': {
   if(r.state.kind!=='sent')return reject('input-requires-sent');
   if(e.competing||!e.sessionId||!e.turnId||!e.inputId||!e.text.split(/[^A-Za-z0-9-]+/).includes('ai-village-run-'+r.id))return reject('unmatched-or-competing-input');
   if(r.state.sessionId&&r.state.sessionId!==e.sessionId)return reject('session-mismatch');
   return record({kind:'running',sessionId:e.sessionId,turnId:e.turnId,inputId:e.inputId});
  }
  case 'terminal': {
   if(r.state.kind!=='running'||r.state.sessionId!==e.sessionId||r.state.turnId!==e.turnId)return reject('unowned-terminal');
   const value=record({kind:'ended',outcome:e.outcome,reason:'native-terminal',...(e.errorCode?{errorCode:e.errorCode}:{})});
   if(value.ok&&e.outcome==='failed')return accept({...value.value,retryBudget:{...r.retryBudget,firstFailureAt:r.retryBudget.firstFailureAt??e.at}});
   return value;
  }
  case 'lost': return r.state.kind==='sent'||r.state.kind==='running'
   ? record({kind:'ended',outcome:'unconfirmed',reason:e.reason}) : reject('not-dispatched');
  case 'cancel': return r.state.kind==='queued' ? accept({...r,state:{kind:'cancelled'},decisions:[...r.decisions,{actor:'human',reason:'cancel-before-send'}]}) : reject('already-dispatched');
  case 'close-tracking': return r.state.kind==='sent'||r.state.kind==='running'
   ? accept({...r,state:{kind:'ended',outcome:'unconfirmed',reason:'human-closed-tracking'},decisions:[...r.decisions,{actor:'human',reason:e.reason}]}) : reject('use-cancel-before-send');
  default:return unreachable(e);
 }
}
export type RetryEvent = Command<'retry','human',{id:string; at:number}>
 | Command<'retry','program',{id:string; at:number; boundaryConfirmed:boolean; agentIdle:boolean; leafRoot:boolean}>;
/** Returns a NEW run; the old outcome/facts are never overwritten. */
export function retryRun(r:Run,e:RetryEvent):Result<Run> {
 if(e.actor!=='human'&&e.actor!=='program')return reject('actor-forbidden');
 if(r.state.kind!=='ended'||r.state.outcome==='normal'||!e.id||e.id===r.id)return reject('not-retryable');
 if(e.actor==='program') {
  const first=r.retryBudget.firstFailureAt;
  if(r.state.outcome!=='failed'||r.state.errorCode!=='server_overloaded'||r.phase!=='work'||r.parentRunId!==null||!e.leafRoot||!e.boundaryConfirmed||!e.agentIdle)return reject('auto-retry-not-safe');
  if(first===null||!Number.isFinite(e.at)||e.at<first||e.at-first>=600000||r.retryBudget.count>=2)return reject('retry-budget-exhausted');
 }
 return accept({...r,id:e.id,retryOf:r.id,state:{kind:'queued'},facts:[],decisions:[{actor:e.actor,reason:'retry'}],retryBudget:e.actor==='program'?{...r.retryBudget,count:r.retryBudget.count+1}:{count:0,firstFailureAt:null}});
}
