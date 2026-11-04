const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// getRandomValues is available on VPN HTTP origins where randomUUID is not.
function newRequestId(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const labels={idle:'待機中',busy:'作業中',starting:'起動待ち',creating:'起動中',creation_unknown:'起動結果不明',unknown:'接続・状態不明',waiting_input:'入力待ち',interrupted:'中断',failed:'ランタイムエラー',unavailable:'端末利用不可',terminated:'終了',stopping:'終了処理中',stop_unknown:'終了結果不明',sending:'送信中',running:'応答待ち',send_unknown:'送信結果不明',completed:'応答完了'};
let state,refreshing=false,focusedHash='',view='all';
window.addEventListener('hashchange',()=>{focusedHash='';focusAgent();});
function focusAgent(){
 if(location.hash===focusedHash||!/^#agent-[0-9a-f-]{36}$/.test(location.hash))return;
 const card=document.getElementById(location.hash.slice(1));
 if(card){view=card.closest('[data-place]').dataset.place;setView();}
 if(card){focusedHash=location.hash;card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'start'});}
}
async function api(path,body,method='POST'){
 const response=await fetch('/api/direct'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'操作に失敗しました');return value;
}
async function action(form,fn){const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('#error').textContent='';try{await fn();await refresh();}catch(e){$('#error').textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}}
function places(){const w=state?.workshops.find(w=>w.id===$('#agent-form [name=workshopId]').value);$('#agent-form [name=cwd]').innerHTML=(w?.workplaces||[]).map(p=>`<option>${esc(p)}</option>`).join('');}
function setView(){for(const section of document.querySelectorAll('[data-place]'))section.hidden=view!=='all'&&section.dataset.place!==view;$('#agents').classList.toggle('focused',view!=='all');for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));}
$('#views').onclick=e=>{if(e.target.dataset.view){view=e.target.dataset.view;setView();}};
function render(){
 const locations=[{id:'mayor',name:'村長の家（秘書）'},...[...state.workshops].sort((a,b)=>(a.connectionType==='local'?0:1)-(b.connectionType==='local'?0:1)).map(w=>({id:w.id,name:'工房（'+w.name+'）'}))];
 $('#views').innerHTML=[{id:'all',name:'3拠点を一覧'},...locations].map(l=>`<button data-view="${esc(l.id)}">${esc(l.name)}</button>`).join('');
 for(const l of locations){let section=document.getElementById('place-'+l.id);if(!section){section=document.createElement('section');section.id='place-'+l.id;section.dataset.place=l.id;section.className='location';section.innerHTML='<h2></h2><p class="empty">Agentを起動して配置できます。</p><div class="residents"></div>';$('#agents').append(section);}section.querySelector('h2').textContent=l.name;}
 setView();
 const selected=$('#agent-form [name=workshopId]').value, place=$('#agent-form [name=cwd]').value;
 $('#workshops').innerHTML=state.workshops.map(w=>`<div class="workshop"><strong>${esc(w.name)}</strong><div class="meta">${w.connectionType==='local'?'ローカル（村長PC）':'SSH · '+esc(w.sshHost)}</div><button class="secondary" data-edit="${w.id}">編集</button></div>`).join('')||'<p>工房を登録してください。</p>';
 $('#agent-form [name=workshopId]').innerHTML=state.workshops.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('');
 if(state.workshops.some(w=>w.id===selected))$('#agent-form [name=workshopId]').value=selected;places();if([...$('#agent-form [name=cwd]').options].some(o=>o.value===place))$('#agent-form [name=cwd]').value=place;
 $('#notifications').textContent=`Notify: ${state.notification.latest?.status|| (state.notification.destinationConfigured?'設定済み':'通知先URL未設定')}（sentはサーバー受理。端末への到着は未確認）`;
 for(const a of state.agents){
  let card=document.getElementById('agent-'+a.id);
  if(!card){card=document.createElement('article');card.id='agent-'+a.id;card.innerHTML=`<div class="summary"></div><div class="runs"></div><form data-send="${a.id}"><label>このAgentに直接指示<textarea name="instruction" required maxlength="16000" rows="3"></textarea></label><button>送信</button></form><button class="danger" data-stop="${a.id}">Agentを終了</button>`;const place=a.location==='mayor'?'mayor':a.workshopId||state.workshops[0]?.id||'mayor';const zone=document.getElementById('place-'+place);if(zone){zone.querySelector('.residents').prepend(card);zone.querySelector('.empty').hidden=true;}}
  card.querySelector('.summary').innerHTML=`<h2>${esc(a.name)} · ${a.provider==='claude'?'Claude':'Codex'} <span class="badge">${esc(labels[a.state]||a.state)}</span></h2><p class="meta">${esc(a.connection.name)} · ${a.connection.connectionType==='local'?'ローカル':'SSH'} · ${esc(a.cwd)}<br>${esc(a.id)}</p>${a.terminalUrl?`<a href="${esc(a.terminalUrl)}" target="_blank" rel="noopener">PurpleMuxでタブを開く ↗</a>`:''}<p>${esc(a.currentAction||'')} ${esc(a.error||'')}</p>`;
  const runs=state.runs.filter(r=>r.agentId===a.id);
  const external=(a.nativeTurns||[]).filter(t=>!runs.some(r=>r.turnId===t.id));
  card.querySelector('.runs').innerHTML=runs.map(r=>`<div class="run"><span class="badge">${esc(labels[r.state]||r.state)}</span> <span class="meta">${esc(r.createdAt)} · 達成状況: 未判定</span><h3>指示</h3><pre>${esc(r.instruction)}</pre>${r.output?`<h3>返答</h3><pre>${esc(r.output)}</pre>`:''}<p class="meta">${esc(r.error||'')} ${r.notification?'通知: '+esc(r.notification.status)+(r.notification.reason?' / '+esc(r.notification.reason):''):''}</p></div>`).join('')+external.map(t=>`<div class="run"><span class="badge">PurpleMuxからの入力 · ${esc(labels[t.state]||t.state)}</span><pre>${esc(t.instruction)}</pre><pre>${esc(t.output)}</pre></div>`).join('');
  card.querySelector('[data-send] button').disabled=a.state!=='idle'||runs.some(r=>['running','sending','send_unknown','unknown','waiting_input'].includes(r.state));
  card.querySelector('[data-stop]').disabled=a.state==='terminated'||!a.tabId;
 }
}
async function refresh(){if(refreshing)return;refreshing=true;try{state=await api('',null,'GET');render();focusAgent();$('#connection').textContent='バックエンドに接続 · '+new Date().toLocaleTimeString();}catch(e){$('#connection').textContent='バックエンドとの接続不明: '+e.message;}finally{refreshing=false;}}
$('#agent-form [name=workshopId]').onchange=places;
$('#agent-form [name=location]').onchange=()=>{if($('#agent-form [name=location]').value==='mayor'){const w=state.workshops.find(w=>w.connectionType==='local');if(w)$('#agent-form [name=workshopId]').value=w.id;$('#agent-form [name=name]').value='秘書';places();}};
function connectionFields(){const local=$('#workshop-form [name=connectionType]').value==='local';$('#ssh-host-field').hidden=local;$('#workshop-form [name=sshHost]').required=!local;}
$('#workshop-form [name=connectionType]').onchange=connectionFields;
$('#workshop-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;action(f,async()=>{const x=Object.fromEntries(new FormData(f));await api('/workshops'+(x.id?'/'+x.id:''),{...x,workplaces:x.workplaces.split('\n').map(s=>s.trim()).filter(Boolean)},x.id?'PUT':'POST');f.reset();connectionFields();$('#workshop-title').textContent='工房を登録';});};
$('#reset-workshop').onclick=()=>{$('#workshop-form').reset();connectionFields();$('#workshop-title').textContent='工房を登録';};
$('#workshops').onclick=e=>{const id=e.target.dataset.edit;if(!id)return;const w=state.workshops.find(w=>w.id===id);for(const key of ['id','name','connectionType','sshHost','baseUrl','workplaces'])$('#workshop-form').elements[key].value=key==='workplaces'?w[key].join('\n'):(w[key]??(key==='connectionType'?'ssh':''));connectionFields();$('#workshop-title').textContent='工房を編集';};
$('#agent-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;f.dataset.requestId ||= newRequestId();action(f,async()=>{await api('/agents',{...Object.fromEntries(new FormData(f)),requestId:f.dataset.requestId});delete f.dataset.requestId;});};
$('#agents').onsubmit=e=>{e.preventDefault();const f=e.target;f.dataset.requestId ||= newRequestId();action(f,async()=>{await api('/agents/'+f.dataset.send+'/runs',{instruction:f.elements.instruction.value,requestId:f.dataset.requestId});delete f.dataset.requestId;f.reset();});};
$('#agents').onclick=e=>{const id=e.target.dataset.stop;if(id)action(e.target.closest('article'),()=>api('/agents/'+id+'/stop',{}));};
await refresh();setInterval(refresh,2000);
