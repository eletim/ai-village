import {escapeReport as esc} from './report-content.js';
export const isHumanInput=r=>!!r.external||r.origin==null||r.origin==='human'||!!r.inputReceipt;
const originLabel={steering:'補足の配送',delegation:'実装・作業依頼',retry:'再試行',continuation:'再開',report:'報告作成',result:'成果の受け取り・レビュー',agent:'他Agentからの依頼',inbox:'入力の配送'};
export function exchangeLabel(entry,state){
 const q=state.requests?.find(q=>q.id===entry.humanRequestId),nodes=q?.requestGraph?.nodes||[];
 const node=nodes.find(n=>n.id===entry.workId),parent=nodes.find(n=>n.id===node?.parentId);
 const name=id=>state.agents?.find(a=>a.id===id)?.name||'Agent';
 const target=name(entry.agentId);
 if(entry.origin==='delegation')return `${parent?name(parent.assignee):'依頼元Agent'} → ${target}・作業依頼`;
 if(entry.origin==='result')return `子作業の担当Agent → ${target}・成果の受け取り・レビュー`;
 if(entry.origin==='agent')return `他Agent → ${target}・作業依頼`;
 return `システム → ${target}・${originLabel[entry.origin]||'途中経過'}`;
}
// The chat shell is always visible. Only its body is a disclosure.
export function chatBodyHTML(entry,side,body,fold){
 if(!fold||!body)return body;
 return `<details class="chat-body" data-disclosure="${esc('chat:'+entry.id+':'+side)}"><summary>…（途中経過）</summary>${body}</details>`;
}
