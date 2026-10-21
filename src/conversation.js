import { isOnDesk } from './job-state.js';
import { escape } from './office.js';
// Secretary prose stays plain text; only local artifact downloads become links.
function prose(content) {
  const pattern = /\[([^\]\n]+)\]\((\/api\/jobs\/[0-9a-f-]{36}\/artifact\?path=[^\s)]+)\)/g;
  let html='', offset=0;
  for (const match of String(content).matchAll(pattern)) {
    html+=escape(content.slice(offset,match.index))+`<a href="${escape(match[2])}" download>${escape(match[1])}</a>`;
    offset=match.index+match[0].length;
  }
  return html+escape(content.slice(offset));
}
let rendered;
export function renderConversation(secretary, openDocument, jobs = []) {
  const deskIds = jobs.filter(isOnDesk).map(job=>job.id);
  const messages = secretary.messages || [], signature = JSON.stringify([messages,deskIds]);
  if (signature === rendered) return;
  rendered = signature;
  const log = document.querySelector('#conversation-log');
  const previousScroll = log.scrollTop;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.innerHTML = messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>{
    const reads = messages.filter(item=>item.role==='tool'&&item.turnId===message.turnId&&item.action==='read_document');
    const tools = messages.filter(item=>item.role==='tool'&&item.turnId===message.turnId);
    return `<article class="chat-message chat-${message.role}" data-message="${escape(message.id)}"><div class="chat-meta"><b>${message.role==='user'?'村長':'ミク'}</b><time>${new Date(message.at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</time></div><p>${prose(message.content)}</p>
    ${message.role==='assistant'&&reads.length ? `<div class="chat-sources">参照した資料：${[...new Set(reads.map(item=>item.document))].map(path=>`<button data-read-document="${escape(path)}">${escape(path)}</button>`).join('')}</div>` : ''}
    ${message.role==='assistant'&&tools.some(item=>item.action==='check_workshop')?'<small class="chat-inspection">工房の状況照会を行いました（Agent起動とは別の処理）</small>':''}
    ${message.jobId && deskIds.includes(message.jobId)?`<button class="chat-report-link" data-job="${escape(message.jobId)}">対応する仕事・報告書を見る ↓</button>`:''}</article>`;
  }).join('');
  log.querySelectorAll('[data-read-document]').forEach(button=>button.addEventListener('click',()=>openDocument(button.dataset.readDocument)));
  log.querySelectorAll('[data-job]').forEach(button=>button.addEventListener('click',()=>{
    const report=document.querySelector(`[data-report="${CSS.escape(button.dataset.job)}"]`);
    (report||document.querySelector('.office-inbox')).scrollIntoView({behavior:'smooth',block:'start'});
  }));
  if (nearBottom) log.scrollTop=log.scrollHeight;
  else log.scrollTop=previousScroll;
}
