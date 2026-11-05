// A controller per log: explicit reader scroll overrides follow; hidden logs retain state.
export function chatScroll(area,{saved,onSave=()=>{}}={}){
 let follow=saved&&typeof saved==='object'?saved.follow!==false:true,top=saved&&typeof saved==='object'?saved.top:0,newContent=false,frame,expected=null;
 const button=document.createElement('button');button.type='button';button.className='latest-message';button.textContent='最新へ';button.hidden=true;area.after(button);
 const visible=()=>area.clientHeight>0&&area.getClientRects().length;
 const persist=()=>onSave({top,follow});
 const update=()=>{frame=null;if(!visible())return;expected=follow?Math.max(0,area.scrollHeight-area.clientHeight):top;area.scrollTop=expected;top=area.scrollTop;if(follow)newContent=false;button.hidden=follow;persist();};
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 area.addEventListener('scroll',()=>{if(!visible())return;const position=area.scrollTop;if(expected!==null&&Math.abs(position-expected)<2){expected=null;return;}expected=null;follow=area.scrollHeight-position-area.clientHeight<64;top=position;if(follow)newContent=false;button.hidden=follow;persist();});
 const content=new MutationObserver(()=>{newContent=true;schedule();});content.observe(area,{childList:true,subtree:true,characterData:true});
 const resize=new ResizeObserver(schedule);resize.observe(area);area.addEventListener('load',schedule,true);
 button.onclick=()=>{follow=true;newContent=false;schedule();};
 schedule();return {changed(){newContent=true;schedule();},restore:schedule,latest(){follow=true;newContent=false;schedule();},capture(){if(visible()){top=area.scrollTop;persist();}},destroy(){content.disconnect();resize.disconnect();cancelAnimationFrame(frame);button.remove();}};
}
