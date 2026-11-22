import {requestProgress} from './request-progress.js';
import {escapeReport as esc} from './report-content.js';
// Local dialog state is only a view; each mutation uses a fetched revision and
// retains the same operation ID after ambiguous transport failures.
export function bindRequestComposition({state,api,refresh,newId}){
 const dialog=document.createElement('dialog');dialog.id='request-composition-dialog';dialog.setAttribute('aria-label','依頼の構成');document.body.append(dialog);
 let agentId,full,selected='',pending=null;
 const title=n=>n.metadata?.instruction||full.instruction||'依頼';
 const preview=n=>{const chars=Array.from(title(n).replace(/\s+/gu,' ').trim());return chars.slice(0,80).join('')+(chars.length>80?'…':'');};
 const available=()=>state().agents.filter(a=>!a.deletedAt&&!['terminated','stopping'].includes(a.state));
 function options(n){const ancestors=new Set();let p=n;while(p){ancestors.add(p.assignee);p=full.requestGraph.nodes.find(x=>x.id===p.parentId);}return '<option value="">担当は後で選ぶ</option>'+available().filter(a=>!ancestors.has(a.id)).map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');}
 function reporting(n){
  if(!full.commonRequests)return '';const s=n.metadata?.reporting||{version:1,completionAt:null,reportAt:null,reports:[]};
  const date=value=>value?new Date(value).toLocaleString():'指定なし';
  const latest=s.reports?.at(-1),overdue=Object.keys(s.expired||{}).length>0;
  return `<div class="request-reporting"><p>完成期限: ${esc(date(s.completionAt))} ／ 次回報告: ${esc(date(s.reportAt))}</p>${overdue?'<p role="status">期限超過：依頼元の判断待ち</p>':''}${latest?`<p>最新報告（${esc(date(latest.at))}）: ${esc(latest.text)}</p>`:''}${!n.parentId&&n.state.kind==='active'&&!full.report?`<form data-deadline-work="${esc(n.id)}" data-version="${s.version}"><details><summary>期限を設定・変更</summary><label>完成期限<input type="datetime-local" name="completionAt"></label><label>次回報告期限<input type="datetime-local" name="reportAt"></label><label>変更理由<input name="reason" required maxlength="4000"></label><p>空欄の期限は指定なしになります。現在の期限を使う場合は入力してください。</p><button>期限を保存</button></details></form>`:''}</div>`;
 }
 function render(){
  const requests=(state().requests||[]).filter(q=>q.requestGraph?.nodes.some(n=>n.assignee===agentId));
  const nodes=full?.requestGraph?.nodes||[];
  const editable=full?.commonRequests&&full.status==='active'&&!full.report;
  function tree(n){const children=nodes.filter(c=>c.parentId===n.id),progress=requestProgress(full,n.id,state().agents),label=progress.label;return `<li data-compose-node="${esc(n.id)}" tabindex="-1"><strong>${esc(preview(n))}</strong><p>${esc(state().agents.find(a=>a.id===n.assignee)?.name||'担当未定')} · ${esc(label)}</p>${progress.waiting?`<p>${esc(progress.waiting)}</p>`:''}${progress.replacesId?`<button type="button" data-compose-jump="${esc(progress.replacesId)}">← 元の依頼</button>`:''}${progress.replacementId?`<button type="button" data-compose-jump="${esc(progress.replacementId)}">再依頼へ →</button>`:''}<details><summary>指示本文</summary><pre class="request-history-text">${esc(title(n))}</pre></details>${(full.runs||[]).filter(r=>r.workId===n.id&&(r.finalOutput||r.output)).map(r=>`<details><summary>成果・応答 ${esc(r.completedAt||r.createdAt||'')}</summary><pre class="request-history-text">${esc(r.finalOutput||r.output)}</pre></details>`).join('')}${editable&&n.planned&&n.state.kind==='active'?`<div class="request-plan-controls"><select aria-label="子依頼の担当" data-assignee="${esc(n.id)}">${options(nodes.find(x=>x.id===n.parentId))}</select><button data-compose-action="assignPlan" data-work="${esc(n.id)}">担当を保存</button><button data-compose-action="launch" data-work="${esc(n.id)}">開始</button><button data-compose-action="discard" data-work="${esc(n.id)}">取り下げ</button></div>`:''}${reporting(n)}${children.length?'<ul>'+children.map(tree).join('')+'</ul>':''}</li>`;}
  dialog.innerHTML=`<div class="dialog-heading"><h2>依頼の構成</h2><button type="button" data-compose-close>閉じる</button></div><p class="dialog-error" role="alert"></p><label>依頼<select data-compose-request><option value="">依頼を選ぶ</option>${requests.map(q=>`<option value="${esc(q.id)}" ${q.id===selected?'selected':''}>${esc((q.instruction||'依頼').slice(0,100))}</option>`).join('')}</select></label>${full?`<ul class="request-tree">${nodes.filter(n=>!n.parentId).map(tree).join('')}</ul>${editable?`<form data-compose-plan><label>分割する親依頼<select name="parentWorkId">${nodes.filter(n=>n.state.kind==='active'&&!n.planned).map(n=>`<option value="${esc(n.id)}">${esc(title(n).slice(0,100))}</option>`).join('')}</select></label><label>子依頼の目的・完了条件<textarea name="instruction" required maxlength="16000" rows="3"></textarea></label><label>担当<select name="agentId"></select></label><p>子依頼を保存してから開始できます。成果は親依頼の担当者が取りまとめます。</p><button>子依頼を追加</button></form>`:full.commonRequests?'<p>この依頼の構成は変更できません。</p>':'<p>旧形式の依頼です。分割は新しい依頼で利用できます。</p>'}`:'<p>親子関係を確認する依頼を選んでください。</p>'}`;
  for(const n of nodes.filter(n=>n.planned)){const el=dialog.querySelector(`[data-assignee="${n.id}"]`);if(el)el.value=n.assignee||'';}
  const f=dialog.querySelector('[data-compose-plan]');if(f){const update=()=>{f.elements.agentId.innerHTML=options(nodes.find(n=>n.id===f.elements.parentWorkId.value));};const own=nodes.find(n=>n.assignee===agentId&&n.state.kind==='active'&&!n.planned);if(own)f.elements.parentWorkId.value=own.id;f.elements.parentWorkId.onchange=update;update();}
 }
 const error=e=>{dialog.querySelector('[role=alert]').textContent=e.message;};
 async function load(id){selected=id;full=id?await api('/requests/get',{humanRequestId:id}):null;render();}
 async function mutate(action,fields){
  const signature=JSON.stringify({action,fields});if(pending&&pending.signature!==signature)throw Error('前の操作の受付を確認してください。同じ操作を再度押すと確認できます。');
  pending ||= {signature,body:{humanRequestId:full.id,revision:full.revision,operationId:newId(),...fields}};
  const controls=[...dialog.querySelectorAll('button,input,textarea,select')];controls.forEach(e=>e.disabled=true);
  try{await api('/human/requests/'+action,pending.body);pending=null;await refresh(true);await load(selected);}
  catch(e){if(e.status&&e.status<500){pending=null;if(e.status===409)await load(selected);}throw e;}
  finally{controls.forEach(e=>e.disabled=false);}
 }
 dialog.addEventListener('change',e=>{if(e.target.matches('[data-compose-request]')){if(pending){e.target.value=selected;error(Error('前の操作の受付確認が必要です'));return;}void load(e.target.value).catch(error);}});
 dialog.addEventListener('submit',e=>{if(e.target.matches('[data-deadline-work]')){e.preventDefault();const fields=Object.fromEntries(new FormData(e.target));for(const key of ['completionAt','reportAt'])fields[key]=fields[key]?new Date(fields[key]).toISOString():null;void mutate('deadline',{...fields,workId:e.target.dataset.deadlineWork,expectedVersion:Number(e.target.dataset.version)}).catch(error);return;}if(!e.target.matches('[data-compose-plan]'))return;e.preventDefault();void mutate('plan',Object.fromEntries(new FormData(e.target))).catch(error);});
 dialog.addEventListener('click',e=>{const jump=e.target.closest('[data-compose-jump]');if(jump){const target=[...dialog.querySelectorAll('[data-compose-node]')].find(n=>n.dataset.composeNode===jump.dataset.composeJump);target?.scrollIntoView({block:'center'});target?.focus();return;}if(e.target.closest('[data-compose-close]'))dialog.close();const b=e.target.closest('[data-compose-action]');if(!b)return;const action=b.dataset.composeAction;void mutate(action,{workId:b.dataset.work,...(action==='discard'?{}:{agentId:dialog.querySelector(`[data-assignee="${b.dataset.work}"]`).value})}).catch(error);});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-request-composition]');if(!b)return;if(pending){dialog.showModal();return;}b.closest('dialog')?.close();agentId=b.dataset.requestComposition;full=null;selected='';render();dialog.showModal();});
}
