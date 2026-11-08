import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
test('HTTP usage reads isolated core cache and returns only whitelisted weekly data',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'weekly-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'.purplemux'));const now=Date.now()/1000;
 await writeFile(join(dir,'.purplemux','rate-limits.json'),JSON.stringify({token:'SECRET',codex:{ts:now,account:'SECRET',seven_day:{used_percentage:42,resets_at:now+3600}},claude:{ts:now,seven_day:{used_percentage:12,resets_at:now-1}}}));
 const bin=join(dir,'pmux');await writeFile(bin,'#!/bin/sh\nexit 1\n',{mode:0o700});
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,HOME:dir,VILLAGE_STATE_DIR:join(dir,'state'),VILLAGE_PMUX_BIN:bin,VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',CODEX_HOME:dir},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}});
 await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('timeout')),10000);child.once('exit',()=>{clearTimeout(timer);no(Error('exit'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);ok();}});});
 const r=await fetch(`http://127.0.0.1:${port}/api/direct/usage`);assert.equal(r.status,200);const data=await r.json();assert.equal(data.providers.codex.usedPercent,42);assert.equal(data.providers.claude.stale,true);assert.equal(data.accountIdentified,false);assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.equal(JSON.stringify(data).includes(dir),false);
});
