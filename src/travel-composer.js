import {travelPicker} from './travel-picker.js';
import {normalizeTravelContexts} from './travel-context.js';
export function travelComposer(host,initial=[],onChange=()=>{}) {
 let value;try{value=normalizeTravelContexts(initial);}catch{value=[];}
 let locked=false;
 host.classList.add('travel-composer');
 host.innerHTML='<button type="button" class="travel-add" title="添付を追加" aria-label="添付を追加" aria-expanded="false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg></button><div class="travel-menu" hidden><button type="button">出張先を追加</button></div><span class="travel-chip" hidden><button type="button" class="travel-edit"></button><button type="button" class="travel-remove" aria-label="出張先を削除">×</button></span>';
 const add=host.querySelector('.travel-add'),menu=host.querySelector('.travel-menu'),chip=host.querySelector('.travel-chip'),edit=host.querySelector('.travel-edit'),remove=host.querySelector('.travel-remove');
 const closeMenu=()=>{menu.hidden=true;add.setAttribute('aria-expanded','false');};
 const render=()=>{chip.hidden=!value.length;edit.textContent=value.length?'出張先：'+value[0].name:'';for(const b of host.querySelectorAll('button'))b.disabled=locked;};
 const change=()=>{render();onChange(structuredClone(value));};
 function openManual(){
  if(locked)return;closeMenu();
  const dialog=document.createElement('dialog');dialog.className='travel-dialog';dialog.setAttribute('aria-label','出張先');
  dialog.innerHTML='<form><h2>出張先</h2><p>この依頼で使う接続先と作業場所を添付します。</p><label>名前<input name="name" required maxlength="120" autocomplete="off"></label><label>SSH接続先<input name="sshHost" required maxlength="200" placeholder="alias または user@host" autocomplete="off" spellcheck="false"></label><label>作業ディレクトリ<input name="cwd" required maxlength="2000" placeholder="/path/to/work" autocomplete="off" spellcheck="false"></label><label>補足<textarea name="notes" maxlength="4000" rows="3"></textarea></label><p class="travel-error" role="alert"></p><div><button type="button" data-cancel>キャンセル</button><button type="submit">保存</button></div></form>';
  document.body.append(dialog);const form=dialog.querySelector('form');
  for(const [key,v] of Object.entries(value[0]||{}))form.elements[key].value=v;
  const close=()=>dialog.close();dialog.querySelector('[data-cancel]').onclick=close;
  dialog.addEventListener('close',()=>{dialog.remove();if(host.isConnected)add.focus();},{once:true});
  form.onsubmit=e=>{e.preventDefault();try{if(locked)return;value=normalizeTravelContexts([Object.fromEntries(new FormData(form))]);change();close();}catch(error){dialog.querySelector('.travel-error').textContent=error.message;}};
  dialog.showModal();
 }
 function open(){if(locked)return;closeMenu();void travelPicker({initial:value,isLocked:()=>locked,onSelect:next=>{value=next;change();},onManual:openManual,onClose:()=>{if(host.isConnected)add.focus();}});}
 add.onclick=()=>{menu.hidden=!menu.hidden;add.setAttribute('aria-expanded',String(!menu.hidden));};
 host.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();add.focus();}});
 menu.querySelector('button').onclick=open;edit.onclick=open;remove.onclick=()=>{value=[];change();};render();
 return {get value(){return structuredClone(value);},set(next){value=normalizeTravelContexts(next);change();},lock(v){locked=v;if(v)closeMenu();render();}};
}
