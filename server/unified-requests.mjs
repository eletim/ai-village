import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {writeSnapshot} from './direct-store.mjs';
import {node,reconcileGraph,graphSteps,transitionGraph,latest,handled} from './state/requests.ts';
export const evidence=(data,q)=>data.runs.filter(r=>r.humanRequestId===q.id).map(r=>({run:r.runModel,ownerId:r.workId,agentId:r.agentId}));
export const rootNode=q=>node(q.requestGraph,q.rootWorkId);
export function newNode(q,w){return {id:w.id,parentId:w.parentWorkId||null,requester:w.parentWorkId?{kind:'agent',agentId:q.works.find(p=>p.id===w.parentWorkId).agentId,requestId:w.parentWorkId}:{kind:'human'},assignee:w.agentId,runAgents:Object.fromEntries(w.runIds.map(id=>[id,w.agentId])),runIds:[...w.runIds],currentRunId:w.currentRunId,reportRunId:null,reportMode:!w.parentWorkId&&q.reportMode===true,state:{kind:'active',review:[]},submissions:[],handling:[],declarations:[],decisions:[]};}
export function compatibilityModel(data,q){
 const n=rootNode(q);return {id:q.id,state:n.state,runs:evidence(data,q).map(e=>e.run),rootRunId:q.report?.sourceRunId||n.currentRunId,reportRunId:n.reportRunId,reportMode:n.reportMode,delegated:q.requestGraph.nodes.length>1,declarations:q.requestGraph.nodes.flatMap(n=>n.declarations),decisions:n.decisions};
}
export function attachGraph(data,q){
 if(!q.requestGraph){
  const old=q.requestModel;
  q.requestGraph={version:1,rootId:q.rootWorkId,nodes:q.works.map(w=>newNode(q,w)),operations:[]};
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
 delete q.requestModel;
 Object.defineProperty(q,'requestModel',{configurable:true,enumerable:false,get:()=>compatibilityModel(data,q)});
 return q;
}
export function applyGraph(data,q,event){
 const changed=transitionGraph(q.requestGraph,event,evidence(data,q));
 if(!changed.ok)throw Object.assign(Error('request transition rejected: '+event.type+' '+changed.reason),{status:409});
 q.requestGraph=changed.value;return q;
}
export const steps=(data,q)=>graphSteps(q.requestGraph,evidence(data,q));
export function validateGraph(data,q){
 const g=q.requestGraph;if(!g||g.version!==1||g.rootId!==q.rootWorkId||!Array.isArray(g.nodes)||g.nodes.length!==q.works.length||!Array.isArray(g.operations))throw Error('Invalid request graph version/shape: '+q.id);
 if(new Set(g.operations.map(o=>o.id)).size!==g.operations.length||g.operations.some(o=>typeof o.id!=='string'||typeof o.payload!=='string'))throw Error('Invalid operation registry');
 const ids=new Set();for(const n of g.nodes){
  const w=q.works.find(w=>w.id===n.id);if(ids.has(n.id)||!w||n.parentId!==(w.parentWorkId||null)||n.assignee!==w.agentId||n.currentRunId!==w.currentRunId||JSON.stringify(n.runIds)!==JSON.stringify(w.runIds)||!['active','submitted','completed','withdrawn'].includes(n.state?.kind)||!Array.isArray(n.submissions)||!Array.isArray(n.handling)||!Array.isArray(n.declarations)||!Array.isArray(n.decisions))throw Error('Invalid request node: '+n.id);ids.add(n.id);
  if(n.requester?.kind!==(n.parentId?'agent':'human')||n.parentId&&n.requester.requestId!==n.parentId||n.state.kind==='active'&&!Array.isArray(n.state.review)||!n.runAgents)throw Error('Invalid request authority/state');
  if(n.state.kind==='submitted'&&(!n.parentId||n.state.resultId!==latest(n)?.id||latest(n)?.outcome!=='normal'))throw Error('Invalid submitted result');
  if(n.replacementId){const replacement=node(g,n.replacementId);if(!replacement||replacement.parentId!==n.parentId)throw Error('Invalid replacement');const visited=new Set([n.id]);let next=n;while(next.replacementId){if(visited.has(next.replacementId))throw Error('Replacement cycle');visited.add(next.replacementId);next=node(g,next.replacementId);if(!next)throw Error('Missing replacement');}}
  const seen=new Set([n.id]);let p=n;while(p.parentId){if(seen.has(p.parentId)||!node(g,p.parentId))throw Error('Request parent cycle/missing');seen.add(p.parentId);p=node(g,p.parentId);}
  for(const id of n.runIds)if(!data.runs.some(r=>r.id===id&&r.workId===n.id&&r.humanRequestId===q.id&&r.agentId===n.runAgents[id]))throw Error('Invalid request run owner');
  for(const s of n.submissions)if(!['normal','failed','interrupted','unconfirmed','cancelled'].includes(s.outcome)||s.requestId!==n.id||s.id!==s.runId||!n.runIds.includes(s.runId)||!Number.isInteger(s.version)||s.version<1)throw Error('Invalid result version/owner');
  for(const [i,s] of n.submissions.entries()){const r=data.runs.find(r=>r.id===s.runId)?.runModel;if(s.version!==i+1||!r||!['ended','cancelled'].includes(r.state.kind)||s.outcome!==(r.state.kind==='ended'?r.state.outcome:'cancelled'))throw Error('Result lacks native terminal evidence');}
  if(new Set(n.submissions.map(s=>s.id)).size!==n.submissions.length||new Set(n.submissions.map(s=>s.version)).size!==n.submissions.length)throw Error('Duplicate result');
  for(const h of n.handling){const c=node(g,h.requestId),s=c?.submissions.find(s=>s.id===h.resultId&&s.version===h.version);if(c?.parentId!==n.id||!s||!n.runIds.includes(h.actorRunId)||!['agent','program','human'].includes(h.actor)||!['accept','rework'].includes(h.decision))throw Error('Invalid result handling');}
  for(const d of n.declarations)if(!n.runIds.includes(d.runId))throw Error('Invalid declaration owner');
 }
}
export function unifiedData(source){
 if(source.unifiedRequestVersion!==undefined&&source.unifiedRequestVersion!==1)throw Error('Unsupported unifiedRequestVersion');
 const data=structuredClone(source);
 for(const q of data.requests||[]){if(q.integrity)continue;if(source.unifiedRequestVersion===1&&!q.requestGraph)throw Error('Missing unified request graph');attachGraph(data,q);validateGraph(data,q);}
 data.unifiedRequestVersion=1;return data;
}
export async function migrateUnifiedStore(dir,source){
 const data=unifiedData(source);if(source.unifiedRequestVersion===1)return data;
 let bytes;try{bytes=await readFile(resolve(dir,'direct.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(bytes){const path=resolve(dir,'direct.pre-unified-requests-v1.json');let f;
  try{f=await open(path,'wx',0o600);await f.writeFile(bytes);await f.sync();}catch(e){if(e.code!=='EEXIST'||!bytes.equals(await readFile(path)))throw e;}finally{await f?.close();}
  const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}
 }
 await writeSnapshot(dir,JSON.stringify(data,null,2));return data;
}
export function graphResults(data,q){
 if(q.integrity)return [];
 return q.requestGraph.nodes.filter(n=>n.parentId).flatMap(n=>n.submissions.map(s=>{
  const parent=node(q.requestGraph,n.parentId),r=data.runs.find(r=>r.id===s.runId),delivery=data.runs.find(r=>r.humanRequestId===q.id&&r.runModel.phase==='result'&&r.runModel.resultOf===s.id);
  return {id:s.id,version:s.version,requestId:n.id,workId:n.id,parentWorkId:n.parentId,recipientAgentId:parent.assignee,resultRunId:s.runId,outcome:({normal:'completed',failed:'failed',interrupted:'interrupted',unconfirmed:'terminated',cancelled:'terminated'})[s.outcome],createdAt:r.completedAt||r.createdAt,deliveryRunId:delivery?.id,handled:handled(parent,s),handling:parent.handling.filter(h=>h.resultId===s.id),superseded:!!n.replacementId||latest(n)?.id!==s.id};
 }));
}
