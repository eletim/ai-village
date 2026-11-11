import {quarantinedRun} from './request-integrity.mjs';
import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {migrateDirect} from './state/migrate.ts';
import {importRun} from './run-lifecycle.mjs';
import {writeSnapshot} from './direct-store.mjs';
const VERSION=1;
export async function migrateRunStore(dir,data){
 for(const key of ['agents','runs','workshops'])if(!Array.isArray(data[key]))throw Error('Invalid direct.json array: '+key);
 if(data.requests!==undefined&&!Array.isArray(data.requests))throw Error('Invalid direct.json requests');
 for(const [kind,items] of Object.entries({agent:data.agents,run:data.runs,request:data.requests||[]})){
  const seen=new Set();for(const item of items){if(!item||typeof item.id!=='string'||!item.id||seen.has(item.id))throw Error('Invalid or duplicate '+kind+' id');seen.add(item.id);}
 }
 for(const q of data.requests||[]){
  if(q.integrity)continue;
  if(!Array.isArray(q.works)||q.inbox!==undefined&&!Array.isArray(q.inbox))throw Error('Invalid request graph: '+q.id);
  const ids=new Set();for(const w of q.works){
   if(!w.id||ids.has(w.id)||!Array.isArray(w.runIds)||!data.runs.some(r=>r.id===w.currentRunId&&r.humanRequestId===q.id))throw Error('Invalid work reference: '+q.id+':'+w.id);
   ids.add(w.id);
  }
 }
 if(data.runStateVersion===VERSION){
  for(const r of data.runs){
   const m=r.runModel,s=m?.state;
   if(!m||m.id!==r.id||(!quarantinedRun(data,r)&&m.requestId!==(r.humanRequestId||''))||!s||!['queued','sent','running','ended','cancelled'].includes(s.kind)||!Array.isArray(m.facts)||!Array.isArray(m.decisions)||!Number.isInteger(m.retryBudget?.count)||m.retryBudget.count<0||
    s.kind==='sent'&&(!Number.isFinite(s.sentAt)||(s.sessionId!==null&&typeof s.sessionId!=='string'))||
    s.kind==='running'&&(!s.sessionId||!s.turnId||!s.inputId)||
    s.kind==='ended'&&(!['normal','failed','interrupted','unconfirmed'].includes(s.outcome)||typeof s.reason!=='string'))throw Error('Invalid run model: '+r.id);
   // Rebuild the compatibility label, never trust a separately edited projection.
   importRun(r,m);
  }
  return data;
 }
 if(data.runStateVersion!==undefined)throw Error('Unsupported runStateVersion: '+data.runStateVersion);
 const migration=migrateDirect(data,{resumeInFlight:true});
 // Pre-request historical runs have no humanRequestId. Keep them as explicitly
 // audited untracked history; dangling tracked references are fatal.
 const allowed=new Set(data.runs.filter(r=>!r.humanRequestId).map(r=>'orphan-run:'+r.id));
 const isolated=new Set(data.runs.filter(r=>data.requests?.some(q=>q.integrity&&(q.id===r.humanRequestId||q.works?.some?.(w=>w.runIds?.includes(r.id))))).map(r=>r.id));
 const referenceIssues=new Set(['orphan-run','missing-parent','missing-result-source','invalid-parent-run','parent-cycle']);
 const fatal=migration.issues.filter(issue=>{const split=issue.indexOf(':');return !allowed.has(issue)&&!(referenceIssues.has(issue.slice(0,split))&&isolated.has(issue.slice(split+1)));});
 if(fatal.length)throw Error('Run migration refused: '+fatal.join(', '));
 const next=structuredClone(data);
 for(const r of next.runs){importRun(r,migration.runs.find(m=>m.id===r.id));}
 next.runStateVersion=VERSION;next.runMigration={at:new Date().toISOString(),issues:migration.issues,counts:Object.fromEntries(['queued','sent','running','ended','cancelled'].map(kind=>[kind,migration.runs.filter(r=>r.state.kind===kind).length]))};
 const path=resolve(dir,'direct.json');
 let original;try{original=await readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(original){
  // Exclusive backup, fsync before replacing data. An existing backup is safe only
  // when it is exactly the same source (e.g. a crash before writing the migration).
  const backup=resolve(dir,'direct.pre-run-state-v1.json');
  let file;try{file=await open(backup,'wx',0o600);await file.writeFile(original);await file.sync();}
  catch(e){if(e.code!=='EEXIST'||!original.equals(await readFile(backup)))throw e;}
  finally{await file?.close();}
  const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}
 }
 await writeSnapshot(dir,JSON.stringify(next,null,2));return next;
}
