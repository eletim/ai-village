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
  // Same boundary as a Project change: a Project must never keep a leader that no longer exists.
  const led=d.data.projects.filter(p=>!p.deletedAt&&p.leaderAgentId===id);
  if(led.length)fail('Projectのリーダーに設定されています。先にリーダーを解除してから削除してください: '+led.map(p=>p.name||p.id).join(', '));
  if(d.data.requests.some(q=>q.requestGraph?.nodes.some(n=>n.assignee===id&&n.state.kind==='active'))||d.data.runs.some(r=>r.agentId===id&&['queued','sent','running'].includes(modelOf(r).state.kind)))fail('未完了の依頼があるAgentは削除できません');
  if(!['idle','terminated'].includes(agentControls(a).state))fail('待機または終了を確認したAgentだけ削除できます');
  a.deletion={...input,status:'running',startedAt:new Date().toISOString()};
  d.updateAvailability(a);await d.save();
 }));
 if(['deleted','registry-retired-unverified'].includes(a.deletion.status))return structuredClone(a.deletion);
 let error=null;
 try{await d.stop(id,{requireProcessEvidence:true});if(agentControls(a).state!=='terminated')throw Error(a.error||'終了未確認');}
 catch(e){if(e.persistenceFailure)throw e;error=e.message;}
 return d.persist(async()=>{
  a.deletion.status=error?'partial':'deleted';a.deletion.error=error;
  if(!error){a.deletedAt ||= new Date().toISOString();a.metadataRevision=(a.metadataRevision||0)+1;}
  await d.save();return structuredClone(a.deletion);
 });
});}

// Registry retirement is deliberately narrower than deletion: it never signals
// a process and never claims that an uncaptured process tree has stopped.
export async function retireUnverifiedAgent(d,id,input){return d.locked('projects',()=>d.locked('request-graph',()=>d.locked(id,async()=>{
 const a=d.agent(id),expected=`Agent ${id} の所有プロセス不在は未確認。孤児プロセスのリスクを受け入れ、登録上のみ退役する。`;
 if(!input||typeof input.operationId!=='string'||!/^[\w-]{8,100}$/.test(input.operationId)||!Number.isInteger(input.revision)||typeof input.deletionOperationId!=='string'||typeof input.workspaceId!=='string'||typeof input.tabId!=='string'||input.acknowledgement!==expected||Object.keys(input).some(k=>!['operationId','revision','deletionOperationId','workspaceId','tabId','acknowledgement'].includes(k)))fail('個体・元削除操作・リスク承認を正確に指定してください',400);
 const payload=JSON.stringify(input),previous=a.deletion?.registryRetirement;
 if(previous){if(previous.operationId!==input.operationId||previous.payload!==payload)fail('退役操作が更新されています');return structuredClone(previous);}
 if(a.deletedAt||a.location!=='mayor'||a.deletion?.status!=='partial'||a.deletion.operationId!==input.deletionOperationId||a.deletion.revision!==input.revision||(a.metadataRevision||0)!==input.revision||a.workspaceId!==input.workspaceId||a.tabId!==input.tabId||a.ownedProcesses||!a.deletion.error?.includes('tabがなく所有プロセスを照合できません'))fail('このAgentは登録上の限定退役対象ではありません');
 if(d.data.projects.some(p=>!p.deletedAt&&p.leaderAgentId===id)||d.conversations.pendingForAgent(id))fail('Projectのリーダーまたは未完了の会話があります');
 if(d.data.requests.some(q=>q.requestGraph?.nodes.some(n=>n.assignee===id&&n.state.kind==='active'))||d.data.runs.some(r=>r.agentId===id&&['queued','sent','running'].includes(modelOf(r).state.kind)))fail('未完了の依頼があります');
 if(d.data.requests.some(q=>q.integrity&&(q.originAgentId===id||q.finalAgentId===id||q.requestGraph?.nodes.some(n=>n.assignee===id)||q.works?.some(w=>w.agentId===id)||d.data.runs.some(r=>r.agentId===id&&r.humanRequestId===q.id))))fail('関連する隔離中の依頼記録があります');
 const absent=async()=>{const {tabs}=await d.pmux(a,'tab','list','-w',a.workspaceId);if(!Array.isArray(tabs)||tabs.some(t=>t.tabId===a.tabId||t.sessionName===a.sessionName))fail('旧tabの不在を確認できません');};
 await absent();
 return d.persist(async()=>{
  await absent();
  const at=new Date().toISOString(),record={operationId:input.operationId,payload,at,agentId:id,mode:'registry-only',processStatus:'unverified',tabAbsent:true,originalDeletion:structuredClone(a.deletion)};
  a.deletion.registryRetirement=record;a.deletion.status='registry-retired-unverified';a.deletedAt=at;a.metadataRevision=(a.metadataRevision||0)+1;
  await d.save();return structuredClone(record);
 });
})));}
