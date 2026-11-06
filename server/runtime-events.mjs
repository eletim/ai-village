import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const runtimeScript=await readFile(new URL('./runtime-events.py',import.meta.url),'utf8');
export const inputHash=text=>createHash('sha256').update(text).digest('hex');
// Associate a captured input event to a native turn, never to assistant prose.
export function correlate(run,snapshot){
 if(!snapshot.available)return {state:'unknown',reason:'runtime-unavailable'};
 if(run.baselineRuntime?.fileIdentity&&snapshot.fileIdentity!==run.baselineRuntime.fileIdentity)return {state:'unknown',reason:'runtime-file-replaced'};
 if(snapshot.cursor< (run.baselineRuntime?.cursor||0))return {state:'unknown',reason:'runtime-truncated'};
 if(run.sessionId&&snapshot.sessionId!==run.sessionId)return {state:'unknown',reason:'session-changed'};
 if(run.priorInputs?.some(p=>snapshot.inputs.filter(i=>i.id===p.id&&i.hash===p.hash&&i.offset===p.offset).length!==1))return {state:'unknown',reason:'steering-prior-input-missing'};
 if(run.turnId){
  if(run.inputId&&snapshot.inputs.some(i=>i.turnId===run.turnId&&i.id!==run.inputId&&!run.priorInputs?.some(p=>p.id===i.id&&p.hash===i.hash&&p.offset===i.offset)))return {state:'unknown',reason:'additional-input-in-owned-turn'};
  const turn=snapshot.turns.find(t=>t.id===run.turnId);
  return turn?{...turn,turnId:turn.id,sessionId:snapshot.sessionId}:{state:'unknown',reason:'turn-missing'};
 }
 if(run.dispatchConfirmed!==true&&!run.dispatchAttemptedAt)return {state:'unknown',reason:'dispatch-not-confirmed'};
 const baseline=run.baselineRuntime;
 if(!baseline)return {state:'unknown',reason:'legacy-run-without-runtime-checkpoint'};
 if(baseline.sessionId&&baseline.sessionId!==snapshot.sessionId)return {state:'unknown',reason:'session-changed'};
 const inputs=snapshot.inputs.filter(i=>i.offset>(baseline.cursor||0));
 const candidates=inputs.filter(i=>i.hash===run.inputHash);
 const turnIds=[...new Set(candidates.map(i=>i.turnId))];
 // Unbound competing input, including duplicate identical text, stays unknown.
 if(turnIds.length!==1||inputs.some(i=>i.turnId!==turnIds[0]||i.hash!==run.inputHash)||candidates.length!==1)return {state:'unknown',reason:inputs.length?'competing-or-unmatched-input':'input-not-observed'};
 if(run.steerTarget&&candidates.some(i=>i.explicitTurn!==true))return {state:'unknown',reason:'steering-turn-attribution-missing'};
 if(run.steerTarget&&(snapshot.sessionId!==run.steerTarget.sessionId||turnIds[0]!==run.steerTarget.turnId))return {state:'unknown',reason:'steering-target-changed'};
 const turn=snapshot.turns.find(t=>t.id===turnIds[0]);
 if(!turn)return {state:'unknown',reason:'turn-not-observed'};
 return {...turn,turnId:turn.id,inputId:candidates[0].id,sessionId:snapshot.sessionId};
}

// A terminal boundary only releases stale busy when no newer native input exists.
export function terminalBoundary(snapshot,status){
 if(!snapshot.available||snapshot.incompleteTail||!status.alive||!status.agentSessionId||snapshot.sessionId!==status.agentSessionId)return false;
 const t=snapshot.turns.at(-1);
 return !!t&&['completed','failed','interrupted'].includes(t.state)&&Number.isFinite(t.completionOffset)&&
  snapshot.inputs.every(i=>Number.isFinite(i.offset)&&i.offset<=t.completionOffset)&&
  !snapshot.turns.some(other=>other!==t&&(other.state==='running'||other.offset>t.completionOffset));
}
