import {agentView} from './state/projection.ts';
import {deriveAgent,sendControls,transitionAgent} from './state/agent.ts';
export const agentControls=a=>agentView(a.agentModel);
export function bindAgent(a){for(const k of ['state','lifecycle','activityState','connectionState','canSend','canQueue','canSteer','sendReason','reportPending'])delete a[k];a.agentModel ||= {id:a.id,intent:null,observation:null};return a;}
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
 const canSteer=['codex','claude'].includes(a.provider)&&(a.provider!=='claude'||owner?.phase!=='report')&&observation.connected&&observation.process==='alive'&&observation.activity==='running'&&a.runtime?.cliState==='busy'&&!a.runtime?.permissionRequest&&!a.setupRequired&&owner?.runModel.state.kind==='running'&&!owner.error&&owner.sessionId===a.runtime.agentSessionId;
 delete a.steerTarget;if(canSteer)a.steerTarget={runId:owner.id,sessionId:owner.sessionId,turnId:owner.turnId};
 agentChange(a,{type:'observe',actor:'program',observation:{...observation,canSteer:!!canSteer,inputPending:owned.length>0}});
}
