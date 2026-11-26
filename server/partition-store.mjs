import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
const collections=['agents','runs','requests','projects','workshops','conversations'];
const encode=(kind,value)=>JSON.stringify(kind==='agents'?Object.fromEntries(Object.entries(value).filter(([k])=>!['runtime','lastCheckedAt'].includes(k))):value);
// A commit contains selected records and their durable wake-up reservations.
// Historical JSON is an import source only; SQLite is the sole writable store.
export class PartitionStore {
 constructor({dir,capture,selection,affected}){Object.assign(this,{dir,capture,selection,affected});this.cache=new Map();this.fingerprint=0;this.jobs=new Map();this.write=changes=>this.commit(changes);}
 open(){
  this.db=new DatabaseSync(resolve(this.dir,'village.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS wakeups(id TEXT PRIMARY KEY,version INTEGER NOT NULL);');
  const rows=this.db.prepare('SELECT * FROM records').all();
  if(!rows.length)return null;
  const data={};for(const r of rows){this.cache.set(r.kind+':'+r.id,r.body);if(r.kind==='meta')Object.assign(data,JSON.parse(r.body));else(data[r.kind]||=[]).push(JSON.parse(r.body));}
  for(const key of collections)data[key]||=[];
  this.reloadJobs();return data;
 }
 reloadJobs(){this.jobs=new Map(this.db.prepare('SELECT * FROM wakeups').all().map(r=>[r.id,r.version]));}
 async save({wakeups:requested=[]}={}){
  this.lastChanges=[];const data=this.capture(),selected=this.selection(),changes=[];
  const meta=Object.fromEntries(Object.entries(data).filter(([k])=>!collections.includes(k)));
  const add=(kind,id,value)=>{const body=encode(kind,value);if(this.cache.get(kind+':'+id)!==body)changes.push({kind,id,body});};
  add('meta','village',meta);
  for(const kind of collections)for(const value of selected?.[kind]||(!selected?data[kind]||[]:[]))add(kind,value.id,value);
  if(!selected){
   const ids=new Map(collections.map(kind=>[kind,new Set((data[kind]||[]).map(r=>r.id))]));
   for(const key of this.cache.keys()){const colon=key.indexOf(':'),kind=key.slice(0,colon),id=key.slice(colon+1);if(ids.has(kind)&&!ids.get(kind).has(id))changes.push({kind,id,body:null});}
  }
  const wakeups=[...new Set([...this.affected(changes),...requested])];
  if(!changes.length&&!wakeups.length)return;
  await this.write({changes,wakeups});
  for(const c of changes){const key=c.kind+':'+c.id;c.body===null?this.cache.delete(key):this.cache.set(key,c.body);}
  this.fingerprint++;this.reloadJobs();this.lastChanges=changes;
 }
 commit({changes,wakeups}){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const put=this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body'),del=this.db.prepare('DELETE FROM records WHERE kind=? AND id=?');
   for(const c of changes)c.body===null?del.run(c.kind,c.id):put.run(c.kind,c.id,c.body);
   const wake=this.db.prepare('INSERT INTO wakeups VALUES(?,1) ON CONFLICT(id) DO UPDATE SET version=version+1');
   for(const id of wakeups)wake.run(id);
   this.db.exec('COMMIT');
  }catch(error){try{this.db.exec('ROLLBACK');}catch{error.persistenceUncertain=true;}throw error;}
 }
 acknowledge(id,version){this.db.prepare('DELETE FROM wakeups WHERE id=? AND version=?').run(id,version);this.reloadJobs();}
 close(){if(this.db){this.db.close();this.db=null;}}
}
export function readPartitionSnapshot(dir){
 const store=new PartitionStore({dir});try{return store.open();}finally{store.close();}
}
