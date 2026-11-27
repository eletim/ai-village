import {escapeReport as esc} from './report-content.js';
const labels={evaluating:'秘書が確認中','human-question':'回答が必要',working:'担当が入力を受付済み',pending:'作業中',queued:'受付済み・開始待ち',blocked:'停止中',attention:'停止中',question:'確認中',completed:'完了','human-closed':'終了',returning:'作業完了・回答準備中','delivery-failed':'作業完了・回答を確認できません','receipt-pending':'受付を確認中',withdrawn:'取り下げ済み',unknown:'状態を確認できません','legacy-unrecorded':'作業完了・判断記録なし（旧形式）',quarantined:'依頼記録を隔離中'};
export function recoveryExplanationHTML(e){
 if(!e)return '';
 return '<div class="recovery-explanation" role="status"><p>確認済み: '+esc(e.known)+'</p>'+ (e.unresolved?'<p>未確認・必要な確認: '+esc(e.unresolved)+'</p>':'')+(e.cause?'<p>原因: '+esc(e.cause)+'</p>':'')+(e.unknown?.length?'<p>'+e.unknown.map(esc).join(' ')+'</p>':'')+'<p>継続: '+(e.available?'境界確認済み。未完了分の判断後に継続できます':'この表示だけでは新しい実行を開始しません')+'</p>'+(e.next?'<p>次の操作: '+esc(e.next.instruction)+'</p>':'')+'</div>';
}
function jobHTML(j,details=false){
 const stopped=['blocked','attention','delivery-failed','unknown','quarantined'].includes(j.code);
 return '<div class="answer-job" data-answer-job="'+esc(j.id)+'"><strong>'+esc(j.code==='evaluating'?j.label:labels[j.code]||j.label)+'</strong>'+(details?'<span class="answer-job-title">'+esc(j.instruction)+'</span>':'')+(j.assigneeName||j.leaderName?'<span class="answer-job-assignee">担当: '+esc(j.assigneeName||j.leaderName)+'</span>':'')+
 (j.questionText?'<p class="answer-question"><strong>確認事項</strong><br>'+esc(j.questionText)+'</p>':'')+
 (j.explanation?recoveryExplanationHTML(j.explanation):(stopped?'<p>'+esc(j.reason||j.label)+'</p><p>'+esc(j.next)+'</p>':''))+'</div>';
}
export function answerJobsHTML(r){
 const jobs=(r.answerJobs||[]).filter(j=>!['completed','human-closed','withdrawn','legacy-unrecorded'].includes(j.code));
 return jobs.length?'<section class="answer-jobs" aria-label="この回答に関係する依頼">'+jobs.map(j=>jobHTML(j)).join('')+'</section>':'';
}
export function conversationWorkHTML(a){
 const summary=a.conversationWork;if(!summary)return '';
 const {leader,jobs}=summary;
 const blocked=leader.code!=='ready';
 const ownBlocked=a.conversationControl&&!a.conversationControl.canAccept;
 if(!blocked&&!jobs.length&&!ownBlocked)return '';
 return '<section class="conversation-work" aria-label="依頼一覧"><p>既定の依頼先: '+esc(leader.name)+'</p>'+
 (ownBlocked?'<p role="status">'+esc(a.conversationControl.next)+'</p>':'')+
 (blocked?'<p role="status">既定のリーダー（'+esc(leader.name)+'）: '+esc(leader.label)+'。'+esc(leader.next)+'</p>':'')+
 (jobs.length?'<details data-disclosure="conversation-work:'+esc(a.id)+'"><summary>依頼一覧 '+jobs.length+'件</summary>'+jobs.map(j=>jobHTML(j,true)).join('')+'</details>':'')+'</section>';
}

// Main chat only needs a genuine inability to converse. Management stays in profile.
export function conversationAlertHTML(a){
 const c=a.conversationControl;
 return c&&(!c.canAccept||c.code==='unknown')?'<p class="conversation-alert" role="status">'+esc(c.label)+'</p>':'';
}
// Quiet note on an answer whose phone notification did not go out. Never offers a resend.
const failedNotification=new Set(['cli_failed','timed_out','cli_unavailable','cli_start_failed','office_url_missing_or_invalid','notification_journal_unavailable','notification_journal_failed']);
export function notificationNoteHTML(r){
 const s=r.notification?.status;
 if(failedNotification.has(s))return '<p class="run-status notification-note">通知を送れませんでした（自動再送しません）</p>';
 if(s==='delivery_unknown')return '<p class="run-status notification-note">通知の送信結果を確認できません（自動再送しません）</p>';
 return '';
}
export function conversationTurnHTML(r){
 const c=r.conversationLifecycle;
 const error=r.attachmentError||r.error||r.errorCode||c?.reason;
 if(!c||c.code==='answered'&&!error)return notificationNoteHTML(r);
 const failed=!!error||['failed','interrupted','unconfirmed'].includes(c.code);
 const label=({steered:c.label,'steering-accepted':c.label,queued:'送信待ち','receipt-pending':'送信を確認中',responding:'応答中',cancelled:'送信取消済み',failed:'返答に失敗しました',interrupted:'返答が中断されました',unconfirmed:'送信結果を確認できません'})[c.code]||(error?'処理中にエラーが発生しました':c.label);
 return '<p class="run-status">'+esc(label)+'</p>'+recoveryExplanationHTML(c.explanation)+(failed&&error?'<details class="conversation-error"><summary>エラー詳細</summary><p>'+esc(error)+'</p></details>':'');
}

// Keep current status beside only the latest related answer; never infer a link from text.
export function latestAnswerStatuses(entries){
 const last=new Map();
 for(const r of entries)for(const j of r.answerJobs||[])last.set(j.purposeId||j.id,r.id);
 return entries.map(r=>({...r,answerJobs:(r.answerJobs||[]).filter(j=>last.get(j.purposeId||j.id)===r.id)}));
}
