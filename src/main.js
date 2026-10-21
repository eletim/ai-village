import { data, people, parcel, connectScene, positionPerson, setSceneStatus } from './scene.js';
import { VillageSimulation, STAGES } from './simulation.js';

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
const positions = {ミク:[540,372],ハル:[590,352],レン:[245,556],ソラ:[300,573],ユイ:[333,536],カイ:[778,576],ナギ:[836,553],リツ:[820,296],トワ:[435,679]};
const secretaryPath = [[540,372],[540,472],[290,580],[280,553]];
const homePath = [...secretaryPath].reverse();
const deliveryPath = [[820,296],[790,330],[660,405],[540,472],[540,372]];
let selected = null, paused = false, speed = 1, lastTime, renderKey = '', focusBeforeDialog;
let history = [];
const sim = new VillageSimulation();
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
function along(points,t) {
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
  let distance=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,t));
  for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]){const q=distance/lengths[i];return [points[i][0]+(points[i+1][0]-points[i][0])*q,points[i][1]+(points[i+1][1]-points[i][1])*q]}distance-=lengths[i]}
  return points.at(-1);
}
function renderPositions() {
  const stage = sim.stage; const p = sim.progress;
  Object.entries(positions).forEach(([name,[x,y]])=>positionPerson(name,x,y,false));
  let miku = positions.ミク;
  if(stage===1)miku=along(secretaryPath,p);
  if(stage===2)miku=secretaryPath.at(-1);
  if(stage===3)miku=along(homePath,p);
  positionPerson('ミク',...miku, !paused && (stage===1||stage===3));
  ['レン','ソラ','ユイ'].forEach((name,i)=>{
    const working=stage>=3&&stage<=7;
    if(stage===2){const a=positions[name],b=[255+i*20,515+i*3];positionPerson(name,a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p,!paused)}
    else if(working)positionPerson(name,255+i*20,515+i*3);
    people[name].classList.toggle('at-work',working);
  });
  let box=positions.リツ;
  if(stage===5){box=along(deliveryPath,p);positionPerson('リツ',...box,!paused)}
  else if(stage===6){box=deliveryPath.at(-1);positionPerson('リツ',...box)}
  else if(stage>=7){box=[560,368];positionPerson('リツ',...along([...deliveryPath].reverse(),Math.min(p*2,1)),!paused&&p<.5)}
  parcel.setAttribute('transform',`translate(${box[0]+13} ${box[1]-3})`);
  parcel.style.opacity=stage>=5?'1':'.7';
  const t=sim.elapsed/1000;positionPerson('トワ',435+Math.sin(t*.2)*13,679+Math.sin(t*.2)*6,!paused);
}
function shopState(index) {
  if(index===0) return { label:sim.stage===6?'成果を確認中':sim.stage>=1&&sim.stage<=3?'ミクは工房へ訪問中':'秘書のいる場所', task:STAGES[sim.stage].status, tone:'green' };
  if(index===1){if(sim.stage<2)return {label:'仲間と制作中',task:sim.request?'村長からの新しい依頼を待っています':'サービスの画面をつくっています',tone:'green'};if(sim.stage===2)return {label:'相談中',task:'ミクから依頼を聞いています',tone:'amber'};return {label:sim.stage>=7?'できあがり':'制作中',task:sim.request||'サービスの画面をつくっています',tone:sim.stage>=7?'amber':'green'}}
  if(index===2)return {label:'動作確認中',task:'ログインから利用までを確かめています',tone:'green'};
  return {label:sim.stage<5?'お届け待ち':sim.stage===5?'お届け中':sim.stage===6?'確認中':'お届け済み',task:sim.stage<5?'小さな試作品ができあがりました':sim.stage===5?'リツが成果を村長の家へ運んでいます':sim.stage===6?'ミクとハルが試作品を確かめています':'村長への報告ができました',tone:'amber'};
}
function renderShops() {
  $('#works').replaceChildren(...data.slice(1).map((d,i)=>{
    const index=i+1,state=shopState(index),names=Object.keys(residents).filter(n=>residents[n].shop===index);
    const button=document.createElement('button');button.className='work';button.dataset.shop=index;
    button.innerHTML=`<div class="row"><b><span class="shop-icon shop-${index}">${['','✂','⚒','✦'][index]}</span>${d.name}</b><span class="tag ${state.tone}">${state.label}</span></div><p>${escape(state.task)}</p><div class="residents">${names.map(n=>`<span class="resident-dot" style="--resident:${residents[n].color}" title="${n}">${n.slice(0,1)}</span>`).join('')}<span>${names.length}人で${index===2?'確認中':'ものづくり'}</span><span class="work-arrow">↗</span></div>`;
    button.addEventListener('click',()=>showShop(index));return button;
  }));
  data.forEach((d,i)=>setSceneStatus(i,`${i===0?'⌂':i===3?'✦':'●'} ${shopState(i).label}`));
  $('#legend').innerHTML=`<span><i class="dot"></i>工房 3棟</span><span><i class="dot amber-dot"></i>${sim.stage===5?'成果をお届け中':sim.stage>=7?'便りが届きました':'今日もものづくり中'}</span>`;
}
function openDetail() {
  if(!selected)focusBeforeDialog=document.activeElement;
  $('#detail').hidden=false;
  document.querySelectorAll('.building').forEach(g=>g.classList.remove('selected'));
}
function closeDetail(){ $('#detail').hidden=true;selected=null;document.querySelectorAll('.building').forEach(g=>g.classList.remove('selected'));focusBeforeDialog?.focus?.(); }
function detailShell(content){$('#detail').innerHTML=`<button class="close" aria-label="詳細を閉じる">×</button>${content}`;$('#detail .close').addEventListener('click',closeDetail);}
function showShop(index,refresh=false) {
  if(!refresh)openDetail();selected={type:'shop',index};
  document.querySelectorAll('.building')[index].classList.add('selected');
  const d=data[index],state=shopState(index),names=Object.keys(residents).filter(n=>residents[n].shop===index);
  detailShell(`<div class="eyebrow">${d.pc}</div><h3>${d.name}</h3><p class="detail-description">${d.desc}</p><div class="interior" aria-label="${d.name}の中の様子"><div class="room-window"></div><div class="room-rug"></div>${names.map((n,i)=>`<button class="room-person" data-person="${n}" style="--resident:${residents[n].color};--slot:${i}"><span class="tiny-head"></span><span class="tiny-body"></span><small>${n}</small></button>`).join('')}<div class="room-table"><span>▤</span><span>⌨</span></div></div><div class="detail-status"><span class="tag ${state.tone}">${state.label}</span><p>${escape(state.task)}</p></div><div class="detail-people">${names.map(n=>`<button data-person="${n}"><span class="resident-dot" style="--resident:${residents[n].color}">${n[0]}</span><span><b>${n}</b><small>${residents[n].role}</small></span><span class="work-arrow">›</span></button>`).join('')}</div>`);
  $('#detail').querySelectorAll('[data-person]').forEach(b=>b.addEventListener('click',()=>showPerson(b.dataset.person)));
}
function showPerson(name) {
  openDetail();selected={type:'person',name};const r=residents[name];
  detailShell(`<div class="eyebrow">VILLAGER PROFILE</div><div class="profile"><div class="profile-character" style="--resident:${r.color}"><span class="tiny-head"></span><span class="tiny-body"></span></div><div><h3>${name}</h3><span>${r.role}</span></div></div><p>${r.about}</p><div class="detail-status"><span class="tag">いまのようす</span><p>${name==='ミク'?STAGES[sim.stage].status:r.shop===null?'広場を散歩しています':shopState(r.shop).task}</p></div>${r.shop!==null?`<button class="go-shop">${data[r.shop].name}を覗く　↗</button>`:''}`);
  $('#detail .go-shop')?.addEventListener('click',()=>showShop(r.shop));
}
connectScene(showShop,showPerson);
function renderStage() {
  const def=STAGES[sim.stage];$('#status').textContent=def.status;$('#chapter-text').textContent=def.title;
  $('#speech').textContent=sim.message;
  $('#journey').innerHTML=['相談','訪問','ものづくり','お届け','確認・報告'].map((s,i)=>`<span class="${i===def.chapter?'current':i<def.chapter?'done':''}"><i>${i<def.chapter?'✓':i+1}</i>${s}</span>`).join('<b>·</b>');
  renderShops();
  if(selected?.type==='shop')showShop(selected.index,true);
  else if(selected?.type==='person')showPerson(selected.name);
}
sim.onStage=()=>{addEvent(sim.event);renderStage()};
$('#request-form').addEventListener('submit',e=>{
  e.preventDefault();const request=$('#request').value.trim();if(!request){$('#request').focus();return}
  sim.start(request);$('#request').value='';$('#char-count').textContent='0 / 240';paused=false;updateControls();
});
$('#request').addEventListener('input',()=>$('#char-count').textContent=`${$('#request').value.length} / 240`);
$('#request').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))$('#request-form').requestSubmit()});
function updateControls() { $('#play').textContent=paused?'▶ 再開':'Ⅱ 一時停止';$('#play').setAttribute('aria-pressed',String(paused));$('#speed').textContent=speed+'×';document.querySelector('.world').classList.toggle('paused',paused); }
$('#play').addEventListener('click',()=>{paused=!paused;updateControls()});
$('#speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?4:1;updateControls()});
$('#home').addEventListener('click',closeDetail);
$('#mayor').addEventListener('click',()=>{$('#request').focus();$('#request').scrollIntoView({behavior:'smooth',block:'center'})});
$('#reset').addEventListener('click',()=>{history=[];paused=false;speed=1;closeDetail();sim.reset();updateControls();addEvent('村の一日が、はじまりました。');renderStage()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetail()});
// Pause the simulated clock while the page is hidden; never race to catch up.
document.addEventListener('visibilitychange',()=>{lastTime=undefined});
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
if(motion.matches){paused=true;updateControls()}
function frame(time) {
  const delta=lastTime===undefined?0:Math.min(time-lastTime,100);lastTime=time;
  if(!paused&&!document.hidden)sim.advance(delta*speed);
  renderPositions();
  const key=`${sim.stage}:${paused}`;if(key!==renderKey){renderKey=key;document.querySelectorAll('.at-work').forEach(g=>g.classList.toggle('working',!paused))}
  requestAnimationFrame(frame);
}
addEvent('村長の家へようこそ。工房の一日を眺めてみましょう。');renderStage();requestAnimationFrame(frame);
