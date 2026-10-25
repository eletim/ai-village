// Read-only equipment probe, except disposable scratch state. Never installs or falls back.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Scratch} from '../server/scratch.mjs';
const deployment=process.argv.includes('--deployment');
if(deployment && !process.env.VILLAGE_SCRATCH_RUNTIME && !process.env.VILLAGE_SCRATCH_BWRAP && !process.env.VILLAGE_SCRATCH_REQUIRED){
  console.log(JSON.stringify({available:false,mode:'disabled',verification:'NOT RUN',reason:'scratch未設定。既存機能のみ反映可能。scratch有効化の検証成功ではありません。'}));
}else{
  const dir=await mkdtemp(resolve(tmpdir(),'scratch-diagnosis-'));
  try {const result=await new Scratch(dir).prepare();console.log(JSON.stringify(result,null,2));if(!result.available)process.exitCode=1;}
  finally {await rm(dir,{recursive:true,force:true});}
}
