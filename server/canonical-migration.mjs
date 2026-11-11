import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {writeSnapshot} from './direct-store.mjs';
import {validateRequestStore} from './request-migration.mjs';
import {ensureProgress} from './state/progress.ts';
const runKeys=['state','acceptance','blocksInput','dispatchConfirmed','needsReview','supersededBy'];
const agentKeys=['state','lifecycle','activityState','connectionState','canSend','canQueue','canSteer','sendReason','reportPending'];
const remove=(x,keys)=>{for(const k of keys)delete x[k];};
export function canonicalData(source){
 const data=structuredClone(source);data.requests ||= [];
 if(data.canonicalStateVersion!==undefined&&data.canonicalStateVersion!==1)throw Error('Unsupported canonicalStateVersion');
 for(const r of data.runs){
  if(!r.runModel)throw Error('Missing run model: '+r.id);
  const facts=[...r.runModel.facts];
  if(r.dispatchConfirmed===true&&!facts.some(f=>f.type==='transport-ack'))facts.push({type:'transport-ack',at:Date.parse(r.dispatchAttemptedAt)||0});
  if(r.acceptance==='accepted'&&r.inputId&&r.turnId&&r.sessionId&&!facts.some(f=>f.type==='input'))facts.push({type:'input',at:Date.parse(r.acceptedAt)||0,inputId:r.inputId,turnId:r.turnId,sessionId:r.sessionId});
  r.runModel={...r.runModel,facts};remove(r,runKeys);
 }
 for(const a of data.agents)remove(a,agentKeys);
 for(const q of data.requests||[]){
  if(q.integrity)continue;
  if(!q.requestModel)throw Error('Missing request model: '+q.id);
  // Claims live in declarations. Preserve old claims not imported by earlier versions.
  const declarations=[...q.requestModel.declarations];
  for(const w of q.works){
   if(w.finish?.runId&&!declarations.some(d=>d.runId===w.finish.runId))declarations.push({id:w.finish.operationId||'legacy:'+w.finish.runId,runId:w.finish.runId,actor:'agent',at:Date.parse(w.finish.requestedAt)||0});
   remove(w,['state','finish','latestResultId']);
  }
  // The source backup retains obsolete inbox bookkeeping. Delivery identity is in runModel.resultOf.
  q.requestModel=ensureProgress({...q.requestModel,declarations,runs:data.runs.filter(r=>r.humanRequestId===q.id).map(r=>r.runModel)},'legacy-needs-decision');
  remove(q,['status','needsReview','ticket','ticketId','inbox']);if(q.report)delete q.report.sourceFinish;
 }
 validateRequestStore(data);data.canonicalStateVersion=1;return data;
}
export async function migrateCanonicalStore(dir,data){
 const next=canonicalData(data);
 if(data.canonicalStateVersion===1)return next;
 const original=await readFile(resolve(dir,'direct.json'));
 const path=resolve(dir,'direct.pre-canonical-state-v1.json');let f;
 try{f=await open(path,'wx',0o600);await f.writeFile(original);await f.sync();}catch(e){if(e.code!=='EEXIST'||!original.equals(await readFile(path)))throw e;}finally{await f?.close();}
 const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}
 next.canonicalMigration={at:new Date().toISOString(),agents:next.agents.length,runs:next.runs.length,requests:next.requests.length};
 await writeSnapshot(dir,JSON.stringify(next,null,2));return next;
}
