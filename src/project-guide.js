import {agentPlaceName} from './agent-identity.js';
import {reportHTML} from './report-content.js';
import {updateReportHTML} from './report-visuals.js';

export function projectGuideViewer(){
 const dialog=document.createElement('dialog');dialog.id='project-guide-dialog';dialog.setAttribute('aria-labelledby','project-guide-title');
 dialog.innerHTML='<header><h2 id="project-guide-title">秘書のプロフィール</h2><button type="button" data-close aria-label="プロフィールを閉じる">閉じる</button></header><dl class="secretary-profile"></dl><h3>秘書の方針</h3><p data-project></p><p>このProjectの秘書用の方針です。他Project・工房Agent・報告専用工程には適用しません。</p><button type="button" data-reload>再読込</button><p role="status" aria-live="polite"></p><div class="guide-body" tabindex="0" aria-label="方針の本文"></div>';
 document.body.append(dialog);
 const status=dialog.querySelector('[role=status]'),body=dialog.querySelector('.guide-body');let current,serial=0,controller;
 function invalidate(){serial++;controller?.abort();controller=null;}
 async function load(){
  invalidate();const version=serial;controller=new AbortController();
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
 return {open(agent,project){
  current=project;
  const profile=dialog.querySelector('.secretary-profile');profile.replaceChildren();
  for(const [label,value] of [['名前',agent.name],['役割','秘書'],['Project',project?.name||(agent.projectId?'登録情報を確認できません':'未所属')],['場所',agentPlaceName(agent)],['AI',agent.provider==='claude'?'Claude':agent.provider==='codex'?'Codex':'未登録']]){
   const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;profile.append(term,detail);
  }
  dialog.querySelector('[data-project]').textContent='対象Project: '+(project?.name||(agent.projectId?'登録情報を確認できません':'未所属'));
  if(!dialog.open)dialog.showModal();void load();
 }};
}
