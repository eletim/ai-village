// Only changes geometry: never replace the textarea, its value, focus or selection.
export function autogrowInput(input,{panel}={}){
 let frame=0,signature='';
 Object.assign(input.style,{boxSizing:'border-box',resize:'none',minHeight:'0',maxHeight:'none',lineHeight:'1.5'});
 function update(){
  frame=0;if(!input.isConnected||!input.getClientRects().length||!input.clientWidth)return;
  const style=getComputedStyle(input),padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),border=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
  const min=Math.ceil(parseFloat(style.lineHeight)*2+padding+border);
  const viewport=window.visualViewport?.height||window.innerHeight;
  const max=Math.max(min,Math.floor(Math.min(viewport*.4,panel?panel.clientHeight*.4:Infinity)));
  const next=JSON.stringify([input.value,input.clientWidth,min,max]);if(next===signature)return;signature=next;
  const top=input.scrollTop;
  input.style.height='0px';input.style.overflowY='hidden';
  const natural=input.value?input.scrollHeight+border:min;
  input.style.height=Math.min(max,Math.max(min,natural))+'px';
  input.style.overflowY=natural>max?'auto':'hidden';
  if(natural>max)input.scrollTop=top;
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 const resize=new ResizeObserver(schedule);resize.observe(input);if(panel)resize.observe(panel);
 input.addEventListener('input',schedule);input.addEventListener('compositionend',schedule);
 window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
 schedule();return {update:schedule,destroy(){resize.disconnect();cancelAnimationFrame(frame);input.removeEventListener('input',schedule);input.removeEventListener('compositionend',schedule);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);}};
}
