import {defaultWorkshopPattern,validWorkshopPattern} from './workshop-pattern.js';
import {roleSVG} from './status-icon.js';
export function workshopPatternEditor(form){
 const field=document.createElement('fieldset');field.className='workshop-pattern-editor';field.innerHTML='<legend>工房アイコンの模様</legend><p>上段・下段それぞれ左から4マス。役割アイコン表示で使います。</p><div class="pattern-grid"></div><div class="pattern-preview" aria-label="模様プレビュー"><span data-size="actual"></span><span data-size="large"></span><small>実寸 / 拡大</small></div>';
 form.querySelector('button').before(field);let id='new-workshop-preview';
 const selects=Array.from({length:8},(_,i)=>{const label=document.createElement('label');label.textContent=`${i<4?'上':'下'}${i%4+1}`;const select=document.createElement('select');select.setAttribute('aria-label',`模様 ${i<4?'上段':'下段'} ${i%4+1}`);select.innerHTML='<option value="none">なし</option><option value="line">横線</option><option value="diamond">ダイヤ</option>';label.append(select);field.querySelector('.pattern-grid').append(label);select.onchange=preview;return select;});
 const value=()=>selects.map(s=>s.value);
 function preview(){const svg=roleSVG({location:'workshop',workshopId:id},[{id,iconPattern:value()}]);for(const span of field.querySelectorAll('.pattern-preview>span'))span.innerHTML=svg;}
 function set(workshop={}){id=workshop.id||'new-workshop-preview';const pattern=validWorkshopPattern(workshop.iconPattern)?workshop.iconPattern:defaultWorkshopPattern(id);selects.forEach((s,i)=>s.value=pattern[i]);preview();}
 form.addEventListener('reset',()=>queueMicrotask(()=>set()));set();return {set,value};
}
