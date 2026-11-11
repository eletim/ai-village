import { spawn } from 'node:child_process';
import { mkdir,writeFile,rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import {stateDirectory} from '../server/execution.mjs';
const dir=stateDirectory();await mkdir(dir,{recursive:true});
let child,stopping=false;
async function save(){const f=resolve(dir,'supervisor.json');await writeFile(f+'.tmp',JSON.stringify({pid:process.pid,backendPid:child?.pid,root:resolve('.'),at:new Date().toISOString()}));await rename(f+'.tmp',f);}
function start(){child=spawn(process.execPath,[resolve('scripts/dev.mjs'),...process.argv.slice(2)],{env:{...process.env,VILLAGE_SUPERVISED:'1'},stdio:'inherit'});save().catch(console.error);child.on('exit',()=>{if(!stopping)setTimeout(start,1000);});}
async function stop(){const old=child;if(!old||old.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>old.kill('SIGKILL'),8000);old.once('exit',()=>{clearTimeout(timer);resolve();});old.kill('SIGTERM');});}
start();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{stopping=true;await stop();process.exit(0);});
