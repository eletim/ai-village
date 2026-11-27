import {continuationBasis} from './run.ts';
import {closeSelfResume,consumeSelfResume} from './self-resume.ts';
import type {SelfResume} from './self-resume.ts';
import {accept,reject} from './common.ts';
import type {Actor,Result} from './common.ts';
import {isTerminal} from './run.ts';
import type {Run,Outcome} from './run.ts';
export type RequestState={kind:'active';review:string[]}|{kind:'submitted';resultId:string}|{kind:'completed';by:'program'|'human'|'agent';reason:string}|{kind:'withdrawn';reason:string};
export type Submission={observationRetraction?:string;id:string;version:number;runId:string;outcome:Outcome|'cancelled';requestId:string};
export type Response={requestId:string;resultId:string;version:number;decision:'accept'|'rework'};
export type Handling=Omit<Response,'decision'>&{decision:Response['decision']|'review';actorRunId:string;actor:Actor;operationId:string};
export type Claim=Handling&{invalidated?:string};
export type Replacement={replacementId:string;actorRunId:string;resultId:string;version:number};
export type InboxItem={source?:{actor:Actor;actorRunId?:string;operation?:string};id:string;kind:'request'|'supplement'|'result';text:string;createdAt:string;result?:Omit<Response,'decision'>&{outcome?:string;reason?:string|null};attempts:string[];handledBy?:string;retiredBy?:string};
export type InputClaim={runId:string;ids:string[];operationId:string};
export type Recipient={kind:'conversation';conversationId:string}|{kind:'human'}|{kind:'request';requestId:string};
export type Node={observationCorrections?:{operationId:string;runId:string;priorSubmission:Submission}[];conversationWait?:{reportId:string;runId:string;answerInputId?:string};selfResume?:SelfResume;recipient:Recipient;createdBy:Actor;planned:boolean;inbox?:InboxItem[];inputClaims?:InputClaim[];metadata:Record<string,unknown>;claims:Claim[];replacements:Replacement[];invalidatedRuns:string[];replacementId?:string;id:string;parentId:string|null;requester:{kind:'conversation';conversationId:string;agentId:string}|{kind:'human'}|{kind:'agent';agentId:string;requestId:string};assignee:string|null;runAgents:Record<string,string>;runIds:string[];currentRunId:string|null;reportRunId:string|null;reportMode:boolean;state:RequestState;submissions:Submission[];handling:Handling[];declarations:{id:string;runId:string;at:number;invalidated?:string}[];decisions:{actor:Actor;reason:string}[]};
export type Graph={version:3;rootId:string;nodes:Node[];operations:{id:string;payload:string;acceptedPayload?:string;allowOmittedResults?:true}[]};
export type Evidence={run:Run;ownerId:string;agentId:string}[];
export const node=(g:Graph,id:string)=>g.nodes.find(n=>n.id===id);
const owned=(n:Node,runs:Evidence)=>runs.filter(e=>e.ownerId===n.id).map(e=>e.run);
const current=(n:Node,runs:Evidence)=>owned(n,runs).find(r=>r.id===n.currentRunId);
const normal=(r:Run|undefined)=>r?.state.kind==='ended'&&r.state.outcome==='normal';
const correlated=(r:Run|undefined)=>!!r?.facts.some(f=>f.type==='input')&&(r.state.kind==='running'||normal(r));
export const latest=(n:Node)=>n.submissions.find(s=>s.runId===n.currentRunId&&!s.observationRetraction);
export const handled=(parent:Node,s:Submission)=>parent.handling.some(h=>h.requestId===s.requestId&&h.resultId===s.id&&h.version===s.version);
const inputBlocksAcceptance=(n:Node,s:Submission)=>n.inbox?.some(i=>!i.handledBy&&!i.retiredBy&&(s.outcome==='normal'||i.kind!=='request'));
export function dependencies(g:Graph,n:Node){return g.nodes.filter(c=>c.parentId===n.id);}
export function resolved(g:Graph,n:Node):boolean{return dependencies(g,n).every(c=>{if(c.replacementId||c.planned&&c.state.kind==='withdrawn')return true;const s=latest(c);return !!s&&([...n.handling].reverse().find(h=>h.resultId===s.id&&h.version===s.version)?.decision==='accept')&&['completed','withdrawn'].includes(c.state.kind);});}
export function waitingForConversation(n:Node,r:Run|undefined):boolean{
 const wait=n.conversationWait;
 return n.recipient?.kind==='conversation'&&!n.parentId&&!!wait&&!n.inbox?.some(i=>i.id===wait.answerInputId&&!!i.handledBy)&&!(normal(r)&&n.declarations.some(d=>d.runId===r?.id&&!d.invalidated));
}
export function ready(g:Graph,n:Node,runs:Evidence):boolean{
 const r=current(n,runs);
 return !waitingForConversation(n,r)&&n.selfResume?.current?.status!=='scheduled'&&!(n.inbox||[]).some(i=>!i.handledBy&&!i.retiredBy)&&normal(r)&&(r?.phase==='report'||!dependencies(g,n).length||n.declarations.some(d=>d.runId===r?.id&&!d.invalidated))&&resolved(g,n);
}
/** Derived continuation evidence, never a second persisted lifecycle. */
export function waitingReason(g:Graph,n:Node,runs:Evidence):string|null{
 if(n.state.kind!=='active')return null;
 if(n.planned)return n.assignee?'not-started':'unassigned';
 const r=current(n,runs);
 if(r&&!r.supersededBy&&!isTerminal(r))return r.phase==='result'?'result-processing':r.phase==='report'?'report-processing':r.state.kind==='queued'?'queued':r.state.kind==='sent'?'awaiting-input':'running';
 if(normal(r)&&n.selfResume?.current?.status==='scheduled')return 'self-resume';
 if(n.inbox?.some(i=>!i.handledBy&&!i.retiredBy&&i.attempts.length<2))return 'input-pending';
 if(normal(r)&&waitingForConversation(n,r))return 'conversation-answer';
 if(graphSteps(g,runs).some(step=>step.requestId===n.id&&step.type==='deliver-result'))return 'result-delivery';
 if(dependencies(g,n).some(c=>!c.replacementId&&c.planned&&c.state.kind==='active'))return 'children-planned';
 if(dependencies(g,n).some(c=>!c.replacementId&&c.state.kind==='active'&&waitingReason(g,c,runs)))return 'dependencies';
 return null;
}
// Reevaluate derived waiting/review labels without committing claims or rewriting history.
export function refreshProgressReviews(g:Graph,runs:Evidence):Graph{
 const visit=(n:Node)=>{
  for(const c of dependencies(g,n))visit(c);
  if(n.state.kind!=='active')return;
  const r=current(n,runs),review=n.state.review.filter(x=>!['dependencies-unresolved','progress-stalled','child-needs-review'].includes(x));
  if(dependencies(g,n).some(c=>!c.replacementId&&c.state.kind==='active'&&c.state.review.length))review.push('child-needs-review');
  if(normal(r)&&!ready(g,n,runs)&&!waitingReason(g,n,runs))review.push('progress-stalled');
  n.state={kind:'active',review:[...new Set(review)]};
 };
 visit(node(g,g.rootId)!);return g;
}
/** Immutable structured facts only; no text, I/O, notification or clock. */
export function reconcileGraph(source:Graph,runs:Evidence):Graph{
 const g=structuredClone(source);
 for(const n of g.nodes){
  if(['completed','withdrawn'].includes(n.state.kind))closeSelfResume(n,'request-ended');
 }
 // Declarations are audit facts. Only the declaring run's observed normal end can commit them.
 for(const n of g.nodes)for(const i of n.inbox||[]){if(!i.result||i.handledBy||i.retiredBy)continue;const c=node(g,i.result.requestId);if(c&&(c.replacementId||latest(c)?.id!==i.result.resultId))i.retiredBy=c.replacementId||c.currentRunId||undefined;}
 let committed=false;
 for(const n of g.nodes)for(const claim of n.inputClaims||[]){
  const r=owned(n,runs).find(r=>r.id===claim.runId);
  if(!normal(r)||!correlated(r)||r?.supersededBy||n.invalidatedRuns.includes(claim.runId))continue;
  for(const id of claim.ids){const item=n.inbox?.find(i=>i.id===id);if(item&&!item.handledBy&&!item.retiredBy){item.handledBy=claim.runId;committed=true;}}
 }
 for(const n of g.nodes){
  consumeSelfResume(n);
  const r=current(n,runs);
  if(normal(r)&&correlated(r)&&!r?.supersededBy&&!n.invalidatedRuns.includes(r!.id)&&n.declarations.some(d=>d.runId===r!.id&&!d.invalidated))closeSelfResume(n,'finish-confirmed',r!.id);
 }
 for(const n of g.nodes)for(const claim of n.claims){
  const r=owned(n,runs).find(r=>r.id===claim.actorRunId),c=node(g,claim.requestId),s=c&&latest(c);
  if(n.state.kind==='withdrawn'||claim.invalidated||n.invalidatedRuns.includes(claim.actorRunId)||!normal(r)||r?.supersededBy||!correlated(r)||!s||s.id!==claim.resultId||s.version!==claim.version)continue;
  if(n.handling.some(h=>h.operationId===claim.operationId&&h.resultId===claim.resultId))continue;
  if(!resolved(g,c!)||claim.decision==='accept'&&inputBlocksAcceptance(c!,s))continue;
  n.handling.push({requestId:claim.requestId,resultId:claim.resultId,version:claim.version,decision:claim.decision,actor:'agent',actorRunId:claim.actorRunId,operationId:claim.operationId});committed=true;
  if(claim.decision==='accept'&&(c!.state.kind==='submitted'||c!.state.kind==='active')){
   c!.state={kind:'completed',by:'agent',reason:'result-accepted:'+s.id};c!.decisions.push({actor:'agent',reason:'result-accepted:'+s.id});
  }
  if(claim.decision==='rework'){
   const reservation=[...c!.replacements].reverse().find(x=>x.resultId===s.id&&x.version===s.version);
   if(reservation&&!c!.replacementId){c!.replacementId=reservation.replacementId;if(c!.state.kind!=='completed'&&c!.state.kind!=='withdrawn')c!.state={kind:'withdrawn',reason:'replaced-by:'+reservation.replacementId};c!.decisions.push({actor:'agent',reason:'replaced-by:'+reservation.replacementId});}
  }
 }
 // A corrected native observation is independent of work acceptance. Even a
 // withdrawn root or an undeclared normal answer must retain the true endpoint
 // beside its immutable prior unknown, without completing/reopening the work.
 for(const n of g.nodes)for(const r of owned(n,runs)){
  const retracted=n.submissions.find(s=>s.runId===r.id&&s.observationRetraction);
  if(retracted&&r.state.kind==='ended'&&['terminal','lost'].includes(r.facts.at(-1)?.type||'')){delete retracted.observationRetraction;retracted.outcome=r.state.outcome;retracted.version=Math.max(...n.submissions.map(s=>s.version))+1;}
 }
 // Descendants settle first. Parent completion is never inferred from child completion alone.
 const depth=(n:Node):number=>n.parentId?1+depth(node(g,n.parentId)!):0;
 for(const n of [...g.nodes].sort((a,b)=>depth(b)-depth(a))){
  const r=current(n,runs);if(!r||r.supersededBy)continue;
  if(n.state.kind==='active'){
   const retryResolved=normal(r)&&r.phase==='work'&&r.retryOf&&n.declarations.some(d=>d.runId===r.id&&!d.invalidated);
   const review=n.state.review.filter(x=>!['needs-decision','dependencies-unresolved','progress-stalled','child-needs-review'].includes(x)&&!(retryResolved&&x==='run-needs-review:'+r.retryOf));
   if(dependencies(g,n).some(c=>!c.replacementId&&c.state.kind==='active'&&c.state.review.length))review.push('child-needs-review');
   if(r.state.kind==='cancelled'||r.state.kind==='ended'&&r.state.outcome!=='normal')review.push('run-needs-review:'+r.id);
   if(isTerminal(r)&&!normal(r)||normal(r)&&(!n.inbox&&!dependencies(g,n).length||ready(g,n,runs))){
    if(!n.submissions.some(s=>s.runId===r.id))n.submissions.push({id:r.id,runId:r.id,requestId:n.id,version:Math.max(0,...n.submissions.map(s=>s.version))+1,outcome:r.state.kind==='ended'?r.state.outcome:'cancelled'});
   }
   if(ready(g,n,runs)&&review.length===0)n.state={kind:'submitted',resultId:r.id};
   else {
    if(normal(r)&&!ready(g,n,runs)&&!waitingReason(g,n,runs))review.push('progress-stalled');
    n.state={kind:'active',review:[...new Set(review)]};
   }
  }
 }
 // A completed response to a delivery is evidence of handling that exact result, not arbitrary siblings.
 let changed=committed;
 for(const n of g.nodes)for(const r of owned(n,runs))if(!n.inbox&&n.state.kind!=='withdrawn'&&r.phase==='result'&&normal(r)&&correlated(r)&&!r.supersededBy&&!n.invalidatedRuns.includes(r.id)){
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
 | {type:'deliver-human'|'deliver-conversation';actor:'program';requestId:string;resultId:string}
 | {type:'plan-assign';actor:'human'|'agent';requestId:string;agentId:string}
 | {type:'discard-plan';actor:'human'|'agent';requestId:string}
 | {type:'attempt';actor:Actor;requestId:string;runId:string;report:boolean;resolveReview?:boolean;resolveContinuationRunId?:string}
 | {type:'respond'|'finish';actor:'agent';requestId:string;runId:string;operationId:string;results:Response[];inputs?:string[];at:number}
 | {type:'supplement';actor:Actor;requestId:string;input:InboxItem}
 | {type:'reconcile-observation';actor:'program';requestId:string;runId:string;operationId:string}
 | {type:'handover';actor:'program';requestId:string;agentId:string;operationId:string}
 | {type:'assign';actor:'human';requestId:string;agentId:string}
 | {type:'review';actor:'program';requestId:string;reason:string}
 | {type:'withdraw';actor:'human'|'agent';requestId:string;reason:string;conversationId?:string;parentWorkId?:string;actorRunId?:string}
 | {type:'complete';actor:'human';requestId:string;reason:string}
 | {type:'observe';actor:'program'};
export function transitionGraph(source:Graph,e:Event,runs:Evidence):Result<Graph>{
 const authorities:Record<Event['type'],Actor[]>={'reconcile-observation':['program'],add:['agent','human'],'deliver-conversation':['program'],'deliver-human':['program'],'plan-assign':['human','agent'],'discard-plan':['human','agent'],supplement:['human','agent','program'],attempt:['agent','human','program'],respond:['agent'],finish:['agent'],review:['program'],withdraw:['human','agent'],complete:['human'],observe:['program'],assign:['human'],handover:['program']};
 if(!authorities[e.type]?.includes(e.actor))return reject('actor-forbidden');
 let g=structuredClone(source);
 if(e.type==='observe')return accept(reconcileGraph(g,runs));
 if(e.type==='add'){
  const n=e.request,p=n.parentId&&node(g,n.parentId);
  if(node(g,n.id)||!n.id||n.parentId&&!p||!n.parentId&&g.nodes.length)return reject('invalid-parent-or-id');
  if(p&&(p.state.kind!=='active'||e.actor==='agent'&&(!correlated(current(p,runs))||current(p,runs)?.state.kind!=='running')))return reject('parent-not-running');
  g.nodes.push(n);return accept(g);
 }
 const n=node(g,e.requestId);if(!n)return reject('request-missing');
 if(e.type==='withdraw'){
  if(!['active','submitted'].includes(n.state.kind))return reject('request-terminal');
  if(e.actor==='agent'){
   const parent=n.parentId?node(g,n.parentId):undefined,r=parent?current(parent,runs):undefined;
   const ownsChild=parent&&r&&parent.id===e.parentWorkId&&parent.state.kind==='active'&&r?.id===e.actorRunId&&r.state.kind==='running'&&correlated(r)&&!r.supersededBy;
   const ownsRoot=!n.parentId&&n.recipient.kind==='conversation'&&n.recipient.conversationId===e.conversationId;
   if(!ownsChild&&!ownsRoot)return reject('request-authority-mismatch');
  }
  const ended=current(n,runs);if(ended&&isTerminal(ended)&&!n.submissions.some(s=>s.runId===ended.id))n.submissions.push({id:ended.id,runId:ended.id,requestId:n.id,version:Math.max(0,...n.submissions.map(s=>s.version))+1,outcome:ended.state.kind==='ended'?ended.state.outcome:'cancelled'});
  const targets=new Set([n.id]);for(let changed=true;changed;){changed=false;for(const item of g.nodes)if(item.parentId&&targets.has(item.parentId)&&!targets.has(item.id)){targets.add(item.id);changed=true;}}
  for(const item of g.nodes)if(targets.has(item.id)&&['active','submitted'].includes(item.state.kind)){item.state={kind:'withdrawn',reason:e.reason};item.decisions.push({actor:e.actor,reason:e.reason});closeSelfResume(item,'request-ended');}
  return accept(g);
 }
 if(e.type==='reconcile-observation'){
  const r=current(n,runs),s=n.submissions.find(s=>s.runId===e.runId);
  if(g.nodes.length!==1||n.parentId||n.state.kind!=='active'||n.state.review.some(x=>x!=='run-needs-review:'+e.runId)||!r||r.id!==e.runId||r.state.kind!=='running'||r.facts.at(-1)?.operationId!==e.operationId||r.facts.at(-1)?.type!=='reconcile-observation'||!s||s.outcome!=='unconfirmed'||s.observationRetraction||n.claims.length||n.handling.length||n.declarations.length)return reject('not-reconcilable-root');
  (n.observationCorrections||=[]).push({operationId:e.operationId,runId:r.id,priorSubmission:{...s}});s.observationRetraction=e.operationId;n.state={kind:'active',review:[]};return accept(g);
 }
 if(e.type==='deliver-human'||e.type==='deliver-conversation'){
  if(n.recipient?.kind!==(e.type==='deliver-human'?'human':'conversation')||n.state.kind!=='submitted'||latest(n)?.id!==e.resultId)return reject('result-not-ready');
  n.state={kind:'completed',by:'program',reason:'result-delivered:'+e.resultId};closeSelfResume(n,'request-ended');return accept(g);
 }
 if(e.type==='plan-assign'){if(!n.planned||n.state.kind!=='active')return reject('request-already-started');n.assignee=e.agentId;return accept(g);}
 if(e.type==='discard-plan'){if(!n.planned||n.state.kind!=='active')return reject('request-already-started');n.state={kind:'withdrawn',reason:'plan-discarded'};n.decisions.push({actor:e.actor,reason:'plan-discarded'});return accept(g);}
 if(e.type==='supplement'){
  if(!['active','submitted'].includes(n.state.kind)||e.input.kind!=='supplement'||n.inbox?.some(i=>i.id===e.input.id))return reject('invalid-supplement');
  if(!n.parentId)n.reportRunId=null;
  (n.inbox ||= []).push({...e.input,source:{...e.input.source,actor:e.actor}});n.inputClaims ||= [];
  n.state={kind:'active',review:n.state.kind==='active'?n.state.review:[]};
  return accept(reconcileGraph(g,runs));
 }
 if(e.type==='respond'||e.type==='finish'){
  const payload=JSON.stringify({type:e.type,requestId:e.requestId,runId:e.runId,results:e.results,...(e.inputs!==undefined?{inputs:e.inputs}:{})});
  const old=g.operations.find(o=>o.id===e.operationId);if(old)return old.payload===payload?accept(g):reject('operation-id-reused');
  const r=owned(n,runs).find(r=>r.id===e.runId);
  if(!r)return reject('run-membership-mismatch');
  if(n.inbox){
   if(!Array.isArray(e.inputs)||new Set(e.inputs).size!==e.inputs.length||n.currentRunId!==r.id||!correlated(r)||n.state.kind!=='active')return reject('explicit-current-inputs-required');
   for(const id of e.inputs){const item=n.inbox.find(i=>i.id===id);if(!item||item.handledBy||item.retiredBy||!item.attempts.includes(r.id))return reject('stale-or-foreign-input');if(item.result&&!e.results.some(ref=>ref.resultId===item.result!.resultId&&ref.version===item.result!.version&&ref.requestId===item.result!.requestId))return reject('result-decision-required');}
   (n.inputClaims ||= []).push({runId:r.id,ids:e.inputs,operationId:e.operationId});
  }
  if(e.type==='respond'||e.results.length){
   const reserved=current(n,runs);
   const reservation=normal(r)&&reserved?.phase==='result'&&reserved.state.kind==='queued'&&reserved.retryOf===r.id&&e.results.some(ref=>ref.resultId===reserved.resultOf);
   if(n.state.kind!=='active'||n.currentRunId!==r.id&&!reservation||!correlated(r))return reject('current-correlated-run-required');
   if(reservation)n.currentRunId=r.id;
   if(new Set(e.results.map(x=>x.requestId)).size!==e.results.length)return reject('duplicate-result');
   for(const ref of e.results){
    const c=node(g,ref.requestId),s=c&&latest(c);
    if(!c||c.parentId!==n.id||!s||s.id!==ref.resultId||s.version!==ref.version||ref.decision!=='accept')return reject('stale-or-foreign-result');
    const existing=n.claims.find(h=>h.resultId===s.id&&h.actorRunId===r.id&&!h.invalidated&&h.decision!=='review');
    if(existing&&existing.decision!==ref.decision)return reject('result-decision-conflict');
    if(!existing)n.claims.push({...ref,actor:'agent',actorRunId:r.id,operationId:e.operationId});
    if(ref.decision==='accept'&&(!resolved(g,c)||inputBlocksAcceptance(c,s)))return reject('child-dependencies-or-inputs-unresolved');
   }
  }
  if(n.currentRunId===r.id&&correlated(r))n.invalidatedRuns=n.invalidatedRuns.filter(id=>id!==r.id);
  if(e.type==='finish')n.declarations.push({id:e.operationId,runId:r.id,at:e.at,...(n.currentRunId!==r.id||r.supersededBy?{invalidated:'not-current-at-declaration'}:{})});
  g.operations.push({id:e.operationId,payload});return accept(reconcileGraph(g,runs));
 }
 if(n.state.kind!=='active'&&!(n.state.kind==='completed'&&n.state.by!=='human'&&e.type==='attempt'&&e.resolveContinuationRunId)&&!(n.state.kind==='submitted'&&(e.type==='attempt'||e.type==='assign'||e.type==='handover'||e.type==='complete')))return reject('request-terminal');
 switch(e.type){
  case 'handover':{if(!e.agentId||!current(n,runs)||!isTerminal(current(n,runs)!)||n.parentId||n.planned)return reject('handover-requires-terminal-root');n.assignee=e.agentId;n.decisions.push({actor:'program',reason:'handover:'+e.operationId+':'+e.agentId});return accept(g);}
  case 'assign':{if(!e.agentId||!current(n,runs)||!isTerminal(current(n,runs)!))return reject('assignment-requires-terminal-attempt');n.assignee=e.agentId;n.decisions.push({actor:'human',reason:'assigned:'+e.agentId});return accept(g);}
  case 'attempt':{
   const r=runs.find(x=>x.run.id===e.runId&&x.ownerId===n.id&&x.agentId===n.assignee)?.run;
   if(!n.assignee||!r||r.createdBy!==e.actor||r.state.kind!=='queued'||n.runIds.includes(r.id)||e.report!==(r.phase==='report'))return reject('invalid-new-run');
   if(e.report){
    if(n.state.kind!=='submitted'||n.recipient.kind!=='human')return reject('report-not-ready');
    n.runAgents[r.id]=n.assignee;n.runIds.push(r.id);n.reportRunId=r.id;return accept(g);
   }
   if(e.resolveContinuationRunId){const old=current(n,runs);if(!['human','agent'].includes(e.actor)||!old||old.id!==e.resolveContinuationRunId||r.retryOf!==old.id||!continuationBasis(old)||!r.decisions.some(d=>d.actor===e.actor&&d.reason==='purpose-continuation'))return reject('invalid-purpose-continuation');}
   if(e.resolveReview&&(e.actor!=='human'||!r.retryOf))return reject('invalid-review-resolution');
   if(r.retryOf&&!n.runIds.includes(r.retryOf))return reject('foreign-predecessor');
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
   n.planned=false;n.runAgents[r.id]=n.assignee;
   n.runIds.push(r.id);n.currentRunId=r.id;if(e.report)n.reportRunId=r.id;
   n.state={kind:'active',review:e.resolveReview?[]:n.state.kind==='active'?n.state.review.filter(x=>x!=='run-needs-review:'+e.resolveContinuationRunId&&!['needs-decision','dependencies-unresolved','progress-stalled','child-needs-review'].includes(x)):[]};
   return accept(reconcileGraph(g,runs));
  }
  case 'review':if(n.state.kind==='active')n.state.review=[...new Set([...n.state.review,e.reason])];return accept(g);
  case 'complete':{
   const descendants=(parent:Node):Node[]=>dependencies(g,parent).flatMap(c=>[...descendants(c),c]);
   const children=descendants(n).filter(c=>!(c.planned&&c.state.kind==='withdrawn'));
   if(children.some(c=>!current(c,runs)||!isTerminal(current(c,runs)!)))return reject('dependencies-unresolved');
   for(const c of children){
    const r=current(c,runs)!;
    if(!latest(c))c.submissions.push({id:r.id,runId:r.id,requestId:c.id,version:c.submissions.length+1,outcome:r.state.kind==='ended'?r.state.outcome:'cancelled'});
    const s=latest(c)!,parent=node(g,c.parentId!)!;
    parent.handling.push({requestId:c.id,resultId:s.id,version:s.version,decision:'accept',actor:'human',actorRunId:parent.currentRunId!,operationId:'human-complete:'+n.id});
    if(c.state.kind==='active'||c.state.kind==='submitted'){c.state={kind:'completed',by:'human',reason:e.reason};c.decisions.push({actor:'human',reason:e.reason});}
   }
   n.state={kind:'completed',by:'human',reason:e.reason};n.decisions.push({actor:'human',reason:e.reason});for(const item of g.nodes)if(['completed','withdrawn'].includes(item.state.kind))closeSelfResume(item,'request-ended');return accept(g);
  }
 }
}
export function graphSteps(g:Graph,runs:Evidence){
 const steps:({type:'deliver-result';childRunId:string;requestId:string}|{type:'prepare-report';requestId:string})[]=[];
 for(const n of g.nodes){
  if(n.state.kind!=='active')continue;
  for(const c of dependencies(g,n)){
   const s=latest(c);if(!n.inbox&&!c.replacementId&&s&&(c.state.kind==='submitted'||c.state.kind==='completed'||c.state.kind==='withdrawn'||s.outcome!=='normal')&&!handled(n,s)&&!runs.some(e=>e.run.phase==='result'&&e.run.resultOf===s.id))steps.push({type:'deliver-result',childRunId:s.runId,requestId:n.id});
  }
 }
 return steps;
}
