import {agentControls} from './agent-lifecycle.mjs';
import {modelOf} from './run-lifecycle.mjs';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export async function deleteAgent(d,id,input){return d.locked('projects',async()=>{
 if(!input||typeof input.operationId!=='string'||!/^[\w-]{8,100}$/.test(input.operationId)||!Number.isInteger(input.revision)||Object.keys(input).some(k=>!['operationId','revision'].includes(k)))fail('operationIdとrevisionが必要です',400);
 const a=d.agent(id);
 await d.locked(id,()=>d.persist(async()=>{
  if(a.deletion){
   if(a.deletion.operationId!==input.operationId||a.deletion.revision!==input.revision)fail('削除操作が更新されています');
   return;
  }
  if(d.agentDeleting(a))fail('削除処理中または削除済みです');
  if((a.metadataRevision||0)!==input.revision)fail('Agentが更新されています');
  if(d.conversations.pendingForAgent(id))fail('会話へ戻る未完了の仕事・配送があるAgentは削除できません');
  if(d.data.requests.some(q=>q.requestGraph?.nodes.some(n=>n.assignee===id&&n.state.kind==='active'))||d.data.runs.some(r=>r.agentId===id&&['queued','sent','running'].includes(modelOf(r).state.kind)))fail('未完了の依頼があるAgentは削除できません');
  if(!['idle','terminated'].includes(agentControls(a).state))fail('待機または終了を確認したAgentだけ削除できます');
  a.deletion={...input,status:'running',startedAt:new Date().toISOString()};
  d.updateAvailability(a);await d.save();
 }));
 if(a.deletion.status==='deleted')return structuredClone(a.deletion);
 let error=null;
 try{await d.stop(id,{requireProcessEvidence:true});if(agentControls(a).state!=='terminated')throw Error(a.error||'終了未確認');}
 catch(e){if(e.persistenceFailure)throw e;error=e.message;}
 return d.persist(async()=>{
  a.deletion.status=error?'partial':'deleted';a.deletion.error=error;
  if(!error){a.deletedAt ||= new Date().toISOString();a.metadataRevision=(a.metadataRevision||0)+1;}
  await d.save();return structuredClone(a.deletion);
 });
});}
