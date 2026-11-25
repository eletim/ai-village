import {fixtureModels} from './model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {villageModel} from '../src/village-model.js';

async function village(t,env={}){
 const dir=await mkdtemp(join(tmpdir(),'lean-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const agentId=randomUUID(),qid=randomUUID(),workId=randomUUID();
 const runs=Array.from({length:120},(_,i)=>({id:randomUUID(),agentId,humanRequestId:qid,workId,requestId:randomUUID(),state:'completed',createdAt:new Date(1700000000000+i*1000).toISOString(),instruction:'question '+i,output:'reply '+i+' body'.repeat(200)}));
 const q={id:qid,status:'completed',revision:0,works:[{id:workId,agentId,currentRunId:runs.at(-1).id,runIds:runs.map(r=>r.id)}],inbox:[],ticket:{state:'consumed'}};
 const data=fixtureModels({version:1,workshops:[],projects:[],agents:[{id:agentId,name:'test',location:'mayor',state:'idle',connection:{connectionType:'local'},secretaryHandover:{operationId:'AUDIT-HANDOVER'},runtimeMigrations:[{at:'2026-01-01',oldRuntime:{note:'AUDIT-RUNTIME'}}]}],runs,requests:[q]});
 q.requestGraph.nodes[0].inbox=[{id:'notice',kind:'supplement',source:{actor:'program'},text:'notice body',createdAt:'2030-01-01T00:00:00.000Z',attempts:[]}];
 await writeFile(join(dir,'direct.json'),JSON.stringify(data));
 const bin=join(dir,'pmux');await writeFile(bin,'#!/bin/sh\nexit 1\n',{mode:0o700});const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,HOME:dir,VILLAGE_STATE_DIR:dir,VILLAGE_PMUX_BIN:bin,VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',CODEX_HOME:dir,...env},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}});
 await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('timeout')),10000);let err='';child.stderr.on('data',b=>{err+=b;});child.once('exit',()=>{clearTimeout(timer);no(Error('exit: '+err.slice(-800)));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);ok();}});});
 const get=async suffix=>{const r=await fetch(`http://127.0.0.1:${port}/api/direct`+suffix);assert.equal(r.status,200);return r.text();};
 return {agentId,get};
}

test('map view: same village from far fewer bytes; legacy GET unchanged',async t=>{
 const {get}=await village(t),full=await get(''),map=await get('?view=map');
 assert.equal(JSON.parse(full).runs.length,120);assert(full.includes('AUDIT-HANDOVER'));
 assert.equal(JSON.parse(map).view,'map');assert(!map.includes('question 119'));assert(!map.includes('reply 119'));assert(!map.includes('AUDIT-'));
 assert(Buffer.byteLength(map)*50<Buffer.byteLength(full));t.diagnostic(`map=${Buffer.byteLength(map)} full=${Buffer.byteLength(full)} bytes`);
 const strip=m=>JSON.stringify(m.residents.map(({source,...r})=>r));assert.equal(strip(villageModel(JSON.parse(map))),strip(villageModel(JSON.parse(full))));
 const workspace=await get('?view=workspace&focus=%5B%5D');assert(!workspace.includes('AUDIT-HANDOVER'));assert(!workspace.includes('AUDIT-RUNTIME'));
});

test('folded bodies are deferred only for a page that asks (bodies=lazy); older pages keep them inline',async t=>{
 const {get,agentId}=await village(t),focus='&focus='+encodeURIComponent(JSON.stringify([agentId]));
 const legacy=JSON.parse(await get('?view=workspace'+focus)),lazy=JSON.parse(await get('?view=workspace&bodies=lazy'+focus));
 assert(legacy.conversations[agentId].entries.every(e=>!e.bodyDeferred));
 const notice=lazy.conversations[agentId].entries.find(e=>e.inputReceipt&&e.bodyDeferred);assert(notice);assert.equal(notice.instruction,undefined);
 assert.equal(legacy.conversations[agentId].entries.find(e=>e.id===notice.id).instruction,'notice body');
 const body=JSON.parse(await get('/agents/'+agentId+'/entry-body?side=input&entry='+encodeURIComponent(JSON.stringify(['run','',notice.id]))));assert.equal(body.instruction,'notice body');assert.equal(body.v,notice.bodyDeferred.input.v);
});

test('VILLAGE_LEGACY_FETCH=1 restores the previous complete payloads',async t=>{
 const {get}=await village(t,{VILLAGE_LEGACY_FETCH:'1'}),full=JSON.parse(await get('')),map=JSON.parse(await get('?view=map'));
 assert.equal(map.view,undefined);assert.equal(map.runs.length,120);assert.deepEqual(map.agents,full.agents);
 const workspace=await get('?view=workspace&focus=%5B%5D');assert(workspace.includes('AUDIT-HANDOVER'));assert(workspace.includes('AUDIT-RUNTIME'));
});
