import {modelFields} from './model-usage.js';
import {registeredRole} from './status-icon.js';
import {reportHTML} from './report-content.js';
import {updateReportHTML} from './report-visuals.js';

export function agentProfileViewer(){
 const dialog=document.createElement('dialog');dialog.id='agent-profile-dialog';dialog.setAttribute('aria-labelledby','agent-profile-title');
 dialog.innerHTML='<header><h2 id="agent-profile-title">Agentのプロフィール</h2><button type="button" data-close aria-label="プロフィールを閉じる">閉じる</button></header><dl class="profile-fields"></dl><dl class="profile-fields" data-model-fields></dl><section class="profile-guide"><h3>秘書の方針</h3><p data-project></p><p>このProjectの秘書用の方針です。他Project・工房Agent・報告専用工程には適用しません。</p><button type="button" data-reload>再読込</button><p role="status" aria-live="polite"></p><div class="guide-body" tabindex="0" aria-label="方針の本文"></div></section>';
 document.body.append(dialog);
 const status=dialog.querySelector('[role=status]'),body=dialog.querySelector('.guide-body');let selectedId,current,secretary=false,serial=0,controller;
 function invalidate(){serial++;controller?.abort();controller=null;}
 async function load(){
  invalidate();if(!secretary)return;const version=serial;controller=new AbortController();
  updateReportHTML(body,'');status.textContent='読込中…';body.setAttribute('aria-busy','true');
  if(!current?.id){status.textContent='Project未所属のため、秘書の方針は未設定です。';body.removeAttribute('aria-busy');return;}
  try{
   const response=await fetch('/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:['projects','guide',current.id]}),signal:controller.signal});
   const data=await response.json();if(version!==serial||!dialog.open)return;
   if(!response.ok||!data.ok)throw Error('request failed');
   const guide=data.result;
   if(!guide?.available){status.textContent='このProjectの秘書の方針は未設定です。';return;}
   if(guide.projectId!==current.id||typeof guide.content!=='string')throw Error('invalid guide');
   updateReportHTML(body,reportHTML(guide.content));body.scrollTop=0;status.textContent='最新版を表示しています。';
  }catch(error){if(version===serial&&dialog.open&&error.name!=='AbortError')status.textContent='方針を取得できませんでした。再読込してください。';}
  finally{if(version===serial)body.removeAttribute('aria-busy');}
 }
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
  invalidate();updateReportHTML(body,'');status.textContent='';body.removeAttribute('aria-busy');
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
