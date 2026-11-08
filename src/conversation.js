import {dateDividers,dayKey} from './date-divider.js';
import {responseHTML} from './response-content.js';
import {displayPreferences} from './display-preferences.js';
import {reportHTML} from './report-content.js';
import {updateReportHTML} from './report-visuals.js';
import {chatScroll} from './chat-scroll.js';
import {attachmentHTML} from './attachments.js';
import {travelSummary} from './travel-context.js';
import { isOnDesk } from './job-state.js';
import { escape } from './office.js';
import {linkedText as prose} from './linked-text.js';
let rendered,scroll;
export function conversationLatest(){scroll?.latest();}
export function renderConversation(secretary, openDocument, jobs = []) {
  const deskIds = jobs.filter(isOnDesk).map(job=>job.id);
  const messages = secretary.messages || [], signature = JSON.stringify([messages,deskIds,displayPreferences().viewer,dayKey(new Date())]);
  if (signature === rendered) return;
  rendered = signature;
  const log = document.querySelector('#conversation-log');
  scroll ||= chatScroll(log);
  const divider=dateDividers();
  const html = messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>{
    const reads = messages.filter(item=>item.role==='tool'&&item.turnId===message.turnId&&item.action==='read_document');
    const tools = messages.filter(item=>item.role==='tool'&&item.turnId===message.turnId);
    return `${divider(message.at)}<article class="chat-message chat-${message.role}" data-message="${escape(message.id)}"><div class="chat-meta"><b>${message.role==='user'?'村長':'ミク'}</b><time>${new Date(message.at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</time></div>${message.role==='assistant'?responseHTML({...message,output:message.content}):`<p>${prose(message.content)}</p>`}${travelSummary(message.travelContexts)}
    ${attachmentHTML(message.attachments)}
    ${message.role==='assistant'&&reads.length ? `<div class="chat-sources">参照した資料：${[...new Set(reads.map(item=>item.document))].map(path=>`<button data-read-document="${escape(path)}">${escape(path)}</button>`).join('')}</div>` : ''}
    ${message.role==='assistant'&&tools.some(item=>item.action==='check_workshop')?'<small class="chat-inspection">工房の状況照会を行いました（Agent起動とは別の処理）</small>':''}
    ${message.jobId && deskIds.includes(message.jobId)?`<button class="chat-report-link" data-job="${escape(message.jobId)}">対応する仕事・報告書を見る ↓</button>`:''}</article>`;
  }).join('')+divider.trailingToday();
  updateReportHTML(log,html);
  log.querySelectorAll('[data-read-document]').forEach(button=>button.addEventListener('click',()=>openDocument(button.dataset.readDocument)));
  log.querySelectorAll('[data-job]').forEach(button=>button.addEventListener('click',()=>{
    const report=document.querySelector(`[data-report="${CSS.escape(button.dataset.job)}"]`);
    (report||document.querySelector('.office-inbox')).scrollIntoView({behavior:'smooth',block:'start'});
  }));
  log.querySelectorAll('.file-previews img').forEach(img=>img.addEventListener('error',()=>{const notice=document.createElement('span');notice.className='operation-error';notice.textContent='画像を表示できません。保存画像が見つからないか、接続に失敗しました。';img.replaceWith(notice);}));
  scroll.changed();
}
