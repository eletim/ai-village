import {reportHTML} from './report-content.js';
import {updateReportHTML} from './report-visuals.js';

export function projectGuideViewer(){
 const dialog=document.createElement('dialog');dialog.id='project-guide-dialog';dialog.setAttribute('aria-labelledby','project-guide-title');
 dialog.innerHTML='<header><h2 id="project-guide-title">秘書の方針</h2><button type="button" data-close aria-label="秘書の方針を閉じる">閉じる</button></header><p data-project></p><p>このProjectの秘書用の方針です。他Project・工房Agent・報告専用工程には適用しません。</p><button type="button" data-reload>再読込</button><p role="status" aria-live="polite"></p><div class="guide-body" tabindex="0" aria-label="方針の本文"></div>';
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
 return {open(project){current=project;dialog.querySelector('[data-project]').textContent='対象Project: '+(project?.name||'未所属');if(!dialog.open)dialog.showModal();void load();}};
}
