import {accepted,runState} from './run-lifecycle.mjs';
import {purposeView} from './conversation-purpose.mjs';
import {rootNode} from './unified-requests.mjs';
const fail=m=>{throw Object.assign(Error(m),{status:403});};
const actions=['supplement','continue','cancel','accept'];
// An input's authority concerns a stable work, never a runtime or a current run.
export function inputScope(d,value){
 if(!value||Object.keys(value).some(k=>!['projectId','workId','actions'].includes(k))||!Array.isArray(value.actions)||!value.actions.length||new Set(value.actions).size!==value.actions.length||value.actions.some(a=>!actions.includes(a)))fail('対象の仕事と許可する操作を指定してください');
 const matches=d.data.requests.filter(q=>q.projectId===value.projectId&&q.requestGraph?.nodes.some(w=>w.id===value.workId));
 if(matches.length!==1)fail('指定された仕事を確認できません。名前ではなく選択した対象を確認してください');
 const q=matches[0],w=rootNode(q),c=d.data.conversations.find(c=>c.id===q.conversationId);
 if(q.integrity||w.id!==value.workId||!c||c.projectId!==q.projectId||!q.requestedBy?.authorization)fail('この対象は会話から依頼された仕事ではありません');
 d.writableProject(q.projectId);d.writableAgent(d.agent(c.agentId));
 return {scope:{projectId:q.projectId,workId:w.id,actions:[...value.actions].sort()},q,w,c};
}
// Interpret meaning in the registered secretary; validate provenance here, not semantics.
// Stored only with the existing input operation, atomically with its receipt.
export function resolveInput(d,c,actor,value){
 if(!value||Object.keys(value).some(k=>!['projectId','workId','action','quote','clarification'].includes(k)))fail('対象解釈の引数が不正です');
 if(actor.conversationSource?.kind!=='human'||actor.conversationSource.scope)fail('現在の通常人間入力だけが対象解釈の根拠になります');
 let human=actor;
 const exact=(text,quote)=>typeof quote==='string'&&!!quote.trim()&&typeof text==='string'&&text.includes(quote);
 if(value.clarification){
  const q=value.clarification;
  if(Object.keys(q).some(k=>!['humanRunId','questionRunId','questionQuote','answerQuote'].includes(k)))fail('確認回答の参照が不正です');
  human=d.flow.run(q.humanRunId);const question=d.flow.run(q.questionRunId);
  // The question is the actual response to that explicit human input, not an
  // adjacent worker report. Intervening reports do not participate in authority.
  if(!human||human.id!==question?.id||human.conversationId!==c.id||human.conversationSource?.kind!=='human'||!accepted(human)||runState(human)!=='completed'||human.runModel.supersededBy||human.conversationSequence>=actor.conversationSequence||!exact(human.finalOutput,q.questionQuote)||!exact(actor.instruction,q.answerQuote))fail('元入力・秘書の質問・今回の人間回答を確認できません');
  if(d.data.runs.some(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&!r.queueCancelledAt&&r.conversationSequence>human.conversationSequence&&r.conversationSequence<actor.conversationSequence))fail('間に別の人間入力があります。過去の入力を許可へ転用できません');
 }
 if(!exact(human.instruction,value.quote))fail('保存された元人間入力の原文根拠が必要です');
 const b=inputScope(d,{projectId:value.projectId,workId:value.workId,actions:[value.action]});
 const decision=purposeView(d.data,b.q).decision;
 if(decision){
  const end=d.flow.run(decision.actorRunId)?.runModel?.facts.findLast(f=>f.type==='terminal')?.at;
  if(decision.state==='pending'||!Number.isFinite(end)||!(end<Date.parse(actor.createdAt)))fail('対象の判断が元入力より後、または順序不明です。新しい人間入力で確認してください');
 }
 return {...b,human,resolution:{humanRunId:human.id,scope:b.scope,targetPermission:structuredClone(b.q.requestedBy.authorization),targetDecisionId:decision?.id||null}};
}
// One authority reader for retained human scopes and new operation-bound input.
export function addressedBinding(d,r){
 const s=r.conversationSource,from=d.data.conversations.find(c=>c.id===s?.conversationId);
 const operation=from?.operations.find(o=>o.receipt?.runId===r.id&&o.receipt?.sourceRunId===s.runId);
 const human=d.flow.run(s?.humanRunId),saved=operation?.resolution||human?.conversationSource;
 if(!operation||!human||saved?.humanRunId&&saved.humanRunId!==human.id)fail('保存された宛先入力を確認できません');
 return {...inputScope(d,saved?.scope),human,saved,operation};
}
export function addressedScope(d,r,action,workId){
 const s=r.conversationSource;
 if(s?.kind!=='agent')return null;
 const human=d.flow.run(s.humanRunId),sender=d.flow.run(s.runId),from=d.data.conversations.find(c=>c.id===s.conversationId);
 if(!human||human.conversationSource?.kind!=='human'||!accepted(human)||!sender||!accepted(sender)||sender.agentId!==s.agentId||sender.conversationId!==from?.id||human.conversationId!==from.id||human.conversationSequence>sender.conversationSequence||!from.operations.some(o=>o.receipt?.runId===r.id&&o.receipt?.sourceRunId===sender.id))fail('送信元の保存入力と対象許可を確認できません');
 const b=addressedBinding(d,r);
 if(b.c.id!==r.conversationId||b.w.id!==workId||!b.scope.actions.includes(action))fail('この入力で許可された対象・操作ではありません');
 if(JSON.stringify(b.q.requestedBy.authorization)!==JSON.stringify(b.saved.targetPermission))fail('対象仕事の元許可が変わりました');
 if(d.data.runs.some(x=>x.conversationId===from.id&&x.conversationSource?.kind==='human'&&!x.queueCancelledAt&&x.conversationSequence>sender.conversationSequence))fail('送信元に新しい人間入力があります。元の入力は再送しません');
 if(d.data.runs.some(x=>x.conversationId===r.conversationId&&x.conversationSource?.kind==='human'&&!x.queueCancelledAt&&x.conversationSequence>r.conversationSequence))fail('受信先に新しい人間入力があります。新しい指示を確認してください');
 if(sender.runModel.supersededBy||!['running','completed'].includes(runState(sender)))fail('送信元の判断が失効または未確定です');
 return {...b,human,sender,targetDecisionId:b.saved.targetDecisionId};
}

// Recheck input authority at dispatch, including queued supplements. No new ledger:
// the work inbox points back to the accepted conversation input.
export function inputScopesIntact(d,r){
 try{
  if(r.conversationSource?.kind==='agent'){
   const {scope}=addressedBinding(d,r);
   addressedScope(d,r,scope?.actions?.[0],scope?.workId);
  }
  if(r.humanRequestId){
   const q=d.flow.root(r.humanRequestId),w=d.flow.work(q,r.workId);
   for(const input of w.inbox||[]){
    if(!input.attempts.includes(r.id)||input.handledBy||input.retiredBy)continue;
    const actor=d.flow.run(input.source?.actorRunId);
    if(actor?.conversationSource?.kind==='agent')addressedScope(d,actor,input.source.operation,w.id);
   }
  }
  return true;
 }catch{return false;}
}
