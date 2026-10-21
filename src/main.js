import { isOnDesk } from './job-state.js';
import { data, people, parcel, connectScene, positionPerson, setSceneStatus, setPersonActivity, animateVillagers } from './scene.js';
import { renderConversation } from './conversation.js';
import { openLibrary, openDocument } from './library.js';
import { renderOffice, resetOfficeRender } from './office.js';
import { BUSY_PHASES, PHASE_LABELS, personActivity } from './live.js';

const $ = (s) => document.querySelector(s);
const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const residents = {
  ミク: { role:'秘書', shop:0, color:'#c49671', about:'村長のアイデアを聞き、工房に伝える。できあがったものを確かめて、わかりやすい言葉で届けます。' },
  ハル: { role:'動作を確かめる人', shop:0, color:'#8da6a0', about:'村長の家に届いたものを実際に触って、使い心地を確かめています。' },
  レン: { role:'第一工房の中心', shop:1, color:'#7c96ac', about:'仲間と相談しながら、依頼を動くかたちにしていきます。' },
  ソラ: { role:'設計を考える人', shop:1, color:'#b3a078', about:'レンと一緒に、つくりたいものの仕組みを考えています。' },
  ユイ: { role:'見た目をつくる人', shop:1, color:'#c6968f', about:'画面の色やかたち、触れたときの気持ちよさを整えています。' },
  カイ: { role:'第二工房の中心', shop:2, color:'#849f7c', about:'サービスの機能を組み立て、ナギと一緒に仕上げています。' },
  ナギ: { role:'動作を確かめる人', shop:2, color:'#a395b7', about:'工房でできたものを、いろいろな使い方で試しています。' },
  リツ: { role:'第三工房の中心', shop:3, color:'#c1a66a', about:'新しいアイデアを小さな試作品にするのが得意です。' },
  トワ: { role:'次の仕事を待つ人', shop:null, color:'#9aa87c', about:'広場を散歩しています。次にどんな仕事が来るか、楽しみにしているようです。' },
};
let live = { job: null }, online = false, lastPhase, submitting = false;
function currentJob() { return live.job && isOnDesk(live.job) ? live.job : (live.jobs || []).find(isOnDesk) || null; }
function assigned() { const job=currentJob();return !!job?.tabId && job.releaseState !== 'released'; }
function activity(name) {
  if(name==='ミク' && online && live.secretary?.status==='thinking')return {active:true,reason:'村長と話し、資料や状況を調べています'};
  return personActivity(name, currentJob(), online);
}
const positions = {ミク:[540,372],ハル:[590,352],レン:[245,556],ソラ:[300,573],ユイ:[333,536],カイ:[778,576],ナギ:[836,553],リツ:[820,296],トワ:[435,679]};
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
  Object.entries(positions).forEach(([name,[x,y]]) => {
    positionPerson(name,x,y,false);
    people[name].classList.toggle('at-work', activity(name).active);
    if(name==='レン')people[name].style.display=assigned() ? '' : 'none';
  });
  parcel.style.opacity = '0';
}
function shopState(index) {
  const job = currentJob(), phase = job?.phase || 'idle';
  if(index === 0) return { label: online ? ({idle:'依頼待ち',planning:'指示を作成中',connecting:'工房へ接続中',working:'工房で作業中',reporting:'報告を作成中',awaiting_review:'報告の確認待ち',completed:'報告が届きました',error:'確認が必要です',cancelling:'停止・解放の確認中'})[phase] : '接続確認中', task: job?.request || '秘書Codexが依頼を受け付けます', tone:'green' };
  if(index === 1) return { label: !assigned() ? 'Agent未配置' : activity('レン').active ? '制作中' : job?.phase==='awaiting_review' ? '確認待ち' : '待機中', task: job?.request || '秘書が資料を読み、合意した仕事に人員を配置します', tone:activity('レン').active ? 'green' : 'amber' };
  return { label:'未接続', task:'この工房はまだ接続していません', tone:'amber' };
}
function renderShops() {
  $('#works').replaceChildren(...data.slice(1).map((d,i)=>{
    const index=i+1,state=shopState(index),names=Object.keys(residents).filter(n=>residents[n].shop===index && (index===0 ? n==='ミク' : n==='レン' && assigned()));
    const working = names.filter(n=>activity(n).active).length;
    const button=document.createElement('button');button.className='work';button.dataset.shop=index;
    button.innerHTML=`<div class="row"><b><span class="shop-icon shop-${index}">${['','✂','⚒','✦'][index]}</span>${d.name}</b><span class="tag ${state.tone}">${state.label}</span></div><p>${escape(state.task)}</p><div class="residents">${names.map(n=>`<span class="resident-dot ${activity(n).active?'resident-working':'resident-idle'}" style="--resident:${residents[n].color}" title="${n}：${activity(n).active?'作業中':'待機中'}">${n.slice(0,1)}</span>`).join('')}<span>作業中 ${working}人 · 待機中 ${names.length-working}人</span><span class="work-arrow">↗</span></div>`;
    button.addEventListener('click',()=>showShop(index));return button;
  }));
  data.forEach((d,i)=>setSceneStatus(i,`${i===0?'⌂':i===3?'✦':'●'} ${shopState(i).label}`));
  const activeCount=['ミク','レン'].filter(n=>activity(n).active).length;
  $('#legend').innerHTML=`<span><i class="dot"></i>作業中 ${activeCount}人</span><span><i class="dot idle-dot"></i>待機中 ${(assigned()?2:1)-activeCount}人</span>`;
  Object.keys(residents).forEach(n=>setPersonActivity(n,activity(n).active));
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
  if(!refresh)openDetail();selected={type:'shop',index};
  document.querySelectorAll('.building')[index].classList.add('selected');
  const d=data[index],state=shopState(index),names=Object.keys(residents).filter(n=>residents[n].shop===index && (index===0 ? n==='ミク' : n==='レン' && assigned()));
  detailShell(`<div class="eyebrow">${d.pc}</div><h3>${d.name}</h3><p class="detail-description">${d.desc}</p><div class="interior" aria-label="${d.name}の中の様子"><div class="room-window"></div><div class="room-rug"></div>${names.map((n,i)=>`<button class="room-person ${activity(n).active?'room-working':'room-idle'}" data-person="${n}" style="--resident:${residents[n].color};--slot:${i}"><span class="tiny-head"></span><span class="tiny-body"></span><span class="room-hammer" aria-hidden="true"></span><span class="room-anvil" aria-hidden="true"></span><small>${n}<em>${activity(n).active?'作業中':'待機中'}</em></small></button>`).join('')}<div class="room-table"><span>▤</span><span>⌨</span></div></div><div class="detail-status"><span class="tag ${state.tone}">${state.label}</span><p>${escape(state.task)}</p></div><div class="detail-people">${names.map(n=>`<button data-person="${n}"><span class="resident-dot" style="--resident:${residents[n].color}">${n[0]}</span><span><b>${n}</b><small>${residents[n].role} · ${activity(n).active?'作業中':'待機中'}</small></span><span class="work-arrow">›</span></button>`).join('')}</div>`);
  $('#detail').querySelectorAll('[data-person]').forEach(b=>b.addEventListener('click',()=>showPerson(b.dataset.person)));
}
function showPerson(name) {
  openDetail();selected={type:'person',name};const r=residents[name];
  detailShell(`<div class="eyebrow">VILLAGER PROFILE</div><div class="profile"><div class="profile-character" style="--resident:${r.color}"><span class="tiny-head"></span><span class="tiny-body"></span></div><div><h3>${name}</h3><span>${r.role}</span></div></div><p>${r.about}</p><div class="detail-status"><span class="tag ${activity(name).active?'':'idle-tag'}">${activity(name).active?'● 作業中':'○ 待機中'}</span><p>${activity(name).reason}</p></div>${name==='レン' && assigned() && currentJob()?.terminalUrl ? `<a class="terminal-link" target="_blank" rel="noopener noreferrer" href="${escape(currentJob().terminalUrl)}">PurpleMuxで実際の端末を開く ↗</a><p>未ログインの場合は、ログインしてからこのリンクを開き直してください。</p><p>workspace: ${escape(currentJob().workspaceId)}<br>tab: ${escape(currentJob().tabId)}</p>` : ''}${r.shop!==null?`<button class="go-shop">${data[r.shop].name}を覗く　↗</button>`:''}`);
  $('#detail .go-shop')?.addEventListener('click',()=>showShop(r.shop));
}
connectScene(showShop,showPerson);
function renderStage() {
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
    live=await response.json(); online=true;
    const job=currentJob(), phase=job?.phase || 'idle', key=`${job?.id}:${phase}`;
    if(key!==lastPhase) { addEvent(PHASE_LABELS[phase]); lastPhase=key; }
  } catch { online=false; }
  renderStage();
  setTimeout(poll,1500);
}
$('#request-form').addEventListener('submit',async e=>{
  e.preventDefault();const request=$('#request').value.trim();if(!request){$('#request').focus();return}
  if(submitting)return; submitting=true; $('#send').disabled=true;
  try {
    const response=await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:request})});
    const body=await response.json(); if(!response.ok)throw new Error(body.error);
    live=body; online=true; $('#request').value=''; $('#char-count').textContent='0 / 2000';
  } catch(error) { addEvent(error.message); $('#office-notice').textContent=error.message; }
  submitting=false; renderStage();
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
$('#open-conversation').addEventListener('click',()=>$('.office-conversation').scrollIntoView({behavior:'smooth',block:'start'}));
$('#open-reports').addEventListener('click',()=>$('.office-inbox').scrollIntoView({behavior:'smooth',block:'start'}));
$('#room-secretary').addEventListener('click',()=>{$('#request').focus();$('#request').scrollIntoView({behavior:'smooth',block:'center'});});
$('#desk-reports').addEventListener('click',()=>$('.office-inbox').scrollIntoView({behavior:'smooth',block:'start'}));
async function officeAction(url, method='POST') {
  try {
    const response=await fetch(url,{method}); const body=await response.json();
    if(!response.ok)throw new Error(body.error);live=body;online=true;
    $('#office-notice').textContent='';
  } catch(error) { $('#office-notice').textContent=error.message; }
  resetOfficeRender();renderStage();
}
function cancelJob(id){return officeAction(`/api/jobs/${encodeURIComponent(id)}/cancel`);}
function approveJob(id){return officeAction(`/api/jobs/${encodeURIComponent(id)}/approve`);}
function discoverArtifacts(id){return officeAction(`/api/jobs/${encodeURIComponent(id)}/artifacts`,'GET');}
navigate(location.pathname,false);renderStage(); poll(); requestAnimationFrame(frame);
