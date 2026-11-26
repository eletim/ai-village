// Read-only projections of the already authorized, ordered Conversations.get view.
// This module never summarizes text or changes the saved/UI conversation history.
const fail=(message,status=403)=>{throw Object.assign(Error(message),{status});};
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value??null),'utf8');
const ref=(kind,id)=>({kind,id});
function boundary(view,actorRunId){
 const actor=view.runs?.find(r=>r.id===actorRunId);
 if(!actor||!Number.isSafeInteger(actor.conversationSequence)||view.sequence!==actor.conversationSequence||view.runs.some(r=>r.conversationSequence>actor.conversationSequence))fail('受付照合済みactorの配送境界内の会話が必要です');
 return actor;
}
function purposeGroups(view){
 const groups=new Map();
 for(const j of view.jobs||[]){const id=j.purpose?.id||j.id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(j);}
 return [...groups].map(([id,jobs])=>{
  const root=jobs.find(j=>j.id===id)||jobs[0],last=jobs.find(j=>j.id===jobs.at(-1).purpose?.currentRequestId)||jobs.at(-1);
  return {id,root,last,jobs};
 });
}
const lifecycle=s=>s?{code:s.code,label:s.label,reason:s.reason,question:s.questionText||s.leaderQuestionText}:null;
const decision=d=>d?{kind:d.kind,state:d.state,question:d.question,actorRunId:d.actorRunId}:null;
export function conversationContext(view,actorRunId){
 const actor=boundary(view,actorRunId),currentDeliveries=(view.deliveries||[]).filter(d=>d.runId===actor.id);
 const currentRequests=new Set(currentDeliveries.map(d=>d.humanRequestId));
 const groups=purposeGroups(view);
 return structuredClone({
  id:view.id,agentId:view.agentId,projectId:view.projectId,sequence:view.sequence,control:view.control,
  projection:'agent-context-v1',current:actor,currentDeliveries,relaySent:view.relaySent||[],relays:(view.relayInbox||[]).map(e=>({id:e.id,runId:e.recovery?.receipt.runId||e.runId,...(e.recovery?{previousRunId:e.runId}:{}),target:e.target,sourceConversationId:e.sourceConversationId,material:ref('relay',e.id)})),relayReturns:view.relayReturns||[],
  purposes:groups.map(({id,root,last,jobs})=>({id,currentRequestId:last.id,assigneeAgentId:last.assigneeAgentId||last.leaderAgentId,state:lifecycle(last.lifecycle),decision:decision(last.purpose?.decision),
   requestIds:jobs.map(j=>j.id),material:ref('purpose',id),
   ...(jobs.some(j=>currentRequests.has(j.id))?{objective:root.instruction,authorization:root.authorization}:{}),
   pendingDeliveries:jobs.some(j=>j.returnPending)})),
  // Every human turn is indexed: older constraints are never silently dropped.
  humanInputs:view.runs.filter(r=>r.conversationSource?.kind==='human').map(r=>({id:r.id,sequence:r.conversationSequence,bytes:bytes(r.instruction),attachments:r.attachments?.length||0,material:ref('turn',r.id)})),
  history:view.runs.filter(r=>r.id!==actor.id).map(r=>({id:r.id,sequence:r.conversationSequence,source:r.conversationSource?.kind,state:r.state,material:ref('turn',r.id)})),
  deliveries:(view.deliveries||[]).map(d=>({id:d.id,humanRequestId:d.humanRequestId,kind:d.kind,material:ref('delivery',d.id)})),
  omittedContent:{historyText:true,pastDeliveryMaterials:true,otherPurposeObjectives:true,semanticSummary:false,
   instruction:'索引は要約ではありません。過去の合意・制約は省略されています。目的を判断・変更する前に関係するturn/purpose/deliveryをreadで取得してください。対象が特定できない場合は全humanInputsを取得してください。取得不能を許可や制約なしとみなさないでください。',
   read:{conversationId:view.id,actorRunId,kind:'turn|purpose|delivery|relay',id:'索引のID'}}
 });
}
export function conversationMaterial(view,actorRunId,{kind,id}={}){
 boundary(view,actorRunId);
 if(typeof id!=='string'||!id)fail('取得する資料のIDが必要です',400);
 let value;
 if(kind==='relay')value=(view.relayInbox||[]).find(e=>e.id===id);
 else if(kind==='turn')value=view.runs.find(r=>r.id===id);
 else if(kind==='delivery')value=(view.deliveries||[]).find(d=>d.id===id);
 else if(kind==='purpose'){
  const group=purposeGroups(view).find(p=>p.id===id);
  if(group)value={id,objective:group.root.instruction,authorization:group.root.authorization,jobs:group.jobs,decisions:(view.purposeDecisions||[]).filter(d=>d.purposeId===id)};
 }else fail('kindはturn|purpose|delivery|relayです',400);
 if(!value)fail('今回の配送境界内に資料がありません',404);
 return structuredClone({conversationId:view.id,actorRunId,kind,id,content:value,complete:true});
}
