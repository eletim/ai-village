import {appendFile,readdir,rename,stat,unlink} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {resolve} from 'node:path';
// Append-only audit journals with a size bound on the live file. A full file is moved aside
// (never truncated or deleted unread) and compressed in the background; the uncompressed copy
// is removed only after its .gz is complete. Archives are kept; pruning is a human decision.
export const AUDIT_MAX_BYTES=Number(process.env.VILLAGE_AUDIT_MAX_BYTES)>0?Number(process.env.VILLAGE_AUDIT_MAX_BYTES):64*1024*1024;
const chains=new Map(),compressing=new Map();
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
async function compress(dir,name){
 const prefix=name.replace(/\.jsonl$/,'')+'-';
 for(const file of (await readdir(dir)).filter(f=>f.startsWith(prefix)&&f.endsWith('.jsonl')).sort()){
  const source=resolve(dir,file),tmp=source+'.gz.tmp';
  await pipeline(createReadStream(source),createGzip(),createWriteStream(tmp,{mode:0o600}));
  await rename(tmp,source+'.gz');await unlink(source);
 }
}
// Single flight per journal; a failure leaves the uncompressed archive in place for the next try.
export function compressArchives(dir,name){
 const key=resolve(dir,name);if(compressing.has(key))return compressing.get(key);
 const task=compress(dir,name).catch(()=>{}).finally(()=>compressing.delete(key));
 compressing.set(key,task);return task;
}
export function appendAudit(dir,name,entry,{maxBytes=AUDIT_MAX_BYTES}={}){
 const file=resolve(dir,name),line=JSON.stringify(entry)+'\n';
 const task=(chains.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
  let size=0;try{size=(await stat(file)).size;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(size>0&&size+Buffer.byteLength(line)>maxBytes){
   await rename(file,resolve(dir,name.replace(/\.jsonl$/,'')+'-'+stamp()+'.jsonl'));
   void compressArchives(dir,name);
  }
  await appendFile(file,line,{mode:0o600});
 });
 chains.set(file,task);
 task.finally(()=>{if(chains.get(file)===task)chains.delete(file);}).catch(()=>{});
 return task;
}
