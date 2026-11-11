const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function actionSVG(kind='check'){
 const path=kind==='send'?'m3 10 17-7-7 17-3-7-7-3m7 3 10-10':'m5 12 4 4L19 6';
 return `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="vertical-align:middle"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
const completedLabels=new Set(['応答完了','報告完了','作業完了（報告に統合済み）','依頼全体完了']);
export function compactStatus(label,normal=true){
 const text=escape(label);
 return normal&&completedLabels.has(label)?`<span class="completion-icon" role="img" title="${text}" aria-label="${text}">${actionSVG()}</span>`:text;
}
export function connectionStatus(element,text,{normal=false,label='接続'}={}){
 element.textContent=normal?'● '+text:text;
 element.title=normal?label+' · '+text:text;
 element.setAttribute('aria-label',element.title);
}
