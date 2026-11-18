import {accept,reject} from './common.ts';
import type {Actor,Result} from './common.ts';
import {isTerminal} from './run.ts';
import type {Run,Outcome} from './run.ts';
export type RequestState={kind:'active';review:string[]}|{kind:'submitted';resultId:string}|{kind:'completed';by:'program'|'human'|'agent';reason:string}|{kind:'withdrawn';reason:string};
export type Submission={id:string;version:number;runId:string;outcome:Outcome|'cancelled';requestId:string};
export type Response={requestId:string;resultId:string;version:number;decision:'accept'|'rework'};
export type Handling=Omit<Response,'decision'>&{decision:Response['decision']|'review';actorRunId:string;actor:Actor;operationId:string};
export type Claim=Handling&{invalidated?:string};
export type Replacement={replacementId:string;actorRunId:string;resultId:string;version:number};
export type Node={metadata:Record<string,unknown>;claims:Claim[];replacements:Replacement[];invalidatedRuns:string[];replacementId?:string;id:string;parentId:string|null;requester:{kind:'human'}|{kind:'agent';agentId:string;requestId:string};assignee:string;runAgents:Record<string,string>;runIds:string[];currentRunId:string;reportRunId:string|null;reportMode:boolean;state:RequestState;submissions:Submission[];handling:Handling[];declarations:{id:string;runId:string;at:number;invalidated?:string}[];decisions:{actor:Actor;reason:string}[]};
export type Graph={version:3;rootId:string;nodes:Node[];operations:{id:string;payload:string;acceptedPayload?:string;allowOmittedResults?:true}[]};
export type Evidence={run:Run;ownerId:string;agentId:string}[];
export const node=(g:Graph,id:string)=>g.nodes.find(n=>n.id===id);
const owned=(n:Node,runs:Evidence)=>runs.filter(e=>e.ownerId===n.id).map(e=>e.run);
const current=(n:Node,runs:Evidence)=>owned(n,runs).find(r=>r.id===n.currentRunId);
const normal=(r:Run|undefined)=>r?.state.kind==='ended'&&r.state.outcome==='normal';
const correlated=(r:Run|undefined)=>!!r?.facts.some(f=>f.type==='input')&&(r.state.kind==='running'||normal(r));
export const latest=(n:Node)=>n.submissions.find(s=>s.runId===(n.reportRunId||n.currentRunId));
export const handled=(parent:Node,s:Submission)=>parent.handling.some(h=>h.requestId===s.requestId&&h.resultId===s.id&&h.version===s.version);
export function dependencies(g:Graph,n:Node){return g.nodes.filter(c=>c.parentId===n.id);}
export function resolved(g:Graph,n:Node):boolean{return dependencies(g,n).every(c=>{if(c.replacementId)return true;const s=latest(c);return !!s&&([...n.handling].reverse().find(h=>h.resultId===s.id&&h.version===s.version)?.decision==='accept')&&['completed','withdrawn'].includes(c.state.kind);});}
export function ready(g:Graph,n:Node,runs:Evidence):boolean{
 const r=current(n,runs);
 return normal(r)&&(r?.phase==='report'||!dependencies(g,n).length||n.declarations.some(d=>d.runId===r?.id&&!d.invalidated))&&resolved(g,n);
}
/** Immutable structured facts only; no text, I/O, notification or clock. */
export function reconcileGraph(source:Graph,runs:Evidence):Graph{
 const g=structuredClone(source);
 // Declarations are audit facts. Only the declaring run's observed normal end can commit them.
 let committed=false;
 for(const n of g.nodes)for(const claim of n.claims){
  const r=owned(n,runs).find(r=>r.id===claim.actorRunId),c=node(g,claim.requestId),s=c&&latest(c);
  if(n.state.kind==='withdrawn'||claim.invalidated||n.invalidatedRuns.includes(claim.actorRunId)||!normal(r)||r?.supersededBy||!correlated(r)||!s||s.id!==claim.resultId||s.version!==claim.version)continue;
  if(n.handling.some(h=>h.operationId===claim.operationId&&h.resultId===claim.resultId))continue;
  if(!resolved(g,c!))continue;
  n.handling.push({requestId:claim.requestId,resultId:claim.resultId,version:claim.version,decision:claim.decision,actor:'agent',actorRunId:claim.actorRunId,operationId:claim.operationId});committed=true;
  if(claim.decision==='accept'&&(c!.state.kind==='submitted'||c!.state.kind==='active')){
   c!.state={kind:'completed',by:'agent',reason:'result-accepted:'+s.id};c!.decisions.push({actor:'agent',reason:'result-accepted:'+s.id});
  }
  if(claim.decision==='rework'){
   const reservation=[...c!.replacements].reverse().find(x=>x.resultId===s.id&&x.version===s.version);
   if(reservation&&!c!.replacementId){c!.replacementId=reservation.replacementId;if(c!.state.kind!=='completed'&&c!.state.kind!=='withdrawn')c!.state={kind:'withdrawn',reason:'replaced-by:'+reservation.replacementId};c!.decisions.push({actor:'agent',reason:'replaced-by:'+reservation.replacementId});}
  }
 }
 // Descendants settle first. Parent completion is never inferred from child completion alone.
 const depth=(n:Node):number=>n.parentId?1+depth(node(g,n.parentId)!):0;
 for(const n of [...g.nodes].sort((a,b)=>depth(b)-depth(a))){
  const r=current(n,runs);if(!r||r.supersededBy)continue;
  if(n.state.kind==='active'){
   const retryResolved=normal(r)&&r.phase==='work'&&r.retryOf&&n.declarations.some(d=>d.runId===r.id&&!d.invalidated);
   const review=n.state.review.filter(x=>!['needs-decision','dependencies-unresolved','child-needs-review'].includes(x)&&!(retryResolved&&x==='run-needs-review:'+r.retryOf));
   if(dependencies(g,n).some(c=>c.state.kind==='active'&&c.state.review.length))review.push('child-needs-review');
   if(r.state.kind==='cancelled'||r.state.kind==='ended'&&r.state.outcome!=='normal')review.push('run-needs-review:'+r.id);
   if(isTerminal(r)&&!normal(r)||normal(r)&&(!dependencies(g,n).length||ready(g,n,runs))){
    if(!n.submissions.some(s=>s.runId===r.id))n.submissions.push({id:r.id,runId:r.id,requestId:n.id,version:n.submissions.length+1,outcome:r.state.kind==='ended'?r.state.outcome:'cancelled'});
   }
   if(ready(g,n,runs)&&review.length===0&&(!n.reportMode||r.phase==='report'))n.state=n.parentId?{kind:'submitted',resultId:r.id}:{kind:'completed',by:'program',reason:r.phase==='report'?'normal-report':'normal-work'};
   else {
    if(isTerminal(r)&&normal(r)&&!ready(g,n,runs))review.push(dependencies(g,n).length?'dependencies-unresolved':'needs-decision');
    n.state={kind:'active',review:[...new Set(review)]};
   }
  }
 }
 // A completed response to a delivery is evidence of handling that exact result, not arbitrary siblings.
 let changed=committed;
 for(const n of g.nodes)for(const r of owned(n,runs))if(n.state.kind!=='withdrawn'&&r.phase==='result'&&normal(r)&&correlated(r)&&!r.supersededBy&&!n.invalidatedRuns.includes(r.id)){
  const child=dependencies(g,n).find(c=>c.submissions.some(s=>s.id===r.resultOf)),s=child?.submissions.find(s=>s.id===r.resultOf);
  if(s&&!handled(n,s)){
   n.handling.push({requestId:s.requestId,resultId:s.id,version:s.version,decision:s.outcome==='normal'?'accept':'review',actor:'program',actorRunId:r.id,operationId:'delivery:'+r.id});
   // Failed results require an explicit Agent/human decision, not mere normal receipt.
   if(child?.state.kind==='submitted'&&latest(child)?.id===s.id&&resolved(g,child))child.state={kind:'completed',by:'program',reason:'result-handled:'+r.id};
   changed=true;
  }
 }
 return changed?reconcileGraph(g,runs):g;
}
export type Event=
 | {type:'add';actor:Actor;request:Node}
 | {type:'attempt';actor:Actor;requestId:string;runId:string;report:boolean;resolveReview?:boolean}
 | {type:'respond'|'finish';actor:'agent';requestId:string;runId:string;operationId:string;results:Response[];at:number}
 | {type:'replace';actor:'agent';requestId:string;childId:string;replacementId:string}
 | {type:'assign';actor:'human';requestId:string;agentId:string}
 | {type:'review';actor:'program';requestId:string;reason:string}
 | {type:'withdraw'|'complete';actor:'human';requestId:string;reason:string}
 | {type:'observe';actor:'program'};
export function transitionGraph(source:Graph,e:Event,runs:Evidence):Result<Graph>{
 const authorities:Record<Event['type'],Actor[]>={add:['agent','human'],attempt:['agent','human','program'],respond:['agent'],finish:['agent'],review:['program'],withdraw:['human'],complete:['human'],observe:['program'],assign:['human'],replace:['agent']};
 if(!authorities[e.type]?.includes(e.actor))return reject('actor-forbidden');
 let g=structuredClone(source);
 if(e.type==='observe')return accept(reconcileGraph(g,runs));
 if(e.type==='add'){
  const n=e.request,p=n.parentId&&node(g,n.parentId);
  if(node(g,n.id)||!n.id||n.parentId&&!p||!n.parentId&&g.nodes.length)return reject('invalid-parent-or-id');
  if(p&&(e.actor!=='agent'||p.state.kind!=='active'||!correlated(current(p,runs))||current(p,runs)?.state.kind!=='running'))return reject('parent-not-running');
  g.nodes.push(n);return accept(g);
 }
 const n=node(g,e.requestId);if(!n)return reject('request-missing');
 if(e.type==='respond'||e.type==='finish'){
  const payload=JSON.stringify({type:e.type,requestId:e.requestId,runId:e.runId,results:e.results});
  const old=g.operations.find(o=>o.id===e.operationId);if(old)return old.payload===payload?accept(g):reject('operation-id-reused');
  const r=owned(n,runs).find(r=>r.id===e.runId);
  if(!r)return reject('run-membership-mismatch');
  if(e.type==='respond'||e.results.length){
   const reserved=current(n,runs);
   const reservation=normal(r)&&reserved?.phase==='result'&&reserved.state.kind==='queued'&&reserved.retryOf===r.id&&e.results.some(ref=>ref.resultId===reserved.resultOf);
   if(n.state.kind!=='active'||n.currentRunId!==r.id&&!reservation||!correlated(r))return reject('current-correlated-run-required');
   if(reservation)n.currentRunId=r.id;
   if(new Set(e.results.map(x=>x.requestId)).size!==e.results.length)return reject('duplicate-result');
   for(const ref of e.results){
    const c=node(g,ref.requestId),s=c&&latest(c);
    if(!c||c.parentId!==n.id||!s||s.id!==ref.resultId||s.version!==ref.version||!['accept','rework'].includes(ref.decision))return reject('stale-or-foreign-result');
    const existing=n.claims.find(h=>h.resultId===s.id&&h.actorRunId===r.id&&!h.invalidated&&h.decision!=='review');
    if(existing&&existing.decision!==ref.decision)return reject('result-decision-conflict');
    if(!existing)n.claims.push({...ref,actor:'agent',actorRunId:r.id,operationId:e.operationId});
    if(ref.decision==='accept'&&!resolved(g,c))return reject('child-dependencies-unresolved');
   }
  }
  if(n.currentRunId===r.id&&correlated(r))n.invalidatedRuns=n.invalidatedRuns.filter(id=>id!==r.id);
  if(e.type==='finish')n.declarations.push({id:e.operationId,runId:r.id,at:e.at,...(n.currentRunId!==r.id||r.supersededBy?{invalidated:'not-current-at-declaration'}:{})});
  g.operations.push({id:e.operationId,payload});return accept(reconcileGraph(g,runs));
 }
 if(n.state.kind!=='active'&&!(n.state.kind==='submitted'&&(e.type==='attempt'||e.type==='assign')))return reject('request-terminal');
 switch(e.type){
  case 'replace':{
   const c=node(g,e.childId),replacement=node(g,e.replacementId),s=c&&latest(c),r=current(n,runs);
   if(!c||!replacement||c.id===replacement.id||c.parentId!==n.id||replacement.parentId!==n.id||c.replacementId||!s||!r||r.state.kind!=='running'||!n.claims.some(h=>h.actorRunId===r.id&&!h.invalidated&&h.resultId===s.id&&h.version===s.version&&h.decision==='rework'))return reject('invalid-replacement');
   if(c.replacements.some(x=>x.actorRunId===r.id&&x.resultId===s.id))return reject('replacement-already-reserved');
   c.replacements.push({replacementId:replacement.id,actorRunId:r.id,resultId:s.id,version:s.version});return accept(g);
  }
  case 'assign':{if(!e.agentId||!current(n,runs)||!isTerminal(current(n,runs)!))return reject('assignment-requires-terminal-attempt');n.assignee=e.agentId;n.decisions.push({actor:'human',reason:'assigned:'+e.agentId});return accept(g);}
  case 'attempt':{
   const r=runs.find(x=>x.run.id===e.runId&&x.ownerId===n.id&&x.agentId===n.assignee)?.run;
   if(!r||r.createdBy!==e.actor||r.state.kind!=='queued'||n.runIds.includes(r.id)||e.report!==(r.phase==='report'))return reject('invalid-new-run');
   if(e.resolveReview&&(e.actor!=='human'||!r.retryOf))return reject('invalid-review-resolution');
   if(r.retryOf&&!n.runIds.includes(r.retryOf))return reject('foreign-predecessor');
   if(r.phase==='report'&&(!n.reportMode||n.parentId||!(n.reportRunId?r.retryOf===n.reportRunId:ready(g,n,runs)&&n.state.kind==='active'&&!n.state.review.length)))return reject('report-not-ready');
   if(r.phase==='result'){
    const child=dependencies(g,n).find(c=>latest(c)?.id===r.resultOf),s=child&&latest(child),previous=r.retryOf&&owned(n,runs).find(p=>p.id===r.retryOf);
    const retry=previous&&previous.phase==='result'&&previous.resultOf===r.resultOf&&previous.state.kind==='ended'&&previous.state.outcome!=='normal';
    if(!retry&&(!s||handled(n,s)||owned(n,runs).some(p=>p.id!==r.id&&p.phase==='result'&&p.resultOf===r.resultOf)||e.actor!=='program'))return reject('result-not-ready-or-already-delivered');
   }
   if(r.phase==='work'&&e.actor==='program'&&!r.retryOf)return reject('actor-forbidden');
   if(e.actor==='human')n.decisions.push({actor:'human',reason:'new-attempt:'+r.id});
   // An unfinished declaration cannot revive when a supplement is later cancelled.
   const previous=current(n,runs);
   if(previous&&!normal(previous)){
    n.invalidatedRuns.push(previous.id);
    for(const d of n.declarations.filter(d=>d.runId===previous.id))d.invalidated='superseded-by:'+r.id;
    for(const claim of n.claims.filter(c=>c.actorRunId===previous.id))claim.invalidated='superseded-by:'+r.id;
   }
   n.runAgents[r.id]=n.assignee;
   n.runIds.push(r.id);n.currentRunId=r.id;if(e.report)n.reportRunId=r.id;
   n.state={kind:'active',review:e.resolveReview?[]:n.state.kind==='active'?n.state.review.filter(x=>!['needs-decision','dependencies-unresolved','child-needs-review'].includes(x)):[]};
   return accept(reconcileGraph(g,runs));
  }
  case 'review':if(n.state.kind==='active')n.state.review=[...new Set([...n.state.review,e.reason])];return accept(g);
  case 'withdraw':{const r=current(n,runs);if(r&&isTerminal(r)&&!n.submissions.some(s=>s.runId===r.id))n.submissions.push({id:r.id,runId:r.id,requestId:n.id,version:n.submissions.length+1,outcome:r.state.kind==='ended'?r.state.outcome:'cancelled'});for(const c of g.nodes){let p=c;while(p.parentId&&p.parentId!==n.id)p=node(g,p.parentId)!;if(p.parentId===n.id&&(c.state.kind==='active'||c.state.kind==='submitted')){c.state={kind:'withdrawn',reason:e.reason};c.decisions.push({actor:'human',reason:e.reason});}}n.state={kind:'withdrawn',reason:e.reason};n.decisions.push({actor:'human',reason:e.reason});return accept(g);}
  case 'complete':{
   const descendants=(parent:Node):Node[]=>dependencies(g,parent).flatMap(c=>[...descendants(c),c]);
   const children=descendants(n);
   if(children.some(c=>!current(c,runs)||!isTerminal(current(c,runs)!)))return reject('dependencies-unresolved');
   for(const c of children){
    const r=current(c,runs)!;
    if(!latest(c))c.submissions.push({id:r.id,runId:r.id,requestId:c.id,version:c.submissions.length+1,outcome:r.state.kind==='ended'?r.state.outcome:'cancelled'});
    const s=latest(c)!,parent=node(g,c.parentId!)!;
    parent.handling.push({requestId:c.id,resultId:s.id,version:s.version,decision:'accept',actor:'human',actorRunId:parent.currentRunId,operationId:'human-complete:'+n.id});
    if(c.state.kind==='active'||c.state.kind==='submitted'){c.state={kind:'completed',by:'human',reason:e.reason};c.decisions.push({actor:'human',reason:e.reason});}
   }
   n.state={kind:'completed',by:'human',reason:e.reason};n.decisions.push({actor:'human',reason:e.reason});return accept(g);
  }
 }
}
export function graphSteps(g:Graph,runs:Evidence){
 const steps:({type:'deliver-result';childRunId:string;requestId:string}|{type:'prepare-report';requestId:string})[]=[];
 for(const n of g.nodes){
  if(n.state.kind!=='active')continue;
  for(const c of dependencies(g,n)){
   const s=latest(c);if(!c.replacementId&&s&&(c.state.kind==='submitted'||c.state.kind==='completed'||c.state.kind==='withdrawn'||s.outcome!=='normal')&&!handled(n,s)&&!runs.some(e=>e.run.phase==='result'&&e.run.resultOf===s.id))steps.push({type:'deliver-result',childRunId:s.runId,requestId:n.id});
  }
  if(n.reportMode&&!n.reportRunId&&ready(g,n,runs)&&!n.state.review.length)steps.push({type:'prepare-report',requestId:n.id});
 }
 return steps;
}
