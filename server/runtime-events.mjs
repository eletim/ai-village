import {matchesRunInput} from './input-envelope.mjs';
import {readFile} from 'node:fs/promises';
export const runtimeScript=(await readFile(new URL('./runtime_index.py',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('./runtime-events.py',import.meta.url),'utf8'));
// Slice by native event position, never by text equality. Terminal finalOutput
// is authoritative and remains on the last run even when its words repeat.
export function outputBetween(turn,start,end=Infinity){
 if(turn.messageOffsets!==true||!Number.isFinite(start))return '';
 const messages=turn.messages.filter(m=>m.offset>start&&m.offset<end);
 if(messages.length)return messages.map(m=>m.text).join('\n\n');
 return end===Infinity&&turn.completionOffset>start&&typeof turn.finalOutput==='string'?turn.finalOutput:'';
}
function ownedTurn(run,turn,input,snapshot){
 const result={...turn,turnId:turn.id,sessionId:snapshot.sessionId};
 if(run.steerTarget){
  if(!input||!Number.isFinite(input.offset))return {state:'unknown',reason:'steering-input-boundary-missing'};
  result.output=outputBetween(turn,input.offset);
 }
 return result;
}
const positions=i=>[{id:i.id,offset:i.offset},...(i.aliases||[])];
export const inputMatches=(i,p)=>positions(i).some(a=>a.id===p.id&&(p.offset===undefined||a.offset===p.offset));
const byId=(i,id)=>positions(i).some(a=>a.id===id);
export function resolveInputPosition(inputs,id,turnId){
 const found=inputs.filter(i=>turnId===undefined||i.turnId===turnId).flatMap(i=>positions(i).filter(p=>p.id===id).map(p=>({...i,...p})));
 return found.length===1?found[0]:undefined;
}
// Associate a captured input event to a native turn, never to assistant prose.
export function correlate(run,snapshot){
 if(!snapshot.available||snapshot.incompleteTail||snapshot.more)return {state:'unknown',reason:'runtime-unavailable'};
 if(run.baselineRuntime?.fileIdentity&&snapshot.fileIdentity!==run.baselineRuntime.fileIdentity)return {state:'unknown',reason:'runtime-file-replaced'};
 if(snapshot.cursor< (run.baselineRuntime?.cursor||0))return {state:'unknown',reason:'runtime-truncated'};
 if(run.sessionId&&snapshot.sessionId!==run.sessionId)return {state:'unknown',reason:'session-changed'};
 if(run.priorInputs?.some(p=>snapshot.inputs.filter(i=>inputMatches(i,p)).length!==1))return {state:'unknown',reason:'steering-prior-input-missing'};
 if(!run.inputMarker)return {state:'unknown',reason:'run-marker-missing'};
 if(run.turnId){
  if(run.inputId&&!snapshot.inputs.some(i=>byId(i,run.inputId)&&i.turnId===run.turnId&&matchesRunInput(run,i)))return {state:'unknown',reason:'owned-input-mismatch'};
  if(run.inputId&&snapshot.inputs.some(i=>i.turnId===run.turnId&&!byId(i,run.inputId)&&!run.priorInputs?.some(p=>inputMatches(i,p))))return {state:'unknown',reason:'additional-input-in-owned-turn'};
  const turn=snapshot.turns.find(t=>t.id===run.turnId);
  return turn?ownedTurn(run,turn,resolveInputPosition(snapshot.inputs,run.inputId,run.turnId),snapshot):{state:'unknown',reason:'turn-missing'};
 }
 if(!run.runModel?.facts.some(f=>f.type==='transport-ack')&&!run.dispatchAttemptedAt)return {state:'unknown',reason:'dispatch-not-confirmed'};
 const baseline=run.baselineRuntime;
 if(!baseline)return {state:'unknown',reason:'legacy-run-without-runtime-checkpoint'};
 if(baseline.sessionId&&baseline.sessionId!==snapshot.sessionId)return {state:'unknown',reason:'session-changed'};
 const inputs=snapshot.inputs.filter(i=>positions(i).every(p=>p.offset>(baseline.cursor||0)));
 const candidates=inputs.filter(i=>matchesRunInput(run,i));
 const turnIds=[...new Set(candidates.map(i=>i.turnId))];
 // Unbound competing input, including duplicate identical text, stays unknown.
 if(turnIds.length!==1||inputs.some(i=>i.turnId!==turnIds[0]||!matchesRunInput(run,i))||candidates.length!==1)return {state:'unknown',reason:inputs.length?'competing-or-unmatched-input':'input-not-observed'};
 if(run.steerTarget&&candidates.some(i=>i.explicitTurn!==true))return {state:'unknown',reason:'steering-turn-attribution-missing'};
 if(run.steerTarget&&(snapshot.sessionId!==run.steerTarget.sessionId||turnIds[0]!==run.steerTarget.turnId))return {state:'unknown',reason:'steering-target-changed'};
 const turn=snapshot.turns.find(t=>t.id===turnIds[0]);
 if(!turn)return {state:'unknown',reason:'turn-not-observed'};
 return {...ownedTurn(run,turn,candidates[0],snapshot),inputId:candidates[0].id};
}

// A terminal boundary only releases stale busy when no newer native input exists.
export function terminalBoundary(snapshot,status){
 if(!snapshot.available||snapshot.incompleteTail||!status.alive||!status.agentSessionId||snapshot.sessionId!==status.agentSessionId)return false;
 const t=snapshot.turns.at(-1);
 return !!t&&['completed','failed','interrupted'].includes(t.state)&&Number.isFinite(t.completionOffset)&&
  snapshot.inputs.every(i=>Number.isFinite(i.offset)&&i.offset<=t.completionOffset)&&
  !snapshot.turns.some(other=>other!==t&&(other.state==='running'||other.offset>t.completionOffset));
}
