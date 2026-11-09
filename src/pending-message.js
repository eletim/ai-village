// Local delivery state is separate from the server receipt and never implies native acceptance.
export function restorePendingMessage(message){
 if(['preparing','uploading'].includes(message.stage))return {...message,stage:'failed',error:'送信前に画面が閉じられました。下書きから再送できます。'};
 if(['posting','syncing'].includes(message.stage))return {...message,stage:'unknown'};
 return message;
}
export function matchingRun(state,agentId,requestId){
 return [...(state.runs||[]),...(state.conversations?.[agentId]?.entries||[])].find(r=>r.agentId===agentId&&r.requestId===requestId);
}
export function unchangedDraft(message,value,version){return message.instruction===value&&message.draftVersion===version;}
export function pendingMessageStatus(message){
 const prefix=message.mode==='steering'?'補足 · ':message.mode==='queue'?'待機キューへの送信 · ':'';
 return prefix+({preparing:'送信を準備中…',uploading:'添付を準備・アップロード中…',posting:'サーバーへ送信中…',syncing:'履歴を照合中…',unknown:'送信結果不明（自動再送しません）',failed:'未送信 · '+(message.error||'送信に失敗しました。下書きから再送できます。')}[message.stage]||'送信結果を確認中');
}
