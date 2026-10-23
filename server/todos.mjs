import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export class TodoStore {
  constructor(dir){this.dir=dir;this.file=join(dir,'todos.json');this.state={revision:0,items:[]};this.queue=Promise.resolve();}
  async init(){await mkdir(this.dir,{recursive:true});try{const state=JSON.parse(await readFile(this.file,'utf8'));if(!Number.isSafeInteger(state.revision)||!Array.isArray(state.items))throw new Error('TODO保存データが不正です');this.state=state;}catch(e){if(e.code!=='ENOENT')throw e;}}
  snapshot(){return structuredClone(this.state);}
  update(input){const task=this.queue.then(()=>this.commit(input));this.queue=task.catch(()=>{});return task;}
  async commit(input){
    if(!input||!Number.isSafeInteger(input.revision)||!['add','edit','toggle','delete'].includes(input.action))throw fail(400,'TODOの操作が不正です');
    if(input.revision!==this.state.revision)throw fail(409,'別の端末で更新されました。最新一覧を確認して再実行してください。入力は残っています。');
    const next=this.snapshot();
    const item=next.items.find(item=>item.id===input.id);
    if(input.action!=='add'&&!item)throw fail(404,'TODOが見つかりません');
    if(['add','edit'].includes(input.action)){
      if(typeof input.text!=='string'||!input.text.trim()||input.text.length>500)throw fail(400,'TODOは1〜500文字で入力してください');
      if(input.action==='add'){if(next.items.length>=200)throw fail(400,'TODOは200件までです');next.items.push({id:randomUUID(),text:input.text.trim(),done:false});}
      else item.text=input.text.trim();
    }
    if(input.action==='toggle'){if(typeof input.done!=='boolean')throw fail(400,'完了状態が不正です');item.done=input.done;}
    if(input.action==='delete')next.items=next.items.filter(item=>item.id!==input.id);
    next.revision++;
    await writeFile(this.file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(this.file+'.tmp',this.file);
    this.state=next;return this.snapshot();
  }
}
