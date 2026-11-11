import { accept, reject, unreachable } from './common.ts';
import type { Actor, Command, Result } from './common.ts';
import { newRun, retryRun, transitionRun } from './run.ts';
import type { Run, RunEvent, RetryEvent } from './run.ts';
export type RequestState = {kind:'active'; review:readonly string[]}
 | {kind:'completed'; by:'program'|'human'; reason:string} | {kind:'withdrawn'; reason:string};
export type Declaration = Readonly<{id:string; runId:string; actor:'agent'; at:number}>;
export type Request = Readonly<{
 id:string; state:RequestState; runs:readonly Run[]; rootRunId:string; reportRunId:string|null;
 reportMode:boolean; delegated:boolean; declarations:readonly Declaration[];
 decisions:readonly {actor:'human'; reason:string}[];
}>;
export type RequestEvent =
 | Command<'delegate','agent',{parentRunId:string; id:string}>
 | Command<'declare-complete','agent',{id:string; runId:string; at:number}>
 | Command<'run-event','program',{runId:string; event:RunEvent}>
 | Command<'run-action','human',{runId:string; event:Extract<RunEvent,{actor:'human'}>}>
 | Command<'retry','human'|'program',{runId:string; retry:RetryEvent}>
 | Command<'prepare-report','program',{id:string}>
 | Command<'complete-as-human','human',{reason:string}>
 | Command<'withdraw','human',{reason:string}>;
export const requestAuthorities = {delegate:['agent'],'declare-complete':['agent'],'run-event':['program'],'run-action':['human'],retry:['human','program'],'prepare-report':['program'],'complete-as-human':['human'],withdraw:['human']} as const;
export function newRequest(id:string, runId:string, actor:Actor, reportMode=false):Result<Request> {
 if(actor!=='human')return reject('actor-forbidden');
 const run=newRun(runId,id,actor);if(!run.ok)return run;
 return accept({id,state:{kind:'active',review:[]},runs:[run.value],rootRunId:runId,reportRunId:null,reportMode,delegated:false,declarations:[],decisions:[]});
}
const normal=(r:Run|undefined)=>r?.state.kind==='ended'&&r.state.outcome==='normal';
function workReady(q:Request):boolean {
 const root=q.runs.find(r=>r.id===q.rootRunId);
 return normal(root)&&(!q.delegated||q.declarations.some(d=>d.runId===q.rootRunId));
}
/** Reconcile structured facts/claims only. Never inspect output text. */
export function reconcile(q:Request):Request {
 if(q.state.kind!=='active')return q;
 const superseded=new Set(q.runs.flatMap(r=>r.retryOf?[r.retryOf]:[]));
 const relevant=q.runs.filter(r=>!superseded.has(r.id));
 const review=[...q.state.review];
 for(const r of relevant)if(r.state.kind==='ended'&&r.state.outcome!=='normal')review.push('run-needs-review:'+r.id);
 for(const d of q.declarations){
  if(superseded.has(d.runId))continue;
  const r=q.runs.find(r=>r.id===d.runId);
  if(!r||r.parentRunId!==null||r.phase!=='work'||(r.state.kind==='ended'&&r.state.outcome!=='normal')||r.state.kind==='cancelled')review.push('declaration-conflict:'+d.id);
 }
 // A normal report needs no declaration. Failure marks are sticky until a human decision.
 if(q.delegated&&workReady(q)&&relevant.some(r=>r.parentRunId!==null&&r.state.kind!=='ended'))review.push('declaration-conflict:unfinished-child');
 const ready=q.reportMode?normal(q.runs.find(r=>r.id===q.reportRunId)):workReady(q);
 if(ready&&review.length===0)return {...q,state:{kind:'completed',by:'program',reason:q.reportMode?'normal-report':'normal-work'}};
 return {...q,state:{kind:'active',review:[...new Set(review)]}};
}
export function transitionRequest(q:Request,e:RequestEvent):Result<Request> {
 if(!(requestAuthorities[e.type] as readonly string[]).includes(e.actor))return reject('actor-forbidden');
 // Claims are ALWAYS recorded, even before correlation or after a human decision.
 if(e.type==='declare-complete'){
  return accept(reconcile({...q,declarations:[...q.declarations,{id:e.id,runId:e.runId,actor:'agent',at:e.at}]}));
 }
 if(q.state.kind!=='active'&&e.type!=='run-event'&&e.type!=='run-action')return reject('request-terminal');
 const replace=(run:Run)=>reconcile({...q,runs:q.runs.map(r=>r.id===run.id?run:r)});
 switch(e.type){
  case 'delegate': {
   if(q.reportRunId||q.runs.some(r=>r.id===e.id))return reject('report-or-duplicate-id');
   const parent=q.runs.find(r=>r.id===e.parentRunId);
   if(!parent||parent.phase!=='work'||parent.state.kind!=='running')return reject('parent-not-running');
   const child=newRun(e.id,q.id,'agent',parent.id);return child.ok?accept({...q,delegated:true,runs:[...q.runs,child.value]}):child;
  }
  case 'run-event': case 'run-action': {
   if(e.actor!==e.event.actor)return reject('actor-forbidden');
   const run=q.runs.find(r=>r.id===e.runId);if(!run)return reject('run-missing');
   const changed=transitionRun(run,e.event);return changed.ok?accept(replace(changed.value)):changed;
  }
  case 'retry': {
   if(q.state.kind!=='active')return reject('request-terminal');
   if(e.actor!==e.retry.actor||q.runs.some(r=>r.id===e.retry.id))return reject('actor-or-id-mismatch');
   const run=q.runs.find(r=>r.id===e.runId);if(!run)return reject('run-missing');
   if(q.runs.some(r=>r.retryOf===run.id))return reject('already-retried');
   if(e.actor==='program'&&q.delegated)return reject('auto-retry-delegated-request');
   const next=retryRun(run,e.retry);if(!next.ok)return next;
   return accept({...q,runs:[...q.runs,next.value],rootRunId:q.rootRunId===run.id?next.value.id:q.rootRunId,reportRunId:q.reportRunId===run.id?next.value.id:q.reportRunId,
    state:{kind:'active',review:e.actor==='human'?q.state.review.filter(x=>x!=='run-needs-review:'+run.id&&!q.declarations.some(d=>d.runId===run.id&&x==='declaration-conflict:'+d.id)):q.state.review.filter(x=>x!=='run-needs-review:'+run.id)}});
  }
  case 'prepare-report': {
   if(q.state.kind!=='active')return reject('request-terminal');
   if(!q.reportMode||q.reportRunId||!workReady(q)||q.state.review.length||q.runs.some(r=>r.id===e.id))return reject('report-not-ready');
   const run=newRun(e.id,q.id,'human');if(!run.ok)return run;
   return accept({...q,reportRunId:e.id,runs:[...q.runs,{...run.value,phase:'report'}]});
  }
  case 'complete-as-human': return accept({...q,state:{kind:'completed',by:'human',reason:e.reason},decisions:[...q.decisions,{actor:'human',reason:e.reason}]});
  case 'withdraw': return accept({...q,state:{kind:'withdrawn',reason:e.reason},decisions:[...q.decisions,{actor:'human',reason:e.reason}]});
  default:return unreachable(e);
 }
}
