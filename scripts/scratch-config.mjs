// Only this schema is accepted. Never evaluate shell text or copy arbitrary keys to env.
import {readFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
export function scratchEnvironment(env=process.env, stateDir=env.VILLAGE_STATE_DIR || '.runtime') {
 const result={...env};
 const file=env.VILLAGE_SCRATCH_CONFIG ?? resolve(stateDir,'scratch.json');
 if(file==='')return result; // Explicit opt-out, including for isolated fixtures.
 if(!isAbsolute(file))throw Error('scratch config must be an absolute path');
 let config;
 try{config=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT' && !Object.hasOwn(env,'VILLAGE_SCRATCH_CONFIG'))return result;throw Error('scratch config unreadable or invalid');}
 if(!config || Array.isArray(config) || Object.keys(config).some(k=>!['version','runtimeRoot'].includes(k)) || config.version!==1 || typeof config.runtimeRoot!=='string' || !isAbsolute(config.runtimeRoot) || resolve(config.runtimeRoot)==='/')throw Error('invalid scratch config schema');
 const root=resolve(config.runtimeRoot);
 for(const [key,value] of Object.entries({VILLAGE_SCRATCH_RUNTIME:resolve(root,'python'),VILLAGE_SCRATCH_BWRAP:resolve(root,'bin/bwrap'),VILLAGE_SCRATCH_FONT:resolve(root,'fonts/NotoSansCJK-Regular.ttc'),VILLAGE_SCRATCH_REQUIRED:'1'})) {
  if(!Object.hasOwn(env,key))result[key]=value;
 }
 return result;
}
