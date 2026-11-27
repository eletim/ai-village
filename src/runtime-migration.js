import {stoppedRuntimeEvidence} from './stopped-runtime.js';
import {escapeReport as esc} from './report-content.js';
// Replacement retains the Agent. The immutable pending operation is a local
// receipt, not permission to retry workspace creation.
export function runtimeMigration({api,newId}){
 const dialog=document.createElement('dialog');dialog.id='runtime-migration-dialog';dialog.setAttribute('aria-label','セッションの切替');document.body.append(dialog);
 let id='',snapshot=null,busy=false,pending=null,message='',notes='';
 const key=()=> 'village-runtime-migration:'+id;
 const agent=()=>snapshot?.agents.find(a=>a.id===id);
 function render(){
  const a=agent(),unresolved=(snapshot?.runs||[]).some(r=>r.agentId===id&&(['sent','running'].includes(r.runModel?.state?.kind)||r.runModel?.state?.outcome==='unconfirmed'));
  const ready=a&&stoppedRuntimeEvidence(a)&&!unresolved&&a.provider==='codex'&&a.connection?.connectionType==='local';
  dialog.innerHTML=`<header><h2>セッションの切替</h2><button data-close>閉じる</button></header><p role="status">${esc(message)}</p><button data-refresh ${busy?'disabled':''}>状態を再確認</button>${a?`<h3>${esc(a.name)}</h3><p>同じAgentの中に新しいセッションを準備します。仕事・入力・成果・過去の履歴は保持します。別Agentの作成や選択は不要です。</p><p>${ready?'管理対象の停止記録があります。切替時に現在の不在を再確認します。':unresolved?'受付または終了が未確認です。先に秘書へ状態確認を依頼してください。':a.provider!=='codex'||a.connection?.connectionType!=='local'?'この接続先のセッション交換は未対応です。通常の入力と状態確認は利用できます。':'先に現在の状態と成果を確認し、停止権限のある担当がこのAgentを停止してください。この画面は停止しません。'}</p><label>引継ぎ内容<textarea name="handover" rows="6" maxlength="30000" ${busy||pending?'disabled':''}>${esc(notes)}</textarea></label><p>実施済みの外部操作、残作業、不明点を記載してください。セッション交換は成果プロセスの終了や仕事の再実行を指示しません。</p><button data-adopt ${!ready||busy||pending?'disabled':''}>このAgentのセッションを交換</button>${a.runtimeUpgrade?.candidate?`<p>準備結果は${esc(a.runtimeUpgrade.state)}です。${esc(a.runtimeUpgrade.error||'登録先の確認が必要です')} 新しい作成は行いません。</p>`:''}`:''}${pending?'<p>受付の確認が必要です。内容を変えて送信し直さないでください。</p>':''}`;
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-refresh]').onclick=load;
  dialog.querySelector('[name=handover]')?.addEventListener('input',e=>notes=e.target.value);
  dialog.querySelector('[data-adopt]')?.addEventListener('click',async()=>{
   if(!ready||busy||pending||!notes.trim())return;
   const receipt={path:'/human/agents/'+encodeURIComponent(id)+'/adopt-runtime',body:{operationId:newId(),revision:a.metadataRevision||0,handover:notes},label:'同Agentのセッション交換'};
   try{localStorage.setItem(key(),JSON.stringify(receipt));pending=receipt;}catch{message='操作記録を保存できないため送信しません';render();return;}
   busy=true;render();try{const result=await api(receipt.path,receipt.body);if(result.state==='unknown'||result.candidate){message=result.error||'準備結果の確認が必要です';}else{localStorage.removeItem(key());pending=null;snapshot=null;try{snapshot=await api('',undefined,'GET');}catch{}message='セッション交換を確認しました。仕事の継続は成果を確認した上で通常のfollowupを使います。';}}catch(e){if(e.status>=400&&e.status<500&&![408,429].includes(e.status)){localStorage.removeItem(key());pending=null;message='操作は拒否されました。状態を再確認してから修正できます。 '+e.message;}else message='受付を確定できません。状態を再確認してください。 '+e.message;}finally{busy=false;render();}
  });
 }
 async function load(){
  if(busy)return;busy=true;render();try{snapshot=await api('',undefined,'GET');const receipt=agent()?.runtimeMigrations?.find(m=>m.operationId===pending?.body?.operationId);if(receipt){localStorage.removeItem(key());pending=null;message='保存された切替記録を確認しました。再実行していません。';}else message='保存状態です。受付不明の操作は自動再送しません。';}catch(e){message='現在の状態を確認できません。 '+e.message;}finally{busy=false;render();}
 }
 return {open(agentId){if(busy)return;id=agentId;snapshot=null;notes='';message='';try{pending=JSON.parse(localStorage.getItem(key())||'null');notes=pending?.body?.handover||'';}catch{pending={};message='操作記録を読み取れません。削除せず確認してください';}render();if(!dialog.open)dialog.showModal();void load();}};
}
