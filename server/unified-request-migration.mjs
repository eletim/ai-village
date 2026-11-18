import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {writeSnapshot} from './direct-store.mjs';
import {node,reconcileGraph,graphSteps,refreshProgressReviews} from './state/requests.ts';
import {evidence,rootNode,validateGraph} from './unified-requests.mjs';
function oldNode(q,w){return {id:w.id,parentId:w.parentWorkId||null,requester:w.parentWorkId?{kind:'agent',agentId:q.works.find(p=>p.id===w.parentWorkId).agentId,requestId:w.parentWorkId}:{kind:'human'},assignee:w.agentId,runAgents:Object.fromEntries(w.runIds.map(id=>[id,w.agentId])),runIds:[...w.runIds],currentRunId:w.currentRunId,reportRunId:null,reportMode:!w.parentWorkId&&q.reportMode===true,state:{kind:'active',review:[]},submissions:[],claims:[],replacements:[],invalidatedRuns:[],handling:[],declarations:[],decisions:[]};}
function importGraph(data,q){
 if(!q.requestGraph){
  const old=q.requestModel;
  q.requestGraph={version:2,rootId:q.rootWorkId,nodes:q.works.map(w=>oldNode(q,w)),operations:[]};
  if(old)for(const w of q.works.filter(w=>w.operationId))q.requestGraph.operations.push({id:w.operationId,payload:JSON.stringify({type:'delegate',requestId:w.parentWorkId,runId:data.runs.find(r=>r.id===w.runIds[0])?.runModel.parentRunId,childId:w.id})});
  for(const n of q.requestGraph.nodes){
   n.declarations=(old?.declarations||[]).filter(d=>n.runIds.includes(d.runId));
   for(const d of n.declarations)q.requestGraph.operations.push({id:d.id,payload:JSON.stringify({type:'finish',requestId:n.id,runId:d.runId,results:[]})});
   if(old)for(const r of evidence(data,q).filter(e=>e.ownerId===n.id).map(e=>e.run))if(['ended','cancelled'].includes(r.state.kind))n.submissions.push({id:r.id,runId:r.id,requestId:n.id,version:n.submissions.length+1,outcome:r.state.kind==='ended'?r.state.outcome:'cancelled'});
   n.reportRunId=evidence(data,q).find(e=>e.ownerId===n.id&&e.run.id===n.currentRunId&&e.run.phase==='report')?.run.id||null;
   if(n.id===q.rootWorkId&&old){n.state=structuredClone(old.state);n.decisions=structuredClone(old.decisions);}
  }
  q.requestGraph=reconcileGraph(q.requestGraph,evidence(data,q));
  // Preserve existing terminal judgments and active roots: migration is not new completion evidence.
  if(old){const n=rootNode(q);n.state=structuredClone(old.state);if(n.state.kind==='active'&&!n.state.review.length&&evidence(data,q).every(e=>['ended','cancelled'].includes(e.run.state.kind))&&!graphSteps(q.requestGraph,evidence(data,q)).length)n.state.review.push('legacy-needs-decision');}
 }
 return q;
}
function upgradeGraph(data,q){
 if(!q.requestGraph||q.requestGraph.version===2)return;
 if(q.requestGraph.version!==1)throw Error('Unsupported request graph version');
 const g=q.requestGraph;g.version=2;
 for(const n of g.nodes){n.claims=[];n.replacements=[];n.invalidatedRuns=[];}
 let uncertain=false;
 for(const n of g.nodes){
  const retained=[];
  for(const h of n.handling){
   if(h.actor!=='agent'){retained.push(h);continue;}
   const r=data.runs.find(r=>r.id===h.actorRunId)?.runModel;
   n.claims.push({...h,legacy:false,...(r?.supersededBy?{invalidated:'migration-superseded'}:{})});
   if(r?.state.kind==='ended'&&r.state.outcome==='normal'&&!r.supersededBy)retained.push(h);
   else {uncertain=true;const child=node(g,h.requestId);if(child?.state.kind==='completed'&&child.state.by==='agent')child.state={kind:'active',review:['migration-unconfirmed-response']};}
  }
  n.handling=retained;
  if(n.replacementId){uncertain=true;delete n.replacementId;n.state={kind:'active',review:['migration-unconfirmed-replacement']};}
 }
 if(uncertain){const root=node(g,g.rootId);if(root.state.kind!=='withdrawn')root.state={kind:'active',review:['migration-unconfirmed-response']};}
}
// Historical receipt of a failed result did not authorize accepting its failure.
export function unifiedData(source){
 if(source.unifiedRequestVersion!==undefined&&![1,2,3].includes(source.unifiedRequestVersion))throw Error('Unsupported unifiedRequestVersion');
 const data=structuredClone(source);
 for(const q of data.requests||[]){
  if(q.integrity)continue;
  if(source.unifiedRequestVersion===3&&q.requestGraph?.version!==3)throw Error('Inconsistent request graph version');
  if(source.unifiedRequestVersion!==undefined&&!q.requestGraph)throw Error('Missing unified request graph');
  if(q.requestGraph?.version!==3){
   upgradeGraph(data,q);importGraph(data,q);
   const g=q.requestGraph;
   if(!Array.isArray(q.works)||g.nodes.length!==q.works.length||new Set(q.works.map(w=>w.id)).size!==q.works.length)throw Error('Invalid legacy ownership');
   for(const n of g.nodes){
    const w=q.works.find(w=>w.id===n.id);
    if(!w||w.agentId!==n.assignee||(w.parentWorkId||null)!==n.parentId||w.currentRunId!==n.currentRunId||JSON.stringify(w.runIds)!==JSON.stringify(n.runIds))throw Error('Conflicting legacy ownership');
    const {id,parentWorkId,agentId,runIds,currentRunId,...metadata}=w;
    n.metadata=metadata;
    for(const h of n.handling){const s=node(g,h.requestId)?.submissions.find(s=>s.id===h.resultId&&s.version===h.version);if(h.actor==='program'&&h.decision==='accept'&&s?.outcome!=='normal')h.decision='review';}
    for(const claim of n.claims){
     const child=node(g,claim.requestId),result=child?.submissions.find(s=>s.id===claim.resultId&&s.version===claim.version);
     if(claim.legacy&&claim.decision==='accept'&&(result?.outcome!=='normal'||child.state.kind==='active')){
      claim.decision='review';
      for(const h of n.handling)if(h.operationId===claim.operationId&&h.resultId===claim.resultId)h.decision='review';
      const op=g.operations.find(o=>o.id===claim.operationId);
      if(op){op.acceptedPayload ||= op.payload;const payload=JSON.parse(op.payload);for(const ref of payload.results||[])if(ref.resultId===claim.resultId)ref.decision='review';op.payload=JSON.stringify(payload);}
     }
     delete claim.legacy;
    }
   }
   for(const op of g.operations)if(['finish','respond'].includes(JSON.parse(op.payload).type))op.allowOmittedResults=true;
   g.version=3;delete q.works;delete q.requestModel;
  }
  validateGraph(data,q);
  refreshProgressReviews(q.requestGraph,evidence(data,q));
 }
 data.unifiedRequestVersion=3;return data;
}
export async function migrateUnifiedStore(dir,source){
 const data=unifiedData(source);if(source.unifiedRequestVersion===3)return data;
 let bytes;try{bytes=await readFile(resolve(dir,'direct.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(bytes){const path=resolve(dir,'direct.pre-unified-requests-v3.json');let f;
  try{f=await open(path,'wx',0o600);await f.writeFile(bytes);await f.sync();}catch(e){if(e.code!=='EEXIST'||!bytes.equals(await readFile(path)))throw e;}finally{await f?.close();}
  const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}
 }
 await writeSnapshot(dir,JSON.stringify(data,null,2));return data;
}
