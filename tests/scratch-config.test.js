import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {scratchEnvironment} from '../scripts/scratch-config.mjs';

test('structured config rejects injection, preserves explicit empty env, and rereads changes',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-config-')),file=resolve(dir,'scratch.json');
 try{
  const env={VILLAGE_STATE_DIR:dir};assert.deepEqual(scratchEnvironment(env),env);
  await writeFile(file,JSON.stringify({version:1,runtimeRoot:'/dedicated/runtime'}));
  assert.equal(scratchEnvironment(env).VILLAGE_SCRATCH_BWRAP,'/dedicated/runtime/bin/bwrap');
  assert.equal(scratchEnvironment({...env,VILLAGE_SCRATCH_RUNTIME:''}).VILLAGE_SCRATCH_RUNTIME,'');
  assert.equal(scratchEnvironment({...env,VILLAGE_SCRATCH_BWRAP:'/explicit/bwrap'}).VILLAGE_SCRATCH_BWRAP,'/explicit/bwrap');
  for(const extra of [{env:{TOKEN:'no'}},{mounts:['/home']},{token:'no'},{runtimeRoot:'relative'},{version:2}]){
   await writeFile(file,JSON.stringify({version:1,runtimeRoot:'/dedicated/runtime',...extra}));
   assert.throws(()=>scratchEnvironment(env),/schema/);
  }
  await writeFile(file,'broken');assert.throws(()=>scratchEnvironment(env),/invalid/);
  assert.deepEqual(scratchEnvironment({...env,VILLAGE_SCRATCH_CONFIG:''}),{...env,VILLAGE_SCRATCH_CONFIG:''});
  await writeFile(file,JSON.stringify({version:1,runtimeRoot:'/new/runtime'}));
  assert.equal(scratchEnvironment(env).VILLAGE_SCRATCH_RUNTIME,'/new/runtime/python');
 }finally{await rm(dir,{recursive:true,force:true});}
});

const configured=scratchEnvironment().VILLAGE_SCRATCH_RUNTIME;
test('real supervisor restart reads persistent config without exported runtime settings', {skip:!configured && 'runtime not installed'},async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-restart-'));let child;
 const delay=()=>new Promise(r=>setTimeout(r,100));
 try{
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const env={...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_LIBRARY_DIR:resolve('village'),VILLAGE_NOTIFICATIONS:'false',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:''};
  for(const key of Object.keys(env))if(key.startsWith('VILLAGE_SCRATCH_'))delete env[key];
  // Invalid config disables only scratch; the backend must still start.
  await writeFile(resolve(dir,'scratch.json'),JSON.stringify({version:1,runtimeRoot:'/invalid',env:{TOKEN:'rejected'}}));
  child=spawn(process.execPath,['scripts/supervise.mjs','--port',String(port)],{env,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
  async function health(previous){for(let i=0;i<200;i++){
   if(child.exitCode!==null)throw Error(stderr);
   try{const h=await(await fetch(`http://127.0.0.1:${port}/api/health`)).json();if(!previous||h.instanceId!==previous)return h;}catch{}
   await delay();
  }throw Error('backend timeout '+stderr);}
  const before=await health();assert.equal(before.scratch.available,false);
  await writeFile(resolve(dir,'scratch.json'),JSON.stringify({version:1,runtimeRoot:dirname(configured)}));
  await writeFile(resolve(dir,'restart.json'),JSON.stringify({id:'scratch-config-restart'}));
  const after=await health(before.instanceId);assert.equal(after.scratch.available,true,JSON.stringify(after));assert.equal(after.supervised,true);
  const response=await fetch(`http://127.0.0.1:${port}/api/village`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({argv:['work','status']})});
  assert.equal((await response.json()).result.available,true);
 }finally{
  if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}
  await rm(dir,{recursive:true,force:true});
 }
});

test('preflight rejects incomplete and modified runtime before running isolation',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {copyFile}=await import('node:fs/promises');
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-integrity-'));
 try{
  for(const part of ['python','fonts','bin'])await mkdir(resolve(dir,part));
  const config=resolve(dir,'config.json');await writeFile(config,JSON.stringify({version:1,runtimeRoot:dir}));
  const env={...process.env,VILLAGE_SCRATCH_CONFIG:config};
  for(const k of ['RUNTIME','BWRAP','FONT','REQUIRED'])delete env['VILLAGE_SCRATCH_'+k];
  const probe=()=>spawnSync(process.execPath,['scripts/preflight-scratch.mjs'],{env,encoding:'utf8'});
  assert.equal(probe().status,1);
  await copyFile('scripts/scratch-sources.json',resolve(dir,'sources.json'));
  const manifest={};
  for(const name of ['bin/bwrap','fonts/NotoSansCJK-Regular.ttc','python/libseccomp.so.2']){await writeFile(resolve(dir,name),'modified');manifest[name]='0'.repeat(64);}
  await writeFile(resolve(dir,'installed.json'),JSON.stringify(manifest));
  const result=probe();assert.equal(result.status,1);assert.match(result.stderr,/checksum mismatch/);assert.ok(!result.stdout.includes('PASS'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
