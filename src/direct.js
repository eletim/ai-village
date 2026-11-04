const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// getRandomValues is available on VPN HTTP origins where randomUUID is not.
function newRequestId(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const labels={idle:'待機中',busy:'作業中',starting:'起動待ち',creating:'起動中',creation_unknown:'起動結果不明',unknown:'接続・状態不明',waiting_input:'入力待ち',interrupted:'中断',failed:'ランタイムエラー',unavailable:'端末利用不可',terminated:'終了',stopping:'終了処理中',stop_unknown:'終了結果不明',sending:'送信中',running:'応答待ち',send_unknown:'送信結果不明',completed:'応答完了'};
let state,refreshing=false,focusedHash='',activeId='',pageIndex=0;
const positions=new Map(), cards=new Map();
const live=()=>state.agents.filter(a=>a.state!=='terminated');
const placeId=a=>a.location==='mayor'?'mayor':a.workshopId||state.workshops[0]?.id||'mayor';
const placeName=a=>a.location==='mayor'?'村長の家（秘書）':a.connection?.name||'工房';
function options(select,items){const previous=select.value,html=items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');if(select.innerHTML!==html){select.innerHTML=html;if(items.some(i=>i.id===previous))select.value=previous;}}
function filtered(){const scope=$('#scope').value;return live().filter(a=>scope==='all'||placeId(a)===$('#place').value).filter(a=>scope!=='agent'||a.id===$('#agent-choice').value);}
function capturePositions(){for(const [id,card] of cards)if(!card.hidden)positions.set(id,card.querySelector('.runs').scrollTop);}
function runHTML(a){
 const runs=state.runs.filter(r=>r.agentId===a.id),external=(a.nativeTurns||[]).filter(t=>!runs.some(r=>r.turnId===t.id));
 return runs.map(r=>`<div class="run"><span class="badge">${esc(labels[r.state]||r.state)}</span> <span class="meta">${esc(r.createdAt)} · 達成状況: 未判定</span><h3>指示</h3><pre>${esc(r.instruction)}</pre>${r.output?`<h3>返答</h3><pre>${esc(r.output)}</pre>`:''}<p class="meta">${esc(r.error||'')} ${r.notification?'通知: '+esc(r.notification.status)+(r.notification.reason?' / '+esc(r.notification.reason):''):''}</p></div>`).join('')+external.map(t=>`<div class="run"><span class="badge">PurpleMuxからの入力 · ${esc(labels[t.state]||t.state)}</span><pre>${esc(t.instruction)}</pre><pre>${esc(t.output)}</pre></div>`).join('');
}
function renderHistory(){
 options($('#history-agent'),state.agents.filter(a=>a.state==='terminated').map(a=>({id:a.id,name:placeName(a)+' / '+a.name})));
 const a=state.agents.find(a=>a.id===$('#history-agent').value);
 const html=a?runHTML(a)||'<p>会話履歴はありません。</p>':'<p>終了したAgentはありません。</p>';
 if($('#history-content').innerHTML!==html)$('#history-content').innerHTML=html;
}
function renderBoard(){
 capturePositions();
 options($('#place'),[{id:'mayor',name:'村長の家（秘書）'},...state.workshops.map(w=>({id:w.id,name:w.name}))]);
 options($('#agent-choice'),live().filter(a=>placeId(a)===$('#place').value));
 $('#place-filter').hidden=$('#scope').value==='all';$('#agent-filter').hidden=$('#scope').value!=='agent';
 const list=filtered(),capacity=Number($('#layout').value);
 if(!list.some(a=>a.id===activeId))activeId=list[0]?.id||'';
 pageIndex=Math.min(pageIndex,Math.max(0,Math.ceil(list.length/capacity)-1));
 const shown=list.slice(pageIndex*capacity,(pageIndex+1)*capacity),ids=new Set(shown.map(a=>a.id));
 if(shown.length&&!ids.has(activeId))activeId=shown[0].id;
 $('#page-count').textContent=list.length?`${pageIndex+1} / ${Math.ceil(list.length/capacity)} · ${list.length} Agent`:'0 Agent';
 $('#previous').disabled=pageIndex===0;$('#next').disabled=(pageIndex+1)*capacity>=list.length;
 const tabHTML=list.map(a=>`<button role="tab" id="tab-${esc(a.id)}" data-agent="${esc(a.id)}" data-state="${esc(a.state)}" aria-controls="agent-${esc(a.id)}" aria-selected="${a.id===activeId}" tabindex="${a.id===activeId?0:-1}" class="${ids.has(a.id)?'shown':''}" title="${esc(placeName(a)+' · '+(labels[a.state]||a.state))}"><span class="dot"></span>${esc(a.name)} <span class="meta">${esc(placeName(a))}</span></button>`).join('');
 // Polling does not replace focused tabs or conversation/input DOM unnecessarily.
 if($('#agent-tabs').innerHTML!==tabHTML){const focused=document.activeElement?.dataset.agent;$('#agent-tabs').innerHTML=tabHTML;if(focused)document.getElementById('tab-'+focused)?.focus({preventScroll:true});}
 for(const [id,card] of cards)if(!live().some(a=>a.id===id)){card.remove();cards.delete(id);positions.delete(id);}
 for(const a of live()){
  let card=cards.get(a.id);
  if(!card){card=document.createElement('article');card.className='agent-panel';card.id='agent-'+a.id;card.setAttribute('role','tabpanel');card.setAttribute('aria-labelledby','tab-'+a.id);card.tabIndex=-1;card.hidden=true;
   card.innerHTML=`<div class="panel-heading"><span class="dot"></span><h2></h2><button data-zoom="${esc(a.id)}" title="このAgentを拡大" aria-label="このAgentを拡大">⤢</button><button class="danger" data-stop="${esc(a.id)}" title="Agentを終了" aria-label="Agentを終了">×</button></div><div class="panel-info"></div><p class="current-action"></p><div class="runs" tabindex="0" aria-label="会話履歴"></div><form data-send="${esc(a.id)}"><textarea name="instruction" aria-label="このAgentに直接指示" placeholder="指示を入力…" required maxlength="16000" rows="2"></textarea><button>送信</button></form>`;
   cards.set(a.id,card);$('#agents').append(card);
  }
  card.dataset.state=a.state;card.classList.toggle('selected',a.id===activeId);
  card.querySelector('h2').textContent=`${a.name} · ${a.provider==='claude'?'Claude':'Codex'}`;
  card.querySelector('h2').title=`${a.name} · ${a.cwd||''}`;
  card.querySelector('.panel-info').innerHTML=`<span class="badge">${esc(labels[a.state]||a.state)}</span><span class="location-name">${esc(placeName(a))}</span>${a.terminalUrl?`<a href="${esc(a.terminalUrl)}" target="_blank" rel="noopener" title="PurpleMuxでタブを開く">PurpleMux ↗</a>`:''}`;
  card.querySelector('.current-action').textContent=[['busy','waiting_input'].includes(a.state)?a.currentAction:null,a.error].filter(Boolean).join(' · ');
  const area=card.querySelector('.runs'),html=runHTML(a);if(area.innerHTML!==html)area.innerHTML=html;
  const running=state.runs.some(r=>r.agentId===a.id&&['running','sending','send_unknown','unknown','waiting_input'].includes(r.state));
  card.querySelector('[data-send] button').disabled=a.state!=='idle'||running||card.dataset.pending==='true';
  card.querySelector('[data-stop]').disabled=!a.tabId||card.dataset.pending==='true';
  card.hidden=!ids.has(a.id);card.style.order=list.findIndex(x=>x.id===a.id);
  if(!card.hidden)area.scrollTop=positions.get(a.id)||0;
 }
 const count=Math.max(1,shown.length),cols=count===1?1:count<=4?2:3;
 $('#agents').style.setProperty('--cols',cols);$('#agents').style.setProperty('--rows',Math.ceil(count/cols));$('#agents').hidden=!shown.length;$('#empty').hidden=!!shown.length;
 renderHistory();
}
function choose(id,zoom=false){const index=filtered().findIndex(a=>a.id===id);if(index<0)return;activeId=id;if(zoom)$('#layout').value='1';pageIndex=Math.floor(index/Number($('#layout').value));renderBoard();document.getElementById('tab-'+id)?.scrollIntoView({block:'nearest',inline:'nearest'});}
function focusAgent(){
 if(location.hash===focusedHash||!/^#agent-[0-9a-f-]{36}$/.test(location.hash)||!state)return;
 const id=location.hash.slice(7),a=state.agents.find(a=>a.id===id);if(!a)return;focusedHash=location.hash;
 if(a.state==='terminated'){renderHistory();$('#history-agent').value=id;renderHistory();$('#history-dialog').showModal();return;}
 $('#scope').value='all';renderBoard();choose(id,true);cards.get(id)?.focus({preventScroll:true});
}
window.addEventListener('hashchange',()=>{focusedHash='';focusAgent();});
for(const id of ['scope','place','agent-choice'])$('#'+id).onchange=()=>{pageIndex=0;activeId='';renderBoard();};
$('#layout').onchange=()=>{pageIndex=Math.max(0,Math.floor(filtered().findIndex(a=>a.id===activeId)/Number($('#layout').value)));renderBoard();};
$('#previous').onclick=()=>{pageIndex--;renderBoard();};$('#next').onclick=()=>{pageIndex++;renderBoard();};
$('#agent-tabs').onclick=e=>{const b=e.target.closest('[data-agent]');if(b)choose(b.dataset.agent);};
$('#agent-tabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const list=filtered(),i=list.findIndex(a=>a.id===activeId);const next=e.key==='Home'?0:e.key==='End'?list.length-1:(i+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;if(list[next]){choose(list[next].id);document.getElementById('tab-'+activeId).focus();}};
for(const b of document.querySelectorAll('[data-open]'))b.onclick=()=>$('#'+b.dataset.open).showModal();
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
$('#history-agent').onchange=renderHistory;
async function api(path,body,method='POST'){
 const response=await fetch('/api/direct'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'操作に失敗しました');return value;
}
async function action(form,fn){const buttons=[...form.querySelectorAll('button')],card=form.closest('.agent-panel');if(card)card.dataset.pending='true';buttons.forEach(b=>b.disabled=true);$('#error').textContent='';document.querySelectorAll('.dialog-error').forEach(el=>el.textContent='');try{await fn();await refresh();}catch(e){const target=document.querySelector('dialog[open] .dialog-error')||$('#error');target.textContent=e.message;}finally{if(card)card.dataset.pending='false';buttons.forEach(b=>b.disabled=false);if(state)renderBoard();}}
function places(){const w=state?.workshops.find(w=>w.id===$('#agent-form [name=workshopId]').value);options($('#agent-form [name=cwd]'),(w?.workplaces||[]).map(p=>({id:p,name:p})));}
function render(){
 $('#workshops').innerHTML=state.workshops.map(w=>`<div class="workshop"><strong>${esc(w.name)}</strong><div class="meta">${w.connectionType==='local'?'ローカル（村長PC）':'SSH · '+esc(w.sshHost)}</div><button class="secondary" data-edit="${esc(w.id)}">編集</button></div>`).join('')||'<p>工房を登録してください。</p>';
 options($('#agent-form [name=workshopId]'),state.workshops);places();
 $('#notifications').textContent=`Notify: ${state.notification.latest?.status||(state.notification.destinationConfigured?'設定済み':'未設定')}`;
 $('#notifications').title='sentは通知サーバーの受理。端末への到着は未確認。';renderBoard();
}
async function refresh(){if(refreshing)return;refreshing=true;try{state=await api('',null,'GET');render();focusAgent();$('#connection').textContent='● 接続 · '+new Date().toLocaleTimeString();}catch(e){$('#connection').textContent='接続不明: '+e.message;}finally{refreshing=false;}}
$('#agent-form [name=workshopId]').onchange=places;
$('#agent-form [name=location]').onchange=()=>{if($('#agent-form [name=location]').value==='mayor'){const w=state.workshops.find(w=>w.connectionType==='local');if(w)$('#agent-form [name=workshopId]').value=w.id;$('#agent-form [name=name]').value='秘書';places();}};
function connectionFields(){const local=$('#workshop-form [name=connectionType]').value==='local';$('#ssh-host-field').hidden=local;$('#workshop-form [name=sshHost]').required=!local;}
$('#workshop-form [name=connectionType]').onchange=connectionFields;
$('#workshop-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;action(f,async()=>{const x=Object.fromEntries(new FormData(f));await api('/workshops'+(x.id?'/'+x.id:''),{...x,workplaces:x.workplaces.split('\n').map(s=>s.trim()).filter(Boolean)},x.id?'PUT':'POST');f.reset();connectionFields();$('#workshop-title').textContent='工房を登録';});};
$('#reset-workshop').onclick=()=>{$('#workshop-form').reset();connectionFields();$('#workshop-title').textContent='工房を登録';};
$('#workshops').onclick=e=>{const id=e.target.dataset.edit;if(!id)return;const w=state.workshops.find(w=>w.id===id);for(const key of ['id','name','connectionType','sshHost','baseUrl','workplaces'])$('#workshop-form').elements[key].value=key==='workplaces'?w[key].join('\n'):(w[key]??(key==='connectionType'?'ssh':''));connectionFields();$('#workshop-title').textContent='工房を編集';};
$('#agent-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;f.dataset.requestId ||= newRequestId();action(f,async()=>{const a=await api('/agents',{...Object.fromEntries(new FormData(f)),requestId:f.dataset.requestId});delete f.dataset.requestId;$('#settings-dialog').close();$('#scope').value='all';activeId=a.id||'';await refresh();if(a.id)choose(a.id,true);});};
$('#agents').onsubmit=e=>{e.preventDefault();const f=e.target;f.dataset.requestId ||= newRequestId();action(f,async()=>{await api('/agents/'+f.dataset.send+'/runs',{instruction:f.elements.instruction.value,requestId:f.dataset.requestId});delete f.dataset.requestId;f.reset();});};
$('#agents').onclick=e=>{const stop=e.target.closest('[data-stop]'),zoom=e.target.closest('[data-zoom]');if(stop)action(stop.closest('article'),()=>api('/agents/'+stop.dataset.stop+'/stop',{}));if(zoom)choose(zoom.dataset.zoom,true);};
await refresh();setInterval(refresh,2000);
