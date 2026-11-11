import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';

test('real Agent view HTTP validates revision, persists across restart and does not dispatch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-review-http-'));let child;
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base=`http://127.0.0.1:${port}`,agentId='11111111-1111-4111-8111-111111111111';
 await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],agents:[{id:agentId,name:'fixture',state:'terminated',connection:{connectionType:'local'}}],runs:[{id:'one',agentId,state:'completed',acceptance:'accepted',completionEvent:'native-terminal',output:'first',notification:{status:'fixture'}},{id:'two',agentId,state:'completed',acceptance:'accepted',completionEvent:'native-terminal',output:'second',notification:{status:'fixture'}}]}));
 const start=async()=>{child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_NOTIFICATIONS:'false',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:'',VILLAGE_VPN_ADDRESS:''},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited'));});child.stdout.on('data',chunk=>{if(chunk.toString().includes('AI村 →')){clearTimeout(timer);resolve();}});});};
 const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}};
 const post=revision=>fetch(base+'/api/direct/agents/'+agentId+'/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})});
 try{
  await start();const key=(await(await fetch(base+'/api/direct')).json()).reviews[agentId].revision;
  assert.equal((await post('0'.repeat(64))).status,409);assert.equal((await post('bad')).status,400);
  assert.equal((await post(key)).status,200);assert.equal((await post(key)).status,200);
  assert.equal((await(await fetch(base+'/api/direct')).json()).reviews[agentId].unreviewed,false);
  const write=async(path,body,method='POST')=>fetch(base+'/api/direct'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const projectResponse=await write('/projects',{requestId:'http-project-1',name:'Explicit Project'});assert.equal(projectResponse.status,201);const project=await projectResponse.json();
  assert.equal((await write('/agents/'+agentId,{revision:0,name:'New display',projectId:project.id},'PUT')).status,200);
  assert.equal((await write('/agents/'+agentId,{revision:0,name:'Lost update'},'PUT')).status,409);
  const discovery=await(await fetch(base+'/api/direct/agents')).json();assert.equal(discovery.agents[0].projectName,'Explicit Project');assert.ok(discovery.management.help);
  assert.equal((await write('/projects/'+project.id,{revision:0,name:'Renamed Project'},'PUT')).status,200);
  await stop();await start();const state=await(await fetch(base+'/api/direct')).json();assert.equal(state.agentReviews[agentId],key);assert.equal(state.reviews[agentId].unreviewed,false);assert.equal(state.runs.length,2);assert.equal(state.projects[0].name,'Renamed Project');assert.equal(state.agents[0].projectId,project.id);assert.equal(state.agents[0].name,'New display');
  assert.equal((await fetch(base+'/api/direct/agents/'+agentId+'/view',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://wrong.example'},body:JSON.stringify({revision:key})})).status,403);
  await assert.rejects(readFile(join(dir,'local-audit.jsonl')),{code:'ENOENT'});await assert.rejects(readFile(join(dir,'notifications.jsonl')),{code:'ENOENT'});
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
