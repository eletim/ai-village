// Mobile layout is a projection of viewport/focus, never saved as Agent state.
export function boardProjectTitle(agents,projects=[],fallback='全部表示'){
 if(!agents.length)return fallback;
 const ids=new Set(agents.map(a=>a.projectId||''));
 if(ids.size>1)return ids.has('')?'複数プロジェクト・未所属':'複数プロジェクト';
 const id=agents[0].projectId;
 return id?(agents.find(a=>a.projectName)?.projectName||projects.find(p=>p.id===id)?.name||'プロジェクト名未取得'):'未所属';
}
export function mobileWorkspace(){
 const root=document.documentElement,media=matchMedia('(max-width:700px)'),heading=document.querySelector('.board-heading'),main=heading.parentElement,header=document.querySelector('body>header');
 function layout(){
  const compact=media.matches&&root.dataset.sidebarCollapsed==='true';
  if(compact&&heading.parentElement!==header)header.insertBefore(heading,header.querySelector('nav'));
  else if(!compact&&heading.parentElement!==main)main.prepend(heading);
  editing();
 }
 function editing(){
  const viewport=window.visualViewport;
  // Android can shrink only the visual viewport: 100dvh/footer stay behind the
  // keyboard. Keep hidden through blur until that viewport has recovered.
  const keyboard=viewport&&viewport.scale===1&&window.innerHeight-viewport.height>120;
  root.dataset.mobileEditing=String(media.matches&&(!!document.activeElement?.closest('form[data-send]')||!!keyboard));
 }
 document.addEventListener('focusin',editing);
 document.addEventListener('focusout',()=>requestAnimationFrame(editing));
 window.visualViewport?.addEventListener('resize',editing);
 window.addEventListener('resize',editing);
 media.addEventListener('change',layout);
 new MutationObserver(layout).observe(root,{attributes:true,attributeFilter:['data-sidebar-collapsed']});
 layout();
}
