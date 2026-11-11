import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {remoteExecutor,stateDirectory,run} from '../server/execution.mjs';
import {VillageOperations} from '../server/operations.mjs';
test('only Direct village starts even when legacy state is invalid; retired routes are absent and bytes untouched',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'single-village-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const legacy=['state.json','conversation.json'];for(const file of legacy)await writeFile(join(dir,file),'invalid legacy data: never parse or rewrite');
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',VILLAGE_PMUX_BIN:'/usr/bin/false'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}});
 await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('startup timeout')),10000);child.once('exit',()=>{clearTimeout(timer);no(Error('startup failed'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);ok();}});});
 const base='http://127.0.0.1:'+port;
 for(const url of ['/office','/office/','/office.html','/api/state','/api/jobs','/api/jobs/11111111-1111-4111-8111-111111111111/artifacts','/api/messages','/api/secretary/memo','/src/main.js','/src/office.js'])assert.equal((await fetch(base+url)).status,404,url);
 for(const path of ['/api/jobs','/api/messages','/api/secretary/send'])assert.equal((await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
 for(const path of ['/','/agents','/api/health','/api/direct'])assert.equal((await fetch(base+path)).status,200);
 for(const path of ['/','/agents'])assert.doesNotMatch(await (await fetch(base+path)).text(),/href="\/office/);
 const help=await (await fetch(base+'/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:['help']})})).json();assert(help.ok);assert(help.result.some(c=>c.name==='agents create'));assert(help.result.some(c=>c.name==='pr list'));assert(!help.result.some(c=>/^(jobs|desk|history|development|deployments) |^reports (list|get|approve)$|^images import$/.test(c.name)));
 for(const file of legacy)assert.equal(await readFile(join(dir,file),'utf8'),'invalid legacy data: never parse or rewrite');
});
test('independent execution preserves literal SSH arguments and audits Agent identity',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'single-execution-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const executor=remoteExecutor(dir);await assert.rejects(executor(['true'],null),/接続先/);
 assert.equal(stateDirectory(dir),dir);assert.equal(await run(process.execPath,['-e','process.stdout.write(process.argv[1])',"literal '$() quote"]),"literal '$() quote");
 // Intercept SSH executable only, then evaluate its correctly quoted remote command locally.
 const ssh=join(dir,'ssh');await writeFile(ssh,`#!/usr/bin/env python3\nimport sys,subprocess\nraise SystemExit(subprocess.call(sys.argv[-1],shell=True))\n`,{mode:0o700});
 const old=process.env.PATH;process.env.PATH=dir+':'+old;
 try{const value="spaces ' quotes $HOME ; literal";assert.equal(await executor(['printf','%s',value],'test-host','agent-one'),value);}finally{process.env.PATH=old;}
 const audit=JSON.parse((await readFile(join(dir,'ssh-audit.jsonl'),'utf8')).trim());assert.equal(audit.agentId,'agent-one');assert.equal(audit.host,'test-host');assert.equal(audit.jobId,undefined);
});
test('old job commands are rejected rather than reinterpreted',()=>{
 const ops=new VillageOperations({dir:'.'},null);
 for(const args of [['jobs','list'],['reports','approve','old'],['development','start','--task','old'],['images','import','old','x.png']])assert.throws(()=>ops.resolve(args),/未対応/);
});
test('retained PR operations use the explicit repository document, not old development configuration',async t=>{
 const {PullRequests}=await import('../server/pull-requests.mjs');const {VillageLibrary}=await import('../server/library.mjs');
 const dir=await mkdtemp(join(tmpdir(),'single-pr-'));t.after(()=>rm(dir,{recursive:true,force:true}));let path;
 const prs=new PullRequests(dir,new VillageLibrary(),async p=>{path=p;return [];});
 const result=await prs.run('list',{});assert.deepEqual(result.items,[]);assert.match(path,/^\/repos\/eletim\/ai-village\/pulls\?/);
});
