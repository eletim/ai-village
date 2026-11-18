// Test launcher: readiness proves the child bound our port using a disposable state directory.
import {spawn} from 'node:child_process';
import {realpath,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
const port=Number(process.argv[2]),state=await realpath(process.env.VILLAGE_STATE_DIR||'');
if(!Number.isInteger(port)||port<1024||port===5173||port>65535||!state.startsWith(await realpath(tmpdir())+sep)||process.env.VILLAGE_NOTIFICATIONS!=='false')throw Error('Isolated browser port/state/notification configuration required');
const child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port),'--host','127.0.0.1'],{stdio:['ignore','pipe','inherit']});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
let output='',verified=false;
child.stdout.on('data',async chunk=>{
 output+=chunk;
 if(verified||!output.includes(`AI村 → http://127.0.0.1:${port}`))return;
 verified=true;
 try{
  const env=(await readFile(`/proc/${child.pid}/environ`,'utf8')).split('\0');
  if(!env.includes('VILLAGE_STATE_DIR='+process.env.VILLAGE_STATE_DIR)||!env.includes('VILLAGE_NOTIFICATIONS=false'))throw Error('Child isolation mismatch');
  if(await realpath(`/proc/${child.pid}/cwd`)!==resolve('.'))throw Error('Child checkout mismatch');
  if(!(await stat(resolve(state,'direct.json'))).isFile())throw Error('Disposable state was not initialized');
  console.log(`ISOLATED_BROWSER_READY port=${port} state=${state} pid=${child.pid}`);
 }catch(error){console.error(error);child.kill();process.exitCode=1;}
});
