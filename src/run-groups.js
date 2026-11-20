import {escapeReport as esc} from './report-content.js';
// Only a published human report bypasses folding. Being the current root run
// does not turn an internal result delivery into a human message.
export function rootRunIds(requests){
 return new Set((requests||[]).filter(q=>q.status==='completed'&&q.finalRunId).map(q=>q.finalRunId));
}
export const isHumanInput=r=>!!r.external||r.origin==null||r.origin==='human'||!!r.inputReceipt;
export const isAlwaysVisible=(r,published)=>isHumanInput(r)||!!published?.has(r.id);
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
// One disclosure per chat; stable identity preserves each independent open state.
export function foldEntriesHTML(entries,renderEntry,published,label=entry=>originLabel[entry.origin]||'内部のやり取り'){
 return entries.map(entry=>isAlwaysVisible(entry,published)?renderEntry(entry):
  `<details class="run-group" data-disclosure="${esc('chat:'+entry.id)}"><summary>…（途中経過） ${esc(label(entry))}</summary>${renderEntry(entry)}</details>`).join('');
}
