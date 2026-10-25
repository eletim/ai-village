import {scratchEnvironment} from './scratch-config.mjs';
import {spawnSync} from 'node:child_process';
const env={...scratchEnvironment(),VILLAGE_SCRATCH_REQUIRED:'1'};
for(const args of [['scripts/diagnose-scratch.mjs'],['--test','tests/scratch.test.js']]){
 const r=spawnSync(process.execPath,args,{env,stdio:'inherit'});
 if(r.error || r.status!==0){process.exitCode=1;break;}
}
