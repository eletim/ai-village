import { spawn } from 'node:child_process';
import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir=resolve(process.env.VILLAGE_STATE_DIR||'.runtime');await mkdir(dir,{recursive:true});
let child,busy=false,stopping=false,last;
try{last=JSON.parse(await readFile(resolve(dir,'restart.json'),'utf8')).id;}catch{}
async function save(){const f=resolve(dir,'supervisor.json');await writeFile(f+'.tmp',JSON.stringify({pid:process.pid,backendPid:child?.pid,root:resolve('.'),at:new Date().toISOString()}));await rename(f+'.tmp',f);}
function start(){child=spawn(process.execPath,[resolve('scripts/dev.mjs'),...process.argv.slice(2)],{env:{...process.env,VILLAGE_SUPERVISED:'1'},stdio:'inherit'});save().catch(console.error);child.on('exit',()=>{if(!busy&&!stopping)setTimeout(start,1000);});}
async function stop(){const old=child;if(!old||old.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>old.kill('SIGKILL'),8000);old.once('exit',()=>{clearTimeout(timer);resolve();});old.kill('SIGTERM');});}
start();
setInterval(async()=>{if(busy||stopping)return;try{const request=JSON.parse(await readFile(resolve(dir,'restart.json'),'utf8'));if(request.id===last)return;last=request.id;busy=true;await stop();start();}catch{}finally{busy=false;}},500);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{stopping=true;await stop();process.exit(0);});
