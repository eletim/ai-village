import type { Request } from './request.ts';
import type { Run } from './run.ts';
import { isTerminal } from './run.ts';
export type NextStep = {type:'prepare-report'} | {type:'deliver-result'; childRunId:string};
export const normal=(r:Run|undefined):boolean=>r?.state.kind==='ended'&&r.state.outcome==='normal';
export function workReady(q:Request):boolean {
 const root=q.runs.find(r=>r.id===q.rootRunId);
 return normal(root)&&(!q.delegated||q.declarations.some(d=>d.runId===q.rootRunId));
}
/** Deduplication is by source attempt, including failed/unknown/cancelled attempts. */
export function pendingResults(q:Request):Run[] {
 return q.runs.filter(r=>r.parentRunId!==null&&r.phase!=='report'&&isTerminal(r)&&!r.supersededBy&&!q.runs.some(n=>n.retryOf===r.id)&&!q.runs.some(d=>d.phase==='result'&&d.resultOf===r.id));
}
/** Resolve the recipient without advertising an action that would be rejected. */
export function resultRecipient(q:Request,child:Run):Run|null {
 const initial=q.runs.find(r=>r.id===child.parentRunId);
 if(!initial)return null;
 let parent:Run=initial;
 const visited=new Set<string>();
 while(true){
  if(visited.has(parent.id))return null;visited.add(parent.id);
  const parentId:string=parent.id;const successors:Run[]=q.runs.filter(r=>r.retryOf===parentId);
  if(successors.length>1)return null;
  if(!successors.length)return parent;
  parent=successors[0];
 }
}
export function nextSteps(q:Request):NextStep[] {
 if(q.state.kind!=='active')return [];
 const results=pendingResults(q).filter(r=>resultRecipient(q,r)!==null);
 const steps:NextStep[]=results.map(r=>({type:'deliver-result',childRunId:r.id}));
 if(q.reportMode&&!q.reportRunId&&workReady(q)&&!q.state.review.length&&!q.runs.some(r=>!isTerminal(r)&&!r.supersededBy)&&!pendingResults(q).length)steps.push({type:'prepare-report'});
 return steps;
}
export function checkProgress(q:Request):{ok:boolean; unfinishedRunIds:string[]; next:NextStep[]; review:readonly string[]} {
 const unfinishedRunIds=q.runs.filter(r=>!isTerminal(r)&&!r.supersededBy).map(r=>r.id),next=nextSteps(q),review=q.state.kind==='active'?q.state.review:[];
 return {ok:q.state.kind!=='active'||unfinishedRunIds.length>0||next.length>0||review.length>0,unfinishedRunIds,next,review};
}
export const stalledRequests=(requests:readonly Request[]):string[]=>requests.filter(q=>!checkProgress(q).ok).map(q=>q.id);
export function ensureProgress(q:Request,reason='needs-decision'):Request {
 return q.state.kind==='active'&&!checkProgress(q).ok?{...q,state:{kind:'active',review:[...q.state.review,reason]}}:q;
}
