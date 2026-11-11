import {fixtureModels} from './model-fixtures.mjs';
import {testView} from './model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {ProjectGuides} from '../server/project-guides.mjs';
import {VillageLibrary} from '../server/library.mjs';
import {DirectAgents} from '../server/direct.mjs';

const projectId='11d88203-2687-49c8-8d7d-baf1169176bc';
test('Project guide scope, fresh reads, missing and unsafe files',async t=>{
 const root=await mkdtemp(join(tmpdir(),'project-guides-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'index.json'),JSON.stringify({[projectId]:'guide.md'}));await writeFile(join(root,'guide.md'),'first policy');
 const guides=new ProjectGuides(root),agent={location:'mayor',projectId};
 const first=await guides.get(projectId);assert.equal(first.content,'first policy');
 const context=await guides.context(agent,{},'https://village.example');assert.match(context,/projects guide/);assert.match(context,/https:\/\/village.example\/api\/village/);assert(!context.includes(first.content));
 for(const [a,r] of [[{...agent,location:'workshop'},{}],[{...agent,projectId:'other'},{}],[{location:'mayor',name:'村実装',cwd:'村実装'},{}],[agent,{phase:'report'}]])assert.equal(await guides.context(a,r,'url'),'');
 await writeFile(join(root,'guide.md'),'updated');const updated=await guides.get(projectId);assert.equal(updated.content,'updated');assert.notEqual(first.hash,updated.hash);
 await rm(join(root,'guide.md'));assert.deepEqual(await guides.get(projectId),{available:false});assert.equal(await guides.context(agent,{},'url'),'');
 await symlink('/etc/passwd',join(root,'guide.md'));assert.equal((await guides.get(projectId)).available,false);
 await writeFile(join(root,'index.json'),'broken');assert.equal((await guides.get(projectId)).available,false);
});
test('dispatch attaches guide only to registered secretary normal runs',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'guide-dispatch-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const d=new DirectAgents({dir});await d.init({watch:false});t.after(()=>d.close());
 d.observe=async a=>{a.canSend=true;a.runtime={agentSessionId:'native'};return {sessionId:'native',cursor:0};};
 d.flow.context=()=>'';
 let sent;d.pmux=async(...args)=>{sent=args.at(-1);};
 for(const [location,project,phase,expected] of [['mayor',projectId,undefined,true],['mayor','other',undefined,false],['workshop',projectId,undefined,false],['mayor',projectId,'report',false]]){
  const a={id:'agent',location,projectId:project,tabId:'tab',workspaceId:'ws',state:'idle'};d.data.agents=[a];
  const r={id:'run',agentId:a.id,state:'queued',instruction:'human instruction',phase};d.data.runs=[r];fixtureModels(d.data);
  await d.attemptRun(r);assert.equal(testView(r).state,'awaiting_input');assert.equal(sent.includes('<ai-village-project-guide>'),expected);
  assert(!sent.includes('まとまった実装・検証'));
 }
});
test('HTTP official operation returns latest guide; retired office is unavailable',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'guide-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sock=createServer();sock.listen(0,'127.0.0.1');await once(sock,'listening');const port=sock.address().port;await new Promise(r=>sock.close(r));
 const child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_AUTH_FILE:'',VILLAGE_VPN_ADDRESS:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_NOTIFICATIONS:'false'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}});
 await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('startup timeout')),15000);child.once('exit',()=>{clearTimeout(timer);no(Error('server exited'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);ok();}});});
 const base=`http://127.0.0.1:${port}`;
 const op=async argv=>{const res=await fetch(base+'/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv})});assert.equal(testView(res).status,200);return res.json();};
 const result=await op(['projects','guide',projectId]);assert.equal(result.result.available,true);assert.match(result.result.content,/同じProject/);
 assert.equal((await op(['projects','guide','other'])).result.available,false);
 assert.equal((await op(['projects','guide','../../etc/passwd'])).result.available,false);
 const office=await fetch(base+'/office',{redirect:'manual'});assert.equal(testView(office).status,404);
 const docs=await (await fetch(base+'/api/documents')).json();assert(!docs.documents.some(d=>d.path.startsWith('compat/')));
});
