import {readFile,open} from 'node:fs/promises';import {resolve} from 'node:path';
import {writeSnapshot} from './direct-store.mjs';import {runMarker} from './input-envelope.mjs';import {ensureProgress} from './state/progress.ts';
export function markerData(source){
 if(source.markerVersion!==undefined&&source.markerVersion!==1)throw Error('Unsupported markerVersion');
 const data=structuredClone(source),unconfirmed=[];
 for(const r of data.runs){
  if(['sent','running'].includes(r.runModel.state.kind)&&r.inputMarker!==runMarker(r.id)){
   r.runModel={...r.runModel,state:{kind:'ended',outcome:'unconfirmed',reason:'legacy-marker-missing'},facts:[...r.runModel.facts,{type:'marker-migration-unconfirmed',at:0}]};unconfirmed.push(r.id);
  }
  delete r.inputHash;for(const p of r.priorInputs||[])delete p.hash;
 }
 for(const q of data.requests){
  if(q.integrity)continue;
  const affected=unconfirmed.filter(id=>data.runs.find(r=>r.id===id)?.humanRequestId===q.id);
  q.requestModel=ensureProgress({...q.requestModel,runs:data.runs.filter(r=>r.humanRequestId===q.id).map(r=>r.runModel),...(affected.length&&q.requestModel.state.kind==='active'?{state:{kind:'active',review:[...new Set([...q.requestModel.state.review,...affected.map(id=>'run-needs-review:'+id)])]}}:{})});
 }
 data.markerVersion=1;return {data,unconfirmed};
}
export async function migrateMarkerStore(dir,source){
 const {data,unconfirmed}=markerData(source);if(source.markerVersion===1)return data;
 const bytes=await readFile(resolve(dir,'direct.json')),path=resolve(dir,'direct.pre-marker-v1.json');let file;
 try{file=await open(path,'wx',0o600);await file.writeFile(bytes);await file.sync();}catch(e){if(e.code!=='EEXIST'||!bytes.equals(await readFile(path)))throw e;}finally{await file?.close();}
 const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}
 data.markerMigration={at:new Date().toISOString(),runs:data.runs.length,unconfirmed};await writeSnapshot(dir,JSON.stringify(data,null,2));return data;
}
