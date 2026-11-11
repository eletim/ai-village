import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {writeSnapshot} from './direct-store.mjs';
export async function migrateAgentStore(dir,data){
 if(data.agentStateVersion!==undefined&&data.agentStateVersion!==1)throw Error('Unsupported agentStateVersion');
 if(data.agentStateVersion===1){
  for(const a of data.agents){const m=a.agentModel,o=m?.observation;if(!m||m.id!==a.id||![null,'start','stop'].includes(m.intent)||!Object.hasOwn(m,'observation')||o!==null&&(typeof o!=='object'||!['alive','absent','unknown'].includes(o.process)||!['idle','running','input-needed','unknown'].includes(o.activity)||typeof o.connected!=='boolean'||typeof o.canSteer!=='boolean'||o.inputPending!==undefined&&typeof o.inputPending!=='boolean'))throw Error('Invalid agent model: '+a.id);}
  return data;
 }
 const next=structuredClone(data);
 for(const a of next.agents){
  const stop=['terminated','stopping','stop_unknown'].includes(a.state)||!!a.deletedAt;
  a.agentModel={id:a.id,intent:stop?'stop':['creating','starting','creation_unknown'].includes(a.state)?'start':null,observation:stop&&a.processVerification?.remainingOwned===0&&a.terminatedAt?{connected:true,process:'absent',activity:'unknown',canSteer:false}:null};
 }
 next.agentStateVersion=1;next.agentMigration={at:new Date().toISOString(),agents:next.agents.length,runs:next.runs.length,requests:(next.requests||[]).length};
 let original;try{original=await readFile(resolve(dir,'direct.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(original){const backup=resolve(dir,'direct.pre-agent-state-v1.json');let file;try{file=await open(backup,'wx',0o600);await file.writeFile(original);await file.sync();}catch(e){if(e.code!=='EEXIST'||!original.equals(await readFile(backup)))throw e;}finally{await file?.close();}const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}}
 await writeSnapshot(dir,JSON.stringify(next,null,2));return next;
}
