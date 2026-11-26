import {createHash} from 'node:crypto';
import {matchesRunInput} from './input-envelope.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const fail=()=>{throw Object.assign(Error('native混入入力と正常終端の証拠が不足しています'),{status:409});};
// This proves a terminal contaminated attempt, never acceptance of the old run.
// The caller pins a previously inspected full native input. Its extra prefix is
// retained as evidence, not executed or interpreted as authority.
export function recoveryEvidence(old,s,status,x){
 const base=old.baselineRuntime;
 if(typeof old.instruction!=='string'||!old.instruction||old.runModel.facts.filter(f=>f.type==='dispatch').length!==1||old.runModel.facts.filter(f=>f.type==='transport-ack').length!==1)fail();
 if(!base?.fileIdentity||!base.sessionId||!s.available||s.more||s.incompleteTail||!status.alive||status.cliState!=='idle'||s.sessionId!==status.agentSessionId||s.sessionId!==base.sessionId||s.fileIdentity!==base.fileIdentity||s.cursor<base.cursor)fail();
 const inputs=s.inputs.filter(i=>i.offset>base.cursor);
 if(inputs.length!==1||inputs.some(i=>(i.aliases||[]).some(a=>a.offset<=base.cursor)))fail();
 const i=inputs[0],t=s.turns.find(t=>t.id===i.turnId);
 if(i.turnId!==x.nativeTurnId||!i.id||typeof i.text!=='string'||digest(i.text)!==x.nativeInputHash||i.explicitTurn!==true||!t||t!==s.turns.at(-1)||t.state!=='completed'||!Number.isFinite(t.completionOffset)||t.completionOffset<=i.offset||s.inputs.some(j=>j.offset>t.completionOffset)||s.turns.some(j=>j!==t&&j.state==='running'))fail();
 // Only one nonempty prefix plus the exact original delivered fingerprint.
 // Never change matchesRunInput/correlate, or mark the old input as accepted.
 const starts=[];let at=i.text.indexOf(old.instruction);
 while(at>=0){if(at>0&&matchesRunInput(old,{...i,text:i.text.slice(at)}))starts.push(at);at=i.text.indexOf(old.instruction,at+1);}
 if(starts.length!==1||old.inputCorrelation?.provider!=='codex')fail();
 return {sessionId:s.sessionId,fileIdentity:s.fileIdentity,cursor:s.cursor,inputId:i.id,turnId:i.turnId,inputOffset:i.offset,completionOffset:t.completionOffset,inputHash:x.nativeInputHash,inputText:i.text,prefixLength:starts[0],oldDigest:old.inputCorrelation.digest};
}
