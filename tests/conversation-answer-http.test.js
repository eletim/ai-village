import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {serverReady} from './helpers/server-ready.mjs';
import {conversationFixture} from './helpers/conversation-answer-fixture.mjs';
test('actual HTTP snapshot and history retain normal conversation answers and internal input provenance',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'leader-answer-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const data=conversationFixture();for(const i of [1,103]){data.runs[i].conversationDisplay={mode:'progress',version:1};data.runs[i].notificationPolicy='conversation';}await writeFile(join(dir,'direct.json'),JSON.stringify(data));const bin=join(dir,'pmux');await writeFile(bin,'#!/bin/sh\nexit 1\n',{mode:0o700});
 const socket=createServer();socket.listen(Number(process.env.VILLAGE_TEST_PORT||0),'127.0.0.1');await once(socket,'listening');const port=socket.address().port;assert.notEqual(port,5173);await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['scripts/dev.mjs','--host','127.0.0.1','--port',String(port)],{env:{...process.env,HOME:dir,VILLAGE_STATE_DIR:dir,VILLAGE_PMUX_BIN:bin,VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',CODEX_HOME:dir},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}});await serverReady(child);
 const env=(await import('node:fs/promises')).readFile;assert((await env(`/proc/${child.pid}/environ`,'utf8')).includes('VILLAGE_STATE_DIR='+dir));t.diagnostic(`isolated port=${port} notifications=false state=${dir}`);
 const get=async path=>{const r=await fetch(`http://127.0.0.1:${port}/api/direct`+path);assert.equal(r.status,200);return r.json();};
 const snap=await get('?view=workspace&bodies=lazy'),p=snap.conversations.s;assert.equal(p.entries.length,100);
 const old=await get('/agents/s/history?bodies=lazy&before='+encodeURIComponent(p.cursor));assert.equal(old.entries.length,5);
 // Folded (progress) answers carry their body behind entry-body (docs/lean-fetch.md, stage 2).
 const output=async r=>r.bodyDeferred?.output?(await get('/agents/s/entry-body?side=output&entry='+encodeURIComponent(JSON.stringify(['run','',r.id])))).output:r.output;
 assert.deepEqual([...p.entries,...old.entries].filter(r=>r.bodyDeferred?.output).map(r=>r.id).sort(),['r1','r103']);
 for(const r of [...p.entries,...old.entries]){assert.equal(r.conversationAnswer,true);assert.equal(r.conversationId,'c');assert.equal(await output(r),'秘書の回答 '+r.id.slice(1));if(r.conversationSource.kind==='leader')assert.equal(r.suppressUser,true);}
 for(const id of ['r1','r103']){const r=[...p.entries,...old.entries].find(r=>r.id===id);assert.equal(r.displayMode,'progress');}
 const request=await fetch(`http://127.0.0.1:${port}/api/direct/conversations/get`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:'c'})});const detail=await request.json();assert.equal(detail.runs.find(r=>r.id==='r103').humanAnswer,null);assert.equal(detail.runs.find(r=>r.id==='r103').progressText,'秘書の回答 103');
 const rejected=await fetch(`http://127.0.0.1:${port}/api/direct/conversations/display`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:'c',actorRunId:'r103',operationId:'late-display-operation',expectedVersion:1,mode:'reply'})});assert.equal(rejected.status,403);
 assert.deepEqual((await get('?view=workspace&bodies=lazy')).conversations.s.entries,p.entries);
});
