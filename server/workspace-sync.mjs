import {randomUUID,createHash} from 'node:crypto';
import {packWorkspace} from '../src/workspace-sync.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function manifest(value){
 if(typeof value==='string')return {kind:'string',length:value.length,hash:hash(value)};
 if(isObject(value))return {kind:'object',fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,manifest(v)]))};
 return {kind:'value',hash:hash(JSON.stringify(value)??'undefined')};
}
function diff(before,next){
 const changes=[];
 function walk(old,value,path){
  if(old.kind==='object'&&isObject(value)){
   for(const k of Object.keys(old.fields))if(!Object.hasOwn(value,k))changes.push({op:'delete',path:[...path,k]});
   for(const [k,v] of Object.entries(value))if(Object.hasOwn(old.fields,k))walk(old.fields[k],v,[...path,k]);else changes.push({op:'set',path:[...path,k],value:v});
   return;
  }
  if(old.kind==='string'&&typeof value==='string'){
   if(old.length===value.length&&old.hash===hash(value))return;
   if(old.length>128&&value.length>old.length&&old.hash===hash(value.slice(0,old.length))){changes.push({op:'append',path,length:old.length,value:value.slice(old.length)});return;}
  }else if(old.kind==='value'&&old.hash===hash(JSON.stringify(value)??'undefined'))return;
  changes.push({op:'set',path,value});
 }
 walk(before,next,[]);return changes;
}

// Bounded, disposable response bases, never authoritative request state.
export class WorkspaceSync {
 constructor({maxBytes=32*1024*1024,maxClients=16,ttl=120000,clock=Date.now}={}){Object.assign(this,{maxBytes,maxClients,ttl,clock});this.clients=new Map();this.bytes=0;}
 drop(id){const old=this.clients.get(id);if(old)this.bytes-=old.bytes;this.clients.delete(id);}
 reply({client,since,scope},snapshot){
  if(typeof client!=='string'||! /^[a-zA-Z0-9_-]{8,100}$/.test(client))throw Object.assign(Error('Invalid sync client'),{status:400});
  for(const [id,base] of this.clients)if(this.clock()-base.at>this.ttl)this.drop(id);
  const records=packWorkspace(snapshot),size=Buffer.byteLength(JSON.stringify(records)),description=manifest(records),cacheSize=Buffer.byteLength(JSON.stringify(description));
  const previous=this.clients.get(client),cursor=randomUUID();
  let response={protocol:1,mode:'full',cursor,records};
  if(previous&&previous.cursor===since){
   // Scope changes also use keyed patches; loading old history never retransmits the new history.
   const changes=diff(previous.description,records);
   if(Buffer.byteLength(JSON.stringify(changes))<size)response={protocol:1,mode:'delta',base:since,cursor,changes};
  }
  this.drop(client);
  if(cacheSize<=this.maxBytes){
   while(this.clients.size>=this.maxClients||this.bytes+cacheSize>this.maxBytes)this.drop(this.clients.keys().next().value);
   this.clients.set(client,{description,cursor,scope,bytes:cacheSize,at:this.clock()});this.bytes+=cacheSize;
  }
  return response;
 }
}
