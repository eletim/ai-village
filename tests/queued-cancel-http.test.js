import {receipt} from './model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
test('Human UI HTTP operation cancels only the addressed unsent input, durable across restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cancel-queue-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const agentId=randomUUID(),id=randomUUID(),workId=randomUUID(),runId=randomUUID();
 const run={id:runId,agentId,humanRequestId:id,workId,state:'queued',acceptance:'queued',origin:'human',instruction:'never send',dispatchConfirmed:false};
 const q={id,rootWorkId:workId,initialRunId:runId,status:'active',revision:0,ticket:{state:'available'},works:[{id:workId,agentId,state:'active',currentRunId:runId,runIds:[runId]}],inbox:[]};
 await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],agents:[{id:agentId,state:'idle',location:'mayor',connection:{connectionType:'local'},tabId:'fixture',workspaceId:'fixture'}],runs:[run],requests:[q]}));
 // Fail closed: no provider/session and no real PurpleMux executable.
 const bin=join(dir,'pmux');await writeFile(bin,'#!/bin/sh\nexit 1\n',{mode:0o700});
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));let child;
 const stop=async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}};t.after(stop);
 const start=async()=>{child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_PMUX_BIN:bin,VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',CODEX_HOME:dir},stdio:['ignore','pipe','pipe']});await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('timeout')),10000);child.once('exit',()=>{clearTimeout(timer);no(Error('exit'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);ok();}});});};
 const post=async(path,data)=>{const base=`http://127.0.0.1:${port}`,ui=path.includes('/human/')?{Origin:base,'X-Village-Human-UI':'1',Cookie:(await fetch(base+'/agents')).headers.get('set-cookie').split(';')[0]}:{};const r=await fetch(`http://127.0.0.1:${port}`+path,{method:'POST',headers:{'Content-Type':'application/json',...ui},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
 await start();const x={humanRequestId:id,agentId,runId};
 assert.equal((await post('/api/direct/human/requests/cancel-queued',{...x,agentId:'request-graph'})).status,404);
 let response=await post('/api/direct/human/requests/cancel-queued',x);assert.equal(response.status,200);assert.equal(receipt(response.data).acceptance,'cancelled');
 await stop();await start();response=await post('/api/direct/human/requests/cancel-queued',x);assert.equal(response.status,200);assert.equal(response.data.state,'terminated');
 const saved=(await post('/api/direct/requests/get',{humanRequestId:id})).data;assert.equal(saved.status,'cancelled');assert.equal(saved.runs[0].dispatchAttemptedAt,undefined);
});
