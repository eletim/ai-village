import {createHash} from 'node:crypto';
import {changeRun} from './run-lifecycle.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
// New local Codex Agents retain their owned shell until the first input has an
// actual launch receipt. No existing Agent/runtime is converted by this module.
export async function initialInputObservation(d,a){
 const pending=a.initialInput;if(!pending)return null;
 const {tabs}=await d.pmux(a,'tab','list','-w',a.workspaceId);
 const shell=tabs.find(t=>t.tabId===pending.shellTabId);
 if(!shell||shell.sessionName!==pending.sessionName)throw Error('Initial shell ownership changed');
 let evidence=null,r;
 if(pending.runId){
  r=d.flow.run(pending.runId);if(!r?.initialLaunch)throw Error('Initial input reference missing');
  evidence=await d.pmux(a,'tab','initial-status',r.id);
  const launch=r.initialLaunch;
  for(const k of ['operationId','workspaceId','tabId','runId','contractHash'])if(evidence[k]!==launch[k])throw Error('Initial launch binding changed');
  if(evidence.bodyHash!==r.inputCorrelation.digest)throw Error('Initial input body changed');
  if(evidence.state==='started'&&evidence.receipt&&evidence.processMatches){
   if(evidence.receipt.tabId!==launch.tabId||evidence.receipt.workspaceId!==a.workspaceId||!evidence.receipt.sessionName)throw Error('Initial receipt ownership changed');
   return {evidence,r};
  }
 }
 const rejected=evidence?.state==='failed-before-launch'&&!evidence.receipt&&!evidence.stages?.['runtime-intent']&&!evidence.stages?.['spawn-intent'];
 const ready=(!evidence||rejected)&&!tabs.some(t=>['codex-cli','claude-code'].includes(t.type||t.panelType));
 return {evidence,r,status:{alive:true,cliState:ready?'idle':'unknown',agentSessionId:null},snapshot:{available:ready,initialInputReady:ready,unrecorded:true,sessionId:null,fileIdentity:null,cursor:0,inputs:[],turns:[]}};
}
export function applyInitialObservation(a,observation){
 const {r,evidence}=observation;
 if(evidence?.state==='failed-before-launch'&&!evidence.receipt&&!evidence.stages?.['runtime-intent']&&!evidence.stages?.['spawn-intent']&&r.runModel.state.kind==='sent'){
  changeRun(r,{type:'prelaunch-rejected',actor:'program',at:Date.now(),operationId:r.id});
  r.error='モデル起動前に拒否されました: '+(evidence.stages.rejected?.stage||evidence.stages.preflight?.stage||'preflight');
 }
 if(evidence?.state==='started'&&evidence.processMatches){
  a.tabId=evidence.receipt.tabId;a.sessionName=evidence.receipt.sessionName;
  if(a.terminalUrl){const url=new URL(a.terminalUrl);url.searchParams.set('tab',a.tabId);a.terminalUrl=url.href;}
  // Receipt is the active runtime ownership fact, not a second recovery history.
  a.launchReceipt={operationId:r.id,...evidence.receipt};
  delete a.initialInput;
 }
}
export function reserveInitialInput(a,r,body){
 if(!a.initialInput)return;
 const previousRunId=a.initialInput.runId;
 r.initialLaunch={operationId:r.id,workspaceId:a.workspaceId,tabId:'tab-relay-'+r.id,runId:r.id,body,contractHash:a.inputEnvelope.hash,
  owner:{shellTabId:a.initialInput.shellTabId,shellSessionName:a.initialInput.sessionName,...(previousRunId?{previousOperationId:previousRunId}:{})}};
 if(hash(body)!==r.inputCorrelation.digest)throw Error('Initial body fingerprint mismatch');
 a.initialInput.runId=r.id;
}
