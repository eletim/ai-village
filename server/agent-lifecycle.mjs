import {deriveAgent,sendControls,transitionAgent} from './state/agent.ts';
const labels={starting:'starting',idle:'idle',running:'busy','input-needed':'waiting_input',unreachable:'unknown',stopping:'stopping',ended:'terminated'};
const keys=['state','lifecycle','activityState','connectionState','canSend','canQueue','canSteer','sendReason'];
export function bindAgent(a){
 delete a.reportPending;
 a.agentModel ||= {id:a.id,intent:null,observation:null};
 const getters={
  state:()=>labels[deriveAgent(a.agentModel).kind],
  lifecycle:()=>{const k=deriveAgent(a.agentModel).kind;return k==='ended'?'terminated':k==='unreachable'?'unknown':['starting','stopping'].includes(k)?k:'alive';},
  activityState:()=>({running:'busy','input-needed':'waiting_input',idle:'idle'})[deriveAgent(a.agentModel).kind]||'unknown',
  connectionState:()=>a.agentModel.observation?.connected?'connected':'unknown',
  canSend:()=>sendControls(a.agentModel).send,canQueue:()=>sendControls(a.agentModel).queue,canSteer:()=>sendControls(a.agentModel).steer,
  sendReason:()=>{
   const k=deriveAgent(a.agentModel).kind,c=sendControls(a.agentModel);
   if(c.send||c.steer)return null;
   return k==='input-needed'?'PurpleMuxで入力・許可を確認してください':k==='unreachable'?'接続・稼働状態を確認できません':k==='starting'?'Agentを起動しています':k==='stopping'?'Agentを停止しています':k==='ended'?'Agentは終了しています':a.agentModel.observation?.inputPending?'前の入力の受付・終了を照合しています':'Agentが実行中です';
  }
 };
 for(const key of keys)Object.defineProperty(a,key,{configurable:true,enumerable:true,get:getters[key]});
 return a;
}
export function agentChange(a,event){
 if(!a.agentModel)bindAgent(a);
 const result=transitionAgent(a.agentModel,event);if(!result.ok)throw Error('Agent transition rejected: '+result.reason);
 a.agentModel=result.value;return a;
}
/** Only transport/native facts. No request status, report flags or output prose. */
export function runtimeObservation(status,snapshot,{freshClaude=false,setupRequired=false,previousSession=null}={}){
 const latest=snapshot.turns.at(-1);
 let activity=status.permissionRequest||setupRequired||['needs-input','waiting-for-input','waiting-for-permission'].includes(status.cliState)?'input-needed':latest?.state==='running'?'running':['idle','ready-for-review'].includes(status.cliState)||snapshot.terminalBoundary?'idle':status.cliState==='busy'?'running':'unknown';
 if(!setupRequired&&!status.permissionRequest&&(!snapshot.available&&!freshClaude||snapshot.incompleteTail||snapshot.sessionId&&status.agentSessionId&&snapshot.sessionId!==status.agentSessionId||previousSession&&!snapshot.sessionId||latest&&Number.isFinite(latest.completionOffset)&&snapshot.inputs.some(i=>i.offset>latest.completionOffset)))activity='unknown';
 return {connected:true,process:status.alive&&(status.permissionRequest||setupRequired)?'alive':!status.alive||status.cliState==='inactive'?'absent':!status.cliState||status.cliState==='unknown'?'unknown':'alive',activity,canSteer:false,inputPending:false};
}
export function projectControls(a,runs){
 if(!a.agentModel)bindAgent(a);
 const observation=a.agentModel.observation;if(!observation)return;
 const owned=runs.filter(r=>r.agentId===a.id&&['sent','running'].includes(r.runModel?.state.kind)&&!r.runModel.supersededBy),owner=owned.length===1?owned[0]:null;
 const canSteer=a.provider==='codex'&&observation.connected&&observation.process==='alive'&&observation.activity==='running'&&a.runtime?.cliState==='busy'&&!a.runtime?.permissionRequest&&!a.setupRequired&&owner?.runModel.state.kind==='running'&&!owner.error&&owner.state==='running'&&owner.sessionId===a.runtime.agentSessionId;
 delete a.steerTarget;if(canSteer)a.steerTarget={runId:owner.id,sessionId:owner.sessionId,turnId:owner.turnId};
 agentChange(a,{type:'observe',actor:'program',observation:{...observation,canSteer:!!canSteer,inputPending:owned.length>0}});
}
