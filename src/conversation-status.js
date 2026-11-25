import {escapeReport as esc} from './report-content.js';
const labels={working:'作業中',pending:'作業中',queued:'受付済み・開始待ち',blocked:'停止中',attention:'停止中',question:'確認中',completed:'完了','human-closed':'終了',returning:'作業完了・回答準備中','delivery-failed':'作業完了・回答を確認できません','receipt-pending':'受付を確認中',withdrawn:'取り下げ済み',unknown:'状態を確認できません'};
function jobHTML(j){
 const stopped=['blocked','attention','delivery-failed','unknown'].includes(j.code);
 return '<div class="answer-job" data-answer-job="'+esc(j.id)+'"><strong>'+esc(labels[j.code]||j.label)+'</strong><span class="answer-job-title">'+esc(j.instruction)+'</span>'+
 (j.questionText?'<p class="answer-question"><strong>確認事項</strong><br>'+esc(j.questionText)+'</p>':'')+
 (stopped?'<p>'+esc(j.reason||j.label)+'</p><p>'+esc(j.next)+'</p>':'')+'</div>';
}
export function answerJobsHTML(r){
 return (r.answerJobs||[]).length?'<section class="answer-jobs" aria-label="この回答に関係する依頼">'+r.answerJobs.map(jobHTML).join('')+'</section>':'';
}
export function conversationWorkHTML(a){
 const summary=a.conversationWork;if(!summary)return '';
 const {leader,jobs}=summary;
 const blocked=leader.code!=='ready';
 const ownBlocked=a.conversationControl&&!a.conversationControl.canAccept;
 if(!blocked&&!jobs.length&&!ownBlocked)return '';
 return '<section class="conversation-work" aria-label="依頼一覧">'+
 (ownBlocked?'<p role="status">'+esc(a.conversationControl.next)+'</p>':'')+
 (blocked?'<p role="status">仕事のリーダー（'+esc(leader.name)+'）: '+esc(leader.label)+'。'+esc(leader.next)+'</p>':'')+
 (jobs.length?'<details data-disclosure="conversation-work:'+esc(a.id)+'"><summary>依頼一覧 '+jobs.length+'件</summary>'+jobs.map(jobHTML).join('')+'</details>':'')+'</section>';
}
