// A controller per log: explicit reader scroll overrides follow; hidden logs retain state.
export function chatScroll(area,{saved,onSave=()=>{}}={}){
 let follow=saved&&typeof saved==='object'?saved.follow!==false:true,top=saved&&typeof saved==='object'?saved.top:0,newContent=false,frame,expected=null;
 const button=document.createElement('button');button.type='button';button.className='latest-message';button.title='最新へ';button.setAttribute('aria-label','最新へ');button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4v16m-6-6 6 6 6-6"/></svg>';button.hidden=true;area.after(button);
 const visible=()=>area.clientHeight>0&&area.getClientRects().length;
 // Layout clamping during composer/viewport resize is not a reader scroll.
 let width=area.clientWidth,height=area.clientHeight;
 const persist=()=>onSave({top,follow});
 const update=()=>{frame=null;if(!visible())return;width=area.clientWidth;height=area.clientHeight;expected=follow?Math.max(0,area.scrollHeight-area.clientHeight):top;area.scrollTop=expected;top=area.scrollTop;if(follow)newContent=false;button.hidden=follow;persist();};
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 area.addEventListener('scroll',()=>{if(!visible())return;if(width!==area.clientWidth||height!==area.clientHeight){schedule();return;}const position=area.scrollTop;if(expected!==null&&Math.abs(position-expected)<2){expected=null;return;}expected=null;follow=area.scrollHeight-position-area.clientHeight<64;top=position;if(follow)newContent=false;button.hidden=follow;persist();});
 const content=new MutationObserver(()=>{newContent=true;schedule();});content.observe(area,{childList:true,subtree:true,characterData:true});
 const resize=new ResizeObserver(schedule);resize.observe(area);area.addEventListener('load',schedule,true);
 window.addEventListener('display-change',update);
 button.onclick=()=>{follow=true;newContent=false;schedule();};
 schedule();return {changed(){newContent=true;schedule();},restore:schedule,latest(){follow=true;newContent=false;schedule();},capture(){if(visible()){top=area.scrollTop;persist();}},destroy(){window.removeEventListener('display-change',update);content.disconnect();resize.disconnect();cancelAnimationFrame(frame);button.remove();}};
}
