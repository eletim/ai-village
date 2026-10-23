export function initTheme(){
  const select=document.querySelector('#theme-choice'),system=matchMedia('(prefers-color-scheme: dark)');
  let choice='system';try{choice=localStorage.getItem('village-theme')||choice;}catch{}
  if(!['system','light','dark'].includes(choice))choice='system';
  const apply=()=>{document.documentElement.dataset.theme=choice==='system'?(system.matches?'dark':'light'):choice;select.value=choice;};
  select.addEventListener('change',()=>{choice=select.value;try{localStorage.setItem('village-theme',choice);}catch{}apply();});
  system.addEventListener('change',apply);
  window.addEventListener('storage',e=>{if(e.key==='village-theme'){choice=['light','dark'].includes(e.newValue)?e.newValue:'system';apply();}});apply();
}
