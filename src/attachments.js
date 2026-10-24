import { escape } from './office.js';
export function attachmentComposer() {
  const picker=document.querySelector('#image-picker'), preview=document.querySelector('#attachment-preview'), error=document.querySelector('#attachment-error');
  let pending=[], locked=false;
  function render() {
    preview.innerHTML=pending.map((item,index)=>`<figure><img src="${item.url}" alt="${escape(item.file.name)}の送信前プレビュー"><figcaption>${escape(item.file.name)}</figcaption><button type="button" data-remove="${index}" ${locked?'disabled':''} aria-label="${escape(item.file.name)}を取り消す">取り消す ×</button></figure>`).join('');
    preview.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>{URL.revokeObjectURL(pending[button.dataset.remove].url);pending.splice(Number(button.dataset.remove),1);render();}));
    picker.disabled=locked;document.querySelector('#attach-image').disabled=locked;
  }
  function add(files) {
    if(locked)return;
    error.textContent='';
    for(const file of files) {
      if(pending.length>=4){error.textContent='画像は4枚まで添付できます。';break;}
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)){error.textContent='静止画のPNG・JPEG・WebPを選んでください。';continue;}
      if(file.size>8*1024*1024){error.textContent='画像は1枚8 MiB以内にしてください。';continue;}
      pending.push({file,url:URL.createObjectURL(file)});
    }
    render();
  }
  document.querySelector('#attach-image').addEventListener('click',()=>picker.click());
  picker.addEventListener('change',()=>{add(picker.files);picker.value='';});
  document.querySelector('#request-form').addEventListener('paste',event=>{
    const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
    if(files.length){event.preventDefault();add(files);}
  });
  return {
    get count(){return pending.length;},
    lock(value){locked=value;render();},
    async upload(){
      for(const item of pending) {
        if(item.id)continue;
        const response=await fetch(`/api/images?name=${encodeURIComponent(item.file.name)}`,{method:'POST',headers:{'Content-Type':item.file.type},body:item.file});
        const result=await response.json();if(!response.ok)throw new Error(result.error || '画像を保存できませんでした。');item.id=result.id;
      }
      return pending.map(item=>item.id);
    },
    clear(){pending.forEach(item=>URL.revokeObjectURL(item.url));pending=[];error.textContent='';render();}
  };
}
