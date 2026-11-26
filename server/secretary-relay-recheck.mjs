import {createHash} from 'node:crypto';
import {accepted} from './run-lifecycle.mjs';
const fail=()=>{throw Object.assign(Error('後着humanの全文参照と送信元秘書の範囲維持判断を再照合してください'),{status:409});};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// References attest which exact materials were assessed, not their meaning.
// Cancellation/change of authority requires a secretary decision; never infer it from text.
export function laterHumanReferences(d,c,e){
 const original=d.flow.run(e.authorization.runId);if(!original)fail();
 return d.data.runs.filter(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&r.conversationSequence>original.conversationSequence)
  .sort((a,b)=>a.conversationSequence-b.conversationSequence)
  .map(r=>({runId:r.id,sequence:r.conversationSequence,digest:digest([r.instruction,r.attachments||[],r.queueCancelledAt||null])}));
}
export function checkRelayRecheck(d,c,e,value,reviewer){
 if(!value||Object.keys(value).some(k=>!['decision','reason','inputs'].includes(k))||value.decision!=='within-original-scope'||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>4000||!Array.isArray(value.inputs))fail();
 const refs=laterHumanReferences(d,c,e);
 if(!refs.length||JSON.stringify(value.inputs)!==JSON.stringify(refs)||!reviewer||reviewer.conversationId!==c.id||reviewer.agentId!==e.sourceSecretaryId||c.agentId!==e.sourceSecretaryId||!accepted(reviewer)||reviewer.conversationSource?.kind==='secretary')fail();
 for(const ref of refs){const r=d.flow.run(ref.runId);if(!accepted(r)||ref.sequence>reviewer.conversationSequence)fail();}
 return {decision:value.decision,reason:value.reason,inputs:refs};
}
