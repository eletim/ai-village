import {modelFields} from './model-usage.js';
import {registeredRole} from './status-icon.js';
import {reportHTML} from './report-content.js';
import {updateReportHTML} from './report-visuals.js';

export function agentProfileViewer(){
 const dialog=document.createElement('dialog');dialog.id='agent-profile-dialog';dialog.setAttribute('aria-labelledby','agent-profile-title');
 dialog.innerHTML='<header><h2 id="agent-profile-title">Agentのプロフィール</h2><button type="button" data-close aria-label="プロフィールを閉じる">閉じる</button></header><dl class="profile-fields"></dl><dl class="profile-fields" data-model-fields></dl><section class="profile-guide"><h3>秘書の方針</h3><p data-project></p><p>このProjectの秘書用の方針です。他Project・工房Agent・報告専用工程には適用しません。</p><button type="button" data-reload>再読込</button><button type="button" data-guide-edit hidden>編集</button><div data-editor hidden><label>秘書方針の本文<textarea data-policy maxlength="20000" rows="14"></textarea></label><button type="button" data-save>保存</button><button type="button" data-cancel>編集を取り消す</button></div><p role="status" aria-live="polite"></p><div class="guide-body" tabindex="0" aria-label="方針の本文"></div></section>';
 document.body.append(dialog);
 const status=dialog.querySelector('[role=status]'),body=dialog.querySelector('.guide-body');let selectedId,current,secretary=false,serial=0,controller,guide;
 const edit=dialog.querySelector('[data-guide-edit]'),editor=dialog.querySelector('[data-editor]'),textarea=dialog.querySelector('[data-policy]'),save=dialog.querySelector('[data-save]'),reload=dialog.querySelector('[data-reload]');
 const cancel=dialog.querySelector('[data-cancel]');
 function stopEditing(){cancel.disabled=false;textarea.disabled=false;editor.hidden=true;body.hidden=false;reload.disabled=false;save.disabled=false;}
 function invalidate(){serial++;controller?.abort();controller=null;}
 async function load(){
  invalidate();stopEditing();edit.hidden=true;guide=null;if(!secretary)return;const version=serial;controller=new AbortController();
  updateReportHTML(body,'');status.textContent='読込中…';body.setAttribute('aria-busy','true');
  if(!current?.id){status.textContent='Project未所属のため、秘書の方針は未設定です。';body.removeAttribute('aria-busy');return;}
  try{
   const response=await fetch('/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:['projects','guide',current.id]}),signal:controller.signal});
   const data=await response.json();if(version!==serial||!dialog.open)return;
   if(!response.ok||!data.ok)throw Error('request failed');
   guide=data.result;
   if(!guide?.available){status.textContent='このProjectの秘書の方針は未設定です。';return;}
   if(guide.projectId!==current.id||typeof guide.content!=='string')throw Error('invalid guide');
   edit.hidden=typeof guide.revision!=='string';
   updateReportHTML(body,reportHTML(guide.content));body.scrollTop=0;status.textContent='最新版を表示しています。';
  }catch(error){if(version===serial&&dialog.open&&error.name!=='AbortError')status.textContent='方針を取得できませんでした。再読込してください。';}
  finally{if(version===serial)body.removeAttribute('aria-busy');}
 }
 edit.onclick=()=>{textarea.value=guide.content;editor.hidden=false;body.hidden=true;edit.hidden=true;reload.disabled=true;status.textContent='編集内容は保存するまで反映されません。';textarea.focus();};
 cancel.onclick=()=>{stopEditing();edit.hidden=!guide;status.textContent='編集を取り消しました。再読込で最新版を取得できます。';};
 save.onclick=async()=>{
  const version=serial,id=current.id,revision=guide.revision;
  if(!textarea.value.trim()){status.textContent='方針の本文を入力してください。';return;}
  save.disabled=true;cancel.disabled=true;textarea.disabled=true;status.textContent='保存中…';
  try{
   const response=await fetch('/api/direct/human/projects/'+encodeURIComponent(id)+'/guide',{method:'PUT',headers:{'Content-Type':'application/json','X-Village-Human-UI':'1'},body:JSON.stringify({revision,content:textarea.value}),signal:AbortSignal.timeout(30000)});
   const data=await response.json();if(version!==serial||!dialog.open)return;
   if(!response.ok)throw Error(data.error||'保存できませんでした。');
   guide=data;stopEditing();edit.hidden=false;updateReportHTML(body,reportHTML(guide.content));status.textContent='保存しました。';
  }catch(error){if(version===serial&&dialog.open)status.textContent=error.message+' 下書きは保持しています。再読込する場合は本文を控え、編集を取り消してください。';}
  finally{if(version===serial){save.disabled=false;cancel.disabled=false;textarea.disabled=false;}}
 };
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-reload]').onclick=load;
 dialog.addEventListener('close',()=>{invalidate();updateReportHTML(body,'');});
 function update(agent){
  if(!dialog.open||agent.id!==selectedId)return;
  const host=dialog.querySelector('[data-model-fields]');if(!host)return;
  const fields=modelFields(agent),key=JSON.stringify(fields);if(host.dataset.fields===key)return;host.dataset.fields=key;
  host.replaceChildren();for(const [label,value] of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;host.append(dt,dd);}
 }
 return {update,open(agent,project){
  selectedId=agent.id;
  invalidate();stopEditing();edit.hidden=true;guide=null;updateReportHTML(body,'');status.textContent='';body.removeAttribute('aria-busy');
  const role=registeredRole(agent);secretary=role==='secretary';current=project;
  dialog.querySelector('.profile-guide').hidden=!secretary;
  const profile=dialog.querySelector('.profile-fields');profile.replaceChildren();
  for(const [label,value] of [['名前',agent.name||'名前未登録'],['役割',({secretary:'秘書',worker:'工房Agent'})[role]||'不明'],['Project',project?.name||(agent.projectId?'登録情報を確認できません':'未所属')],['場所',agent.location==='mayor'?'村長の家':agent.location==='workshop'?(agent.connection?.name||'工房（名称未登録）'):'場所未登録・不明'],['AI',agent.provider==='claude'?'Claude':agent.provider==='codex'?'Codex':agent.provider?'不明':'未登録']]){
   const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;profile.append(term,detail);
  }
  dialog.querySelector('[data-project]').textContent='対象Project: '+(project?.name||(agent.projectId?'登録情報を確認できません':'未所属'));
  if(!dialog.open)dialog.showModal();update(agent);if(secretary)void load();
 }};
}
