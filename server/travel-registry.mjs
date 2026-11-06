import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeTravelContexts} from '../src/travel-context.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
// Reference data only: never connects, scans folders or changes a request snapshot.
export class TravelRegistry {
 constructor(dir){this.dir=dir;this.file=join(dir,'travel-registry.json');this.state={revision:0,computers:[]};this.queue=Promise.resolve();}
 async init(){await mkdir(this.dir,{recursive:true});try{const data=JSON.parse(await readFile(this.file,'utf8'));if(!Number.isSafeInteger(data.revision)||!Array.isArray(data.computers))throw Error('出張先の保存データが不正です');this.state=data;}catch(e){if(e.code!=='ENOENT')throw e;}}
 snapshot(){return structuredClone(this.state);}
 update(input){const task=this.queue.then(()=>this.commit(input));this.queue=task.catch(()=>{});return task;}
 async commit(x){
  if(!x||!Number.isSafeInteger(x.revision)||!['computer','folder'].includes(x.entity)||!['add','edit','delete'].includes(x.action))fail('出張先の操作が不正です');
  const keys=['revision','entity','action','id',...(x.entity==='computer'?['name','sshHost']:['computerId','name','cwd','notes'])];
  if(Object.keys(x).some(k=>!keys.includes(k)))fail('出張先の項目が不正です');
  if(x.revision!==this.state.revision)fail('別の画面で更新されています。入力を控えてから一覧を再読込してください。',409);
  const next=this.snapshot(),computer=next.computers.find(c=>c.id===(x.entity==='computer'?x.id:x.computerId));
  if((x.entity==='folder'||x.action!=='add')&&!computer)fail('コンピューターが見つかりません',404);
  const item=x.entity==='computer'?computer:computer.folders.find(f=>f.id===x.id);
  if(x.action!=='add'&&!item)fail('登録が見つかりません',404);
  if(x.action==='delete'){
   if(x.entity==='computer')next.computers=next.computers.filter(c=>c.id!==x.id);
   else computer.folders=computer.folders.filter(f=>f.id!==x.id);
  }else{
   const [valid]=normalizeTravelContexts([{name:x.name,sshHost:x.entity==='computer'?x.sshHost:computer.sshHost,cwd:x.entity==='computer'?'/':x.cwd,notes:x.entity==='computer'?'':x.notes}]);
   const fields=x.entity==='computer'?{name:valid.name,sshHost:valid.sshHost}:{name:valid.name,cwd:valid.cwd,notes:valid.notes};
   if(x.action==='add'){
    const record={id:randomUUID(),...fields};
    if(x.entity==='computer')next.computers.push({...record,folders:[]});else computer.folders.push(record);
   }else Object.assign(item,fields);
  }
  next.revision++;await writeFile(this.file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(this.file+'.tmp',this.file);this.state=next;return this.snapshot();
 }
}
