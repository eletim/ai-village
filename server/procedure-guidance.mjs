import {randomUUID} from 'node:crypto';
import {agentActions} from './agent-rules.mjs';
import {dependencies,resolved} from './state/requests.ts';
const pending=i=>!i.handledBy&&!i.retiredBy;
const normal=r=>r?.runModel.state.kind==='ended'&&r.runModel.state.outcome==='normal'&&r.runModel.facts.some(f=>f.type==='input')&&!r.runModel.supersededBy;
export function missingProcedure(q,w,r){
 const items=(w.inbox||[]).filter(i=>!i.procedure&&pending(i)&&i.attempts.includes(r?.id));
 const results=items.filter(i=>i.result).map(i=>({requestId:i.result.requestId,resultId:i.result.resultId,version:i.result.version}));
 const finish=!!dependencies(q.requestGraph,w).length&&resolved(q.requestGraph,w)&&!w.declarations.some(d=>d.runId===r?.id&&!d.invalidated);
 return {inputs:items.map(i=>i.id),results,finish};
}
export function procedureText(m){return '手続きの補完案内（人間の追加指示ではありません）。外部作業や既存成果をやり直さず、requests get / inputs / resultsで最新状態と全文を確認してください。\n'+JSON.stringify(m)+'\ninputsは対応した入力IDを明示。resultsは内容を確認しrequestId/resultId/versionとdecision:accept|reworkを自分で選びます（採否は自動決定しません）。待機ならrespond、完了を申告するならfinish。詳細は rules get work respond または rules get work finish。';}
// Only delivery metadata is added. The graph's completion and claim conditions stay authoritative.
export function updateProcedureGuidance(flow,q){
 let changed=false;
 for(const w of q.requestGraph.nodes){
  const r=flow.run(w.currentRunId),confirmed=normal(r)&&!w.invalidatedRuns.includes(r.id),guides=(w.inbox||[]).filter(i=>i.procedure);
  for(const i of guides.filter(pending)){
   const m=i.procedure.missing,remaining=m.inputs.some(id=>w.inbox.some(x=>x.id===id&&pending(x))),finishPending=m.finish&&!(confirmed&&w.declarations.some(d=>d.runId===r.id&&!d.invalidated))&&w.state.kind==='active';
   // A queued second attempt may carry both the original and its guide. Preserve
   // that batch, but never dispatch a delayed guide for an exhausted original.
   const undispatched=!i.attempts.some(id=>flow.run(id)?.runModel.facts.some(f=>f.type==='dispatch'));
   const exhausted=undispatched&&m.inputs.some(id=>{const x=w.inbox.find(x=>x.id===id);return x&&pending(x)&&x.attempts.length>=2&&!(r?.runModel.state.kind==='queued'&&i.attempts.includes(r.id)&&x.attempts.includes(r.id));});
   if(w.state.kind!=='active'||!remaining&&!finishPending||confirmed&&i.attempts.includes(r.id)||exhausted){i.retiredBy='procedure-guidance-finished';changed=true;}
  }
  if(w.state.kind!=='active'||!w.inbox||!normal(r)||r.runModel.phase!=='work'||w.invalidatedRuns.includes(r.id)||w.selfResume?.current?.status==='scheduled')continue;
  const children=dependencies(q.requestGraph,w).filter(c=>!c.replacementId&&!(c.planned&&c.state.kind==='withdrawn'));
  if(children.some(c=>c.state.kind==='active'||c.planned))continue;
  const m=missingProcedure(q,w,r);if(!m.inputs.length&&!m.finish)continue;
  // Exhausted original inputs must never be bypassed with a new guidance input.
  if(m.inputs.some(id=>w.inbox.find(i=>i.id===id).attempts.length>=2))continue;
  const key=JSON.stringify(m);if(guides.length>=2||guides.some(i=>i.procedure.key===key))continue;
  w.inbox.push({id:randomUUID(),kind:'supplement',source:{actor:'program'},text:procedureText(m),createdAt:new Date().toISOString(),attempts:[],procedure:{targetRunId:r.id,key,missing:m}});changed=true;
 }
 return changed;
}
export function operationGuidance(error,action){
 if(!Object.hasOwn(agentActions,action)||error.persistenceFailure||![400,403,404,409].includes(error.status))return error;
 const messages={
  'explicit-current-inputs-required':'現在runのinputsが必要です。requests inputsで対象IDを取得し、respond/finishにinputsとresultsを明示してください。',
  'result-decision-required':'子成果の採否が未指定です。requests resultsで全文と版を確認し、resultsにdecision:accept|reworkを選んで明示してください。',
  'stale-or-foreign-result':'結果の依頼/版が一致しません。requests get/resultsで直接の子の最新resultId/versionを確認してください。',
  'child-dependencies-or-inputs-unresolved':'子の未対応入力/依存が残っています。requests get/inputs/resultsで状況を確認し、解決前のacceptは行わないでください。',
  'stale-or-foreign-input':'入力が古いか対象外です。requests inputsで現在runに配送された未対応IDを再確認してください。',
  'current-correlated-run-required':'現在の受付照合済みrunが必要です。requests getでcurrentRunIdと受付状態を確認し、不明な実行は再送しないでください。'
 };
 const code=Object.keys(messages).find(c=>error.message.endsWith(c));
 error.message+='\n'+(code?messages[code]:'requests getで現在の対象・revision・受付状態を確認してください。')+' 詳細: rules get work '+action+'。このエラーだけから受付の成否を推測しないでください。採否・完了を推測せず、応答不明の再試行は同じoperationIdと内容を使ってください。';return error;
}
