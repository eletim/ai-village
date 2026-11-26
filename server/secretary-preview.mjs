// Display-only messages: native correlation still owns acceptance/completion.
export function previewMessages(turn,start,end=Infinity){
 if(turn?.messageOffsets!==true||!Number.isFinite(start))return [];
 const messages=(turn.messages||[]).filter(m=>m.offset>start&&m.offset<end&&['commentary','final'].includes(m.phase)&&typeof m.text==='string'&&m.text&&typeof m.id==='string');
 // A provider may repeat/update an item; different IDs with identical prose remain distinct.
 return [...new Map(messages.map(m=>[m.id,m])).values()].sort((a,b)=>a.offset-b.offset).map(({id,offset,phase,text})=>({id,offset,phase,text}));
}
export function secretaryPreview(a,r){
 if(a.location!=='mayor'||!r.conversationId||!r.turnId||!r.sessionId||r.conversationAnswer||!['running','failed','interrupted','superseded','terminated'].includes(r.state))return null;
 const p=r.livePreview;
 if(!p||p.runId!==r.id||p.sessionId!==r.sessionId||p.turnId!==r.turnId)return null;
 return p;
}
