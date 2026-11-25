// Prepare NEW Agents only; no test instruction or native event is sent here.
// Pass the isolation launcher's captured stdout, never a production URL.
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
const [proofFile,outputDir,agentCwd]=process.argv.slice(2);
if(!proofFile||!outputDir||!agentCwd)throw Error('usage: node scripts/prepare-secretary-leader-eval.mjs LAUNCHER_LOG NEW_EVIDENCE_DIR NEW_AGENT_CWD');
const proof=await readFile(proofFile,'utf8'),match=proof.match(/ISOLATED_BROWSER_READY port=(\d+) state=(\S+) pid=(\d+)/);
if(!match)throw Error('Missing isolation proof');
const [,port,state,pid]=match;
if(port==='5173'||!(await realpath(state)).startsWith(await realpath(tmpdir())+'/'))throw Error('Not an isolated state/port');
const env=(await readFile(`/proc/${pid}/environ`,'utf8')).split('\0');
if(!env.includes('VILLAGE_STATE_DIR='+state)||!env.includes('VILLAGE_NOTIFICATIONS=false'))throw Error('Isolation environment mismatch');
const serverCwd=await realpath(`/proc/${pid}/cwd`);
if(serverCwd!==resolve('.'))throw Error('Run this preparation in the isolated server checkout');
await mkdir(outputDir,{recursive:false});await mkdir(agentCwd,{recursive:false});
const base='http://127.0.0.1:'+port,manifest={createdAt:new Date().toISOString(),base,state,pid,serverCwd,agentCwd:await realpath(agentCwd),notification:false,operations:[]};
const file=resolve(outputDir,'manifest.json'),save=()=>writeFile(file,JSON.stringify(manifest,null,2));await save();
async function call(path,input,method='POST'){
 const entry={path,input,method,status:'attempting',at:new Date().toISOString()};manifest.operations.push(entry);await save();
 let response;
 try{const r=await fetch(base+'/api/direct'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});response=await r.json();entry.httpStatus=r.status;entry.response=response;entry.status=r.ok?'received':'rejected';await save();if(!r.ok)throw Error(JSON.stringify(response));}
 catch(error){if(entry.status==='attempting'){entry.status='unknown';entry.error=error.message;await save();}throw error;}
 return response;
}
manifest.health=await(await fetch(base+'/api/health')).json();await save();
const project=await call('/projects',{requestId:randomUUID(),name:'秘書リーダー独立受入 '+Date.now()});
const workshop=await call('/workshops',{name:'独立受入ローカル',connectionType:'local',baseUrl:'http://127.0.0.1:3000',workplaces:[manifest.agentCwd]});
for(const [role,location] of [['secretary','mayor'],['leader','workshop'],['worker','workshop']]){
 manifest[role]=await call('/agents',{requestId:randomUUID(),workshopId:workshop.id,projectId:project.id,cwd:manifest.agentCwd,name:'受入 '+role,provider:'codex',location});await save();
}
manifest.project=await call('/projects/'+project.id,{revision:project.revision,leaderAgentId:manifest.leader.id},'PUT');await save();
console.log(JSON.stringify({manifest:file,base,projectId:project.id,secretary:manifest.secretary.id,leader:manifest.leader.id,worker:manifest.worker.id}));
