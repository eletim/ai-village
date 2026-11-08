import {villageModel,reconcileSelection,workspaceLink} from './village-model.js';
import {faviconHref} from './completions.js';
import {houseArt,gardenArt} from './village-art.js';
import {roleSVG} from './status-icon.js';
import {initDisplaySettings} from './display-settings.js';
import {initTheme} from './theme.js';
const $=s=>document.querySelector(s),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let snapshot={},online=false,hasSnapshot=false,model=villageModel({},false),selection={place:null,resident:null},signature='';
function readHash(){try{const hash=decodeURIComponent(location.hash.slice(1));selection=hash.startsWith('resident-')?{resident:hash.slice(9),place:null}:hash.startsWith('place-')?{place:hash.slice(6),resident:null}:{place:null,resident:null};}catch{selection={place:null,resident:null};}}
readHash();
function stateLabel(r){return r.label+(r.attention?' · 要確認':'');}
function residentButton(r){return `<button class="villager" data-resident="${esc(r.id)}" data-status="${esc(r.status)}" data-attention="${r.attention}" aria-pressed="${selection.resident===r.id}" title="${esc([r.name,r.role,r.project,stateLabel(r)].join(' · '))}"><span class="villager-portrait" aria-hidden="true"><i></i></span><span><b>${esc(r.name)}</b><small>${esc(stateLabel(r))}</small></span></button>`;}
function totals(c){return `${c.total}人 · 作業中 ${c.busy} · 要確認 ${c.attention} · 不明/接続不可 ${c.unknown}`;}
function replace(selector,html){const el=$(selector);if(el.innerHTML!==html)el.innerHTML=html;}
function render(){
 model=villageModel(snapshot,online);if(hasSnapshot)selection=reconcileSelection(model,selection);
 const key=JSON.stringify([model.places.map(p=>[p.id,p.name,p.workshop?.iconPattern,p.residents.map(r=>[r.id,r.name,r.role,r.project,r.status,r.attention])]),model.suspendedProjects.map(p=>[p.id,p.name,p.residents.map(r=>[r.id,r.status,r.attention,snapshot.reviews?.[r.id]?.unreviewed])]),selection,online]);
 if(key===signature)return;signature=key;
 const focusArea=document.activeElement?.closest('.village-notice')?'.village-notice':'#village-lots';
 const focused=document.activeElement?.closest('[data-resident],[data-place],[data-paused-project]'),focusKey=focused?.dataset.resident?['resident',focused.dataset.resident]:focused?.dataset.place?['place',focused.dataset.place]:focused?.dataset.pausedProject?['paused-project',focused.dataset.pausedProject]:null;
 $('#plaza-count').textContent=hasSnapshot?`${model.workshops.length}工房 / ${model.count.total}人の住人`:'登録情報を待っています';
 document.querySelector('link[rel=icon]').href=faviconHref(model.count.attention+model.suspendedCount.attention>0);document.title=(model.count.attention+model.suspendedCount.attention?'要確認 '+(model.count.attention+model.suspendedCount.attention)+'人 · ':'')+'AI村 · 村の地図';
 replace('#village-lots',model.places.map(p=>`<section class="village-lot" data-lot="${esc(p.id)}" data-selected="${selection.place===p.id}"><button class="building-choice" data-place="${esc(p.id)}" aria-pressed="${selection.place===p.id}" aria-label="${esc(p.name)} · ${totals(p.count)}">${houseArt(p.kind)}<span class="building-sign">${p.kind==='workshop'?`<span class="workshop-mark">${roleSVG({role:'worker',workshopId:p.workshop.id},model.workshops)}</span>`:''}<b>${esc(p.name)}</b></span><span class="building-count">${totals(p.count)}</span></button><div class="lot-residents" aria-label="${esc(p.name)}の住人">${p.residents.map(residentButton).join('')||'<p class="empty-lot">住人はまだいません</p>'}</div></section>`).join('')+(model.places.length%2?gardenArt():''));
 const suspendedOpen=$('.map-suspended')?.open;
 replace('#village-overview',`<h2>村のいま</h2><p class="overview-count"><strong>${hasSnapshot?model.count.total:'—'}</strong> 人の住人 <span>/ ${model.workshops.length}工房</span></p><dl class="village-stats"><div><dt>作業中</dt><dd>${model.count.busy}</dd></div><div><dt>要確認</dt><dd>${model.count.attention}</dd></div><div><dt>不明・接続不可</dt><dd>${model.count.unknown}</dd></div></dl>${!online?`<p class="offline-note">${hasSnapshot?'接続未確認です。前回取得した登録を表示し、現在の稼働状態は不明として扱います。':'登録情報をまだ取得できていません。接続を待っています。'}</p>`:''}`);
 const overview=$('#village-overview');const suspended=document.createElement('details');suspended.className='map-suspended';
 suspended.innerHTML=`<summary>休止中(${model.suspendedProjects.length})</summary><p>表示整理のみ。Agent・依頼・通知は継続します。</p>${model.suspendedProjects.map(p=>`<p><a data-paused-project="${esc(p.id)}" href="/agents#project-${encodeURIComponent(p.id)}">${esc(p.name)}の会話を見る</a> · ${p.residents.length}人</p>`).join('')}`;
 suspended.open=!!suspendedOpen;overview.append(suspended);
 const place=model.places.find(p=>p.id===selection.place);
 replace('#place-detail',place?`<p class="eyebrow">選択した場所</p><h2>${esc(place.name)}</h2><p>${totals(place.count)}</p><div class="notice-residents">${place.residents.map(residentButton).join('')||'<p>ここにはAgentが配置されていません。</p>'}</div>`:'<p class="eyebrow">村の歩き方</p><h2>どの工房を訪ねますか？</h2><p>建物の看板で場所を、住人で詳細を選べます。村長の家には登録された秘書が集まります。</p>');
 const resident=model.residents.find(r=>r.id===selection.resident);
 replace('#resident-detail',resident?`<p class="eyebrow">選択した住人</p><h2>${esc(resident.name)}</h2><dl class="resident-profile"><dt>役割</dt><dd>${esc(resident.role)}</dd><dt>場所</dt><dd>${esc(place.name)}</dd><dt>Project</dt><dd>${esc(resident.project)}</dd><dt>状態</dt><dd>${esc(stateLabel(resident))}</dd></dl><a class="workspace-door" href="${esc(workspaceLink(resident.id))}">このAgentと話す ↗<small>Agent Workspaceを開く</small></a>`:'');
 if(focusKey)document.querySelector(`${focusArea} [data-${focusKey[0]}="${CSS.escape(focusKey[1])}"]`)?.focus({preventScroll:true});
}
function choose(next){selection=next;history.replaceState(null,'',next.resident?'#resident-'+encodeURIComponent(next.resident):next.place?'#place-'+encodeURIComponent(next.place):location.pathname);render();if(matchMedia('(max-width: 850px)').matches){$(next.resident?'#resident-detail':next.place?'#place-detail':'.terrain').scrollIntoView({block:'start',behavior:'auto'});}}
document.addEventListener('click',e=>{const r=e.target.closest('[data-resident]'),p=e.target.closest('[data-place]');if(r)choose({resident:r.dataset.resident,place:null});else if(p)choose({resident:null,place:p.dataset.place});});
$('#map-return').onclick=()=>{ $('.map-heading').scrollIntoView({block:'start',behavior:'auto'});$('#map-home').focus({preventScroll:true});};
$('#map-home').onclick=()=>choose({place:null,resident:null});
window.addEventListener('hashchange',()=>{readHash();render();});
async function poll(){
 try{const response=await fetch('/api/direct',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('offline');const data=await response.json();if(!Array.isArray(data.agents)||!Array.isArray(data.workshops))throw Error('invalid snapshot');snapshot=data;hasSnapshot=true;online=true;$('#map-connection').textContent='接続中 · 登録情報から表示';}
 catch{online=false;$('#map-connection').textContent='接続未確認 · 再接続を待っています';}
 render();setTimeout(poll,3000);
}
initTheme();initDisplaySettings($('#map-settings'));poll();
