import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {migrateDirect} from './state/migrate.ts';
import {ensureProgress,checkProgress} from './state/progress.ts';
import {writeSnapshot} from './direct-store.mjs';
export function validateRequestStore(data){
 const ids=new Set();
 for(const q of data.requests||[]){
  if(q.integrity)continue;
  const m=q.requestModel;
  if(!m||m.id!==q.id||ids.has(q.id)||!['active','completed','withdrawn'].includes(m.state?.kind)||!Array.isArray(m.runs)||!Array.isArray(m.declarations)||!Array.isArray(m.decisions)||m.state.kind==='active'&&!Array.isArray(m.state.review))throw Error('Invalid request model: '+q.id);
  ids.add(q.id);
  const runs=data.runs.filter(r=>r.humanRequestId===q.id);
  if(m.runs.length!==runs.length||new Set(m.runs.map(r=>r.id)).size!==runs.length||m.runs.some(r=>!runs.some(saved=>saved.id===r.id))||!runs.some(r=>r.id===m.rootRunId)||m.reportRunId&&!runs.some(r=>r.id===m.reportRunId&&r.phase==='report'))throw Error('Invalid request run references: '+q.id);
  for(const w of q.works){
   if(w.parentWorkId&&!q.works.some(p=>p.id===w.parentWorkId)||w.runIds.some(id=>!runs.some(r=>r.id===id&&r.workId===w.id)))throw Error('Invalid work graph: '+q.id);
   const visited=new Set([w.id]);let p=w;while(p.parentWorkId){if(visited.has(p.parentWorkId))throw Error('Work cycle: '+q.id);visited.add(p.parentWorkId);p=q.works.find(x=>x.id===p.parentWorkId);}
  }
  if(!checkProgress(m).ok)throw Error('Stalled request: '+q.id);
 }
}
export async function migrateRequestStore(dir,data){
 if(data.requestStateVersion===1){validateRequestStore(data);return data;}
 if(data.requestStateVersion!==undefined)throw Error('Unsupported requestStateVersion');
 const next=structuredClone(data),legacy=migrateDirect(data,{resumeInFlight:true});
 for(const q of next.requests||[]){
  const imported=legacy.requests.find(m=>m.id===q.id);
  q.requestModel=ensureProgress({...imported,runs:next.runs.filter(r=>r.humanRequestId===q.id).map(r=>r.runModel)},'legacy-needs-decision');
 }
 validateRequestStore(next);
 next.requestStateVersion=1;
 const models=(next.requests||[]).map(q=>q.requestModel);
 next.requestMigration={at:new Date().toISOString(),counts:{active:models.filter(m=>m.state.kind==='active').length,completed:models.filter(m=>m.state.kind==='completed').length,withdrawn:models.filter(m=>m.state.kind==='withdrawn').length,review:models.filter(m=>m.state.kind==='active'&&m.state.review.length).length,stalled:models.filter(m=>!checkProgress(m).ok).length}};
 let original;try{original=await readFile(resolve(dir,'direct.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(original){
  const backup=resolve(dir,'direct.pre-request-state-v1.json');let file;
  try{file=await open(backup,'wx',0o600);await file.writeFile(original);await file.sync();}
  catch(e){if(e.code!=='EEXIST'||!original.equals(await readFile(backup)))throw e;}
  finally{await file?.close();}
  const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}
 }
 await writeSnapshot(dir,JSON.stringify(next,null,2));return next;
}
