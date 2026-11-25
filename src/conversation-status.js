import {escapeReport as esc} from './report-content.js';
export function conversationWorkHTML(a){
 const summary=a.conversationWork;if(!summary)return '';
 const {leader,jobs}=summary;
 const blocked=leader.code!=='ready';
 const rows=jobs.map(j=>'<li data-conversation-job="'+esc(j.id)+'"><strong>'+esc(j.label)+'</strong> · '+esc(j.leaderName)+'<p>'+esc(j.instruction)+'</p>'+(j.reason?'<p>'+esc(j.reason)+'</p>':'')+'<p>'+esc(j.next)+'</p></li>').join('');
 return '<section class="conversation-work" aria-label="会話と仕事の状況"><p>'+esc(a.conversationControl?.next||'')+'</p>'+
 (blocked?'<p role="status">仕事のリーダー（'+esc(leader.name)+'）: '+esc(leader.label)+'。'+esc(leader.next)+' 秘書との会話とは別の状態です。</p>':'')+
 (jobs.length?'<details data-disclosure="conversation-work:'+esc(a.id)+'"><summary>仕事の状況 '+jobs.length+'件 · '+esc(jobs.at(-1).label)+'</summary><ul>'+rows+'</ul></details>':'<p>この秘書会話から依頼した仕事はありません。</p>')+'</section>';
}
