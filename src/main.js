import { initOfficePanels, selectOfficePanel } from './office-panels.js';
import { refreshMemo } from './memo.js';
import { initTheme } from './theme.js';
import { initTodos } from './todos.js';
import { updateUnread } from './unread.js';
import { attachmentComposer } from './attachments.js';
import { isOnDesk } from './job-state.js';
import { data, people, parcel, connectScene, syncScene, setSceneStatus, setPersonActivity, animateVillagers } from './scene.js';
import { renderConversation } from './conversation.js';
import { openLibrary, openDocument } from './library.js';
import { renderOffice, resetOfficeRender } from './office.js';
import { PHASE_LABELS } from './live.js';

import { placedAgents, agentState, workshopAgents } from './village-state.js';

const $ = (s) => document.querySelector(s);
const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let live = { job: null }, online = false, lastPhase, submitting = false;
function currentJob() { return live.job && isOnDesk(live.job) ? live.job : (live.jobs || []).find(isOnDesk) || null; }
const agents=()=>placedAgents(live);
const shops=()=>live.workshops || [];
let selected = null, focusBeforeDialog;
let history = [];

function addEvent(message) {
  history.unshift({ message, at: new Date() }); history = history.slice(0, 5);
  $('#feed').replaceChildren(...history.map((event,i) => {
    const row = document.createElement('div'); row.className = 'feed';
    const mark = document.createElement('i'); const copy = document.createElement('div');
    copy.textContent = event.message; copy.append(document.createElement('br'));
    const time = document.createElement('small'); time.textContent = i === 0 ? 'たった今' : event.at.toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'});
    copy.append(time); row.append(mark,copy); return row;
  }));
}
function renderPositions() {
  syncScene(shops(),agents());
  agents().forEach(job=>{
    const state=agentState(job,online);
    setPersonActivity(job.id,state.active,state.label,'レン');
  });
  setPersonActivity('miku',online&&live.secretary?.status==='thinking',!online?'接続未確認':live.secretary?.status==='thinking'?'応答中':'待機中','ミク');
  parcel.style.opacity='0';
}
function shopState(index) {
  if(index===0)return {label:'執務室',task:'秘書と相談し、報告を確認する場所',tone:'green'};
  const jobs=workshopAgents(data[index],agents());
  const disconnected=jobs.some(job=>job.connectionError);
  return {label:!online?'接続未確認':disconnected?'接続不能':jobs.length?jobs.map(job=>agentState(job,online).label).join('・'):'Agent未配置',task:jobs.map(job=>job.request).join(' / ') || '登録済み · 接続状態は未確認です',tone:disconnected?'amber':'green'};
}
function renderShops() {
  $('#works').replaceChildren(...data.slice(1).map((d,i)=>{
    const index=i+1,state=shopState(index),jobs=workshopAgents(d,agents());
    const button=document.createElement('button');button.className='work';button.dataset.shop=index;
    button.innerHTML=`<div class="row"><b>${escape(d.name)}</b><span class="tag ${state.tone}">${escape(state.label)}</span></div><p>${escape(state.task)}</p><div class="residents">配置 ${jobs.length}人 · 作業中 ${jobs.filter(j=>agentState(j,online).active).length}人</div>`;
    button.addEventListener('click',()=>showShop(index));return button;
  }));
  data.forEach((d,i)=>{setSceneStatus(i,shopState(i).label);const smoke=document.querySelectorAll('.building')[i].querySelector('.smoke');if(smoke)smoke.style.display=workshopAgents(d,agents()).some(j=>agentState(j,online).active)?'':'none';});
  $('#workshop-count').textContent=`${shops().length} 登録工房`;
  $('#legend').textContent=`常駐秘書 1人 · 工房配置Agent ${agents().length}人 · 作業中 ${agents().filter(j=>agentState(j,online).active).length}人`;
}
function openDetail() {
  if(!selected)focusBeforeDialog=document.activeElement;
  $('#detail').hidden=false;
  document.querySelectorAll('.building').forEach(g=>g.classList.remove('selected'));
}
function closeDetail(){ $('#detail').hidden=true;selected=null;document.querySelectorAll('.building').forEach(g=>g.classList.remove('selected'));focusBeforeDialog?.focus?.(); }
function detailShell(content){$('#detail').innerHTML=`<button class="close" aria-label="詳細を閉じる">×</button>${content}`;$('#detail .close').addEventListener('click',closeDetail);}
function showShop(index,refresh=false) {
  if(index===0){ navigate('/office'); return; }
  const d=data[index];if(!d){closeDetail();return;}
  if(!refresh)openDetail();selected={type:'shop',index};
  document.querySelectorAll('.building')[index].classList.add('selected');
  const state=shopState(index),jobs=workshopAgents(d,agents());
  detailShell(`<div class="eyebrow">REGISTERED WORKSHOP</div><h3>${escape(d.name)}</h3><p>${escape(d.desc)}</p><div class="detail-status"><span class="tag">${escape(state.label)}</span><p>${escape(state.task)}</p></div><p>配置Agent ${jobs.length}人</p><div class="detail-people">${jobs.map(j=>`<button data-person="${escape(j.id)}">レン · ${escape(agentState(j,online).label)}</button>`).join('')}</div>`);
  $('#detail').querySelectorAll('[data-person]').forEach(b=>b.addEventListener('click',()=>showPerson(b.dataset.person)));
}
function showPerson(id) {
  if(id==='miku'){navigate('/office');return;}
  const job=agents().find(j=>j.id===id);if(!job){closeDetail();return;}
  openDetail();selected={type:'person',name:id};const state=agentState(job,online);
  detailShell(`<div class="eyebrow">ASSIGNED AGENT</div><h3>レン</h3><p>${escape(job.workshopName || '配置中のAgent')}</p><div class="detail-status"><span class="tag">${escape(state.label)}</span><p>${escape(state.reason)}</p></div>${job.terminalUrl?`<a class="terminal-link" target="_blank" rel="noopener noreferrer" href="${escape(job.terminalUrl)}">PurpleMuxで実際の端末を開く ↗</a><p>未ログインの場合は、ログインしてからこのリンクを開き直してください。</p>`:''}`);
}
connectScene(showShop,showPerson);
function renderStage() {
  renderPositions();
  const job=currentJob(), phase=job?.phase || 'idle';
  const reviewLabels={held:'報告が届きました · 村長の確認待ち',releasing:'OK済み · Agentを解放中',failed:'OK済み · Agent解放の再試行が必要です',released:'報告はOK済み · Agent解放済み'};
  const phaseLabel=phase==='awaiting_review'?reviewLabels[job.releaseState || 'held']:PHASE_LABELS[phase];
  $('#status').textContent = !online ? 'コアPCへ接続できません' : live.secretary?.status==='thinking' ? 'ミクが考えています…' : '相談も、質問も、いつでもどうぞ';
  $('#chapter-text').textContent = online ? phaseLabel : '接続を確認してください';
  $('#speech').hidden = !!live.secretary?.messages?.some(message=>message.role==='user'||message.role==='assistant');
  $('#speech').textContent = !online ? 'コアPCとの接続を確認してください。会話と資料は保存されています。' : '村長、おかえりなさい。相談や質問から始めましょう。仕事を進めると決まったら、工房へ伝えます。';
  $('#send').disabled = submitting || !online || live.secretary?.status==='thinking';
  $('#send').textContent = live.secretary?.status==='thinking' ? 'ミクが考えています…' : 'ミクに話す ↗';
  renderConversation(live.secretary || {messages:[]}, openDocument, live.jobs || []);
  if(online)updateUnread(live.secretary?.messages || []);
  $('#room-secretary small').textContent=`ミク ／ ${!online?'接続未確認':live.secretary?.status==='thinking'?'応答中':'待機中'}`;
  const current = ({idle:0,planning:0,connecting:1,working:2,reporting:3,awaiting_review:4,completed:4,error:0})[phase];
  $('#journey').innerHTML = ['相談','工房へ接続','ものづくり','秘書が報告作成','報告の確認'].map((s,i)=>`<span class="${i===current?'current':i<current?'done':''}"><i>${i<current?'✓':i+1}</i>${s}</span>`).join('<b>·</b>');
  renderShops();
  renderOffice(live, { approve: approveJob, discover: discoverArtifacts, cancel: cancelJob });
  if(selected?.type==='shop')showShop(selected.index,true);
  else if(selected?.type==='person')showPerson(selected.name);
}
async function poll() {
  try {
    const response=await fetch('/api/state', { signal: AbortSignal.timeout(10000) });
    if(!response.ok) throw new Error('接続失敗');
    live=await response.json(); online=true;await refreshMemo();
    const job=currentJob(), phase=job?.phase || 'idle', key=`${job?.id}:${phase}`;
    if(key!==lastPhase) { addEvent(PHASE_LABELS[phase]); lastPhase=key; }
  } catch { online=false; }
  renderStage();
  setTimeout(poll,1500);
}
const attachments = attachmentComposer();
$('#request-form').addEventListener('submit',async e=>{
  e.preventDefault();const request=$('#request').value.trim();if(!request && !attachments.count){$('#request').focus();return}
  if(submitting || live.secretary?.status==='thinking')return; submitting=true; $('#send').disabled=true; attachments.lock(true); $('#request').disabled=true;
  try {
    const ids=await attachments.upload();
    const response=await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:request,attachments:ids})});
    const body=await response.json(); if(!response.ok)throw new Error(body.error);
    live=body; online=true; attachments.clear(); $('#office-notice').textContent=''; $('#request').value=''; $('#char-count').textContent='0 / 2000';
  } catch(error) { addEvent(error.message); $('#office-notice').textContent=error.message; }
  submitting=false; attachments.lock(false); $('#request').disabled=false; renderStage();
});
$('#request').addEventListener('input',()=>$('#char-count').textContent=`${$('#request').value.length} / 2000`);
$('#request').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))$('#request-form').requestSubmit()});
$('#home').addEventListener('click',closeDetail);
$('#mayor').addEventListener('click',()=>navigate('/office'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetail()});
function frame(time) {
  renderPositions();
  animateVillagers(time);
  requestAnimationFrame(frame);
}
// A real path with history support: the server also serves /office directly.
const secretary = document.querySelector('.secretary');
$('#office-secretary').append(secretary);
const invitation=document.createElement('div'); invitation.className='village-invitation';
invitation.innerHTML='<p>仕事の相談と報告の確認は、村長の家の執務室で。</p><a href="/office" data-nav>執務室へ入る ↗</a>';
$('.side .section-title').after(invitation);
function navigate(path, push=true) {
  if(push && location.pathname!==path)historyPush(path);
  const office=path.startsWith('/office');
  document.body.classList.toggle('in-office',office);
  $('#office-page').hidden=!office; $('#village-page').hidden=office;
  document.title=office?'村長の執務室 — AI村':'AI村 — ものづくりのある風景';
  if(office)closeDetail();
  window.scrollTo(0,0);
}
function historyPush(path){window.history.pushState({},'',path);}
document.addEventListener('click',e=>{const link=e.target.closest('a[data-nav]');if(link && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button===0){e.preventDefault();navigate(link.getAttribute('href'));}});
window.addEventListener('popstate',()=>navigate(location.pathname,false));
$('#room-library').addEventListener('click',openLibrary);
$('#open-documents').addEventListener('click',openLibrary);
$('#open-conversation').addEventListener('click',()=>selectOfficePanel('conversation'));
$('#open-reports').addEventListener('click',()=>selectOfficePanel('reports'));
$('#room-secretary').addEventListener('click',()=>selectOfficePanel('conversation'));
$('#desk-reports').addEventListener('click',()=>selectOfficePanel('reports'));
async function officeAction(url, method='POST') {
  try {
    const response=await fetch(url,{method}); const body=await response.json();
    if(!response.ok)throw new Error(body.error);live=body;online=true;
    $('#report-notice').textContent='';
  } catch(error) { $('#report-notice').textContent=error.message; $('.office-inbox').scrollTop=0; }
  resetOfficeRender();renderStage();
}
function cancelJob(id){return officeAction(`/api/jobs/${encodeURIComponent(id)}/cancel`);}
function approveJob(id){return officeAction(`/api/jobs/${encodeURIComponent(id)}/approve`);}
function discoverArtifacts(id){return officeAction(`/api/jobs/${encodeURIComponent(id)}/artifacts`,'GET');}
initOfficePanels();initTheme();initTodos();navigate(location.pathname,false);renderStage(); poll(); requestAnimationFrame(frame);
