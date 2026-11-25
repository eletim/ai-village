import {createHash} from 'node:crypto';
import {correlate} from './runtime-events.mjs';
import {verifyInstructionsScript} from './input-envelope.mjs';
import {changeRun,accepted} from './run-lifecycle.mjs';
import {applyGraph,validateGraph} from './unified-requests.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:409});};
// Explicit self reconciliation of an already accepted turn, never a retry or
// inferred success. Remote evidence is read before the atomic model correction.
export async function reconcileObservation(flow,x){
 if(typeof x.operationId!=='string'||!/^[\w-]{8,100}$/.test(x.operationId)||!x.actorRunId||Object.keys(x).some(k=>!['humanRequestId','workId','actorRunId','operationId'].includes(k)))fail('明示した自runの照合引数が必要です');
 const d=flow.d;
 return d.locked('request-graph',async()=>{
  const q=flow.root(x.humanRequestId),w=flow.work(q,x.workId),r=flow.run(x.actorRunId);
  const payload=JSON.stringify(x),old=q.requestGraph.operations.find(o=>o.id===x.operationId);
  if(old){if(old.payload!==payload||!old.observationReconciliation)fail('operationIdの再利用です');return structuredClone(old.observationReconciliation);}
  function boundary(){
   if(!r||r.humanRequestId!==q.id||r.workId!==w.id||r.agentId!==w.assignee||w.runAgents[r.id]!==r.agentId||w.currentRunId!==r.id||q.requestGraph.nodes.length!==1||w.parentId||w.state.kind!=='active'||w.state.review.some(v=>v!=='run-needs-review:'+r.id)||w.claims.length||w.handling.length||w.declarations.length||w.invalidatedRuns.length||r.observationReconciliation||r.runModel.supersededBy||!accepted(r)||r.runModel.state.kind!=='ended'||r.runModel.state.outcome!=='unconfirmed'||r.runModel.state.reason!=='session-changed'||r.runModel.facts.at(-1)?.type!=='lost')fail('現在の自runの誤観測だけを照合できます');
   if(d.data.runs.some(other=>other.id!==r.id&&other.agentId===r.agentId&&['queued','sent','running'].includes(other.runModel?.state.kind)))fail('別の配送・実行があります');
   const s=w.submissions.find(s=>s.runId===r.id);if(!s||s.outcome!=='unconfirmed'||s.observationRetraction)fail('未採用の不明観測が必要です');
  }
  boundary();const a=d.agent(r.agentId),fixedHash=createHash('sha256').update(d.startupInstructions(a)).digest('hex');
  return d.locked(a.id,async()=>{
   const envelope=JSON.stringify(a.inputEnvelope),identity=JSON.stringify([a.workspaceId,a.tabId,a.sessionName,a.provider,a.connection]);
   if(a.provider!=='codex'||a.deletedAt||a.deletion||a.runtimeRetiredTo||a.runtimeUpgrade?.state==='prepared'||a.agentModel?.intent==='stop'||a.inputEnvelope?.hash!==fixedHash||a.inputEnvelope?.sessionId!==r.sessionId||!['startup-v2','migration-required'].includes(a.inputEnvelope?.mode)||a.inputEnvelope.mode==='migration-required'&&a.inputEnvelope.reason!=='native-session-changed')fail('同一正式契約のsession誤観測だけを復旧できます');
   const check=JSON.parse(await d.execute(a,['python3','-c',verifyInstructionsScript,a.workspaceId,a.provider,fixedHash]));if(check.verified!==true)fail('固定起動契約を確認できません');
   const status=await d.observationPmux(a,'tab','status','-w',a.workspaceId,a.tabId),snapshot=await d.runtime(a,status),observation=correlate(r,snapshot);
   if(!status.alive||status.cliState!=='busy'||status.agentSessionId!==r.sessionId||!snapshot.available||snapshot.incompleteTail||snapshot.more||snapshot.fileIdentity!==r.baselineRuntime?.fileIdentity||snapshot.sessionId!==r.sessionId||observation.state!=='running'||observation.turnId!==r.turnId||snapshot.turns.at(-1)?.id!==r.turnId||snapshot.inputs.some(i=>i.turnId!==r.turnId&&i.offset>r.baselineRuntime.cursor))fail('同session・input・turnの現在実行を証明できません');
   const input=snapshot.inputs.find(i=>i.id===r.inputId||(i.aliases||[]).some(p=>p.id===r.inputId));
   if(!input||input.hash!==r.inputCorrelation?.digest)fail('元入力の完全一致を証明できません');
   const proof={sessionId:r.sessionId,turnId:r.turnId,inputId:r.inputId,inputHash:input.hash,fileIdentity:snapshot.fileIdentity,cursor:snapshot.cursor,workspaceId:a.workspaceId,tabId:a.tabId,sessionName:a.sessionName,contractHash:fixedHash,observedAt:snapshot.observedAt||null,status:{agentSessionId:status.agentSessionId,workspaceId:status.workspaceId||a.workspaceId,tabId:status.tabId||a.tabId,cwd:status.cwd||null,pid:status.pid||null,sessionName:status.sessionName||a.sessionName,currentProcess:status.currentProcess||null,cliState:status.cliState,alive:status.alive}};
   return d.persist(async()=>{
    boundary();if(JSON.stringify(a.inputEnvelope)!==envelope||JSON.stringify([a.workspaceId,a.tabId,a.sessionName,a.provider,a.connection])!==identity)fail('照合中にruntime/契約が変わりました');
    const at=Date.now(),record={operationId:x.operationId,at,priorRunState:structuredClone(r.runModel.state),priorError:r.error||null,priorInputReleasedAt:r.inputReleasedAt||null,priorUnknownSince:r.unknownSince||null,priorEnvelope:structuredClone(a.inputEnvelope),proof};
    changeRun(r,{type:'reconcile-observation',actor:'program',operationId:x.operationId,at,sessionId:r.sessionId,turnId:r.turnId,inputId:r.inputId});r.observationReconciliation=record;
    applyGraph(d.data,q,{type:'reconcile-observation',actor:'program',requestId:w.id,runId:r.id,operationId:x.operationId});
    a.inputEnvelope={...a.inputEnvelope,mode:'startup-v2',reconciledBy:x.operationId};delete a.inputEnvelope.reason;delete a.inputEnvelope.downgradedAt;
    delete r.error;delete r.unknownSince;delete r.inputReleasedAt;
    const receipt={runId:r.id,workId:w.id,humanRequestId:q.id,operationId:x.operationId,state:'running',sent:false};
    q.requestGraph.operations.push({id:x.operationId,payload,observationReconciliation:receipt});q.revision++;
    validateGraph(d.data,q);await d.save();return receipt;
   });
  });
 });
}
