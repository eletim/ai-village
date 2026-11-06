import {workshopPatternEditor} from './workshop-pattern-editor.js';
import {statusIcon} from './status-icon.js';
import {displayPreferences} from './display-preferences.js';
import {initDisplaySettings} from './display-settings.js';
import {reportHTML} from './report-content.js';
import {updateReportHTML} from './report-visuals.js';
import {autogrowInput} from './autogrow-input.js';
import {linkedText} from './linked-text.js';
import {attachmentComposer,attachmentHTML} from './attachments.js';
import {chatScroll} from './chat-scroll.js';
import {travelComposer} from './travel-composer.js';
import {travelSummary,sameTravelContexts} from './travel-context.js';
import {PAGE_SIZE,placeOf,orderedAgents,orderedProjects,boardLayout} from './board-state.js';
import {agentEntries,unreadByAgent,visualState,faviconHref} from './completions.js';
import {agentPlaceName} from './agent-identity.js';
import {bindPromptInput} from './prompt-input.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// getRandomValues is available on VPN HTTP origins where randomUUID is not.
function newRequestId(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const labels={superseded:'補足runへ引継ぎ',queued:'送信待ち',awaiting_input:'受付照合中',idle:'待機中',busy:'作業中',starting:'起動待ち',creating:'起動中',creation_unknown:'起動結果不明',unknown:'接続・状態不明',waiting_input:'入力待ち',interrupted:'中断',failed:'ランタイムエラー',unavailable:'端末利用不可',terminated:'終了',stopping:'終了処理中',stop_unknown:'終了結果不明',sending:'送信中',running:'応答待ち',send_unknown:'送信結果不明',completed:'応答完了'};
let state,focusedHash='',selectedPlace='all',selectedPage=0,zoomId='',selectedAgent='',boardScroll=0,connected=false,refreshTask;
const navigationKey='ai-village-sidebar-v1';
let navigation={mode:'projects',projects:{id:'all',page:0},places:{id:'all',page:0}};
try{
 const stored=JSON.parse(localStorage.getItem(navigationKey));
 if(stored&&['projects','places'].includes(stored.mode))navigation.mode=stored.mode;
 for(const mode of ['projects','places']){const choice=stored?.[mode];if(choice&&typeof choice.id==='string'&&Number.isSafeInteger(choice.page)&&choice.page>=0)navigation[mode]={id:choice.id,page:choice.page};}
}catch{}
let sidebarMode=navigation.mode;
({id:selectedPlace,page:selectedPage}=navigation[sidebarMode]);
function rememberNavigation(){
 navigation.mode=sidebarMode;navigation[sidebarMode]={id:selectedPlace,page:selectedPage};
 try{const json=JSON.stringify(navigation);if(localStorage.getItem(navigationKey)!==json)localStorage.setItem(navigationKey,json);}catch{}
}
const pageKey=id=>sidebarMode+':'+id;
const storageKey='ai-village-direct-drafts-v2';
let saved={};try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'{}');}catch{}
const positions=new Map(Object.entries(saved.positions||{})),cards=new Map(),drafts=new Map(Object.entries(saved.drafts||{})),pending=new Map(Object.entries(saved.pending||{}));
const fileEditors=new Map(),scrolls=new Map();
const travelDrafts=new Map(Object.entries(saved.travelDrafts||{})),travelEditors=new Map();
function storeDrafts(){try{sessionStorage.setItem(storageKey,JSON.stringify({travelDrafts:Object.fromEntries(travelDrafts),positions:Object.fromEntries(positions),drafts:Object.fromEntries(drafts),pending:Object.fromEntries(pending)}));}catch{}}
window.addEventListener('pagehide',()=>{capturePositions();storeDrafts();});

const live=()=>orderedAgents(state.agents);
let unread=new Map();
const pageMemory=new Map();
const placeId=placeOf;
const placeName=agentPlaceName;
function options(select,items){const previous=select.value,html=items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');if(select.innerHTML!==html){select.innerHTML=html;if(items.some(i=>i.id===previous))select.value=previous;}}
const isProject=id=>id.startsWith('project:');
const inScope=(a,id)=>id==='all'||(isProject(id)?a.projectId===id.slice(8):placeId(a)===id);
function filtered(){return live().filter(a=>inScope(a,selectedPlace));}
function projectOptions(select){options(select,[{id:'',name:'未所属'},...orderedProjects(state.projects||[])]);}
function capturePositions(){for(const [id,card] of cards)if(!card.hidden)scrolls.get(id)?.capture();}
function timeHTML(value){if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?'':`<time datetime="${esc(value)}" title="${esc(date.toLocaleString())}">${esc(date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</time>`;}
function bubble(side,text,at,extra=''){return `<div class="message ${side}">${text?(side==='assistant'?reportHTML(text):`<pre>${linkedText(text)}</pre>`):''}${extra}${timeHTML(at)}</div>`;}
function recoveryHTML(r){
 const q=state.requests?.find(q=>q.id===r.humanRequestId),w=q?.works.find(w=>w.currentRunId===r.id);
 if(!q||q.status!=='active'||!w||!(['failed','interrupted'].includes(r.state)||(r.phase==='report'&&r.state==='completed'&&!w.finish)))return '';
 const reason=r.recovery?.status==='scheduled'?'自動再試行予定: '+new Date(r.recovery.nextAt).toLocaleTimeString():r.recovery?.reason||'停止理由を確認し、未完了の作業を再開できます。';
 return `<div class="recovery"><p>${esc(reason)}</p>${!w.parentWorkId?`<button data-retry-run="${esc(r.id)}">確認して再試行</button>`:'<p>委任元でrequests get/resultsを確認し、requests retryで復旧してください。</p>'}<button data-cancel-request="${esc(q.id)}">依頼をキャンセル</button></div>`;
}
function runHTML(a){
 const entries=agentEntries(state,a);
 return entries.map(r=>`<div class="run">${r.suppressUser?'':bubble('user',r.instruction,r.createdAt,travelSummary(r.travelContexts)+attachmentHTML(r.attachments))}${r.output?bubble('assistant',r.output,r.completedAt):''}<p class="run-status"><span class="badge">${r.external?'PurpleMuxからの入力 · ':r.origin==='result'?'子作業結果の配送 · ':r.origin==='steering'?'実行中への補足 · ':''}${esc(r.reportStatus||labels[r.state]||r.state)}</span> · ${r.humanRequestId?esc(({active:'依頼継続中',finalizing:'最終報告の完了待ち',completed:'依頼全体完了',cancelled:'依頼キャンセル'})[state.requests?.find(q=>q.id===r.humanRequestId)?.status]||'依頼照合中'):'達成状況: 未判定'} ${esc(r.errorCode||'')} ${esc(r.attachmentError||r.error||'')} ${r.notification?' · 通知: '+esc(r.notification.status)+(r.notification.reason?' / '+esc(r.notification.reason):''):''}</p>${recoveryHTML(r)}</div>`).join('');
}
function renderHistory(){
 options($('#history-agent'),state.agents.filter(a=>a.state==='terminated').map(a=>({id:a.id,name:placeName(a)+' / '+a.name+(state.reviews?.[a.id]?.attention?' · 依頼完了・要確認':unread.get(a.id)?' · 更新あり':'')})));
 const a=state.agents.find(a=>a.id===$('#history-agent').value);
 const html=a?runHTML(a)||'<p>会話履歴はありません。</p>':'<p>終了したAgentはありません。</p>';
 updateReportHTML($('#history-content'),html);
}
function renderBoard(){
 capturePositions();
 unread=unreadByAgent(state);updateCompletionIndicator();
 const validScope=selectedPlace==='all'||(sidebarMode==='projects'?(state.projects||[]).some(p=>'project:'+p.id===selectedPlace):selectedPlace==='mayor'||state.workshops.some(w=>w.id===selectedPlace)||(selectedPlace==='unassigned'&&live().some(a=>placeId(a)==='unassigned')));
 let pageCount=Math.max(1,Math.ceil(filtered().length/PAGE_SIZE));
 if(!validScope||selectedPage>=pageCount){selectedPlace='all';selectedPage=0;selectedAgent='';zoomId='';pageCount=Math.max(1,Math.ceil(filtered().length/PAGE_SIZE));}
 rememberNavigation();
 renderPlaces();
 const list=filtered();
 const restoreScroll=zoomId&&!list.some(a=>a.id===zoomId)?boardScroll:null;
 if(restoreScroll!==null)zoomId='';
 const shown=zoomId?list.filter(a=>a.id===zoomId):list.slice(selectedPage*PAGE_SIZE,(selectedPage+1)*PAGE_SIZE),ids=new Set(shown.map(a=>a.id));
 $('#board-title').textContent=zoomId?shown[0].name:groupTitle(selectedPlace,selectedPage);
 $('#agent-count').textContent=`${shown.length} / ${list.length} Agent`;
 $('#pages').hidden=selectedPlace!=='all'||!!zoomId||pageCount===1;
 $('#page-number').textContent=`${selectedPage+1} / ${pageCount}`;
 $('#previous-page').disabled=selectedPage===0;$('#next-page').disabled=selectedPage===pageCount-1;
 for(const [id,card] of cards)if(!live().some(a=>a.id===id)){card.autogrow?.destroy();scrolls.get(id)?.destroy();scrolls.delete(id);fileEditors.get(id)?.destroy();fileEditors.delete(id);card.remove();cards.delete(id);travelDrafts.delete(id);travelEditors.delete(id);positions.delete(id);drafts.delete(id);pending.delete(id);storeDrafts();}
 for(const a of live()){
  let card=cards.get(a.id);
  if(!card){card=document.createElement('article');card.className='agent-panel';card.id='agent-'+a.id;card.setAttribute('aria-labelledby','heading-'+a.id);card.tabIndex=0;card.hidden=true;
   card.innerHTML=`<div class="panel-heading"><span class="dot"></span><h2></h2><span class="request-attention"></span><span class="selection-label"></span><span class="unread-badge"></span><button data-zoom="${esc(a.id)}" title="このAgentを拡大" aria-label="このAgentを拡大">⤢</button><button data-manage-agent="${esc(a.id)}" title="Agentの操作" aria-label="Agentの操作">…</button></div><div class="panel-info"></div><p class="current-action"></p><div class="runs" tabindex="0" aria-label="会話履歴"></div><form data-send="${esc(a.id)}"><textarea name="instruction" aria-label="このAgentに直接指示" placeholder="指示を入力…（Ctrl+Enterで送信、Enter / Shift+Enterで改行）" maxlength="16000" rows="2"></textarea><button type="submit">送信</button><button type="button" data-reconcile="${esc(a.id)}" hidden>送信結果を確認</button><div class="travel-slot"></div></form>`;
   const input=card.querySelector('textarea');input.value=drafts.get(a.id)||'';card.autogrow=autogrowInput(input,{panel:card});
   travelEditors.set(a.id,travelComposer(card.querySelector('.travel-slot'),travelDrafts.get(a.id)||[],value=>{travelDrafts.set(a.id,value);storeDrafts();}));
   fileEditors.set(a.id,attachmentComposer({host:card.querySelector('.travel-slot'),key:'agent:'+a.id,supported:()=>!!state?.capabilities?.attachments}));
   scrolls.set(a.id,chatScroll(card.querySelector('.runs'),{saved:positions.get(a.id),onSave:value=>{positions.set(a.id,value);storeDrafts();}}));
   bindPromptInput(input,()=>{const button=input.form.querySelector('button');if(!button.disabled)input.form.requestSubmit(button);});
   input.oninput=()=>{drafts.set(a.id,input.value);storeDrafts();};

   cards.set(a.id,card);$('#agents').append(card);
  }
  const marker=agentMarker(a,false),currentMarker=card.querySelector('.panel-heading .dot');
  if(card.markerHTML!==marker){currentMarker.outerHTML=marker;card.markerHTML=marker;}
  card.dataset.state=visualState(a,agentEntries(state,a));
  card.dataset.unread=String(!!unread.get(a.id));
  card.dataset.attention=String(!!state.reviews?.[a.id]?.attention);
  card.querySelector('.request-attention').textContent=state.reviews?.[a.id]?.attention?'依頼完了・要確認':'';
  card.querySelector('.unread-badge').textContent=unread.get(a.id)?'更新あり':state.reviews?.[a.id]?.hasCompleted?'確認済み':'';
  const zoom=card.querySelector('[data-zoom]'),expanded=zoomId===a.id;
  zoom.textContent=expanded?'⤡':'⤢';zoom.title=expanded?'一覧に戻る':'このAgentを拡大';zoom.setAttribute('aria-label',zoom.title);zoom.setAttribute('aria-expanded',String(expanded));
  card.querySelector('h2').id='heading-'+a.id;
  card.querySelector('h2').textContent=`${a.name} · ${a.provider==='claude'?'Claude':'Codex'}`;
  card.querySelector('h2').title=`${a.name} · ${a.cwd||''}`;
  card.querySelector('.panel-info').innerHTML=`<span class="badge">${esc(labels[visualState(a,agentEntries(state,a))]||a.state)}</span><span class="location-name">${esc(placeName(a))}</span>${a.terminalUrl?`<a href="${esc(a.terminalUrl)}" target="_blank" rel="noopener" title="PurpleMuxでタブを開く">PurpleMux ↗</a>`:''}`;
  card.querySelector('.current-action').textContent=[['busy','waiting_input'].includes(a.state)?a.currentAction:null,a.error,a.canSend?null:a.sendReason,pending.has(a.id)?'送信結果を照合中（自動再送なし）':null].filter(Boolean).join(' · ');
  const area=card.querySelector('.runs'),html=runHTML(a);updateReportHTML(area,html);
  const receipt=pending.get(a.id),known=receipt&&state.runs.find(r=>r.requestId===receipt.requestId);
  if(known){pending.delete(a.id);fileEditors.get(a.id).clear();scrolls.get(a.id).latest();if(!['unknown','send_unknown'].includes(known.state)&&sameTravelContexts(travelDrafts.get(a.id),receipt.travelContexts))travelEditors.get(a.id).set([]);if(!['unknown','send_unknown'].includes(known.state)&&card.querySelector('textarea').value===receipt.instruction){card.querySelector('textarea').value='';drafts.delete(a.id);}storeDrafts();}
  const send=card.querySelector('[data-send] button:not([data-reconcile])');
  fileEditors.get(a.id).lock(card.dataset.pending==='true'||pending.has(a.id));
  travelEditors.get(a.id).lock(card.dataset.pending==='true'||pending.has(a.id));
  send.disabled=!connected||(a.canSend!==true&&a.canSteer!==true&&a.canQueue!==true)||card.dataset.pending==='true'||pending.has(a.id);
  card.querySelector('[data-reconcile]').hidden=!pending.has(a.id);
  send.textContent=a.reportPending?'次の依頼を待機キューへ':a.canSteer?'実行中に補足':a.canQueue&&!a.canSend?'待機キューへ':'送信';
  send.title=pending.has(a.id)?'送信結果を確認中です。自動再送しません。':a.canSteer?'実行中の同じ依頼に補足します。native受付を照合し、通知は依頼全体で1回です。':a.canQueue&&!a.canSend?'別の依頼として保存し、現在の応答が終わったら渡します。':a.sendReason||'';

  card.hidden=!ids.has(a.id);card.style.order=list.findIndex(x=>x.id===a.id);
  if(!card.hidden){card.autogrow.update();scrolls.get(a.id).restore();}
 }
 $('#agents').hidden=!shown.length;$('#empty').hidden=!!shown.length;
 $('#empty-help').hidden=false;
 const secretaries=(isProject(selectedPlace)?filtered():live()).filter(a=>a.location==='mayor');
 $('#start-secretary').hidden=secretaries.length>0;
 $('#start-secretary').title=state.workshops.some(w=>w.connectionType==='local')?'秘書を追加':'ローカル実行環境を登録して秘書を追加';
 layoutBoard();if(restoreScroll!==null)$('#agents').scrollTop=restoreScroll;renderHistory();syncSelection();
}
function placeTitle(id){if(isProject(id))return (state.projects||[]).find(p=>p.id===id.slice(8))?.name||'Project';return id==='all'?'全部表示':id==='mayor'?'秘書':id==='unassigned'?'所属未登録':'工房（'+(state.workshops.find(w=>w.id===id)?.name||'未登録')+'）';}
function groupTitle(id,page){return placeTitle(id)+(id!=='all'&&page>0?` (${page+1})`:'');}
function agentMarker(a,sidebar=true){
 const stateName=visualState(a,agentEntries(state,a));
 return statusIcon(a,{mode:displayPreferences().iconMode,workshops:state.workshops,state:stateName,stateLabel:labels[stateName]||stateName,attention:!!state.reviews?.[a.id]?.attention,unread:!!unread.get(a.id),sidebar});
}
function agentDot(a){return agentMarker(a);}
function renderPlaces(){
 const all=live(),places=sidebarMode==='projects'?orderedProjects(state.projects||[]).map(p=>({id:'project:'+p.id})):[{id:'mayor'},...state.workshops];
 for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===sidebarMode));
 $('#places').setAttribute('aria-label',sidebarMode==='projects'?'プロジェクト':'場所');
 if(sidebarMode==='places'&&all.some(a=>placeId(a)==='unassigned'))places.push({id:'unassigned'});
 const allPage=selectedPlace==='all'?selectedPage:pageMemory.get(pageKey('all'))||0;
 const entries=[{id:'all',page:0,agents:all.slice(allPage*PAGE_SIZE,(allPage+1)*PAGE_SIZE)}];
 for(const {id} of places){const agents=all.filter(a=>inScope(a,id));for(let page=0;page<Math.max(1,Math.ceil(agents.length/PAGE_SIZE));page++)entries.push({id,page,agents:agents.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)});}
 const html=entries.map(({id,page,agents})=>`<div class="place-row"><button data-place="${esc(id)}" data-page="${page}" ${selectedPlace===id&&(id==='all'||selectedPage===page)?'aria-current="page"':''}><span>${esc(groupTitle(id,page))}</span><span class="place-dots" aria-label="${id==='all'?'全体表示の現在ページ':'このグループ'}のAgent状態">${agents.map(agentDot).join('')}</span></button>${id==='all'||id==='unassigned'?'':`<button class="add-agent" data-add="${esc(id)}" data-page="${page}" aria-label="${esc(groupTitle(id,page))}の操作">…</button>`}</div>`).join('');
 if($('#places').innerHTML!==html){const dataset=document.activeElement?.dataset;$('#places').innerHTML=html;if(dataset?.place||dataset?.add){const key=dataset.place?'place':'add';[...$('#places').querySelectorAll('button')].find(b=>b.dataset[key]===dataset[key]&&b.dataset.page===dataset.page)?.focus({preventScroll:true});}}
}
function updateCompletionIndicator(){
 const count=Object.values(state.reviews||{}).reduce((n,r)=>n+(r.attentionRequestIds?.length||0),0);
 const icon=$('#village-favicon'),href=faviconHref(count>0);
 if(icon.getAttribute('href')!==href)icon.setAttribute('href',href);
 icon.dataset.unread=String(count>0);document.title=(count?'依頼完了・要確認 '+count+'件 · ':'')+'AI村 · Agentワークスペース';
 $('#completion-count').textContent=count?'依頼完了・要確認 '+count+'件':'';
}

let viewFrame=0;
const viewing=new Set();
function activeView(){
 if(!connected||document.visibilityState!=='visible'||!document.hasFocus()||!selectedAgent)return false;
 const dialog=document.querySelector('dialog[open]');
 if(dialog)return dialog.id==='history-dialog'&&$('#history-agent').value===selectedAgent;
 return !!cards.get(selectedAgent)&&!cards.get(selectedAgent).hidden;
}
function syncSelection(){
 const active=activeView();
 for(const [id,card] of cards){const selected=id===selectedAgent;card.dataset.selected=String(selected);if(selected)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');card.dataset.active=String(selected&&active);card.querySelector('.selection-label').textContent=selected?'選択中':'';}
 cancelAnimationFrame(viewFrame);
 // Acknowledge only a revision rendered in the selected, visible window.
 viewFrame=requestAnimationFrame(()=>{void acknowledgeSelection();});
}
function selectAgent(id){selectedAgent=id;syncSelection();}
async function acknowledgeSelection(){
 if(!activeView())return;
 const id=selectedAgent,review=state.reviews?.[id];
 if((!review?.unreviewed&&!review?.attention)||viewing.has(id))return;
 viewing.add(id);
 try{
  const result=await api('/agents/'+id+'/view',{revision:review.revision});
  // Never let an old response overwrite a newer completion snapshot.
  if(state.reviews?.[id]?.revision===result.revision){state.reviews[id]=result;renderBoard();}
 }catch(error){if(error.status===409)void refresh();else $('#error').textContent='確認状態を保存できません: '+error.message;}
 finally{viewing.delete(id);}
}
$('#agents').addEventListener('pointerdown',e=>{const card=e.target.closest('.agent-panel');if(card)selectAgent(card.id.slice(6));});
$('#agents').addEventListener('focusin',e=>{const card=e.target.closest('.agent-panel');if(card)selectAgent(card.id.slice(6));});
// Modal history is also an explicitly chosen Agent window, not a bulk read.
$('#history-content').tabIndex=0;
$('#history-content').addEventListener('pointerdown',()=>selectAgent($('#history-agent').value));
$('#history-content').addEventListener('focusin',()=>selectAgent($('#history-agent').value));
window.addEventListener('focus',syncSelection);window.addEventListener('blur',syncSelection);
document.addEventListener('visibilitychange',syncSelection);
document.addEventListener('focusin',syncSelection);
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',syncSelection);

function layoutBoard(){
 const board=$('#agents'),count=[...cards.values()].filter(c=>!c.hidden).length;if(!count)return;
 const layout=zoomId?{cols:1,rows:1,rowHeight:board.clientHeight}:boardLayout(count,board.clientWidth,board.clientHeight);
 board.style.setProperty('--cols',layout.cols);board.style.setProperty('--rows',layout.rows);board.style.setProperty('--row-height',`${Math.max(1,layout.rowHeight)}px`);
}
function choosePlace(id,page){
 capturePositions();pageMemory.set(pageKey(selectedPlace),selectedPage);rememberNavigation();
 if(id!=='all')sidebarMode=isProject(id)?'projects':'places';
 selectedPlace=id;selectedAgent='';selectedPage=page??pageMemory.get(pageKey(id))??0;zoomId='';boardScroll=0;$('#agents').scrollTop=0;renderBoard();
}
$('#sidebar-mode').onclick=e=>{
 const mode=e.target.closest('[data-mode]')?.dataset.mode;if(!mode||mode===sidebarMode)return;
 capturePositions();pageMemory.set(pageKey(selectedPlace),selectedPage);rememberNavigation();sidebarMode=mode;
 const choice=navigation[mode];selectedPlace=choice.id;selectedPage=choice.page;selectedAgent='';zoomId='';boardScroll=0;$('#agents').scrollTop=0;renderBoard();
};
$('#previous-page').onclick=()=>choosePlace('all',selectedPage-1);
$('#next-page').onclick=()=>choosePlace('all',selectedPage+1);
function toggleZoom(id){
 capturePositions();const restore=zoomId===id;
 if(!zoomId)boardScroll=$('#agents').scrollTop;
 zoomId=restore?'':id;renderBoard();$('#agents').scrollTop=restore?boardScroll:0;
 cards.get(id)?.querySelector('[data-zoom]')?.focus({preventScroll:true});
}
new ResizeObserver(()=>layoutBoard()).observe($('#agents'));
function focusAgent(){
 if(location.hash===focusedHash||!/^#agent-[0-9a-f-]{36}$/.test(location.hash)||!state)return;
 const id=location.hash.slice(7),a=state.agents.find(a=>a.id===id);if(!a)return;focusedHash=location.hash;
 if(a.state==='terminated'){renderHistory();$('#history-agent').value=id;renderHistory();$('#history-dialog').showModal();return;}
 if(!filtered().some(a=>a.id===id))choosePlace('all');
 selectedPage=Math.max(0,Math.floor(filtered().findIndex(a=>a.id===id)/PAGE_SIZE));
 if(zoomId!==id)toggleZoom(id);cards.get(id)?.focus({preventScroll:true});
}
window.addEventListener('hashchange',()=>{focusedHash='';focusAgent();});
$('#places').onclick=e=>{const add=e.target.closest('[data-add]'),place=e.target.closest('[data-place]');if(add)openManagement(add.dataset.add);else if(place)choosePlace(place.dataset.place,place.dataset.place==='all'?undefined:Number(place.dataset.page));};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&zoomId&&!document.querySelector('dialog[open]'))toggleZoom(zoomId);});
function openLauncher(place=selectedPlace){
 const f=$('#agent-form'),w=place==='mayor'?state.workshops.find(w=>w.connectionType==='local'):state.workshops.find(w=>w.id===place)||state.workshops[0];
 if(!w){if(place==='mayor')openSecretarySetup();else $('#settings-dialog').showModal();return;}
 f.elements.location.value=place==='mayor'?'mayor':'workshop';f.elements.workshopId.value=w.id;places();
 f.elements.name.value=place==='mayor'?'秘書':'Agent';
 projectOptions(f.elements.projectId);f.elements.projectId.value=isProject(manageScope)?manageScope.slice(8):isProject(place)?place.slice(8):'';
 $('#agent-dialog').showModal();f.elements.provider.focus();
}
let manageScope='all',metadataId='',metadataRevision=0,projectRevision=0;
let secretarySetup=false;
function prepareSecretaryForm(){
 const f=$('#workshop-form');f.reset();f.elements.connectionType.value='local';f.elements.name.value='村長PC';
 $('#workshop-title').textContent='秘書の実行環境を登録';$('#secretary-setup-help').hidden=false;connectionFields();
}
function openSecretarySetup(){
 secretarySetup=true;prepareSecretaryForm();
 $('#settings-dialog').showModal();$('#workshop-form').elements.baseUrl.focus();
}
$('#settings-dialog').addEventListener('close',()=>{if(secretarySetup){$('#workshop-form').reset();$('#workshop-title').textContent='工房を登録';connectionFields();}secretarySetup=false;$('#secretary-setup-help').hidden=true;});
function openManagement(scope=selectedPlace){manageScope=scope;openSettings();}
const openSettings=initDisplaySettings($('#manage'),$('#manage-dialog'));
$('#manage').addEventListener('click',()=>{manageScope=selectedPlace;});
window.addEventListener('display-change',()=>{if(state)render();});
$('#manual-add').onclick=()=>{$('#manage-dialog').close();openLauncher(manageScope);};
$('#start-secretary').onclick=()=>{manageScope=selectedPlace;openLauncher('mayor');};
function openMetadata(id){
 const a=state.agents.find(a=>a.id===id);metadataId=id;metadataRevision=a.metadataRevision||0;
 const f=$('#metadata-form');f.elements.name.value=a.name;projectOptions(f.elements.projectId);f.elements.projectId.value=a.projectId||'';
 $('#metadata-id').textContent=a.name+' · '+a.id;$('#stop-form').reset();$('#stop-form button').disabled=!a.tabId;
 $('#metadata-dialog .dialog-error').textContent='';$('#metadata-dialog').showModal();
}
$('#metadata-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;action(f,async()=>{await api('/agents/'+metadataId,{revision:metadataRevision,name:f.elements.name.value,projectId:f.elements.projectId.value||null},'PUT');$('#metadata-dialog').close();});};
$('#stop-form').onsubmit=e=>{e.preventDefault();action(e.currentTarget,async()=>{await api('/agents/'+metadataId+'/stop',{});$('#metadata-dialog').close();});};
function openProjects(){
 const f=$('#project-form');options(f.elements.id,[{id:'',name:'新規作成'},...orderedProjects(state.projects||[])]);f.elements.id.value='';f.elements.name.value='';$('#delete-project').disabled=true;delete f.dataset.requestId;$('#projects-dialog').showModal();
}
$('#project-form [name=id]').onchange=()=>{const f=$('#project-form'),p=(state.projects||[]).find(p=>p.id===f.elements.id.value);f.elements.name.value=p?.name||'';projectRevision=p?.revision||0;$('#delete-project').disabled=!p;delete f.dataset.requestId;};
$('#project-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;f.dataset.requestId ||= newRequestId();action(f,async()=>{const id=f.elements.id.value;await api('/projects'+(id?'/'+id:''),{name:f.elements.name.value,revision:projectRevision,requestId:f.dataset.requestId},id?'PUT':'POST');$('#projects-dialog').close();});};
let projectDeletePlan=null,projectDeleteInput=null;
function renderProjectDeletion(result){
 const remaining=result?.remaining||[];
 $('#project-delete-status').textContent=result?(result.status==='deleted'?'Projectと所属Agentを削除しました。':`削除は未完了です。残り ${remaining.length} 人。終了確認済みのAgentは再度終了しません。`):'';
 $('#project-delete-members').replaceChildren(...projectDeletePlan.members.map(m=>{const li=document.createElement('li'),pending=remaining.find(r=>r.id===m.id);li.textContent=m.name+' · '+m.id+' — '+(result?(pending?pending.error:'終了確認済み'):(labels[m.state]||m.state));return li;}));
 $('#confirm-project-delete').textContent=result?'残りを再試行':'削除';
 $('#project-delete-dialog [data-close]').textContent=result?'閉じる':'キャンセル';
}
$('#delete-project').onclick=()=>action($('#projects-dialog'),async()=>{
 const id=$('#project-form').elements.id.value;if(!id)return;
 projectDeletePlan=await api('/projects/'+id+'/delete-plan',null,'GET');
 projectDeleteInput={operationId:projectDeletePlan.deletion?.operationId||newRequestId(),revision:projectDeletePlan.revision,members:projectDeletePlan.members.map(m=>({id:m.id,revision:m.revision}))};
 $('#project-delete-name').textContent='プロジェクト：'+projectDeletePlan.name;
 renderProjectDeletion(projectDeletePlan.deletion);$('#projects-dialog').close();$('#project-delete-dialog').showModal();
});
$('#confirm-project-delete').onclick=()=>action($('#project-delete-dialog'),async()=>{
 $('#project-delete-status').textContent='所属Agentの終了を確認しています。画面を閉じても開始した削除は取り消されません。';$('#project-delete-dialog [data-close]').textContent='閉じる';
 const result=await api('/projects/'+projectDeletePlan.projectId+'/delete',projectDeleteInput);renderProjectDeletion(result);
 if(result.status==='deleted')$('#project-delete-dialog').close();
});
for(const b of document.querySelectorAll('[data-open]'))b.onclick=()=>{if(b.closest('#manage-dialog'))$('#manage-dialog').close();if(b.dataset.open==='projects-dialog')openProjects();else $('#'+b.dataset.open).showModal();};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
$('#history-agent').onchange=()=>{renderHistory();selectAgent($('#history-agent').value);};
async function api(path,body,method='POST'){
 if(path.endsWith('/runs')&&body?.steerTarget&&!state?.capabilities?.steering)throw Error('実行中の補足にはサーバー更新が必要です。');
 if(path.endsWith('/runs')&&body?.attachments?.length&&!state?.capabilities?.attachments)throw Error('添付にはサーバー更新の反映が必要です。');
 if(path.endsWith('/runs')&&body?.travelContexts?.length&&!state?.capabilities?.travelContexts)throw Error('出張先の送信にはサーバー更新の反映が必要です。下書きは保持しています。');
 const response=await fetch('/api/direct'+path,{method,signal:AbortSignal.timeout(method==='GET'?10000:30000),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'操作に失敗しました'),{status:response.status});return value;
}
async function action(form,fn){const buttons=[...form.querySelectorAll('button')],card=form.closest('.agent-panel');if(card)card.dataset.pending='true';buttons.forEach(b=>b.disabled=true);$('#error').textContent='';document.querySelectorAll('.dialog-error').forEach(el=>el.textContent='');try{await fn();await refresh(true);}catch(e){const target=document.querySelector('dialog[open] .dialog-error')||$('#error');target.textContent=e.message;}finally{if(card)card.dataset.pending='false';buttons.forEach(b=>b.disabled=false);if(state)renderBoard();}}
function places(){const w=state?.workshops.find(w=>w.id===$('#agent-form [name=workshopId]').value);options($('#agent-form [name=cwd]'),(w?.workplaces||[]).map(p=>({id:p,name:p})));}
function render(){
 $('#workshops').innerHTML=state.workshops.map(w=>`<div class="workshop"><strong>${esc(w.name)}</strong><div class="meta">${w.connectionType==='local'?'ローカル（村長PC）':'SSH · '+esc(w.sshHost)}</div><button class="secondary" data-edit="${esc(w.id)}">編集</button></div>`).join('')||'<p>工房を登録してください。</p>';
 options($('#agent-form [name=workshopId]'),state.workshops);if(!$('#agent-dialog').open)projectOptions($('#agent-form [name=projectId]'));places();
 $('#notifications').textContent=`Notify: ${state.notification.enabled===false?'OFF':state.notification.latest?.status||(state.notification.destinationConfigured?'設定済み':'未設定')}`;
 $('#notifications').title='sentは通知サーバーの受理。端末への到着は未確認。';renderBoard();
}
async function refresh(force=false){
 if(refreshTask){await refreshTask;if(force)return refresh(true);return;}
 refreshTask=(async()=>{try{state=await api('',null,'GET');connected=true;render();focusAgent();$('#connection').textContent='● 接続 · '+new Date().toLocaleTimeString();}catch(e){connected=false;if(state)renderBoard();$('#connection').textContent='接続不明: '+e.message;}})();
 try{await refreshTask;}finally{refreshTask=null;}
}
$('#agent-form [name=workshopId]').onchange=places;
$('#agent-form [name=location]').onchange=()=>{if($('#agent-form [name=location]').value==='mayor'){const w=state.workshops.find(w=>w.connectionType==='local');if(w)$('#agent-form [name=workshopId]').value=w.id;$('#agent-form [name=name]').value='秘書';places();}};
const patternEditor=workshopPatternEditor($('#workshop-form'));
function connectionFields(){const local=$('#workshop-form [name=connectionType]').value==='local';$('#ssh-host-field').hidden=local;$('#workshop-form [name=sshHost]').required=!local;}
$('#workshop-form [name=connectionType]').onchange=connectionFields;
$('#workshop-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;action(f,async()=>{const x=Object.fromEntries(new FormData(f));if(secretarySetup&&x.connectionType!=='local')throw Error('秘書にはローカル（村長PC）を選んでください。');await api('/workshops'+(x.id?'/'+x.id:''),{...x,iconPattern:patternEditor.value(),workplaces:x.workplaces.split('\n').map(s=>s.trim()).filter(Boolean)},x.id?'PUT':'POST');f.reset();connectionFields();$('#workshop-title').textContent='工房を登録';if(secretarySetup){await refresh(true);$('#settings-dialog').close();openLauncher('mayor');}});};
$('#reset-workshop').onclick=()=>{if(secretarySetup)prepareSecretaryForm();else{$('#workshop-form').reset();connectionFields();$('#workshop-title').textContent='工房を登録';}};
$('#workshops').onclick=e=>{const id=e.target.dataset.edit;if(!id)return;const w=state.workshops.find(w=>w.id===id);for(const key of ['id','name','connectionType','sshHost','baseUrl','workplaces'])$('#workshop-form').elements[key].value=key==='workplaces'?w[key].join('\n'):(w[key]??(key==='connectionType'?'ssh':''));patternEditor.set(w);connectionFields();$('#workshop-title').textContent='工房を編集';};
$('#agent-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;f.dataset.requestId ||= newRequestId();action(f,async()=>{let a;try{a=await api('/agents',{...Object.fromEntries(new FormData(f)),requestId:f.dataset.requestId});}catch(error){if(error.status&&error.status<500)delete f.dataset.requestId;throw error;}delete f.dataset.requestId;$('#agent-dialog').close();await refresh(true);if(a.id){const scope=a.projectId?'project:'+a.projectId:placeId(a);choosePlace(scope,Math.floor(live().filter(x=>inScope(x,scope)).findIndex(x=>x.id===a.id)/PAGE_SIZE));cards.get(a.id)?.scrollIntoView({block:'nearest'});}});};
$('#agents').onsubmit=async e=>{
 e.preventDefault();const f=e.target,id=f.dataset.send;if(!id||pending.has(id)||f.querySelector('button').disabled||(!f.elements.instruction.value.trim()&&!fileEditors.get(id).count))return;
 if(travelEditors.get(id).value.length&&!state.capabilities?.travelContexts){$('#error').textContent='出張先の送信にはサーバー更新の反映が必要です。下書きは保持しています。';return;}
 action(f,async()=>{
  const target=state.agents.find(a=>a.id===id),steerTarget=target?.canSteer?structuredClone(target.steerTarget):null;
  fileEditors.get(id).lock(true);travelEditors.get(id).lock(true);
  const attachmentIds=await fileEditors.get(id).upload();
  const receipt={...(steerTarget?{steerTarget}:{}),instruction:f.elements.instruction.value,attachments:attachmentIds,travelContexts:travelEditors.get(id).value,requestId:newRequestId()};pending.set(id,receipt);storeDrafts();scrolls.get(id).latest();
  try{const r=await api('/agents/'+id+'/runs',receipt);pending.delete(id);
   if(!['unknown','send_unknown'].includes(r.state)){fileEditors.get(id).clear();if(sameTravelContexts(travelDrafts.get(id),receipt.travelContexts))travelEditors.get(id).set([]);if(f.elements.instruction.value===receipt.instruction){f.elements.instruction.value='';drafts.delete(id);}}
   storeDrafts();
  }catch(error){if(error.status&&error.status<500){pending.delete(id);storeDrafts();}throw error;}
 });
};
$('#agents').onclick=e=>{
 const retry=e.target.closest('[data-retry-run]'),cancel=e.target.closest('[data-cancel-request]');
 if(retry||cancel){
  const r=retry&&state.runs.find(r=>r.id===retry.dataset.retryRun),q=state.requests.find(q=>q.id===(r?.humanRequestId||cancel?.dataset.cancelRequest));
  if(!q||!confirm(retry?r.phase==='report'?'元作業を再実行せず、報告だけを作り直しますか？':'既存変更・PR・委任結果を確認し、未完了部分だけ再開しますか？':'この依頼全体をキャンセルしますか？ 実行中のAgentは停止しません。'))return;
  action((retry||cancel).closest('article'),async()=>{
   if(cancel)await api('/requests/cancel',{humanRequestId:q.id,revision:q.revision});
   else await api(r.phase==='report'&&r.state==='completed'?'/requests/resume':'/requests/retry',{humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:newRequestId(),instruction:'失敗・中断からの復旧です。既存変更・PR・外部操作・requests get/resultsの子作業を確認し、未完了部分だけ進めてください。子作業の再委任や二重操作を避け、モデルは変更しないでください。今回のrunでfinishを登録してください。\n元の指示（全文はrequests getで確認）:\n'+q.instruction.slice(0,12000)});
  });return;
 }
 const reconcile=e.target.closest('[data-reconcile]');if(reconcile){const id=reconcile.dataset.reconcile,receipt=pending.get(id);if(receipt)action(reconcile.closest('article'),async()=>{await api('/agents/'+id+'/runs',receipt);await refresh();});return;}const manage=e.target.closest('[data-manage-agent]'),zoom=e.target.closest('[data-zoom]');if(manage)openMetadata(manage.dataset.manageAgent);if(zoom)toggleZoom(zoom.dataset.zoom);};
await refresh();setInterval(refresh,2000);
