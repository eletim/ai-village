import {mkdir,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {runtimeScript} from './runtime-events.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const empty=()=>({generation:null,cursor:{seq:0,part:0},pages:0,records:new Map(),partial:'',partialLength:0,partialRecord:null,snapshot:null});
// A core-side replica of the host's rebuildable change feed. No request data writes.
export class RuntimeReader{
 constructor(dir){this.dir=resolve(dir,'native-index-replica');this.sessions=new Map();this.locks=new Map();}
 async load(key){
  const cache=empty(),dir=resolve(this.dir,key);
  try{
   for(const name of (await readdir(dir)).filter(n=>/^\d{12}\.json$/.test(n)).sort()){
    const envelope=JSON.parse(await readFile(resolve(dir,name),'utf8'));
    if(hash(envelope.payload)!==envelope.checksum)throw Error('cache checksum');
    const page=JSON.parse(envelope.payload);
    if(name!==String(cache.pages+1).padStart(12,'0')+'.json')throw Error('cache gap');
    this.apply(cache,page);cache.pages++;
   }
  }catch(error){
   if(error.code!=='ENOENT')await rm(dir,{recursive:true,force:true});
   return empty();
  }
  return cache;
 }
 apply(cache,page){
  if(cache.generation&&page.generation!==cache.generation)throw Error('cache generation');
  if(JSON.stringify(page.from)!==JSON.stringify(cache.cursor))throw Error('cache cursor');
  cache.generation=page.generation;
  for(const piece of page.pieces){
   if(piece.part!==cache.partialLength)throw Error('cache chunk');
   const record=JSON.stringify([piece.seq,piece.kind,piece.key]);
   if(cache.partialRecord&&record!==cache.partialRecord)throw Error('cache partial identity');
   cache.partialRecord=record;cache.partial+=piece.data;cache.partialLength+=Array.from(piece.data).length;
   if(piece.done){const value=JSON.parse(cache.partial),key=piece.kind+'\0'+piece.key;if(value===null)cache.records.delete(key);else cache.records.set(key,{kind:piece.kind,key:piece.key,value});cache.partial='';cache.partialLength=0;cache.partialRecord=null;cache.snapshot=null;}
  }
  cache.cursor=page.next;
 }
 snapshot(cache){
  if(cache.snapshot)return cache.snapshot;
  const turns=new Map(),messages=new Map(),inputs=[];let modelInfo;
  for(const {kind,key,value} of cache.records.values()){
   if(kind==='turn')turns.set(key,{...value,messages:[]});
   else if(kind==='message'){const list=messages.get(value.turnId)||[];list.push(value);messages.set(value.turnId,list);}
   else if(kind==='input')inputs.push(value);
   else if(kind==='model')modelInfo=value;
  }
  for(const [id,t] of turns){t.messages=(messages.get(id)||[]).sort((a,b)=>a.offset-b.offset).map(({turnId,...m})=>m);if(t.outputFromMessages)t.output=t.messages.filter(m=>m.offset<=(t.outputThrough??Infinity)).map(m=>m.text).join('\n\n');delete t.outputFromMessages;delete t.outputThrough;}
  cache.snapshot={turns:[...turns.values()].sort((a,b)=>a.offset-b.offset),inputs:inputs.sort((a,b)=>a.offset-b.offset),...(modelInfo?{modelInfo}: {})};return cache.snapshot;
 }
 async read(a,status,execute){
  const provider=a.provider||'codex',sid=status.agentSessionId||'';
  const key=hash(JSON.stringify([a.connection?.connectionType||'ssh',a.connection?.sshHost||'',provider,sid]));
  const previous=this.locks.get(key)||Promise.resolve();
  const job=previous.catch(()=>{}).then(async()=>{
   const began=performance.now();let result;
   for(let page=0;page<8;page++){
    result=await this.readOnce(key,a,provider,sid,execute);
    if(result.available||(!result.more&&result.reason!=='index-catching-up')||performance.now()-began>=1500)break;
   }
   return result;
  });this.locks.set(key,job);
  try{return await job;}finally{if(this.locks.get(key)===job)this.locks.delete(key);}
 }
 async readOnce(key,a,provider,sid,execute){
  let cache=this.sessions.get(key);if(!cache){cache=await this.load(key);this.sessions.set(key,cache);}
  const raw=await execute(a,['python3','-c',runtimeScript,provider,sid,JSON.stringify({generation:cache.generation,cursor:cache.cursor})]);
  const result=JSON.parse(raw);
  if(!result.generation)return result;
  const dir=resolve(this.dir,key);
  if(cache.generation&&cache.generation!==result.generation){await rm(dir,{recursive:true,force:true});cache=empty();this.sessions.set(key,cache);}
  if(result.pieces?.length||!cache.generation){
   const page={generation:result.generation,from:cache.cursor,next:result.next,pieces:result.pieces||[]};
   // Validate before committing; on any fault the next read replays from disk.
   try{
    this.apply(cache,page);
    await mkdir(dir,{recursive:true,mode:0o700});const payload=JSON.stringify(page),name=String(cache.pages+1).padStart(12,'0')+'.json',tmp=resolve(dir,randomUUID()+'.tmp');
    await writeFile(tmp,JSON.stringify({payload,checksum:hash(payload)}),{mode:0o600});await rename(tmp,resolve(dir,name));cache.pages++;
   }catch(error){this.sessions.delete(key);throw error;}
  }
  const {pieces,next,...meta}=result;
  // Never expose a partially reconstructed snapshot to native correlation.
  if(!result.available||result.more||cache.partial)return {...meta,available:false,turns:[],inputs:[]};
  return {...meta,...this.snapshot(cache)};
 }
}
