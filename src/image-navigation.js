// The transform is confined to the image viewport: browser/page zoom stays available.
export function imageNavigation(viewport,onScale){
 let scale=1,x=0,y=0,width=0,height=0,viewWidth=0,viewHeight=0,img,pointers=new Map();
 const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 const point=e=>{const r=viewport.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 function draw(){
  if(!img)return;
  const w=width*scale,h=height*scale,vw=viewport.clientWidth,vh=viewport.clientHeight;
  x=w<=vw?(vw-w)/2:clamp(x,vw-w,0);y=h<=vh?(vh-h)/2:clamp(y,vh-h,0);
  img.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
  viewport.dataset.scale=String(scale);viewport.classList.toggle('magnified',scale>1);onScale(scale);
 }
 function fit(){
  if(!img?.naturalWidth||!viewport.clientWidth||!viewport.clientHeight)return;
  viewWidth=viewport.clientWidth;viewHeight=viewport.clientHeight;
  const ratio=Math.min(viewWidth/img.naturalWidth,viewHeight/img.naturalHeight);
  width=img.naturalWidth*ratio;height=img.naturalHeight*ratio;scale=1;x=y=0;
  img.style.width=width+'px';img.style.height=height+'px';draw();
 }
 function zoom(factor,from={x:viewport.clientWidth/2,y:viewport.clientHeight/2},to=from){
  if(!width)return;
  const next=clamp(scale*factor,1,8),ratio=next/scale;
  x=to.x-(from.x-x)*ratio;y=to.y-(from.y-y)*ratio;scale=next;draw();
 }
 const pan=(dx,dy)=>{x+=dx;y+=dy;draw();};
 viewport.addEventListener('wheel',e=>{e.preventDefault();const unit=e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1;zoom(Math.exp(-clamp(e.deltaY*unit,-300,300)*.003),point(e));},{passive:false});
 viewport.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  e.preventDefault();viewport.focus({preventScroll:true});pointers.set(e.pointerId,point(e));viewport.setPointerCapture(e.pointerId);
 });
 viewport.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;e.preventDefault();
  const before=[...pointers.values()],old=pointers.get(e.pointerId),next=point(e);pointers.set(e.pointerId,next);
  if(pointers.size===1){if(scale>1)pan(next.x-old.x,next.y-old.y);return;}
  const after=[...pointers.values()],center=p=>({x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}),distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
  const d=distance(before);if(d>0)zoom(distance(after)/d,center(before),center(after));
 });
 const release=e=>{pointers.delete(e.pointerId);};
 for(const type of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(type,release);
 viewport.addEventListener('dragstart',e=>e.preventDefault());
 const observer=new ResizeObserver(()=>{if(img&&(viewport.clientWidth!==viewWidth||viewport.clientHeight!==viewHeight))fit();});observer.observe(viewport);
 return {
  show(image){pointers.clear();img=image;scale=1;width=height=0;x=y=0;img.draggable=false;viewport.replaceChildren(img);const current=img;img.addEventListener('load',()=>{if(img===current&&!width)fit();},{once:true});fit();},
  clear(){pointers.clear();img=null;width=height=0;viewport.replaceChildren();},
  key(e){
   if(e.ctrlKey||e.metaKey||e.altKey)return false;
   if(['+','=','-','0','Home'].includes(e.key)){e.preventDefault();if(e.key==='0'||e.key==='Home')fit();else zoom(e.key==='-'?1/1.25:1.25);return true;}
   if(scale>1&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();pan(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0,e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0);return true;}
   return false;
  }
 };
}
