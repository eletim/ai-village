// One key per message avoids lost updates between tabs. Retain a bounded recent window.
const prefix='village-read-v2:',limit=512;
let messages=[],read=new Set(),initialized=false,lastStamp=0;
function stored(){try{return Object.keys(localStorage).filter(k=>k.startsWith(prefix));}catch{return [];}}
for(const key of stored())read.add(key.slice(prefix.length));
function mark(id){read.add(id);lastStamp=Math.max(performance.timeOrigin+performance.now(),lastStamp+0.001);try{localStorage.setItem(prefix+id,String(lastStamp));}catch{}}
function prune(){
  try{const keys=stored().sort((a,b)=>Number(localStorage.getItem(b))-Number(localStorage.getItem(a))||a.localeCompare(b));for(const key of keys.slice(limit))localStorage.removeItem(key);}catch{}
  read=new Set([...read].filter(id=>messages.some(m=>m.id===id)));
}
const icon=document.querySelector('link[rel="icon"]'),normal=icon.href;
const marked='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#587452"/><path d="M14 31L32 15L50 31V51H36V37H28V51H14Z" fill="#fffdf5"/><circle cx="50" cy="14" r="12" fill="#e85b43" stroke="white" stroke-width="3"/></svg>`);

function check(){
  if(!read)return;
  let changed=false;
  const log=document.querySelector('#conversation-log'),bounds=log.getBoundingClientRect();
  if(document.visibilityState==='visible'&&!document.querySelector('#office-page').hidden&&log.getClientRects().length&&bounds.height>0){
    for(const message of messages){const article=log.querySelector(`[data-message="${CSS.escape(message.id)}"]`);if(!article)continue;const rect=article.getBoundingClientRect();
      // Reaching the end of the rendered message counts as reading, including long replies.
      if(rect.bottom>Math.max(0,bounds.top)&&rect.bottom<=Math.min(innerHeight,bounds.bottom)&&rect.right>0&&rect.left<innerWidth&&!read.has(message.id)){mark(message.id);changed=true;}
    }
  }
  if(changed)prune();const unread=messages.some(message=>!read.has(message.id));icon.href=unread?marked:normal;icon.dataset.unread=String(unread);
}
export function updateUnread(history){
  messages=history.filter(message=>message.role==='assistant'&&message.id).slice(-limit);
  if(!initialized){
    let baseline=false;
    try{
      const old=JSON.parse(localStorage.getItem('village-read-messages-v1'));
      baseline=localStorage.getItem('village-read-initialized')!=='true'&&!Array.isArray(old)&&stored().length===0;
      if(Array.isArray(old))for(const message of messages)if(old.includes(message.id))mark(message.id);
      localStorage.removeItem('village-read-messages-v1');localStorage.setItem('village-read-initialized','true');
    }catch{baseline=true;}
    if(baseline)for(const message of messages)mark(message.id);
    initialized=true;
  }
  prune();
  requestAnimationFrame(check);
}
document.addEventListener('scroll',check,true);document.addEventListener('visibilitychange',check);window.addEventListener('resize',check);
window.addEventListener('storage',e=>{if(e.key?.startsWith(prefix)&&e.newValue){read.add(e.key.slice(prefix.length));check();}});

document.addEventListener('office-panel-change',()=>requestAnimationFrame(check));
