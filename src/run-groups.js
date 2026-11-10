import {escapeReport as esc} from './report-content.js';
// Every village-internal exchange (enqueue() in server/requests.mjs) creates a brand-new run
// rather than updating the human's original one in place, so "the current answer to a human"
// can legitimately live on a steering/retry/continuation/report-origin run. rootRunIds collects
// exactly those: the live head of each request's own root work (never a delegated child's work,
// which always carries a parentWorkId), so that live answer is never hidden behind a fold.
export function rootRunIds(requests){
 const ids=new Set();
 for(const q of requests||[])for(const w of q.works||[])if(!w.parentWorkId&&w.currentRunId)ids.add(w.currentRunId);
 return ids;
}
// A human only ever speaks through a direct request ('human'), the raw native/PurpleMux
// terminal (external, no managed origin at all), or legacy/未分類 runs with no origin recorded
// at all (never fold what we can't classify). Everything else — steering, delegation,
// retries/resumes, the report-only prompt, a child task's result delivery, and an independent
// new request one Agent sent another directly via the CLI/API 'requests start' path ('agent',
// as opposed to the browser's own route or the office chat relay, both still 'human') — is the
// village talking to itself, and stays folded by default, unless it is still the live head above.
export const isAlwaysVisible=(r,current)=>!!r.external||r.origin==null||r.origin==='human'||!!current?.has(r.id);
const originLabel={steering:'補足',delegation:'委任',retry:'再試行',continuation:'再開',report:'報告指示',result:'子作業結果',agent:'他Agentからの依頼'};
function groupSummary(group){
 const labels=[...new Set(group.map(r=>originLabel[r.origin]||r.origin||'内部'))];
 return `人間以外の入出力 ${group.length}件を表示（${labels.join('・')}）`;
}
// Groups a maximal run of consecutive foldable entries into one collapsed <details>, keyed by
// its first entry so the open/closed state (restored by updateReportHTML) survives later appends
// to the same group. renderEntry renders a single entry exactly as the ungrouped path would.
export function foldEntriesHTML(entries,renderEntry,current){
 let html='',i=0;
 while(i<entries.length){
  if(isAlwaysVisible(entries[i],current)){html+=renderEntry(entries[i]);i++;continue;}
  const group=[];
  while(i<entries.length&&!isAlwaysVisible(entries[i],current)){group.push(entries[i]);i++;}
  html+=`<details class="run-group" data-disclosure="${esc('group:'+group[0].id)}"><summary>${esc(groupSummary(group))}</summary>${group.map(renderEntry).join('')}</details>`;
 }
 return html;
}
