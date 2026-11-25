import {runState,accepted} from './run-lifecycle.mjs';
import {agentControls} from './agent-lifecycle.mjs';
const state=r=>r?.runModel?runState(r):r?.state;
const status=(code,label,reason='',next='')=>({code,label,reason,next});
export function runtimeGate(a){
 if(!a||a.deletedAt||a.deletion||a.runtimeRetiredTo)return status('unavailable','担当を利用できません','','同じProjectの担当設定を確認してください。');
 if(a.inputEnvelope?.mode!=='startup-v2'||a.runtimeUpgrade?.state==='prepared')return status('migration-required','正式セッションへの移行待ち',a.inputEnvelope?.reason||'runtime-prepared','プロフィールの起動契約から正式な移行を確認してください。既存の送信待ちは保持されています。');
 const controls=a.agentModel?agentControls(a):a;
 if(['terminated','stopping'].includes(controls.state))return status('stopped','担当は停止しています','','稼働状態と正式な復旧手順を確認してください。');
 if(controls.connectionState==='unknown'||controls.state==='unknown')return status('unknown','接続・稼働状態を確認できません','','接続先を確認してください。受付不明の送信は再送しません。');
 return status('ready','利用可能');
}
export function conversationControl(a){
 const gate=runtimeGate(a);
 // A conversation is a durable mailbox, independent of its leader's graph.
 return {...gate,canAccept:['ready','unknown'].includes(gate.code),next:gate.code==='ready'?'追加指示を保存できます。秘書の応答中は順番に配送します。':gate.next};
}
export function conversationTurn(r){
 const s=state(r);
 if(r.queueCancelledAt)return status('cancelled','未送信の会話を取消済み','','新しい会話入力を送れます。');
 if(s==='queued')return status('queued','会話を保存済み・配送待ち',r.error||r.queuedReason||'','同じ内容を再送せず、配送を待ってください。');
 if(s==='awaiting_input')return status('receipt-pending','秘書への受付照合中',r.error||'','自動再送せずnative入力を照合しています。');
 if(s==='running')return status('responding','秘書が応答中','','追加指示は順番に配送できます。');
 if(s==='completed'&&accepted(r))return status('answered','秘書の回答終了','','仕事の完了・成果確認は「仕事の状況」を確認してください。');
 if(s==='failed'||s==='interrupted')return status(s,s==='failed'?'秘書の応答に失敗':'秘書の応答が中断',r.error||'','結果と稼働状態を確認してください。仕事の完了を意味しません。');
 return status('unconfirmed','秘書の受付・結果が未確認',r.error||r.runModel?.state.reason||'','過去の送信は再送せず確認してください。新しい指示は別の会話入力として送れます。');
}
export function conversationJob(data,q){
 const w=q.requestGraph?.nodes.find(n=>n.id===(q.rootWorkId||q.requestGraph.rootId))||q.requestGraph?.nodes.find(n=>!n.parentId);
 if(!w)return {id:q.id,...status('unknown','仕事の状態を確認できません')};
 const r=data.runs.find(r=>r.id===w.currentRunId),leader=data.agents.find(a=>a.id===w.assignee),gate=runtimeGate(leader);
 const c=data.conversations?.find(c=>c.id===q.conversationId);
 const event=c?.deliveries.findLast(e=>e.humanRequestId===q.id&&e.kind==='result'),delivery=event&&data.runs.find(r=>r.id===event.runId);
 let work;
 if(w.state.kind==='withdrawn')work=status('withdrawn','仕事は取り下げ済み','','送信済みの外部操作の取消とは別です。');
 else if(w.state.kind==='completed'){
  const ds=state(delivery);
  work=status('completed','リーダーの仕事完了');
  if(event){
   if(ds==='completed'&&accepted(delivery))work=status('awaiting-review','仕事完了・秘書回答済み（成果確認待ち）','','成果を確認してください。人間の了承は自動判定しません。');
   else if(['failed','interrupted','terminated'].includes(ds))work=status('delivery-failed','仕事完了・秘書の返答は要確認',delivery.error||'','成果は保存済みです。秘書へ確認を指示できます。仕事は再実行しません。');
   else work=status('returning',ds==='running'?'仕事完了・秘書が確認中':'仕事完了・秘書へ返答待ち',delivery?.error||delivery?.queuedReason||'','秘書からの説明を待ってください。追加指示も送れます。');
  }else if(w.state.by==='human')work=status('human-closed','人間が仕事を終了','','成果の採用や外部効果の完了とは別です。');
 }else if(w.conversationWait&&!w.conversationWait.answerInputId)work=status('question','リーダーからの相談・秘書回答待ち','','秘書の質問・相談内容を確認し、必要な指示を会話で送ってください。');
 else if(['failed','interrupted','terminated'].includes(state(r)))work=status('attention','仕事は未完了・要確認',r.error||r.runModel?.state.reason||'','秘書へ状況確認・残作業の指示を送れます。受付不明の操作は再送しません。');
 else if(state(r)==='queued'&&gate.code!=='ready')work=status('blocked','仕事の配送を保留',gate.label+(gate.reason?'：'+gate.reason:''),gate.next+' 秘書への追加指示は可能です。');
 else if(state(r)==='queued')work=status('queued','仕事を保存済み・配送待ち',r.error||r.queuedReason||'','実行中の応答が終わり、安全条件が揃うと配送します。');
 else if(state(r)==='awaiting_input')work=status('receipt-pending','リーダーの受付照合中',r.error||'','再送せず受付を照合します。秘書への追加指示は可能です。');
 else if(state(r)==='running')work=status('working','リーダーが作業中','','秘書への追加指示は可能です。');
 else work=status('pending','仕事は継続中','','応答終了は仕事完了ではありません。秘書へ残件を確認できます。');
 return {id:q.id,workId:w.id,leaderAgentId:w.assignee,leaderName:leader?.name||'担当不明',instruction:(q.instruction||'').slice(0,160),runId:r?.id,deliveryRunId:delivery?.id,humanApproval:'not-inferred',...work};
}
export function conversationSummary(data,a){
 const cs=(data.conversations||[]).filter(c=>c.agentId===a.id),ids=new Set(cs.map(c=>c.id));
 const p=data.projects.find(p=>p.id===a.projectId),leader=data.agents.find(l=>l.id===p?.leaderAgentId);
 return {leader:{agentId:leader?.id,name:leader?.name||'未設定',...runtimeGate(leader)},jobs:data.requests.filter(q=>ids.has(q.conversationId)).map(q=>conversationJob(data,q))};
}
