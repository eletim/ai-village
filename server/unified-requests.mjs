import {node,graphSteps,transitionGraph,latest,handled} from './state/requests.ts';
export const evidence=(data,q)=>data.runs.filter(r=>r.humanRequestId===q.id).map(r=>({run:r.runModel,ownerId:r.workId,agentId:r.agentId}));
export const rootNode=q=>node(q.requestGraph,q.rootWorkId);
export function newNode(q,{id,parentId=null,assignee,metadata={},createdBy='human',planned=false}){return {...(q.commonRequests?{recipient:parentId?{kind:'request',requestId:parentId}:{kind:'human'},createdBy,planned}:{}),...(q.inputProtocol===1?{inbox:[],inputClaims:[]}:{}),id,parentId,requester:parentId?{kind:'agent',agentId:node(q.requestGraph,parentId).assignee,requestId:parentId}:{kind:'human'},assignee,metadata,runAgents:{},runIds:[],currentRunId:null,reportRunId:null,reportMode:!parentId&&q.reportMode===true,state:{kind:'active',review:[]},submissions:[],claims:[],replacements:[],invalidatedRuns:[],handling:[],declarations:[],decisions:[]};}
export function applyGraph(data,q,event){
 const changed=transitionGraph(q.requestGraph,event,evidence(data,q));
 if(!changed.ok)throw Object.assign(Error('request transition rejected: '+event.type+' '+changed.reason),{status:409});
 // Keep references to the single canonical nodes valid across a transaction.
 const prior=new Map(q.requestGraph.nodes.map(n=>[n.id,n]));
 for(const n of changed.value.nodes){const existing=prior.get(n.id);if(existing){for(const key of Object.keys(existing))delete existing[key];Object.assign(existing,n);}}
 q.requestGraph={...changed.value,nodes:changed.value.nodes.map(n=>prior.get(n.id)||n)};return q;
}
export const steps=(data,q)=>graphSteps(q.requestGraph,evidence(data,q));
export function validateGraph(data,q){
 if(q.commonRequests!==undefined&&typeof q.commonRequests!=='boolean')throw Error('Unsupported request contract');
 if(q.inputProtocol!==undefined&&![0,1].includes(q.inputProtocol))throw Error('Unsupported request input protocol');
 if(q.inputProtocol===1&&q.requestGraph?.nodes?.some(n=>!Array.isArray(n.inbox)))throw Error('Request inbox missing');
 const g=q.requestGraph;if(!g||g.version!==3||g.rootId!==q.rootWorkId||!Array.isArray(g.nodes)||Object.hasOwn(q,'works')||Object.hasOwn(q,'requestModel')||!Array.isArray(g.operations))throw Error('Invalid request graph version/shape: '+q.id);
 if(new Set(g.operations.map(o=>o.id)).size!==g.operations.length||g.operations.some(o=>typeof o.id!=='string'||typeof o.payload!=='string'))throw Error('Invalid operation registry');
 if(g.nodes.filter(n=>n.parentId===null).length!==1||!node(g,g.rootId)||node(g,g.rootId).parentId!==null)throw Error('Invalid request root');
 const ids=new Set();for(const n of g.nodes){
  if(q.commonRequests&&(!n.recipient||!['human','agent'].includes(n.createdBy)||typeof n.planned!=='boolean')||!q.commonRequests&&n.recipient)throw Error('Invalid common request contract');
  if(n.recipient&&(n.recipient.kind==='request'?n.recipient.requestId!==n.parentId:n.recipient.kind!=='human'||!!n.parentId))throw Error('Invalid result recipient');
  if(n.planned&&(n.runIds.length||n.currentRunId))throw Error('Planned request has execution');
  if(ids.has(n.id)||(!(n.planned&&n.assignee===null)&&typeof n.assignee!=='string')||!Array.isArray(n.runIds)||(!n.planned&&!n.runIds.includes(n.currentRunId))||new Set(n.runIds).size!==n.runIds.length||!n.metadata||typeof n.metadata!=='object'||Array.isArray(n.metadata)||['agentId','parentWorkId','runIds','currentRunId'].some(key=>Object.hasOwn(n.metadata,key))||!['active','submitted','completed','withdrawn'].includes(n.state?.kind)||!Array.isArray(n.submissions)||!Array.isArray(n.claims)||!Array.isArray(n.replacements)||!Array.isArray(n.invalidatedRuns)||!Array.isArray(n.handling)||!Array.isArray(n.declarations)||!Array.isArray(n.decisions))throw Error('Invalid request node: '+n.id);ids.add(n.id);
  if(!n.recipient&&n.requester?.kind!==(n.parentId?'agent':'human')||n.parentId&&n.requester.requestId!==n.parentId||n.state.kind==='active'&&!Array.isArray(n.state.review)||!n.runAgents)throw Error('Invalid request authority/state');
  if(n.state.kind==='submitted'&&(!n.recipient&&!n.parentId||n.state.resultId!==latest(n)?.id||latest(n)?.outcome!=='normal'))throw Error('Invalid submitted result');
  if(n.replacementId){const replacement=node(g,n.replacementId);if(!replacement||replacement.parentId!==n.parentId)throw Error('Invalid replacement');const visited=new Set([n.id]);let next=n;while(next.replacementId){if(visited.has(next.replacementId))throw Error('Replacement cycle');visited.add(next.replacementId);next=node(g,next.replacementId);if(!next)throw Error('Missing replacement');}}
  const seen=new Set([n.id]);let p=n;while(p.parentId){if(seen.has(p.parentId)||!node(g,p.parentId))throw Error('Request parent cycle/missing');seen.add(p.parentId);p=node(g,p.parentId);}
  for(const id of n.runIds)if(!data.runs.some(r=>r.id===id&&r.workId===n.id&&r.humanRequestId===q.id&&r.agentId===n.runAgents[id]))throw Error('Invalid request run owner');
  for(const s of n.submissions)if(!['normal','failed','interrupted','unconfirmed','cancelled'].includes(s.outcome)||s.requestId!==n.id||s.id!==s.runId||!n.runIds.includes(s.runId)||!Number.isInteger(s.version)||s.version<1)throw Error('Invalid result version/owner');
  for(const [i,s] of n.submissions.entries()){const r=data.runs.find(r=>r.id===s.runId)?.runModel;if(s.version!==i+1||!r||!['ended','cancelled'].includes(r.state.kind)||s.outcome!==(r.state.kind==='ended'?r.state.outcome:'cancelled'))throw Error('Result lacks native terminal evidence');}
  if(new Set(n.submissions.map(s=>s.id)).size!==n.submissions.length||new Set(n.submissions.map(s=>s.version)).size!==n.submissions.length)throw Error('Duplicate result');
  for(const h of n.handling){const c=node(g,h.requestId),s=c?.submissions.find(s=>s.id===h.resultId&&s.version===h.version);if(c?.parentId!==n.id||!s||!n.runIds.includes(h.actorRunId)||!['agent','program','human'].includes(h.actor)||!['accept','rework','review'].includes(h.decision))throw Error('Invalid result handling');}
  for(const h of [...n.claims,...n.handling]){
   const c=node(g,h.requestId),s=c?.submissions.find(s=>s.id===h.resultId&&s.version===h.version),r=data.runs.find(r=>r.id===h.actorRunId&&r.workId===n.id&&r.humanRequestId===q.id)?.runModel;
   if(!s||c.parentId!==n.id||!r)throw Error('Invalid response authority');
   if(n.handling.includes(h)&&h.actor!=='human'){
    if(r.state.kind!=='ended'||r.state.outcome!=='normal'||r.supersededBy||n.invalidatedRuns.includes(r.id)||!r.facts.some(f=>f.type==='input'))throw Error('Handling lacks normal native evidence');
    if(h.actor==='agent'&&!n.claims.some(c=>!c.invalidated&&c.actorRunId===h.actorRunId&&c.operationId===h.operationId&&c.resultId===h.resultId&&c.version===h.version&&c.decision===h.decision))throw Error('Handling lacks matching declaration');
    if(h.actor==='program'&&(r.phase!=='result'||r.resultOf!==h.resultId||h.operationId!=='delivery:'+r.id||h.decision!==(s.outcome==='normal'?'accept':'review')))throw Error('Handling lacks delivery evidence');
   }
   if(n.handling.includes(h)&&h.actor==='human'){const source=node(g,h.operationId?.startsWith('human-complete:')?h.operationId.slice('human-complete:'.length):'');if(source?.state.kind!=='completed'||source.state.by!=='human'||!source.decisions.some(d=>d.actor==='human')||h.decision!=='accept')throw Error('Human handling lacks closure decision');}
   if(n.claims.includes(h)){
    if(!r.facts.some(f=>f.type==='input'))throw Error('Claim lacks native input evidence');
    const op=g.operations.find(o=>o.id===h.operationId);let payload;try{payload=JSON.parse(op?.payload);}catch{}
    if(h.actor!=='agent'||!['accept','rework','review'].includes(h.decision)||!payload||payload.requestId!==n.id||payload.runId!==r.id||!['respond','finish'].includes(payload.type)||!payload.results?.some(ref=>ref.requestId===h.requestId&&ref.resultId===h.resultId&&ref.version===h.version&&ref.decision===h.decision))throw Error('Claim lacks operation evidence');
   }
  }
  for(const reservation of n.replacements){const parent=node(g,n.parentId),replacement=node(g,reservation.replacementId);if(!parent||replacement?.parentId!==n.parentId||!parent.claims.some(c=>c.actorRunId===reservation.actorRunId&&c.resultId===reservation.resultId&&c.version===reservation.version&&c.decision==='rework'))throw Error('Invalid replacement reservation');}
  if(n.replacementId&&!node(g,n.parentId)?.handling.some(h=>h.requestId===n.id&&h.decision==='rework'&&n.replacements.some(x=>x.replacementId===n.replacementId&&x.resultId===h.resultId&&x.version===h.version)))throw Error('Replacement lacks confirmed judgment');
  if(n.parentId&&n.state.kind==='completed'&&n.state.by==='agent'&&!node(g,n.parentId)?.handling.some(h=>h.requestId===n.id&&h.resultId===latest(n)?.id&&h.decision==='accept'&&h.actor==='agent'))throw Error('Child completion lacks confirmed handling');
  if(n.invalidatedRuns.some(id=>!n.runIds.includes(id)))throw Error('Invalid supersession owner');
  if(n.inbox){
   if(!Array.isArray(n.inbox)||!Array.isArray(n.inputClaims)||new Set(n.inbox.map(i=>i.id)).size!==n.inbox.length)throw Error('Invalid inbox');
   for(const i of n.inbox){if(typeof i.id!=='string'||typeof i.text!=='string'||!['request','supplement','result'].includes(i.kind)||!Array.isArray(i.attempts)||i.attempts.some(id=>!n.runIds.includes(id)))throw Error('Invalid inbox input');if(i.handledBy){const r=data.runs.find(r=>r.id===i.handledBy)?.runModel;if(!r||r.state.kind!=='ended'||r.state.outcome!=='normal'||!n.inputClaims.some(c=>c.runId===i.handledBy&&c.ids.includes(i.id)))throw Error('Input handling lacks evidence');}}
   for(const c of n.inputClaims){const op=g.operations.find(o=>o.id===c.operationId);let payload;try{payload=JSON.parse(op?.payload);}catch{}if(!n.runIds.includes(c.runId)||!Array.isArray(c.ids)||c.ids.some(id=>!n.inbox.some(i=>i.id===id&&i.attempts.includes(c.runId)))||payload?.runId!==c.runId||payload?.requestId!==n.id||!['respond','finish'].includes(payload?.type)||JSON.stringify(payload.inputs)!==JSON.stringify(c.ids))throw Error('Invalid input claim');}
  }
  for(const d of n.declarations)if(!n.runIds.includes(d.runId))throw Error('Invalid declaration owner');
 }
}
export function graphResults(data,q){
 if(q.integrity)return [];
 return q.requestGraph.nodes.filter(n=>n.parentId).flatMap(n=>n.submissions.map(s=>{
  const parent=node(q.requestGraph,n.parentId),r=data.runs.find(r=>r.id===s.runId),delivery=data.runs.find(r=>r.humanRequestId===q.id&&(r.runModel.phase==='result'&&r.runModel.resultOf===s.id||r.inboxBatch?.some(id=>parent.inbox?.some(i=>i.id===id&&i.result?.resultId===s.id))));
  return {id:s.id,version:s.version,requestId:n.id,workId:n.id,parentWorkId:n.parentId,recipientAgentId:parent.assignee,resultRunId:s.runId,outcome:({normal:'completed',failed:'failed',interrupted:'interrupted',unconfirmed:'terminated',cancelled:'terminated'})[s.outcome],createdAt:r.completedAt||r.createdAt,deliveryRunId:delivery?.id,handled:handled(parent,s),handling:parent.handling.filter(h=>h.resultId===s.id),claims:parent.claims.filter(h=>h.resultId===s.id),superseded:!!n.replacementId||latest(n)?.id!==s.id};
 }));
}
