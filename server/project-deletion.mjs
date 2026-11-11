import {agentControls} from './agent-lifecycle.mjs';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const now=()=>new Date().toISOString();
const key=members=>JSON.stringify(members.map(m=>({id:m.id,revision:m.revision})).sort((a,b)=>a.id.localeCompare(b.id)));
export function deletionPlan(d,id){
 const p=d.project(id),members=d.data.agents.filter(a=>a.projectId===id).map(a=>({id:a.id,revision:a.metadataRevision||0,name:a.name,state:agentControls(a).state}));
 return structuredClone({projectId:id,name:p.name,revision:p.deletion?.revision??p.revision,members:p.deletion?.members||members,deletion:p.deletion||null});
}
export async function deleteProject(d,id,input){return d.locked('projects',async()=>{
 const p=d.project(id);
 if(!input||typeof input!=='object'||Array.isArray(input))fail('削除操作のJSONが必要です',400);
 if(typeof input.operationId!=='string'||!/^[\w-]{8,100}$/.test(input.operationId)||!Number.isInteger(input.revision)||!Array.isArray(input.members)||input.members.some(m=>!m||typeof m.id!=='string'||!Number.isInteger(m.revision)))fail('operationId、revision、確認したmembersが必要です',400);
 const existing=p.deletion;
 if(existing){
  if(existing.operationId!==input.operationId||existing.revision!==input.revision||key(existing.members)!==key(input.members))fail('削除操作が更新されています。削除予定を再取得して確認してください');
  if(existing.status==='deleted')return structuredClone(existing);
 }else{
  const plan=deletionPlan(d,id);
  if(p.revision!==input.revision||key(plan.members)!==key(input.members))fail('Projectまたは所属が更新されています。削除予定を再取得して確認してください');
  await d.persist(async()=>{
  p.deletion={operationId:input.operationId,revision:input.revision,members:plan.members,status:'running',startedAt:now(),remaining:plan.members.map(m=>({id:m.id,name:m.name,error:'終了未確認'}))};
  for(const m of plan.members)d.updateAvailability(d.agent(m.id));
  // Durable intent before stopping anything. No rollback after a remote side effect.
  await d.save();
  });
 }
 await d.persist(async()=>{p.deletion.status='running';await d.save();});
 for(const member of p.deletion.members){
  const a=d.agent(member.id);let error=null;
  try{await d.stop(a.id,{requireProcessEvidence:true});if(agentControls(a).state!=='terminated')throw Error(a.error||'終了を確認できません');}
  catch(e){if(e.persistenceFailure)throw e;error=e.message||'接続・終了結果不明';}
  await d.persist(async()=>{
   p.deletion.remaining=p.deletion.remaining.filter(m=>m.id!==a.id);
   if(error)p.deletion.remaining.push({id:a.id,name:a.name,error});
   else{a.deletedAt ||= now();a.deletedByProject=id;}
   await d.save();
  });
 }
 return d.persist(async()=>{
 p.deletion.status=p.deletion.remaining.length?'partial':'deleted';p.deletion.updatedAt=now();
 if(p.deletion.status==='deleted'){p.deletedAt=now();p.revision++;}
 await d.save();
 return structuredClone(p.deletion);
 });
});}
