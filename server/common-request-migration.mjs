import {changeRun} from './run-lifecycle.mjs';
// One-time semantic conversion. Runtime transitions never select a legacy mode.
// Existing results, decisions and completed delivery records remain audit evidence.
export function migrateCommonRequests(data){
 if(data.commonRequestVersion===1)return data;
 for(const q of data.requests||[]){
  if(q.integrity)continue;
  for(const n of q.requestGraph.nodes){
   if(n.recipient)continue;
   n.recipient=n.parentId?{kind:'request',requestId:n.parentId}:{kind:'human'};
   n.createdBy=n.parentId?'agent':'human';n.planned=false;
   if(!n.parentId&&n.reportRunId){
    const report=data.runs.find(r=>r.id===n.reportRunId);
    const source=q.report?.sourceRunId||[...n.runIds].reverse().map(id=>data.runs.find(r=>r.id===id)).find(r=>r&&r.phase!=='report')?.id;
    if(!source)throw Error('Report source missing during common request migration: '+q.id);
    n.currentRunId=source;
    const run=data.runs.find(r=>r.id===source);
    if(run?.runModel?.state.kind==='ended'&&!n.submissions.some(s=>s.runId===source))n.submissions.push({id:source,runId:source,requestId:n.id,version:n.submissions.length+1,outcome:run.runModel.state.outcome});
    q.report ||= {sourceRunId:source,createdAt:report?.createdAt};
    if(n.state.kind==='active'&&run?.runModel?.state.outcome==='normal'){
     if(n.inbox?.some(i=>i.kind==='supplement'&&!i.handledBy)){if(report?.runModel?.state.kind==='queued')changeRun(report,{type:'cancel-report-reservation',actor:'program'});n.reportRunId=null;delete q.report;}
     else n.state={kind:'submitted',resultId:source};
    }
   }
  }
  q.commonRequests=true;
 }
 data.commonRequestVersion=1;return data;
}
