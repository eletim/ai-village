import {escapeReport as esc} from './report-content.js';

// A pending human operation is an immutable receipt, not a new request on retry.
// localStorage keeps it across reloads; no credentials are stored here.
export function runtimeMigration({api,newId}){
 const dialog=document.createElement('dialog');dialog.id='runtime-migration-dialog';dialog.setAttribute('aria-label','セッションの切替');document.body.append(dialog);
 let id='',snapshot,selected='',busy=false,message='',pending=null,storageError=false,verified=false;
 const key=agentId=>'village-runtime-migration:'+agentId;
 const agent=()=>snapshot?.agents.find(a=>a.id===id);
 const idle=a=>a?.agentModel?.observation?.activity==='idle'&&a?.agentModel?.observation?.process==='alive'&&a?.agentModel?.observation?.connected===true;
 const activeRuns=a=>(snapshot?.runs||[]).filter(r=>r.agentId===a?.id&&['sent','running'].includes(r.runModel?.state?.kind||r.state));
 const normalBoundary=a=>{
  const runs=(snapshot?.runs||[]).filter(r=>r.agentId===a?.id&&(r.runModel?.state?.kind||r.state)!=='queued').sort((x,y)=>String(y.createdAt||'').localeCompare(String(x.createdAt||'')));
  if(!runs.length)return true;const r=runs[0];return r.runModel?.state?.kind==='ended'&&r.runModel.state.outcome==='normal'||!r.runModel&&r.state==='completed';
 };
 const owned=a=>(snapshot?.requests||[]).flatMap(q=>(q.requestGraph?.nodes||[]).filter(n=>n.assignee===a?.id).map(n=>({q,n})));
 const unused=a=>!(snapshot?.runs||[]).some(r=>r.agentId===a.id)&&!owned(a).length&&!(a.nativeTurns||[]).length;
 const compatible=(a,b)=>['provider','location','projectId','workshopId','cwd'].every(k=>(a[k]||null)===(b[k]||null))&&JSON.stringify(a.connection)===JSON.stringify(b.connection);
 const candidates=()=>snapshot?.agents.filter(b=>b.id!==id&&!b.deletedAt&&!b.runtimeRetiredTo&&b.inputEnvelope?.mode==='startup-v2')||[];
 const editable=()=>!busy&&!pending&&!storageError&&verified;
 function persist(value){localStorage.setItem(key(id),JSON.stringify(value));pending=value;}
 function read(){try{pending=JSON.parse(localStorage.getItem(key(id))||'null');storageError=false;}catch{storageError=true;message='操作記録を読み込めません。記録を削除せず管理者に確認してください。';}}
 function render(){
  const a=agent(),donor=snapshot?.agents.find(b=>b.id===selected),prepared=a?.runtimeUpgrade?.state==='prepared',v2=a?.inputEnvelope?.mode==='startup-v2';
  const notes=dialog.querySelector('[name=handover]')?.value||pending?.body?.handover||'',resumeText=dialog.querySelector('[name=resumeText]')?.value||'',resumeTarget=dialog.querySelector('[name=resumeTarget]')?.value||'';
  const ready=a&&prepared&&idle(a)&&normalBoundary(a)&&!activeRuns(a).length&&donor&&compatible(a,donor)&&unused(donor)&&idle(donor);
  dialog.innerHTML=`<header><h2>セッションの切替</h2><button type="button" data-close>閉じる</button></header><p role="status">${esc(storageError?'操作記録を保存・読込できません。記録を消去せず管理者に確認してください。':message)}</p><button type="button" data-refresh ${busy?'disabled':''}>状態を再確認</button>${a?`
   <h3>${esc(a.name)}</h3><p>現在の契約: <strong>${v2?'短い起動契約（v2）':a.runtimeRetiredTo?'旧セッション保管':'移行待ち'}</strong> ／ ${idle(a)?'待機中':'実行状態の確認が必要'} ／ 追跡中 ${activeRuns(a).length}件</p>${!normalBoundary(a)?'<p>直近の実行の正常終了を確認できません。失敗・中断・不明は確認し、強制切替しないでください。</p>':''}
   <p>このAgentと依頼のIDは維持します。他のAgentは停止しません。切替準備後も実行中の処理は正常終了を待ちます。</p>
   ${a.legacyContract?'<p>旧契約で継続中です。確認日が過ぎても自動停止しません。</p>':''}
   ${!v2&&!a.runtimeRetiredTo?`<label>新セッション候補<select name="donor" ${!editable()?'disabled':''}><option value="">選択してください</option>${candidates().map(b=>`<option value="${esc(b.id)}" ${b.id===selected?'selected':''}>${esc(b.name)} — ${compatible(a,b)?'属性適合':'属性不一致'} / ${unused(b)?'登録履歴未使用':'使用済み'} / ${idle(b)?'待機中':'実行状態を確認'}</option>`).join('')}</select></label>
   <p>属性適合はProject・場所・AI・工房・作業場所・接続の一致です。実機の未使用状態は切替時にサーバーでも確認します。</p>
   <label>引継ぎメモ<textarea name="handover" rows="8" maxlength="30000" ${!editable()?'disabled':''} placeholder="元の目的、完了事項、未完事項、実施済み外部操作、不明点を確認して記入">${esc(notes)}</textarea></label>
   <p>秘密情報や認証情報は記入しないでください。過去の依頼・補足・子結果は新セッションから取得できます。未記録の操作は推測しません。</p>
   <button type="button" data-prepare ${!editable()||prepared?'disabled':''}>このAgentの切替を準備</button>
   <button type="button" data-adopt ${!editable()||!ready?'disabled':''}>確認した新セッションへ切替</button>
   ${prepared?`<p>${ready?'引継ぎメモを確認して切替できます。':'次の送信を保留しています。正常終了・待機状態と候補を確認してください。強制停止はしません。'}</p>`:''}`:''}
   ${v2?`<section><h3>同じ依頼のレビューを再開</h3><p>結果配送や実行が進んでいる場合は追加送信しません。再開が必要な依頼だけ選び、補足を明示送信します。成果の採否・完了は変更しません。</p><label>対象の依頼<select name="resumeTarget" ${!editable()?'disabled':''}><option value="">選択してください</option>${owned(a).filter(({n})=>n.state.kind==='active').map(({q,n})=>`<option value="${esc(q.id+':'+n.id)}" ${q.id+':'+n.id===resumeTarget?'selected':''}>${esc((n.metadata?.instruction||q.instruction||'依頼').slice(0,100))}</option>`).join('')}</select></label><label>再開する内容<textarea name="resumeText" rows="3" maxlength="12000" ${!editable()?'disabled':''}>${esc(resumeText)}</textarea></label><button type="button" data-resume ${!editable()?'disabled':''}>対象を確認してレビュー再開</button></section>`:''}`:''}
   ${pending?`<p>未確認の操作: ${esc(pending.label)}。内容と操作IDを保持しています。新しい操作を作らず同じ内容で受付を確認します。</p><button type="button" data-retry ${busy?'disabled':''}>同じ操作で受付を確認</button>`:''}`;
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-refresh]').onclick=load;
  dialog.querySelector('[name=donor]')?.addEventListener('change',e=>{selected=e.target.value;render();});
  dialog.querySelector('[data-prepare]')?.addEventListener('click',()=>start('prepare-runtime',{revision:a.metadataRevision||0},'切替準備'));
  dialog.querySelector('[data-adopt]')?.addEventListener('click',()=>{
   const handover=dialog.querySelector('[name=handover]').value.trim();if(!handover){message='引継ぎメモを入力してください。';render();return;}
   if(ready)void start('adopt-runtime',{revision:a.metadataRevision||0,replacementAgentId:donor.id,replacementRevision:donor.metadataRevision||0,handover},'セッション切替');
  });
  dialog.querySelector('[data-resume]')?.addEventListener('click',()=>{
   const target=dialog.querySelector('[name=resumeTarget]').value,instruction=dialog.querySelector('[name=resumeText]').value.trim();
   if(!target||!instruction){message='対象の依頼と再開する内容を指定してください。';render();return;}
   const [humanRequestId,workId]=target.split(':'),entry=owned(a).find(x=>x.q.id===humanRequestId&&x.n.id===workId);
   const queued=(snapshot.runs||[]).some(r=>r.workId===workId&&['queued','sent','running'].includes(r.runModel?.state?.kind||r.state));
   const unread=(entry?.n.inbox||[]).some(i=>!i.handledBy&&!i.retiredBy);
   const resultWaiting=(entry?.q.requestGraph?.nodes||[]).some(n=>n.parentId===workId&&!['completed','withdrawn'].includes(n.state.kind));
   if(resultWaiting||!entry||entry.n.state.kind!=='active'||!idle(a)||queued||unread){message='未処理入力・実行・配送待ちがあります。状態を再確認し、既存の再開を待ってください。';render();return;}
   void start('supplement',{humanRequestId,workId,instruction},'レビュー再開');
  });
  dialog.querySelector('[data-retry]')?.addEventListener('click',send);
 }
 async function load(){
  if(busy)return;const target=id;busy=true;render();
  try{const value=await api('',undefined,'GET');if(target!==id)return;snapshot=value;verified=true;message='最新の状態です。操作前に対象と内容を確認してください。';}
  catch{verified=false;message='状態を取得できませんでした。明示的に再確認してください。';}
  finally{busy=false;if(target===id)render();}
 }
 async function start(action,body,label){
  if(!editable())return;
  read();if(pending||storageError){message='未確認の操作を先に確認してください。';render();return;}
  const path=action==='supplement'?'/human/requests/supplement':'/human/agents/'+encodeURIComponent(id)+'/'+action;
  try{persist({path,body:{operationId:newId(),...body},label});}catch{storageError=true;message='操作記録を保存できないため送信しません。';render();return;}
  await send();
 }
 async function send(){
  if(busy||!pending)return;busy=true;const target=id,receipt=pending;message='受付を確認中…';render();
  try{
   await api(receipt.path,receipt.body);localStorage.removeItem(key(target));if(target!==id)return;pending=null;message=receipt.label+'を受け付けました。';
   try{snapshot=await api('',undefined,'GET');verified=true;}catch{verified=false;message+=' 状態の読込に失敗しました。状態を再確認してください。';}
  }catch(error){
   if(target!==id)return;
   if(error.status>=400&&error.status<500&&![408,429].includes(error.status)){
    localStorage.removeItem(key(target));pending=null;verified=false;message='操作は拒否されました。状態を再確認してください。 '+error.message;
   }else message='受付を確定できません。同じ操作で確認してください。自動再送はしません。';
  }finally{busy=false;if(target===id)render();}
 }
 return {open(agentId){if(busy)return;dialog.replaceChildren();id=agentId;snapshot=null;verified=false;selected='';message='';read();render();if(!dialog.open)dialog.showModal();void load();}};
}
