import type { Agent } from './agent.ts';
import type { Run, RunState } from './run.ts';
import type { Request, Declaration } from './request.ts';
import { reconcile } from './request.ts';
type Row = Record<string, unknown>;
const row=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.map(row):[];
const str=(v:unknown):string=>typeof v==='string'?v:'';
export type Migration = Readonly<{
 version:1; agents:readonly Agent[]; runs:readonly Run[]; requests:readonly Request[];
 issues:readonly string[]; legacy:unknown;
}>;
/** Pure, conservative import. No production paths, filesystem, clock or mutation. */
export function migrateDirect(source:unknown):Migration {
 const data=row(source),issues:string[]=[];
 const unique=(values:Row[],kind:string):Row[]=>{
  const seen=new Set<string>();return values.filter(v=>{
   const id=str(v.id);if(!id||seen.has(id)){issues.push('missing-or-duplicate-'+kind+'-id:'+id);return false;}seen.add(id);return true;
  });
 };
 const oldAgents=unique(rows(data.agents),'agent'),oldRequests=unique(rows(data.requests),'request'),oldRuns=unique(rows(data.runs),'run');
 const agents:Agent[]=oldAgents.map(a=>({id:str(a.id),intent:null,observation:null}));
 // Saved agent flags are not a new observation; even "terminated" needs re-observation.
 const runs:Run[]=oldRuns.map(r=>{
  const request=oldRequests.find(q=>q.id===r.humanRequestId),works=rows(request?.works),work=works.find(w=>w.id===r.workId);
  const parent=works.find(w=>w.id===work?.parentWorkId);
  const parentRunId=parent?(Array.isArray(parent.runIds)?str(parent.runIds[0]):'')||str(parent.currentRunId)||null:null;
  let state:RunState;
  switch(str(r.state)){
   case 'queued': state=r.dispatchAttemptedAt||r.dispatchConfirmed===true?{kind:'ended',outcome:'unconfirmed',reason:'legacy-queued-after-dispatch'}:{kind:'queued'};break;
   case 'completed': state=r.acceptance==='accepted'&&r.completionEvent
    ?{kind:'ended',outcome:'normal',reason:'legacy-native-terminal'}:{kind:'ended',outcome:'unconfirmed',reason:'legacy-completion-unverified'};break;
   case 'failed': case 'interrupted': state={kind:'ended',outcome:r.state==='failed'?'failed':'interrupted',reason:'legacy-terminal',...(typeof r.errorCode==='string'?{errorCode:r.errorCode}:{})};break;
   case 'terminated': state=r.queueCancelledAt&&!r.dispatchAttemptedAt&&r.dispatchConfirmed!==true
    ?{kind:'cancelled'}:{kind:'ended',outcome:'unconfirmed',reason:'legacy-terminated'};break;
   case 'unknown': case 'send_unknown': case 'awaiting_input': case 'sending': case 'running': case 'waiting_input': case 'superseded':
    state={kind:'ended',outcome:'unconfirmed',reason:'legacy-'+str(r.state)};break;
   default: state={kind:'ended',outcome:'unconfirmed',reason:'legacy-unrecognized-state'};issues.push('unrecognized-run-state:'+str(r.id));
  }
  if(!request)issues.push('orphan-run:'+str(r.id));
  if(work?.parentWorkId&&!parentRunId)issues.push('missing-parent:'+str(r.id));
  const siblings=oldRuns.filter(other=>other.humanRequestId===r.humanRequestId&&other.workId===r.workId&&other.phase!=='report');
  const prior=r.phase==='report'||!work?null:siblings[siblings.indexOf(r)-1];
  return {id:str(r.id),requestId:str(r.humanRequestId),parentRunId,retryOf:prior?str(prior.id):null,phase:r.phase==='report'?'report':'work',state,facts:[],decisions:[],retryBudget:{count:0,firstFailureAt:null}};
 });
 for(const r of runs){
  if(r.parentRunId&&!runs.some(parent=>parent.id===r.parentRunId&&parent.requestId===r.requestId))issues.push('invalid-parent-run:'+r.id);
  const seen=new Set<string>([r.id]);let cursor=r;
  while(cursor.parentRunId){
   if(seen.has(cursor.parentRunId)){issues.push('parent-cycle:'+r.id);break;}
   seen.add(cursor.parentRunId);const parent=runs.find(p=>p.id===cursor.parentRunId);if(!parent)break;cursor=parent;
  }
 }
 const requests:Request[]=oldRequests.map(q=>{
  const works=rows(q.works),root=works.find(w=>w.id===q.rootWorkId)||works.find(w=>!w.parentWorkId),owned=runs.filter(r=>r.requestId===q.id);
  const report=row(q.report),currentId=str(root?.currentRunId),current=owned.find(r=>r.id===currentId);
  const claim=row(report.sourceFinish || root?.finish);
  const declarations:Declaration[]=str(claim.runId)&&owned.find(r=>r.id===claim.runId)?.phase!=='report'
   ?[{id:str(claim.operationId)||'legacy-root-finish',runId:str(claim.runId),actor:'agent',at:0}]:[];

  // Historical root attempts remain evidence. Only current work attempts drive migration review.
  const currentIds=new Set(works.map(w=>str(w.currentRunId)));
  const review=owned.filter(r=>(currentIds.size===0||currentIds.has(r.id))&&r.state.kind==='ended'&&r.state.outcome!=='normal').map(r=>'run-needs-review:'+r.id);
  if(!current)review.push('legacy-root-run-missing');
  if(!['active','finalizing','completed','cancelled'].includes(str(q.status)))review.push('legacy-request-state-unknown');
  const value:Request={id:str(q.id),rootRunId:str(report.sourceRunId)||currentId,reportRunId:current?.phase==='report'?current.id:null,reportMode:q.reportMode===true,delegated:works.some(w=>!!w.parentWorkId),runs:owned,declarations,decisions:[],
   state:q.status==='completed'?{kind:'completed',by:'program',reason:'legacy-completed-record'}:q.status==='cancelled'?{kind:'withdrawn',reason:'legacy-cancelled-record'}:{kind:'active',review}};
  // Do not silently complete active requests during import. Preserve old raw claims,
  // and surface discrepancies even when the import has no fresh runtime evidence.
  const checked=reconcile({...value,runs:owned.filter(r=>currentIds.has(r.id))});
  return value.state.kind==='active'&&checked.state.kind==='active'?{...value,state:checked.state}:value;
 });
 return {version:1,agents,runs,requests,issues,legacy:structuredClone(source)};
}
