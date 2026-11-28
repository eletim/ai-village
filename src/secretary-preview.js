// Preview identity is independent of completion/read/notification bookkeeping.
export function visiblePreview(agent,entry,selected){
 const p=entry.preview;
 if(agent.location!=='mayor'||agent.id!==selected||!entry.conversationId||entry.conversationAnswer||entry.state==='completed'||!p||p.runId!==entry.id||p.sessionId!==entry.sessionId||p.turnId!==entry.turnId)return null;
 const messages=(p.messages||[]).filter(m=>typeof m.id==='string'&&Number.isFinite(m.offset)&&['commentary','final'].includes(m.phase)&&typeof m.text==='string');
 return messages.length?{messages,label:entry.state==='superseded'&&entry.runModel?.state.kind==='ended'&&entry.runModel.state.outcome==='normal'?'追加入力へ継続':['failed','interrupted','superseded','terminated'].includes(entry.state)?'途中で終了・未確定':'応答中・未確定'}:null;
}
