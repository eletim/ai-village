import {reportHTML,escapeReport} from './report-content.js';
import {responseText} from './response-text.js';
// The native record is retained. Only an exact final suffix identifies commentary.
export function responseHTML(entry,{finalLabel='回答'}={}){
 const {answer,record,recordLabel}=responseText(entry);
 const section=(label,text,kind)=>text?'<section class="response-section response-'+kind+'"><h3>'+escapeReport(label)+'</h3>'+reportHTML(text)+'</section>':'';
 const progress=record?'<details class="response-progress" data-disclosure="'+escapeReport('response:'+entry.id+':progress')+'"><summary>'+escapeReport(recordLabel)+'</summary>'+reportHTML(record)+'</details>':'';
 const body=progress+section(entry.finalOutput?.trim()?finalLabel:entry.state==='running'||entry.state==='busy'?'途中報告':'応答',answer,entry.finalOutput?.trim()?'final':'legacy');
 return entry.collapsedHistory?'<details class="response-history" data-disclosure="'+escapeReport(entry.id)+'"><summary>経過を見る（途中報告・元の最終回答）</summary>'+body+'</details>':body;
}
