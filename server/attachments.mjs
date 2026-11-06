import {ImageStore} from './images.mjs';
import {mkdir,writeFile,rename,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class AttachmentStore {
 constructor(dir){this.root=resolve(dir,'attachments');this.images=new ImageStore(dir);}
 async init(){await mkdir(this.root,{recursive:true,mode:0o700});await this.images.init();}
 async save(bytes,name,mime){
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw fail('ファイルが空です。');
  name=String(name||'file').split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g,'').slice(0,160)||'file';
  if(['image/png','image/jpeg','image/webp'].includes(mime)){
   const record=await this.images.save(bytes,name);return {...record,kind:'image',sha256:createHash('sha256').update(await this.images.content(record.id)).digest('hex')};
  }
  if(!['.pdf','.txt','.csv','.json','.md','.log','.yaml','.yml','.tsv','.xml'].includes(extname(name).toLowerCase()))throw fail('PDF・テキスト・CSV・JSONなどのデータファイルを選んでください。');
  const id=randomUUID(),record={id,kind:'file',name,mime:'application/octet-stream',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),at:new Date().toISOString()};
  await this.init();await writeFile(resolve(this.root,id+'.blob'),bytes,{flag:'wx',mode:0o600});await writeFile(resolve(this.root,id+'.tmp'),JSON.stringify(record),{flag:'wx',mode:0o600});await rename(resolve(this.root,id+'.tmp'),resolve(this.root,id+'.json'));return record;
 }
 async read(path,max=Infinity){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.size>max)throw fail('添付ファイルが不正です');return await f.readFile();}finally{await f.close();}}
 async get(id){
  if(typeof id!=='string'||!uuid.test(id))throw fail('添付IDが不正です');
  try{return JSON.parse(await this.read(resolve(this.root,id+'.json'),4096));}catch(e){if(e.code!=='ENOENT')throw e;const image=await this.images.get(id);return {...image,kind:'image',sha256:createHash('sha256').update(await this.images.content(id)).digest('hex')};}
 }
 async content(id){const r=await this.get(id),bytes=r.kind==='image'?await this.images.content(id):await this.read(resolve(this.root,id+'.blob'));if(bytes.length!==r.size||createHash('sha256').update(bytes).digest('hex')!==r.sha256)throw fail('添付ファイルの内容が保存記録と一致しません');return bytes;}
 async select(ids=[]){if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length)throw fail('添付は重複なしで4件までです');const records=await Promise.all(ids.map(id=>this.get(id)));return records;}
}
