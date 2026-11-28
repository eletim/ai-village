import {addressedScope} from './conversation-input-scope.mjs';
import {continuationBasis} from './state/run.ts';
import {purposeId,purposeView,purposeLeaf} from './conversation-purpose.mjs';
import {rootNode} from './unified-requests.mjs';
import {accepted,runState} from './run-lifecycle.mjs';
const fail=m=>{throw Object.assign(Error(m),{status:409});};
// Resolve once while the caller owns request-graph. No text/permission inference.
export function resolveFollowup(conversations,c,actor,x){
 if(Object.keys(x).some(k=>!['conversationId','actorRunId','operationId','purposeId','instruction'].includes(k)))fail('追加指示は目的IDと残作業を指定してください。追加権限は新規依頼で扱います');
 const data=conversations.d.data,original=data.requests.find(q=>q.id===x.purposeId&&purposeId(q)===q.id&&q.conversationId===c.id);
 if(!original)fail('この会話の目的IDを指定してください');
 const source=data.runs.find(r=>r.id===original.requestedBy?.actorRunId);
 if(!source||source.conversationId!==c.id||source.conversationSequence>actor.conversationSequence)fail('未配送の目的は指定できません');
 if(data.runs.some(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&!r.queueCancelledAt&&r.conversationSequence>actor.conversationSequence))fail('後着の人間入力があります。配送後に追加指示してください');
 const q=purposeLeaf(data,original);
 if(q.integrity||original.integrity)fail('目的の参照を検証できません');
 const w=rootNode(q),view=purposeView(data,q),decision=view.decision,current=data.runs.find(r=>r.id===w.currentRunId);
 if(w.state.kind==='withdrawn'||w.state.kind==='completed'&&w.state.by==='human')fail('取り下げ・人間による終了済みの目的は自動再開できません');
 const stopped=current&&['failed','interrupted','terminated'].includes(runState(current));
 if(stopped&&!continuationBasis(current.runModel))fail('実行権限の閉鎖が未確認です。村のstatusで未解決項目と接続再観測の案内を確認してください。入力は再送しません');
 if(decision?.state==='pending')fail('前の秘書判断の正常終了を待ってください');
 let humanAfter=decision&&data.runs.findLast(r=>r.conversationId===c.id&&r.conversationSource?.kind==='human'&&!r.queueCancelledAt&&accepted(r)&&r.conversationSequence<=actor.conversationSequence&&r.conversationSequence>(data.runs.find(r=>r.id===decision.actorRunId)?.conversationSequence??Infinity));
 if(decision&&actor.conversationSource?.kind==='agent'){const bound=addressedScope(conversations.d,actor,'continue',w.id);if(bound.targetDecisionId===decision.id)humanAfter=bound.human;}
 if(decision?.kind==='question'&&decision.state==='committed'&&!humanAfter)fail('具体的な人間の回答を待っています');
 const base={conversationId:c.id,actorRunId:actor.id,operationId:x.operationId,instruction:x.instruction,authorization:original.requestedBy.authorization};
 if(stopped)return {action:'continue-purpose',input:{...base,humanRequestId:q.id,workId:w.id,previousRunId:current.id,revision:q.revision}};
 if(['active','submitted'].includes(w.state.kind))return {action:'amend',input:{...base,humanRequestId:q.id}};
 const event=c.deliveries.findLast(e=>e.humanRequestId===q.id&&e.kind==='result'&&data.runs.some(r=>r.id===e.runId&&accepted(r)&&r.conversationSequence<=actor.conversationSequence));
 if(!event)fail('保存成果の正式配送を待っています。配送後に同じ目的へ追加指示してください');
 if(decision?.kind==='accept'&&decision.state==='committed'&&!humanAfter)fail('達成報告後の追加指示には後続の人間入力が必要です');
 if(!current||!continuationBasis(current.runModel))fail('成果後の実行終端を確認できません。入力は再送しません');
 return {action:'continue-purpose',input:{...base,humanRequestId:q.id,workId:w.id,previousRunId:current.id,revision:q.revision,deliveryId:event.id}};
}
