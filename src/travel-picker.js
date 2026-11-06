import {normalizeTravelContexts,travelSummary} from './travel-context.js';
export async function travelPicker({initial,onSelect,onManual,onClose,isLocked=()=>false}){
 const dialog=document.createElement('dialog');dialog.className='travel-dialog';dialog.setAttribute('aria-label','出張先');
 dialog.innerHTML=`<h2>出張先</h2><div class="travel-current"></div><p class="travel-error" role="alert"></p><fieldset data-controls>
 <section data-picker><form data-select><label>コンピューター<select name="computer" required></select></label><label>フォルダ<select name="folder" required></select></label><p data-preview></p><button type="submit">添付</button></form><p><button type="button" data-manage>登録・管理</button> <button type="button" data-manual>今回だけ入力</button></p></section>
 <section data-manager hidden><button type="button" data-back>選択に戻る</button>
 <form data-computer><h3>コンピューター</h3><label>編集するコンピューター<select name="id"></select></label><label>表示名<input name="name" required maxlength="120"></label><label>SSH接続先<input name="sshHost" required maxlength="200" placeholder="alias または user@host" spellcheck="false"></label><button type="submit">コンピューターを保存</button> <button type="button" data-delete-computer>削除</button></form>
 <form data-folder><fieldset><h3>このコンピューターのフォルダ</h3><label>編集するフォルダ<select name="id"></select></label><label>表示名<input name="name" required maxlength="120"></label><label>作業ディレクトリ<input name="cwd" required maxlength="2000" spellcheck="false"></label><label>補足<textarea name="notes" maxlength="4000" rows="2"></textarea></label><button type="submit">フォルダを保存</button> <button type="button" data-delete-folder>削除</button></fieldset></form></section>
 <button type="button" data-reload>一覧を再読込</button></fieldset><p><button type="button" data-close>閉じる</button></p>`;
 const $=s=>dialog.querySelector(s),choose=$('[data-select]'),computerForm=$('[data-computer]'),folderForm=$('[data-folder]'),error=$('.travel-error'),controls=$('[data-controls]');
 $('.travel-current').innerHTML=travelSummary(initial);let registry={revision:0,computers:[]},loaded=false,busy=false;
 const options=(select,items,empty,selected='')=>{select.replaceChildren(new Option(empty,''),...items.map(i=>new Option(i.label||i.name,i.id)));select.value=items.some(i=>i.id===selected)?selected:'';};
 const computer=()=>registry.computers.find(c=>c.id===computerForm.elements.id.value);
 const folders=()=>registry.computers.find(c=>c.id===choose.elements.computer.value)?.folders||[];
 function preview(){const c=registry.computers.find(c=>c.id===choose.elements.computer.value),f=folders().find(f=>f.id===choose.elements.folder.value);$('[data-preview]').textContent=f?`${c.sshHost} · ${f.cwd}${f.notes?'\n'+f.notes:''}`:'';choose.querySelector('button').disabled=!f||!loaded;}
 function renderChoice(){const c=choose.elements.computer.value,f=choose.elements.folder.value;options(choose.elements.computer,registry.computers.map(c=>({...c,label:c.name+' · '+c.sshHost})),registry.computers.length?'選択してください':'未登録です。登録・管理から追加できます',c);options(choose.elements.folder,folders().map(f=>({...f,label:f.name+' · '+f.cwd})),'選択してください',f);preview();}
 function renderFolder(){const c=computer(),f=c?.folders.find(f=>f.id===folderForm.elements.id.value);folderForm.querySelector('fieldset').disabled=!c;for(const key of ['name','cwd','notes'])folderForm.elements[key].value=f?.[key]||'';$('[data-delete-folder]').disabled=!f;}
 function renderComputer(){const c=computer();for(const key of ['name','sshHost'])computerForm.elements[key].value=c?.[key]||'';options(folderForm.elements.id,c?.folders||[],'新規登録');$('[data-delete-computer]').disabled=!c;renderFolder();}
 function renderManager(id=computerForm.elements.id.value,folderId=folderForm.elements.id.value){options(computerForm.elements.id,registry.computers.map(c=>({...c,label:c.name+' · '+c.sshHost})),'新規登録',id);renderComputer();folderForm.elements.id.value=computer()?.folders.some(f=>f.id===folderId)?folderId:'';renderFolder();}
 async function request(input){const response=await fetch('/api/travel-registry',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{});const data=await response.json();if(!response.ok)throw Error(data.error||'出張先を取得できません');if(!Number.isSafeInteger(data.revision)||!Array.isArray(data.computers))throw Error('出張先登録にはサーバー更新の反映が必要です');return data;}
 async function run(fn){if(busy)return;busy=true;controls.disabled=true;error.textContent='';try{await fn();}catch(e){error.textContent=e.message;}finally{busy=false;controls.disabled=false;}}
 async function reload(){await run(async()=>{registry=await request();loaded=true;renderChoice();renderManager();});}
 async function mutate(input){await run(async()=>{const old=registry;registry=await request({...input,revision:registry.revision});loaded=true;let c=computerForm.elements.id.value,f=folderForm.elements.id.value;
  if(input.action==='add'&&input.entity==='computer')c=registry.computers.find(c=>!old.computers.some(o=>o.id===c.id)).id;
  if(input.action==='add'&&input.entity==='folder')f=registry.computers.find(c=>c.id===input.computerId).folders.find(f=>!old.computers.find(c=>c.id===input.computerId).folders.some(o=>o.id===f.id)).id;
  renderChoice();renderManager(c,f);
 });}
 choose.elements.computer.onchange=()=>{options(choose.elements.folder,folders().map(f=>({...f,label:f.name+' · '+f.cwd})),'選択してください');preview();};choose.elements.folder.onchange=preview;
 choose.onsubmit=e=>{e.preventDefault();if(!loaded||busy||isLocked())return;const c=registry.computers.find(c=>c.id===choose.elements.computer.value),f=c?.folders.find(f=>f.id===choose.elements.folder.value);if(!f)return;onSelect(normalizeTravelContexts([{name:f.name,sshHost:c.sshHost,cwd:f.cwd,notes:f.notes}]));dialog.close();};
 $('[data-manage]').onclick=()=>{$('[data-picker]').hidden=true;$('[data-manager]').hidden=false;renderManager(choose.elements.computer.value);};
 $('[data-back]').onclick=()=>{$('[data-picker]').hidden=false;$('[data-manager]').hidden=true;renderChoice();};
 computerForm.elements.id.onchange=renderComputer;folderForm.elements.id.onchange=renderFolder;
 computerForm.onsubmit=e=>{e.preventDefault();if(!loaded)return;const {id,name,sshHost}=Object.fromEntries(new FormData(computerForm));void mutate({entity:'computer',action:id?'edit':'add',...(id?{id}:{}),name,sshHost});};
 folderForm.onsubmit=e=>{e.preventDefault();if(!loaded||!computer())return;const {id,name,cwd,notes}=Object.fromEntries(new FormData(folderForm));void mutate({entity:'folder',computerId:computer().id,action:id?'edit':'add',...(id?{id}:{}),name,cwd,notes});};
 $('[data-delete-computer]').onclick=()=>{if(computer()&&confirm('このコンピューターと登録フォルダを削除しますか？ 添付済みの依頼は変わりません。'))void mutate({entity:'computer',action:'delete',id:computer().id});};
 $('[data-delete-folder]').onclick=()=>{if(computer()&&folderForm.elements.id.value&&confirm('この登録フォルダを削除しますか？ 添付済みの依頼は変わりません。'))void mutate({entity:'folder',action:'delete',computerId:computer().id,id:folderForm.elements.id.value});};
 let manual=false;$('[data-manual]').onclick=()=>{if(isLocked())return;manual=true;dialog.close();};$('[data-close]').onclick=()=>dialog.close();$('[data-reload]').onclick=()=>void reload();
 dialog.addEventListener('close',()=>{dialog.remove();if(manual)onManual();else onClose();},{once:true});document.body.append(dialog);renderChoice();renderManager();dialog.showModal();await reload();
}
