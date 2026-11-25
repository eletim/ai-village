import {createHash} from 'node:crypto';
import {agentControls} from './agent-lifecycle.mjs';
import {applyGraph,validateGraph} from './unified-requests.mjs';
const fail=m=>{throw Object.assign(Error(m),{status:409});};
export function secretaryHandoverPlan(d,id,targetId){
 const a=d.agent(id),b=d.writableAgent(d.agent(targetId));d.writableProject(a.projectId);
 if(id===targetId||!a.projectId||a.projectId!==b.projectId||a.location!=='mayor'||b.location!=='mayor')fail('同Projectの異なる秘書を指定してください');
 if(d.data.projects.some(p=>p.leaderAgentId===id)||b.inputEnvelope?.mode!=='startup-v2'||b.runtimeUpgrade?.state==='prepared'||['terminated','stopping'].includes(agentControls(b).state))fail('引継ぎ先を利用できません');
 const conversations=d.data.conversations.filter(c=>c.agentId===id);
 const runs=d.data.runs.filter(r=>r.agentId===id);
 const works=d.data.requests.flatMap(q=>q.requestGraph.nodes.filter(w=>w.assignee===id&&['active','submitted'].includes(w.state.kind)).map(w=>({humanRequestId:q.id,workId:w.id,revision:q.revision,currentRunId:w.currentRunId})));
 const plan={sourceAgentId:id,targetAgentId:targetId,sourceRevision:a.metadataRevision||0,targetRevision:b.metadataRevision||0,conversations:conversations.map(c=>({id:c.id,sequence:c.sequence,deliveries:c.deliveries.map(e=>e.id)})),works,queued:runs.filter(r=>r.runModel.state.kind==='queued').map(r=>r.id),runs:runs.map(r=>({id:r.id,state:r.runModel.state,dispatch:r.dispatchAttemptedAt||null,sessionId:r.sessionId||null}))};
 return {...plan,planHash:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
// Administrative ownership transfer only: no retries, inferred success, or new work is enqueued.
export async function handoverSecretary(d,id,x){return d.locked('projects',()=>d.locked('request-graph',()=>d.persist(async()=>{
 if(!x||!/^[-\w]{8,100}$/.test(x.operationId)||typeof x.planHash!=='string'||typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>4000||Object.keys(x).some(k=>!['operationId','planHash','targetAgentId','actorRunId','reason'].includes(k)))fail('引継ぎ入力が不正です');
 const a=d.agent(id),payload=JSON.stringify(x);
 if(a.secretaryHandover){if(a.secretaryHandover.payload!==payload)fail('引継ぎ済みです');return structuredClone(a.secretaryHandover);}
 d.writableAgent(a);
 const plan=secretaryHandoverPlan(d,id,x.targetAgentId),actor=d.flow.run(x.actorRunId),project=d.data.projects.find(p=>p.id===a.projectId);
 if(!actor?.humanRequestId||actor.agentId!==project?.leaderAgentId||actor.runModel.state.kind!=='running')fail('同Projectの受付済みリーダー作業が必要です');
 const q=d.flow.root(actor.humanRequestId),w=d.flow.work(q,actor.workId);await d.flow.actor(q,w,actor.id);
 if(q.projectId!==a.projectId)fail('依頼Projectが一致しません');
 if(plan.planHash!==x.planHash)fail('引継ぎ対象が変わりました');
 if(agentControls(a).state!=='terminated'||a.processVerification?.remainingOwned!==0)fail('旧runtimeの正式停止とプロセス終了証拠が必要です');
 if(d.data.runs.some(r=>r.agentId===id&&['sent','running'].includes(r.runModel.state.kind)))fail('受付追跡中のrunは移せません');
 const queued=plan.queued.map(rid=>d.flow.run(rid));
 if(queued.some(r=>!r.conversationId||r.dispatchAttemptedAt||r.inputId||r.sessionId||r.runModel.facts.length||!plan.conversations.some(c=>c.id===r.conversationId)))fail('未送信を証明できる会話だけ移せます');
 for(const item of plan.works){
  const source=d.flow.root(item.humanRequestId),node=d.flow.work(source,item.workId),last=d.flow.run(node.currentRunId);
  if(source.projectId!==a.projectId||node.parentId||node.planned||source.requestGraph.nodes.length!==1||!last||last.runModel.state.kind!=='ended'||node.selfResume?.current?.status==='scheduled'||node.inbox?.some(i=>!i.handledBy&&i.attempts.length<2))fail('予約・未配送・子仕事がある旧仕事は個別整理が必要です');
 }
 const receipt={operationId:x.operationId,payload,sourceAgentId:id,targetAgentId:x.targetAgentId,actorRunId:actor.id,reason:x.reason,at:new Date().toISOString(),plan};
 for(const item of plan.conversations){
  const c=d.conversations.record(item.id);
  const historical=d.data.runs.filter(r=>r.conversationId===c.id&&!queued.includes(r)).map(r=>r.id);
  c.handoverHistory ||= [];c.handoverHistory.push({operationId:x.operationId,fromAgentId:id,toAgentId:x.targetAgentId,historicalRunIds:historical,at:receipt.at});c.agentId=x.targetAgentId;
 }
 for(const r of queued){r.handoverOrigin={agentId:id,operationId:x.operationId};r.agentId=x.targetAgentId;r.queuedReason='secretary-handover';r.error=null;}
 for(const item of plan.works){const source=d.flow.root(item.humanRequestId);applyGraph(d.data,source,{type:'handover',actor:'program',requestId:item.workId,agentId:x.targetAgentId,operationId:x.operationId});source.finalAgentId=x.targetAgentId;source.revision++;}
 a.secretaryHandover=receipt;a.metadataRevision=(a.metadataRevision||0)+1;
 d.conversations.validate();
 for(const q of d.data.requests.filter(q=>plan.conversations.some(c=>c.id===q.conversationId)))validateGraph(d.data,q);
 await d.save();return structuredClone(receipt);
})));}
