// Legacy observation only. No reservation or launch effects are exported.
import {createHash} from 'node:crypto';
import {matchesRunInput} from './input-envelope.mjs';
import {recoveryEvidence} from './secretary-relay-recovery.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const fail=m=>{throw Object.assign(Error(m),{status:409});};
async function oldProofIntact(service,a,r){
 const d=service.d,i=r.relayInitial;
 const c=d.conversations.record(r.conversationId),e=c.relayInbox.find(e=>e.id===r.conversationSource.relayId);
 const old=d.flow.run(r.relayRecoveryOf),oldAgent={...a,...(i.proofRuntime||i.oldRuntime)};
 const oldStatus=await d.pmux(oldAgent,'tab','status','-w',oldAgent.workspaceId,oldAgent.tabId),oldSnapshot=await d.runtime(oldAgent,oldStatus);
 const proof=recoveryEvidence(old,oldSnapshot,oldStatus,{nativeInputHash:e.recovery.proof.inputHash,nativeTurnId:e.recovery.proof.turnId});
 if(JSON.stringify(proof)!==JSON.stringify(e.recovery.proof))fail('保管runtimeの証拠が変化しました');
}
// Revalidate the exact uncertainty assessed by the source secretary. A new stage,
// receipt or identity is new evidence, not permission to continue automatically.
async function successorUnknownIntact(service,a,r){
 const d=service.d,c=d.conversations.record(r.conversationId),e=c.relayInbox.find(e=>e.recovery?.receipt.runId===r.id),prior=e?.recovery?.supersedes;
 if(!prior)return;
 const old=d.flow.run(prior.runId),l=old?.relayInitial?.launch,i=r.relayInitial;
 if(!l||old.relaySuperseded?.successorRunId!==r.id||l.operationId!==prior.operationId||l.runId!==old.id||typeof l.body!=='string'||digest(l.body)!==old.inputCorrelation?.digest||old.runModel?.state.kind!=='ended'||old.runModel.state.outcome!=='unconfirmed'||old.runModel.state.reason!=='timeout'||old.runModel.facts.some(f=>f.type==='input')||old.acceptedAt||old.relayInitial.receipt)fail('旧unknownの判断前提が変化しました。明示再判断が必要です');
 const runtime=i.oldRuntime;
 if(runtime.tabId!==l.tabId||runtime.workspaceId!==l.workspaceId||JSON.stringify(runtime.connection)!==JSON.stringify(old.relayInitial.oldRuntime.connection))fail('旧unknown runtimeが一致しません');
 const boundary=JSON.stringify([old,runtime,prior]);
 const observation=await d.pmux({...a,...runtime},'tab','initial-status',prior.operationId);
 if(boundary!==JSON.stringify([d.flow.run(prior.runId),r.relayInitial.oldRuntime,e.recovery.supersedes]))fail('旧unknownの照会中に保存境界が変化しました');
 if(observation.state!=='unknown'||observation.receipt||observation.processMatches||observation.operationId!==l.operationId||observation.runId!==old.id||observation.bodyHash!==old.inputCorrelation.digest||observation.workspaceId!==l.workspaceId||observation.tabId!==l.tabId||observation.contractHash!==l.contractHash||JSON.stringify(observation)!==JSON.stringify(prior.observation))fail('旧unknownの証拠/stageが変化しました。明示再判断が必要です');
 // The asynchronous read cannot authorize a newly arrived human input or revision.
 service.dispatchBoundary(r);
}
export async function bindInitialRelayRuntime(service,a,r){
 const d=service.d,i=r.relayInitial,l=i.launch;
 if(!i.attemptedAt)return false;
 service.dispatchBoundary(r);
 if(JSON.stringify(a.connection)!==JSON.stringify(i.oldRuntime.connection)||a.workshopId!==i.oldRuntime.workshopId||a.tabId!==l.tabId||a.workspaceId!==l.workspaceId)fail('予約runtimeが変化しました');
 const evidence=await d.pmux(a,'tab','initial-status',l.operationId);
 if(evidence.state!=='started'||!evidence.processMatches||!evidence.receipt)return false;
 for(const k of ['operationId','workspaceId','tabId','runId','contractHash'])if(evidence[k]!==l[k])fail('初回receiptが一致しません');
 if(evidence.bodyHash!==r.inputCorrelation.digest||evidence.receipt.tabId!==a.tabId||evidence.receipt.workspaceId!==a.workspaceId||!evidence.receipt.sessionName)fail('初回本文/receiptが一致しません');
 if(i.receipt&&JSON.stringify(i.receipt)!==JSON.stringify(evidence.receipt))fail('初回processが変化しました');
 await d.persist(async()=>{
  await successorUnknownIntact(service,a,r);
  service.dispatchBoundary(r);
  if(a.sessionName&&a.sessionName!==evidence.receipt.sessionName)fail('初回paneが変化しました');
  a.sessionName=evidence.receipt.sessionName;i.receipt=structuredClone(evidence.receipt);await d.save();
 });
 return true;
}
export async function initialRelayObservation(service,a,r,snapshot,status){
 const d=service.d,i=r.relayInitial,l=i.launch;
 if(!i.attemptedAt)return false;
 service.dispatchBoundary(r);
 if(JSON.stringify(a.connection)!==JSON.stringify(i.oldRuntime.connection)||a.workshopId!==i.oldRuntime.workshopId||a.tabId!==l.tabId||a.workspaceId!==l.workspaceId)fail('予約runtimeが変化しました');
 const evidence=await d.pmux(a,'tab','initial-status',l.operationId);
 if(evidence.state!=='started'||!evidence.processMatches||!evidence.receipt)return false;
 for(const k of ['operationId','workspaceId','tabId','runId','contractHash'])if(evidence[k]!==l[k])fail('初回receiptが一致しません');
 if(evidence.bodyHash!==r.inputCorrelation.digest||evidence.receipt.tabId!==a.tabId||evidence.receipt.workspaceId!==a.workspaceId)fail('初回本文/receiptが一致しません');
 if(i.receipt&&JSON.stringify(i.receipt)!==JSON.stringify(evidence.receipt))fail('初回processが変化しました');
 await oldProofIntact(service,a,r);
 await successorUnknownIntact(service,a,r);
 service.dispatchBoundary(r);
 if(!snapshot.available||snapshot.more||snapshot.incompleteTail||!status.agentSessionId||snapshot.sessionId!==status.agentSessionId||snapshot.inputs.length!==1||!matchesRunInput(r,snapshot.inputs[0]))return false;
 if(i.sessionId&&(i.sessionId!==snapshot.sessionId||i.fileIdentity!==snapshot.fileIdentity))fail('初回sessionが変化しました');
 // Return data; caller persists this together with normal lifecycle acceptance.
 return {receipt:structuredClone(evidence.receipt),sessionId:snapshot.sessionId,fileIdentity:snapshot.fileIdentity};
}
