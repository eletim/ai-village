import {AsyncLocalStorage} from 'node:async_hooks';
import {checkpoint} from './persistence-boundary.mjs';
import {recordedNodes} from './request-integrity.mjs';
// Establish the ownership boundary at command entry, before any mutation.
export class RequestUnits {
 constructor(d){this.d=d;this.context=new AsyncLocalStorage();this.reset();}
 reset(){this.maps={requests:new Map(),runs:new Map(),agents:new Map()};this.lengths={requests:0,runs:0,agents:0};this.arrays={};this.runsByRequest=new Map();this.requestsByAgent=new Map();this.members=new Map();}
 indexRequest(q){
  for(const a of this.members.get(q.id)||[])this.requestsByAgent.get(a)?.delete(q.id);
  const members=new Set(recordedNodes(q).filter(n=>['active','submitted'].includes(n.state?.kind)).map(n=>n.assignee).filter(Boolean));
  this.members.set(q.id,members);
  for(const a of members){if(!this.requestsByAgent.has(a))this.requestsByAgent.set(a,new Set());this.requestsByAgent.get(a).add(q.id);}
 }
 sync(){
  const data=this.d.data;
  if(Object.keys(this.maps).some(k=>this.arrays[k]&&this.arrays[k]!==data[k]||(data[k]?.length||0)<this.lengths[k]))this.reset();
  for(const k of Object.keys(this.maps)){
   const rows=data[k]||[];this.arrays[k]=rows;
   for(const row of rows.slice(this.lengths[k])){
    this.maps[k].set(row.id,row);
    if(k==='requests')this.indexRequest(row);
    if(k==='runs'&&row.humanRequestId){if(!this.runsByRequest.has(row.humanRequestId))this.runsByRequest.set(row.humanRequestId,new Set());this.runsByRequest.get(row.humanRequestId).add(row);}
   }
   this.lengths[k]=rows.length;
  }
 }
 run(id,fn){return this.context.run({requestIds:new Set([id])},fn);}
 agent(id,fn){return this.context.run({agentIds:new Set([id])},fn);}
 selection(){
  const scope=this.context.getStore();if(!scope)return null;
  this.sync();const d=this.d.data,ids=new Set(scope.requestIds||[]),agents=new Set(scope.agentIds||[]);
  if(scope.agentIds)for(const a of agents)for(const id of this.requestsByAgent.get(a)||[])ids.add(id);
  // Include records created inside this command, before they enter an index.
  for(const q of (d.requests||[]).slice(scope.requestCount??d.requests.length))ids.add(q.id);
  const requests=[...ids].map(id=>this.maps.requests.get(id)).filter(Boolean);
  for(const q of requests)for(const n of recordedNodes(q))if(n.assignee)agents.add(n.assignee);
  const runs=[...ids].flatMap(id=>[...this.runsByRequest.get(id)||[]]);
  if(scope.agentIds)runs.push(...d.runs.filter(r=>scope.agentIds.has(r.agentId)&&!r.humanRequestId));
  const conversations=(d.conversations||[]).filter(c=>requests.some(q=>q.conversationId===c.id)||agents.has(c.agentId));
  runs.push(...d.runs.filter(r=>r.conversationId&&conversations.some(c=>c.id===r.conversationId)));
  return {requests,runs,conversations,agents:[...agents].map(id=>this.maps.agents.get(id)).filter(Boolean)};
 }
 checkpoint(){
  const scope=this.context.getStore();if(!scope)return null;
  scope.requestCount??=this.d.data.requests.length;
  const data=this.d.data,arrays={requests:data.requests.length,runs:data.runs.length,agents:data.agents.length,conversations:data.conversations?.length||0},restore=checkpoint(this.selection());
  return ()=>{restore();for(const [key,length] of Object.entries(arrays))if(data[key])data[key].length=length;this.reset();};
 }
 affected(changes){
  this.sync();const ids=new Set(),agents=new Set();
  for(const c of changes){if(c.kind==='requests'){ids.add(c.id);const q=this.maps.requests.get(c.id);if(q)this.indexRequest(q);}if(c.kind==='runs'&&c.body){const r=JSON.parse(c.body);if(r.humanRequestId)ids.add(r.humanRequestId);if(r.agentId)agents.add(r.agentId);}if(c.kind==='agents')agents.add(c.id);}
  for(const a of agents)for(const id of this.requestsByAgent.get(a)||[])ids.add(id);
  return [...ids];
 }
}
