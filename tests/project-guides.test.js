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
 const context=await guides.context(agent,{},'https://village.example');assert.deepEqual(JSON.parse(context.split('<ai-village-project-guide>')[1].split('</ai-village-project-guide>')[0]).argv,['projects','guide',projectId]);assert(!context.includes(first.content));
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
 d.flow.context=()=>'';d.flow.root=()=>({});d.flow.reportPrompt=()=> 'human instruction';
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
 const created=(await op(['projects','create','default-policy-http','HTTP policy'])).result;
 const initial=(await op(['projects','guide',created.id])).result;assert.match(initial.content,/デフォルトの秘書方針/);assert.match(initial.content,/人間から明示的な実装指示があるまで、実装や工房への作業指示を行わない。相談・方針検討・案への同意だけでは、実装指示とみなさない。/);
 const endpoint=base+'/api/direct/human/projects/'+created.id+'/guide';
 const payload={revision:initial.revision,content:'# HTTP edited policy'};
 const denied=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(denied.status,403);
 const page=await fetch(base+'/agents');const cookie=page.headers.get('set-cookie').split(';')[0];
 const put=body=>fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json','X-Village-Human-UI':'1',Origin:base,Cookie:cookie},body:JSON.stringify(body)});
 assert.equal((await put(payload)).status,200);assert.equal((await put(payload)).status,409);
 const latest=(await op(['projects','guide',created.id])).result;assert.equal(latest.content,payload.content);
 assert.equal((await put({revision:latest.revision,content:''})).status,400);
 const office=await fetch(base+'/office',{redirect:'manual'});assert.equal(testView(office).status,404);
 const docs=await (await fetch(base+'/api/documents')).json();assert(!docs.documents.some(d=>d.path.startsWith('compat/')));
});

test('defaults initialize once; legacy documents stay live until edited; revisions serialize saves and survive restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'policy-state-')),root=await mkdtemp(join(tmpdir(),'policy-docs-'));
 t.after(()=>Promise.all([rm(dir,{recursive:true,force:true}),rm(root,{recursive:true,force:true})]));
 await writeFile(join(root,'index.json'),JSON.stringify({legacy:'guide.md',broken:'missing.md'}));await writeFile(join(root,'guide.md'),'individual policy');
 await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,projects:[{id:'existing',name:'Existing',revision:0},{id:'legacy',name:'Legacy',revision:0},{id:'broken',name:'Broken',revision:0}],agents:[],runs:[],workshops:[]}));
 const d=new DirectAgents({dir});d.projectGuides.root=root;await d.init({watch:false});t.after(()=>d.close());
 const initial=await d.projectGuides.get('existing');assert.match(initial.content,/デフォルトの秘書方針/);assert.match(initial.content,/人間から明示的な実装指示があるまで、実装や工房への作業指示を行わない。相談・方針検討・案への同意だけでは、実装指示とみなさない。/);
 const created=await d.putProject({name:'New',requestId:'create-new-project'});assert.equal((await d.projectGuides.get(created.id)).content,initial.content);
 assert.equal((await d.projectGuides.get('broken')).available,false);assert(!Object.hasOwn(d.data.projectPolicies,'broken'));
 assert.equal((await d.projectGuides.get('legacy')).content,'individual policy');
 await writeFile(join(root,'guide.md'),'changed document');const legacy=await d.projectGuides.get('legacy');assert.equal(legacy.content,'changed document');
 await d.putProjectGuide('legacy',{revision:legacy.revision,content:'edited legacy'});
 await writeFile(join(root,'guide.md'),'later file edit');assert.equal((await d.projectGuides.get('legacy')).content,'edited legacy');
 const results=await Promise.allSettled(['one','two'].map(content=>d.putProjectGuide('existing',{revision:initial.revision,content})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const saved=await d.projectGuides.get('existing');
 for(const content of ['', '   ',null,'x'.repeat(20001),'bad\0text'])await assert.rejects(d.putProjectGuide('existing',{revision:saved.revision,content}),{status:400});
 await assert.rejects(d.putProjectGuide('missing',{revision:saved.revision,content:'bad'}),{status:404});
 const write=d.store.write;d.store.write=async()=>{throw Error('disk failed');};
 await assert.rejects(d.putProjectGuide('existing',{revision:saved.revision,content:'must roll back'}),/disk failed/);d.store.write=write;
 assert.deepEqual(await d.projectGuides.get('existing'),saved);
 const restarted=new DirectAgents({dir});restarted.projectGuides.root=root;await restarted.init({watch:false});t.after(()=>restarted.close());
 assert.deepEqual(await restarted.projectGuides.get('existing'),saved);assert.equal((await restarted.projectGuides.get('legacy')).content,'edited legacy');
});
