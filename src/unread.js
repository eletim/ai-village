const key='village-read-messages-v1';
let messages=[],read=null;
try{const saved=JSON.parse(localStorage.getItem(key));if(Array.isArray(saved))read=new Set(saved);}catch{}
const icon=document.querySelector('link[rel="icon"]'),normal=icon.href;
const marked='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#587452"/><path d="M14 31L32 15L50 31V51H36V37H28V51H14Z" fill="#fffdf5"/><circle cx="50" cy="14" r="12" fill="#e85b43" stroke="white" stroke-width="3"/></svg>`);
function save(){try{localStorage.setItem(key,JSON.stringify([...read]));}catch{}}
function check(){
  if(!read)return;
  let changed=false;
  const log=document.querySelector('#conversation-log'),bounds=log.getBoundingClientRect();
  if(document.visibilityState==='visible'&&!document.querySelector('#office-page').hidden){
    for(const message of messages){const article=log.querySelector(`[data-message="${CSS.escape(message.id)}"]`);if(!article)continue;const rect=article.getBoundingClientRect();
      // Reaching the end of the rendered message counts as reading, including long replies.
      if(rect.bottom>Math.max(0,bounds.top)&&rect.bottom<=Math.min(innerHeight,bounds.bottom)&&rect.right>0&&rect.left<innerWidth&&!read.has(message.id)){read.add(message.id);changed=true;}
    }
  }
  if(changed)save();const unread=messages.some(message=>!read.has(message.id));icon.href=unread?marked:normal;icon.dataset.unread=String(unread);
}
export function updateUnread(history){
  messages=history.filter(message=>message.role==='assistant'&&message.id);
  if(!read){read=new Set(messages.map(message=>message.id));save();} // First history restoration is a baseline, not a new notification.
  requestAnimationFrame(check);
}
document.addEventListener('scroll',check,true);document.addEventListener('visibilitychange',check);window.addEventListener('resize',check);
window.addEventListener('storage',e=>{if(e.key===key){try{for(const id of JSON.parse(e.newValue)||[])read?.add(id);}catch{}check();}});
