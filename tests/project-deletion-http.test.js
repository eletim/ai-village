import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {once} from 'node:events';
test('HTTP/CLI deletion plan, revision conflict, partial stop, restart/retry, tombstones and history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'project-delete-http-'));let child;
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`;
 const p={id:randomUUID(),name:'Fixture Project',revision:0};const agents=[0,1].map(i=>({id:randomUUID(),name:'Fixture '+i,projectId:p.id,metadataRevision:0,state:'busy',connection:{connectionType:'local'},workspaceId:'ws-'+i,tabId:'tab-'+i,sessionName:'session-'+i,cwd:dir}));
 const history={id:'old-run',agentId:agents[0].id,state:'completed',output:'history preserved'};
 const sim=join(dir,'sim.json');await writeFile(sim,JSON.stringify({present:[0,1],offline:1,closed:[]}));await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],projects:[p],agents,runs:[history]}));
 const pmux=join(dir,'fake-pmux');await writeFile(pmux,`#!${process.execPath}\nconst fs=require('fs'),file=process.env.DELETE_FIXTURE,sim=JSON.parse(fs.readFileSync(file)),args=process.argv.slice(2),i=Number(args[args.indexOf('-w')+1]?.slice(3));if(sim.offline===i)process.exit(1);if(args[1]==='list')console.log(JSON.stringify({tabs:sim.present.includes(i)?[{tabId:'tab-'+i,sessionName:'session-'+i}]:[]}));else if(args[1]==='close'){sim.present=sim.present.filter(x=>x!==i);sim.closed.push(i);fs.writeFileSync(file,JSON.stringify(sim));console.log('{}');}else if(args[1]==='status')console.log(JSON.stringify({alive:true,cliState:'busy',agentSessionId:'fixture'}));else process.exit(2);\n`,{mode:0o700});
 // Every process command is a fixture. No real tmux/SSH/process manipulation.
 await writeFile(join(dir,'python3'),`#!${process.execPath}\nconst script=process.argv[3];console.log(JSON.stringify(script.includes('root=pane')?[{pid:987,start:'fixture'}]:script.includes('remainingOwned')?{remainingOwned:0}:{available:true,sessionId:'fixture',inputs:[],turns:[]}));\n`,{mode:0o700});
 const env={...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_NOTIFICATIONS:'false',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:'',VILLAGE_PMUX_BIN:pmux,DELETE_FIXTURE:sim,PATH:dir+':'+process.env.PATH};
 const start=async()=>{child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});child.stdout.on('data',c=>{if(c.toString().includes('AI村 →')){clearTimeout(timer);resolve();}});});};
 const stop=async()=>{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}};
 const get=async path=>(await fetch(base+'/api/direct'+path)).json();const post=async(path,data,method='POST')=>{const r=await fetch(base+'/api/direct'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
 const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['scripts/village.mjs',...args],{env:{...env,VILLAGE_URL:base}})).stdout);
 try{await start();let plan=await get('/projects/'+p.id+'/delete-plan');assert.equal(plan.members.length,2);assert.match(JSON.stringify(await cli('help')),/projects delete-plan/);
 assert.equal((await post('/projects/'+p.id,{revision:0,name:'Renamed'},'PUT')).status,200);
 let input={revision:plan.revision,members:plan.members,operationId:'http-delete-operation'};assert.equal((await post('/projects/'+p.id+'/delete',input)).status,409);assert.deepEqual(JSON.parse(await readFile(sim)).closed,[]);
 plan=(await cli('projects','delete-plan',p.id)).result;input={...input,revision:plan.revision,members:plan.members};
 const partial=await post('/projects/'+p.id+'/delete',input);assert.equal(partial.status,200);assert.equal(partial.data.status,'partial');assert.equal(partial.data.remaining[0].id,agents[1].id);
 assert.equal((await post('/agents/'+agents[1].id+'/runs',{instruction:'blocked',requestId:'blocked-send'})).status,409);
 assert.equal((await post('/agents',{projectId:p.id,requestId:'blocked-create'})).status,409);
 await stop();const fixture=JSON.parse(await readFile(sim));fixture.offline=null;await writeFile(sim,JSON.stringify(fixture));await start();
 assert.equal((await cli('projects','delete',p.id,JSON.stringify(input))).result.status,'deleted');assert.equal((await post('/projects/'+p.id+'/delete',input)).data.status,'deleted');
 const state=await get('');assert.equal(state.projects.length,0);assert(state.agents.every(a=>a.state==='terminated'&&a.deletedAt));assert.equal(state.runs[0].output,'history preserved');assert.equal((await get('/agents')).agents.length,0);assert.deepEqual(JSON.parse(await readFile(sim)).closed,[0,1]);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
