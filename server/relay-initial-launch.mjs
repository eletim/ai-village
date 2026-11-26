import {randomUUID,createHash} from 'node:crypto';
import {inputCorrelation,startupContract,matchesRunInput} from './input-envelope.mjs';
import {changeRun} from './run-lifecycle.mjs';
import {recoveryEvidence} from './secretary-relay-recovery.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const fail=m=>{throw Object.assign(Error(m),{status:409});};
const runtimeKeys=['connection','workshopId','cwd','workspaceId','tabId','initialTabId','sessionName','runtime','inputEnvelope','observedSessionId','contractVerifiedSessionId','ownedProcesses','processVerification','terminalUrl','modelInfo'];
export function reserveInitialRelay(d,a,r,e,handover){
 if(a.provider!=='codex'||a.connection?.connectionType!=='local'||a.launchProfile||a.runtimeRetiredTo||a.runtimeUpgrade?.state==='prepared'||a.inputEnvelope?.mode!=='startup-v2'||a.inputEnvelope.hash!==digest(d.startupInstructions(a)))fail('初回起動は現行契約のlocal Codexだけです');
 if(typeof handover!=='string'||!handover.trim()||handover.length>12000)fail('旧runtime・外部効果・draftの保全引継ぎが必要です');
 const operationId=randomUUID(),tabId='tab-relay-'+operationId;
 const oldRuntime=Object.fromEntries(runtimeKeys.filter(k=>a[k]!==undefined).map(k=>[k,structuredClone(a[k])]));
 const plain=startupContract(a)===3;
 const body=(r.instruction+(plain?'':d.secretaryContext(a))+d.flow.context(r)).trim();
 if(Buffer.byteLength(body)>64000)fail('初回本文が起動引数の上限を超えます');
 const launch={operationId,workspaceId:a.workspaceId,tabId,runId:r.id,body,contractHash:a.inputEnvelope.hash};
 r.relayInitial={launch,oldRuntime,handover,createdAt:new Date().toISOString()};
 // Record ownership before any native execution. The old process and draft are untouched.
 (a.retainedRelayRuntimes||=[]).push({operationId,runId:r.id,runtime:oldRuntime,handover});
 if(a.terminalUrl){const url=new URL(a.terminalUrl);url.searchParams.set('tab',tabId);a.terminalUrl=url.href;}
 a.tabId=tabId;delete a.modelInfo;delete a.sessionName;delete a.runtime;delete a.observedSessionId;delete a.contractVerifiedSessionId;delete a.ownedProcesses;delete a.processVerification;
 a.inputEnvelope={mode:'startup-v2',hash:launch.contractHash,...(plain?{contract:3}:{})};
 r.inputCorrelation=inputCorrelation(body,'codex');r.inputEnvelopeMode='startup-v2';
 r.baselineRuntime={sessionId:null,fileIdentity:null,cursor:0};
 changeRun(r,{type:'dispatch',actor:'program',at:Date.now(),sessionId:null,agentIdle:true});
 r.dispatchAttemptedAt=new Date().toISOString();
 e.recovery.initialLaunchId=operationId;
}
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
export async function launchInitialRelay(service,r){
 const d=service.d,a=d.agent(r.agentId),initial=r.relayInitial;
 // Persist a separate attempted boundary. Restart/tick never calls this effect.
 await d.persist(async()=>{
  service.dispatchBoundary(r);
  await oldProofIntact(service,a,r);
  await successorUnknownIntact(service,a,r);
  service.dispatchBoundary(r);
  if(initial.attemptedAt)fail('初回起動は試行済みです。照会だけ可能です');
  initial.attemptedAt=new Date().toISOString();await d.save();
 });
 try { await d.pmux(a,'tab','initial-launch',JSON.stringify(initial.launch)); }
 catch { /* Unknown launch is never retried; observation queries the durable receipt. */ }
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
