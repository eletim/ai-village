// Transport-only representation. The UI still receives the same workspace snapshot.
const key=(...parts)=>JSON.stringify(parts);
const entryId=e=>key(e.external?'native':'run',e.sessionId||e.agentSessionId||'',e.id);
// Store a repeated final suffix once on the wire, reconstructing the exact UI value.
function packEntry(entry){
 if(typeof entry.output==='string'&&typeof entry.finalOutput==='string'&&entry.finalOutput&&entry.output.endsWith(entry.finalOutput))return {...entry,output:entry.output.slice(0,-entry.finalOutput.length),outputIncludesFinal:true};
 return entry;
}
function unpackEntry(entry){
 if(!entry.outputIncludesFinal)return entry;
 const {outputIncludesFinal,...rest}=entry;return {...rest,output:(rest.output||'')+(rest.finalOutput||'')};
}
export function packWorkspace(snapshot){
 const records={};const {agents,runs,requests,conversations,...meta}=snapshot;
 records.meta=meta;
 for(const [name,rows] of Object.entries({agents,runs,requests})){
  records[key(name,'order')]=(rows||[]).map(r=>r.id);
  for(const row of rows||[])records[key(name,row.id)]=row;
 }
 records.conversations=Object.keys(conversations||{});
 for(const [id,page] of Object.entries(conversations||{})){
  const {entries,...rest}=page;records[key('page',id)]={...rest,order:entries.map(entryId)};
  for(const entry of entries)records[key('entry',id,entryId(entry))]=packEntry(entry);
 }
 return records;
}
export function unpackWorkspace(records){
 const snapshot={...records.meta};
 for(const name of ['agents','runs','requests'])snapshot[name]=records[key(name,'order')].map(id=>records[key(name,id)]);
 snapshot.conversations={};
 for(const id of records.conversations){const {order,...meta}=records[key('page',id)];snapshot.conversations[id]={...meta,entries:order.map(k=>unpackEntry(records[key('entry',id,k)]))};}
 return snapshot;
}
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function applyChanges(previous,changes){
 // Apply atomically: a missing base or malformed response never corrupts the retained view.
 const result={...previous},owned=new WeakSet([result]);
 for(const c of changes){
  if(!Array.isArray(c.path)||!c.path.length||c.path.some(k=>typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)))throw Error('Invalid workspace update');
  let target=result;for(const k of c.path.slice(0,-1)){
   if(!object(target)||!Object.hasOwn(target,k)||!object(target[k]))throw Error('Missing workspace base');
   if(!owned.has(target[k])){target[k]={...target[k]};owned.add(target[k]);}
   target=target[k];
  }
  const k=c.path.at(-1);
  if(!object(target))throw Error('Invalid workspace target');
  if(c.op==='delete')delete target[k];
  else if(c.op==='set')target[k]=c.value;
  else if(c.op==='append'&&typeof target[k]==='string'&&target[k].length===c.length&&typeof c.value==='string')target[k]+=c.value;
  else throw Error('Invalid workspace operation');
 }
 return result;
}
export function acceptWorkspace(current,envelope){
 if(envelope.protocol!==1||typeof envelope.cursor!=='string')throw Error('Invalid workspace response');
 const records=envelope.mode==='full'?structuredClone(envelope.records):envelope.mode==='delta'&&current?.cursor===envelope.base?applyChanges(current.records,envelope.changes):null;
 if(!records)throw Error('Workspace base expired');
 return {cursor:envelope.cursor,records,state:unpackWorkspace(records)};
}
