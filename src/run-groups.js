import {requestProgress} from './request-progress.js';
import {escapeReport as esc} from './report-content.js';
// The stable identity a chat entry is addressed by (data-entry, entry-body requests).
export const entryIdentity=r=>JSON.stringify([r.external?'native':'run',r.external?(r.sessionId||r.agentSessionId||''):'',r.id]);
export const isHumanInput=r=>!!r.external||r.origin==null||r.origin==='human'||!!r.inputReceipt&&!['program','agent'].includes(r.inputSource?.actor);
const originLabel={steering:'補足の配送',delegation:'実装・作業依頼',retry:'再試行',continuation:'再開',report:'報告作成',result:'成果の受け取り・レビュー',agent:'他Agentからの依頼',inbox:'入力の配送'};
export function exchangeLabel(entry,state){
 const q=state.requests?.find(q=>q.id===entry.humanRequestId),nodes=q?.requestGraph?.nodes||[];
 const node=nodes.find(n=>n.id===entry.workId),parent=nodes.find(n=>n.id===node?.parentId);
 const name=id=>state.agents?.find(a=>a.id===id)?.name||'Agent';
 const progress=entry.requestProgress||requestProgress(q,entry.workId,state.agents);
 const suffix=progress&&['差し戻し・再依頼済み','差し戻し','承認済み','取り下げ','成果提出済み'].includes(progress.label)?' · '+progress.label+(progress.waiting?' · '+progress.waiting:''):'';
 if(entry.origin==='delegation')return '作業依頼（'+(parent?name(parent.assignee):'依頼元Agent')+'から）'+suffix;
 if(entry.origin==='result')return '成果の受け取り・レビュー';
 if(entry.origin==='agent')return '他Agentからの作業依頼';
 return originLabel[entry.origin]||'途中経過';
}
// The chat shell is always visible. Only its body is a disclosure.
export function chatBodyHTML(entry,side,body,fold,label='途中経過'){
 if(!fold)return body;
 if(!body)return `<span class="chat-placeholder">…（${esc(label)}）</span>`;
 return `<details class="chat-body" data-disclosure="${esc('chat:'+entry.id+':'+side)}"><summary>…（${esc(label)}）</summary>${body}</details>`;
}

// Input provenance does not decide whether a secretary's completed reply is public.
export const isVisibleAnswer=r=>!r.hiddenCompletion&&!r.collapsedHistory&&(r.conversationId?r.conversationAnswer===true&&r.displayMode!=='progress':isHumanInput(r)&&!!(r.finalOutput||(r.origin==null&&r.state==='completed')));
