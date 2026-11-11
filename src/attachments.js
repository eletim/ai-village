import {escape} from './html.js';
const valid=id=>/^[0-9a-f-]{36}$/.test(id);
export function attachmentHTML(records=[]){return `<div class="file-previews">${records.filter(r=>valid(r.id)).map(r=>`<a href="/api/${r.kind==='image'||r.mime==='image/png'?'images':'attachments'}/${r.id}" ${r.kind==='image'||r.mime==='image/png'?'target="_blank" rel="noopener"':'download'}>${r.kind==='image'||r.mime==='image/png'?`<img src="/api/images/${r.id}" alt="${escape(r.name)}">`:''}<span>${escape(r.name)} · ${Math.ceil(r.size/1024)} KiB</span></a>`).join('')}</div>`;}
let database;
function db(){return database ||= new Promise((ok,no)=>{const r=indexedDB.open('village-attachment-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
async function storage(key,value){const d=await db();return new Promise((ok,no)=>{const tx=d.transaction('drafts',value===undefined?'readonly':'readwrite'),s=tx.objectStore('drafts'),r=value===undefined?s.get(key):s.put(value,key);tx.oncomplete=()=>ok(r.result);tx.onerror=()=>no(tx.error);});}
export function attachmentComposer({host,key,supported=()=>true,onChange=()=>{}}){
 let pending=[],locked=false,urls=[],writing=Promise.resolve();
 let tabKey;try{tabKey=sessionStorage.getItem('attachment-tab');if(!tabKey){tabKey=Date.now()+'-'+Math.random();sessionStorage.setItem('attachment-tab',tabKey);}}catch{tabKey='memory';}
 key=tabKey+':'+key;const maskKey='attachment-mask:'+key;
 const menu=host.querySelector('.travel-menu'),box=document.createElement('div');box.className='file-composer';
 box.innerHTML='<input type="file" data-image accept="image/png,image/jpeg,image/webp" multiple hidden><input type="file" data-file accept=".pdf,.docx,.txt,.csv,.json,.md,.log,.yaml,.yml,.tsv,.xml" multiple hidden><div class="file-previews"></div><p class="file-error" role="alert"></p>';host.append(box);
 const preview=box.querySelector('.file-previews'),error=box.querySelector('.file-error');
 const persist=()=>{try{sessionStorage.setItem(maskKey,JSON.stringify(pending.map(p=>p.key)));}catch{}const copy=pending.map(p=>({...p}));writing=writing.catch(()=>{}).then(()=>storage(key,copy)).catch(()=>{error.textContent='下書きを保存できません。この画面を閉じずに再試行してください。';});onChange();return writing;};
 const render=()=>{
  urls.forEach(u=>URL.revokeObjectURL(u));urls=[];
  preview.innerHTML=pending.map((p,i)=>{const image=p.record?.kind==='image'||p.file?.type.startsWith('image/'),url=p.file?URL.createObjectURL(p.file):(p.record.kind==='image'?'/api/images/':'/api/attachments/')+p.record.id;if(p.file)urls.push(url);return `<figure>${image?`<img src="${url}" alt="${escape(p.record?.name||p.file.name)}">`:''}<figcaption>${escape(p.record?.name||p.file.name)} · ${Math.ceil((p.record?.size||p.file.size)/1024)} KiB</figcaption><button type="button" data-remove="${i}" ${locked?'disabled':''} aria-label="${escape(p.record?.name||p.file.name)}を削除">×</button></figure>`;}).join('');
  preview.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{pending.splice(Number(b.dataset.remove),1);render();persist();});
 };
 const ready=storage(key).then(value=>{pending=Array.isArray(value)?value:[];try{const mask=JSON.parse(sessionStorage.getItem(maskKey));if(mask)pending=pending.filter(p=>mask.includes(p.key));}catch{}render();onChange();}).catch(()=>{});
 async function add(files){await ready;if(locked)return;error.textContent='';if(!supported()){error.textContent='添付にはサーバー更新の反映が必要です。';return;}
  for(const file of files){if(pending.length>=4){error.textContent='添付は4件までです。';break;}pending.push({file,key:Date.now()+'-'+Math.random()});}await persist();render();}
 for(const [selector,label] of [['data-image','画像を追加'],['data-file','ファイルを追加']]){const picker=box.querySelector('['+selector+']'),b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{menu.hidden=true;host.querySelector('.travel-add').setAttribute('aria-expanded','false');picker.click();};menu.append(b);picker.onchange=()=>{void add([...picker.files]);picker.value='';};}
 host.closest('form')?.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();void add(files);}});
 return {ready,get count(){return pending.length;},get summaries(){return pending.map(p=>({name:p.record?.name||p.file?.name,size:p.record?.size??p.file?.size}));},get records(){return pending.filter(p=>p.record).map(p=>p.record);},lock(v){if(locked===v)return;locked=v;for(const b of menu.querySelectorAll('button'))b.disabled=v;render();},async upload(){await ready;if(pending.length&&!supported())throw Error('添付にはサーバー更新の反映が必要です。');for(const p of pending){if(p.record)continue;const response=await fetch('/api/attachments?name='+encodeURIComponent(p.file.name),{method:'POST',headers:{'Content-Type':p.file.type||'application/octet-stream'},body:p.file});const value=await response.json();if(!response.ok)throw Error(value.error||'添付を保存できません');p.record=value;delete p.file;persist();}render();await writing;return pending.map(p=>p.record.id);},clear(){pending=[];render();persist();},destroy(){urls.forEach(u=>URL.revokeObjectURL(u));urls=[];}};
}
