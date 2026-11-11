import { normal, workReady, pendingResults, nextSteps, ensureProgress, resultRecipient } from './progress.ts';
import { accept, reject, unreachable } from './common.ts';
import type { Actor, Command, Result } from './common.ts';
import { newRun, retryRun, transitionRun, isTerminal } from './run.ts';
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
 | Command<'deliver-result','program',{id:string; childRunId:string}>
 | Command<'complete-as-human','human',{reason:string}>
 | Command<'withdraw','human',{reason:string}>
 | Command<'review','program',{reason:string}>
 | Command<'restore-root','human',{id:string}>
 | Command<'observe-runs','program',{runs:readonly Run[]}>
 | Command<'append-run','human'|'agent'|'program',{run:Run; resolveReview?:boolean}>;
export const requestAuthorities = {delegate:['agent'],'declare-complete':['agent'],'run-event':['program'],'run-action':['human'],retry:['human','program'],'deliver-result':['program'],'prepare-report':['program'],'complete-as-human':['human'],withdraw:['human'],review:['program'],'restore-root':['human'],'observe-runs':['program'],'append-run':['human','agent','program']} as const;
export function newRequest(id:string, runId:string, actor:Actor, reportMode=false):Result<Request> {
 if(actor!=='human')return reject('actor-forbidden');
 const run=newRun(runId,id,actor);if(!run.ok)return run;
 return accept({id,state:{kind:'active',review:[]},runs:[run.value],rootRunId:runId,reportRunId:null,reportMode,delegated:false,declarations:[],decisions:[]});
}
/** Reconcile structured facts/claims only. Never inspect output text. */
export function reconcile(q:Request):Request {
 if(q.state.kind!=='active')return q;
 const superseded=new Set(q.runs.flatMap(r=>r.retryOf?[r.retryOf]:[]));
 const relevant=q.runs.filter(r=>!superseded.has(r.id)&&!r.supersededBy);
 const review=q.state.review.filter(reason=>reason!=='needs-decision'&&!([...superseded].some(id=>reason==='run-needs-review:'+id||q.declarations.some(d=>d.runId===id&&reason==='declaration-conflict:'+d.id))));
 for(const r of relevant)if(!q.decisions.some(d=>d.reason==='reviewed-run:'+r.id)&&r.state.kind==='ended'&&r.state.outcome!=='normal')review.push('run-needs-review:'+r.id);
 for(const d of q.declarations){
  if(superseded.has(d.runId))continue;
  const r=q.runs.find(r=>r.id===d.runId);
  if(!r||(r.state.kind==='ended'&&r.state.outcome!=='normal')||r.state.kind==='cancelled')review.push('declaration-conflict:'+d.id);
 }
 // A normal report needs no declaration. Failure marks are sticky until a human decision.
 if(q.delegated&&workReady(q)&&q.runs.some(r=>r.parentRunId!==null&&!isTerminal(r)&&!r.supersededBy))review.push('declaration-conflict:unfinished-child');
 const ready=q.reportMode?normal(q.runs.find(r=>r.id===q.reportRunId)):workReady(q);
 if(ready&&review.length===0&&!pendingResults(q).length&&!q.runs.some(r=>!isTerminal(r)&&!r.supersededBy))return {...q,state:{kind:'completed',by:'program',reason:q.reportMode?'normal-report':'normal-work'}};
 return ensureProgress({...q,state:{kind:'active',review:[...new Set(review)]}});
}
export function transitionRequest(q:Request,e:RequestEvent):Result<Request> {
 if(!(requestAuthorities[e.type] as readonly string[]).includes(e.actor))return reject('actor-forbidden');
 // Claims are ALWAYS recorded, even before correlation or after a human decision.
 if(e.type==='declare-complete'){
  return accept(reconcile({...q,declarations:[...q.declarations,{id:e.id,runId:e.runId,actor:'agent',at:e.at}]}));
 }
 if(q.state.kind!=='active'&&e.type!=='run-event'&&e.type!=='run-action'&&e.type!=='observe-runs')return reject('request-terminal');
 const replace=(run:Run)=>reconcile({...q,runs:q.runs.map(r=>r.id===run.id?run:r)});
 switch(e.type){
  case 'review': return q.state.kind==='active'?accept({...q,state:{kind:'active',review:[...new Set([...q.state.review,e.reason])]}}):reject('request-terminal');
  case 'restore-root': {
   const run=q.runs.find(r=>r.id===e.id);if(!run||run.parentRunId||run.phase==='report')return reject('invalid-root');
   return accept(reconcile({...q,rootRunId:e.id}));
  }
  case 'observe-runs': {
   if(e.runs.length!==q.runs.length||e.runs.some(r=>r.requestId!==q.id||!q.runs.some(old=>old.id===r.id)))return reject('run-membership-mismatch');
   return accept(reconcile({...q,runs:e.runs}));
  }
  case 'append-run': {
   const r=e.run;
   if(r.requestId!==q.id||q.runs.some(old=>old.id===r.id)||r.state.kind!=='queued'||r.createdBy!==e.actor)return reject('invalid-new-run');
   const previous=r.retryOf?q.runs.find(old=>old.id===r.retryOf):null;
   const retry=previous&&previous.phase===r.phase&&previous.state.kind==='ended'&&previous.state.outcome!=='normal';
   if(r.phase!=='work'&&e.actor!=='program'&&!(e.actor==='human'&&retry))return reject('actor-forbidden');
   if(e.actor==='program'&&r.phase==='work'&&!r.retryOf)return reject('actor-forbidden');
   if(r.phase==='report'&&!nextSteps(q).some(s=>s.type==='prepare-report')&&!r.retryOf)return reject('report-not-ready');
   if(r.phase==='result'&&!retry&&(!pendingResults(q).some(c=>c.id===r.resultOf)||!q.runs.some(p=>p.id===r.recipientRunId)))return reject('result-not-ready-or-already-delivered');
   const parent=r.parentRunId&&q.runs.find(p=>p.id===r.parentRunId);
   if(r.parentRunId&&!parent)return reject('parent-missing');
   if(e.actor==='agent'&&r.phase==='work'&&(!parent||parent.state.kind!=='running'))return reject('parent-not-running');
   const review=q.state.kind==='active'?q.state.review:[];
   const state:RequestState={kind:'active',review:e.actor==='human'&&e.resolveReview?[]:review.filter(x=>x!=='needs-decision')};
   return accept(reconcile({...q,state,decisions:e.actor==='human'&&e.resolveReview?[...q.decisions,...q.runs.filter(isTerminal).map(old=>({actor:'human' as const,reason:'reviewed-run:'+old.id}))]:q.decisions,delegated:q.delegated||!!r.parentRunId,
    rootRunId:r.parentRunId===null&&r.phase!=='report'?r.id:q.rootRunId,
    reportRunId:r.phase==='report'?r.id:q.reportRunId,runs:[...q.runs,r]}));
  }

  case 'delegate': {
   if(q.reportRunId||q.runs.some(r=>r.id===e.id))return reject('report-or-duplicate-id');
   const parent=q.runs.find(r=>r.id===e.parentRunId);
   if(!parent||parent.phase==='report'||parent.state.kind!=='running')return reject('parent-not-running');
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
  case 'deliver-result': {
   if(q.runs.some(r=>r.id===e.id))return reject('duplicate-run-id');
   const child=pendingResults(q).find(r=>r.id===e.childRunId);
   if(!child)return reject('result-not-ready-or-already-delivered');
   const parent=resultRecipient(q,child);
   if(!parent)return reject('parent-missing-or-ambiguous');
   const created=newRun(e.id,q.id,'program',parent.parentRunId,{phase:'result',resultOf:child.id,recipientRunId:parent.id});
   if(!created.ok)return created;
   const delivery={...created.value,retryOf:parent.id};
   return accept(reconcile({...q,rootRunId:q.rootRunId===parent.id?delivery.id:q.rootRunId,runs:[...q.runs,delivery]}));
  }
  case 'prepare-report': {
   if(q.state.kind!=='active')return reject('request-terminal');
   if(!nextSteps(q).some(step=>step.type==='prepare-report')||q.runs.some(r=>r.id===e.id))return reject('report-not-ready');
   const run=newRun(e.id,q.id,'program',null,{phase:'report'});if(!run.ok)return run;
   return accept({...q,reportRunId:e.id,runs:[...q.runs,run.value]});
  }
  case 'complete-as-human': return accept({...q,state:{kind:'completed',by:'human',reason:e.reason},decisions:[...q.decisions,{actor:'human',reason:e.reason}]});
  case 'withdraw': return accept({...q,state:{kind:'withdrawn',reason:e.reason},decisions:[...q.decisions,{actor:'human',reason:e.reason}]});
  default:return unreachable(e);
 }
}
