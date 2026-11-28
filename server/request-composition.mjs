import {initialDeadlines} from './request-reports.mjs';
import {randomUUID} from 'node:crypto';
import {newNode,applyGraph} from './unified-requests.mjs';
import {workDTO} from './request-compatibility.mjs';
import {agentControls} from './agent-lifecycle.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:409});};
// Human and Agent adapters share this transaction. Actor comes from the route,
// never from a caller-supplied role. The parent remains the result recipient.
export async function compose(flow,x,action,actor){
 return flow.d.locked('request-graph',()=>flow.d.persist(async()=>{
  const q=flow.root(x.humanRequestId),creating=['plan','delegate'].includes(action);
  if(typeof x.operationId!=='string'||!/^[\w-]{8,100}$/.test(x.operationId))fail('operationIdを指定してください');
  const payload=JSON.stringify({type:action,actor,parentWorkId:x.parentWorkId||null,workId:x.workId||null,actorRunId:x.actorRunId||null,instruction:x.instruction||null,reportAt:x.reportAt||null,completionAt:x.completionAt||null,agentId:x.agentId||null,replacesRequestId:x.replacesRequestId||null});
  const old=q.requestGraph.operations.find(o=>o.id===x.operationId);
  if(old){if(old.payload!==payload)fail('operationIdの再利用です');return workDTO(flow.work(q,old.childId));}
  if(x.replacesRequestId)fail('旧置換予約は廃止しました。同じ仕事へのfollowupを使ってください');
  if(!q.inputProtocol)fail('旧形式の仕事は閲覧専用です。新しい子仕事は作成できません');
  flow.active(q);
  const w=creating?flow.work(q,x.parentWorkId):flow.work(q,x.workId),parent=creating?w:flow.work(q,w.parentId);
  if(actor==='agent'){if(!x.actorRunId)fail('actorRunIdが必要です');await flow.actor(q,parent,x.actorRunId);}
  else flow.version(q,x.revision);
  if(parent.state.kind!=='active'||q.report)fail('親依頼は作業受付中ではありません');
  if(!creating&&(!w.planned||w.state.kind!=='active'))fail('開始前の子依頼だけ操作できます');
  if(creating&&(typeof x.instruction!=='string'||!x.instruction.trim()||x.instruction.length>16000))fail('指示を1〜16000文字で指定してください');
  const assignee=x.agentId|| (creating?null:w.assignee);
  if(assignee&&action!=='discard'){
   const a=flow.d.writableAgent(flow.d.agent(assignee));
   if(actor==='agent'&&q.projectId&&a.projectId!==q.projectId)fail('同じProjectの担当だけ指定できます');
   if(!a.tabId||['terminated','stopping'].includes(agentControls(a).state))fail('宛先Agentを利用できません');
   for(let p=parent;p;p=p.parentId?flow.work(q,p.parentId):null)if(p.assignee===assignee)fail('祖先と同じAgentには委任できません');
  }
  let child=w;
  if(creating){
   if(action==='delegate'&&!assignee)fail('担当Agentを指定してください');
   const spec={parentId:parent.id,assignee,createdBy:actor,metadata:{reporting:initialDeadlines(x),instruction:x.instruction,operationId:x.operationId,actorRunId:x.actorRunId||null,createdAt:new Date().toISOString()}};
   if(action==='delegate'){
    child=flow.createWork(q,spec,x.instruction,'delegate:'+x.operationId,'delegation').work;
   }else{
    child=newNode(q,{...spec,id:randomUUID(),planned:true});
    applyGraph(flow.d.data,q,{type:'add',actor,request:child});child=flow.work(q,child.id);
   }
  }else if(action==='discard')applyGraph(flow.d.data,q,{type:'discard-plan',actor,requestId:w.id});
  else {
   if(!assignee)fail('担当Agentを選んでください');
   applyGraph(flow.d.data,q,{type:'plan-assign',actor,requestId:w.id,agentId:assignee});
   if(action==='launch')flow.enqueue(q,w,w.metadata.instruction,'launch:'+x.operationId,actor==='agent'?'delegation':'human');
  }
  if(actor==='human'){
   applyGraph(flow.d.data,q,{type:'supplement',actor:'human',requestId:parent.id,input:{id:randomUUID(),kind:'supplement',text:'人間が子依頼の構成を変更しました。'+JSON.stringify({action,childRequestId:child.id,instruction:child.metadata.instruction,assignee:flow.work(q,child.id).assignee})+'。既存の子依頼を確認し、二重に委任せず取りまとめてください。',createdAt:new Date().toISOString(),attempts:[]}});
  }
  q.requestGraph.operations.push({id:x.operationId,payload,childId:child.id});q.revision++;
  await flow.d.save();return workDTO(flow.work(q,child.id));
 }));
}
