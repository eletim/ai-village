import {reportHTML,escapeReport} from './report-content.js';
// Only a recorded final answer identifies the final section. Legacy text stays intact.
export function responseHTML(entry){
 const output=entry.output||'',final=entry.finalOutput||'';
 let progress=output;
 if(final&&output.trimEnd().endsWith(final.trimEnd()))progress=output.trimEnd().slice(0,-final.trimEnd().length).trimEnd();
 const section=(label,text,kind)=>text?'<section class="response-section response-'+kind+'"><h3>'+label+'</h3>'+reportHTML(text)+'</section>':'';
 const body=final?section('途中報告',progress,'progress')+section('最終報告',final,'final'):section(entry.state==='running'||entry.state==='busy'?'途中報告':'応答',output,'progress');
 return entry.collapsedHistory?'<details class="response-history" data-disclosure="'+escapeReport(entry.id)+'"><summary>経過を見る（途中報告・元の最終回答）</summary>'+body+'</details>':body;
}
