import {open,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export function durableData(data){return data;}
export function durableFingerprint(data){
 // Observation timestamps and live transport snapshots are revalidated at startup.
 const agents=data.agents.map(({lastCheckedAt,runtime,...agent})=>agent);
 return createHash('sha256').update(JSON.stringify({...data,agents})).digest('hex');
}
export async function writeSnapshot(dir,value){
 const file=await open(resolve(dir,'direct.tmp'),'w',0o600);
 try{await file.writeFile(value);await file.sync();}finally{await file.close();}
 await rename(resolve(dir,'direct.tmp'),resolve(dir,'direct.json'));
 try{const directory=await open(dir,'r');try{await directory.sync();}finally{await directory.close();}}
 catch(error){error.persistenceUncertain=true;throw error;}
}
export class DirectStore {
 constructor({capture,write}){Object.assign(this,{capture,write});this.pending=[];this.running=false;this.fingerprint=null;}
 save(){
  const promise=new Promise((resolve,reject)=>this.pending.push({resolve,reject}));
  if(!this.running){this.running=true;setImmediate(()=>void this.flush());}
  return promise;
 }
 async flush(){
  while(this.pending.length){
   const batch=this.pending.splice(0);
   try{
    const data=durableData(this.capture()),fingerprint=durableFingerprint(data);
    if(fingerprint!==this.fingerprint){
     // Capture before yielding. Every caller in this batch is covered by this fsync.
     const value=JSON.stringify(data,null,2);await this.write(value);this.fingerprint=fingerprint;
    }
    for(const waiter of batch)waiter.resolve();
   }catch(error){for(const waiter of batch)waiter.reject(error);}
  }
  this.running=false;
 }
}
