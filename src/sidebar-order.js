// Pointer capture supports mouse and touch; only the explicit handles start a move.
export function bindSidebarOrder(root,{save,changed,error,activate}){
 let gesture=null,saving=false,suppressUntil=0,scrollFrame=0;
 const node=e=>e.closest('[data-order-kind]');
 const read=e=>({kind:e.dataset.orderKind,id:e.dataset.orderId,revision:Number(e.dataset.orderRevision),projectId:e.dataset.orderProject||undefined});
 const compatible=(a,b)=>a.kind===b.kind&&a.id!==b.id&&(a.kind==='projects'||a.projectId===b.projectId);
 const clear=()=>{root.querySelectorAll('[data-drop]').forEach(e=>delete e.dataset.drop);root.classList.remove('ordering');};
 const cancel=()=>{cancelAnimationFrame(scrollFrame);if(gesture&&root.hasPointerCapture(gesture.pointer))root.releasePointerCapture(gesture.pointer);gesture=null;clear();};
 const commit=async(source,target,position)=>{
  saving=true;root.setAttribute('aria-busy','true');
  try{await save({kind:source.kind,id:source.id,targetId:target.id,position,revision:source.revision,targetRevision:target.revision,...(source.projectId?{projectId:source.projectId}:{})});}
  catch(e){error(e);}
  finally{saving=false;root.removeAttribute('aria-busy');changed();}
 };
 root.addEventListener('click',e=>{if(Date.now()<suppressUntil){suppressUntil=0;e.preventDefault();e.stopImmediatePropagation();}},true);
 root.addEventListener('pointerdown',e=>{
  suppressUntil=0;
  if(saving||e.button!==0)return;
  const handle=e.target.closest('[data-project-handle],[data-agent-handle]');if(!handle)return;
  const item=node(handle);if(!item)return;
  e.preventDefault();(handle.closest('button')||handle).focus({preventScroll:true});
  gesture={handle,source:read(item),pointer:e.pointerId,x:e.clientX,y:e.clientY,active:false};root.setPointerCapture(e.pointerId);
 });
 const updateDrop=(x,y)=>{
  clear();root.classList.add('ordering');gesture.target=null;
  const hit=document.elementFromPoint(x,y);
  const item=gesture.source.kind==='projects'?hit?.closest('.place-row[data-order-kind="projects"]'):hit?.closest('[data-agent-handle]');
  if(!item||!root.contains(item))return;
  const target=read(item);if(!compatible(gesture.source,target))return;
  const rect=item.getBoundingClientRect(),after=gesture.source.kind==='projects'?y>rect.top+rect.height/2:x>rect.left+rect.width/2;
  gesture.target=target;gesture.position=after?'after':'before';item.dataset.drop=gesture.position;
 };
 const autoScroll=()=>{
  if(!gesture?.active)return;
  const sidebar=root.closest('.sidebar,dialog')||root,rect=sidebar.getBoundingClientRect(),{lastX:x,lastY:y}=gesture;
  if(x>=rect.left&&x<=rect.right){const delta=y<rect.top+28?-6:y>rect.bottom-28?6:0;if(delta){sidebar.scrollTop+=delta;updateDrop(x,y);}}
  scrollFrame=requestAnimationFrame(autoScroll);
 };
 root.addEventListener('pointermove',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;
  if(!gesture.active&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)<5)return;
  const started=!gesture.active;gesture.active=true;gesture.lastX=e.clientX;gesture.lastY=e.clientY;
  updateDrop(e.clientX,e.clientY);if(started)scrollFrame=requestAnimationFrame(autoScroll);
 });
 root.addEventListener('pointerup',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;
  const g=gesture;suppressUntil=Date.now()+300;cancel();
  if(g.target)void commit(g.source,g.target,g.position);else if(!g.active&&activate)activate(g.handle);else changed();
 });
 root.addEventListener('pointercancel',()=>{cancel();changed();});
 root.closest('dialog')?.addEventListener('close',cancel);
 window.addEventListener('blur',()=>{if(gesture){cancel();changed();}});
 root.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&gesture){e.preventDefault();e.stopPropagation();suppressUntil=Date.now()+300;cancel();changed();return;}
  if(saving||!e.altKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
  const item=node(e.target);if(!item)return;
  const source=read(item),ids=new Set(),items=[...root.querySelectorAll('[data-order-kind]')].map(read).filter(x=>{if(ids.has(x.id)||x.kind!==source.kind)return false;ids.add(x.id);return true;});
  const direction=['ArrowUp','ArrowLeft'].includes(e.key)?-1:1,target=items[items.findIndex(x=>x.id===source.id)+direction];
  e.preventDefault();if(target&&compatible(source,target))void commit(source,target,direction<0?'before':'after');
 });
 return {busy:()=>!!gesture||saving};
}
