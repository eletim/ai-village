// Read all pending logs before writing any scroll/button state. A board render may
// update several logs in one turn; per-log read/write pairs force repeated layout.
const pending=new Set();let batchFrame=0;
function enqueue(job){pending.add(job);if(!batchFrame)batchFrame=requestAnimationFrame(()=>{batchFrame=0;const jobs=[...pending];pending.clear();const writes=jobs.map(read=>read());for(const write of writes)write?.();});}
// A controller per log: explicit reader scroll overrides follow; hidden logs retain state.
export function chatScroll(area,{saved,onSave=()=>{}}={}){
 let follow=saved&&typeof saved==='object'?saved.follow!==false:true,top=saved&&typeof saved==='object'?saved.top:0,expected=null,anchor=null,restoring=true,destroyed=false,intentTop=null;
 const button=document.createElement('button');button.type='button';button.className='latest-message';button.title='最新へ';button.setAttribute('aria-label','最新へ');button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4v16m-6-6 6 6 6-6"/></svg>';button.hidden=true;area.after(button);
 const visible=()=>{const shown=!destroyed&&area.isConnected&&!area.closest('[hidden]')&&area.dataset.loading!=='true'&&area.clientHeight>0&&area.getClientRects().length;if(!shown)restoring=true;return shown;};
 // Observe wheel before its default scroll, including compositor scrolling.
 // An input alone is not a new position: only movement caused by reader input
 // may supersede a restoration which has not reached the DOM yet.
 const intent=e=>{if(e.type==='keydown'&&!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))return;if(visible())intentTop=area.scrollTop;};
 const inputs=['wheel','touchstart','pointerdown','keydown'];
 for(const name of inputs)area.addEventListener(name,intent,{passive:name!=='wheel'});
 const readerMoved=()=>intentTop!==null&&Math.abs(area.scrollTop-intentTop)>1;
 const adoptReader=()=>{top=area.scrollTop;follow=area.scrollHeight-top-area.clientHeight<64;anchor=null;expected=null;restoring=false;intentTop=null;};
 // Layout clamping during composer/viewport resize is not a reader scroll.
 let width=0,height=0;
 const persist=()=>onSave({top,follow});
 const measure=()=>{
  if(!visible())return;
  if(readerMoved())adoptReader();
  const w=area.clientWidth,h=area.clientHeight,max=Math.max(0,area.scrollHeight-h);
  let position=follow?max:top;
  if(!follow&&anchor){const next=[...area.querySelectorAll('[data-entry]')].find(n=>n.dataset.entry===anchor.key);if(next)position=area.scrollTop+next.getBoundingClientRect().top-area.getBoundingClientRect().top-anchor.offset;}
  position=Math.max(0,Math.min(max,position));
  return ()=>{if(destroyed)return;restoring=false;intentTop=null;width=w;height=h;anchor=null;expected=position;area.scrollTop=position;top=position;button.hidden=follow;persist();};
 };
 const schedule=()=>{if(!destroyed)enqueue(measure);};
 const restore=()=>{restoring=true;schedule();};
 const scroll=()=>{
  if(!visible())return;
  if(readerMoved()){adoptReader();width=area.clientWidth;height=area.clientHeight;button.hidden=follow;persist();return;}
  if(restoring||anchor)return;
  if(width!==area.clientWidth||height!==area.clientHeight){schedule();return;}
  const position=area.scrollTop;if(expected!==null&&Math.abs(position-expected)<2){expected=null;return;}
  expected=null;anchor=null;follow=area.scrollHeight-position-area.clientHeight<64;top=position;button.hidden=follow;persist();
 };
 area.addEventListener('scroll',scroll);
 const content=new MutationObserver(schedule);content.observe(area,{childList:true,subtree:true,characterData:true});
 const resize=new ResizeObserver(schedule);resize.observe(area);area.addEventListener('load',schedule,true);
 window.addEventListener('display-change',restore);
 button.onclick=()=>{follow=true;anchor=null;restore();};
 // Board callers prepare all anchors before the first DOM mutation. Standalone
 // updates use preserve(), retaining the same anchor across several pending renders.
 const prepare=()=>{
  if(visible()&&!restoring&&!anchor&&!follow){
   const edge=area.getBoundingClientRect().top;
   const node=[...area.querySelectorAll('[data-entry]')].find(n=>n.getBoundingClientRect().bottom>edge);
   if(node)anchor={key:node.dataset.entry,offset:node.getBoundingClientRect().top-edge};
  }
  return schedule;
 };
 schedule();return {prepare,preserve(render){const restore=prepare();render();restore();},changed:schedule,restore,loaded:restore,latest(){follow=true;anchor=null;restore();},capture(){if(visible()&&!restoring&&!anchor){top=area.scrollTop;persist();}},destroy(){destroyed=true;pending.delete(measure);area.removeEventListener('scroll',scroll);for(const name of inputs)area.removeEventListener(name,intent);window.removeEventListener('display-change',restore);area.removeEventListener('load',schedule,true);content.disconnect();resize.disconnect();button.remove();}};
}
