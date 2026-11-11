// Only changes geometry: never replace the textarea, its value, focus or selection.
export function autogrowInput(input,{panel}={}){
 let frame=0,signature='',pointerHeld=false;
 const form=input.closest('form[data-send]'),events=new AbortController();
 function expand(){
  if(!form)return;
  const expanded=!!input.value||document.activeElement===input||(form.dataset.expanded==='true'&&(pointerHeld||form.contains(document.activeElement)));
  if(form.dataset.expanded===String(expanded))return;
  const initialized=form.dataset.expanded!==undefined;
  form.dataset.expanded=String(expanded);
  // Animate paint only: moving hit targets or changing height over several frames
  // interferes with clicks and the conversation's scroll anchoring.
  form.getAnimations().forEach(animation=>animation.cancel());
  if(initialized&&!pointerHeld&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   form.animate({opacity:[.85,1]},{duration:140,easing:'ease-out'});
  }
 }
 Object.assign(input.style,{boxSizing:'border-box',resize:'none',minHeight:'0',maxHeight:'none',lineHeight:'1.5'});
 function update(){
  frame=0;if(!input.isConnected||!input.getClientRects().length||!input.clientWidth)return;
  expand();
  const style=getComputedStyle(input),padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),border=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
  const min=Math.ceil(parseFloat(style.lineHeight)+padding+border);
  const viewport=window.visualViewport?.height||window.innerHeight;
  const max=Math.max(min,Math.floor(Math.min(viewport*.4,panel?panel.clientHeight*.4:Infinity)));
  const next=JSON.stringify([input.value,input.clientWidth,min,max,style.fontFamily,style.fontSize,style.letterSpacing]);if(next===signature)return;signature=next;
  const top=input.scrollTop;
  input.style.height='0px';input.style.overflowY='hidden';
  const natural=input.value?input.scrollHeight+border:min;
  input.style.height=Math.min(max,Math.max(min,natural))+'px';
  input.style.overflowY=natural>max?'auto':'hidden';
  if(natural>max)input.scrollTop=top;
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 form?.addEventListener('focusin',schedule,{signal:events.signal});
 form?.addEventListener('focusout',schedule,{signal:events.signal});
 form?.addEventListener('pointerdown',()=>{pointerHeld=true;},{signal:events.signal});
 for(const type of ['pointerup','pointercancel'])window.addEventListener(type,()=>{pointerHeld=false;schedule();},{signal:events.signal});
 const resize=new ResizeObserver(schedule);resize.observe(input);if(panel)resize.observe(panel);
 input.addEventListener('input',schedule);input.addEventListener('compositionend',schedule);
 window.addEventListener('display-change',schedule);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
 schedule();return {update:schedule,destroy(){events.abort();form?.getAnimations().forEach(animation=>animation.cancel());resize.disconnect();cancelAnimationFrame(frame);input.removeEventListener('input',schedule);input.removeEventListener('compositionend',schedule);window.removeEventListener('display-change',schedule);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);}};
}
