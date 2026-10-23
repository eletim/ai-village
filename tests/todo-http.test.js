import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
test('real HTTP TODO restart persistence and authenticated proxy boundary',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-http-'));let child;
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base=`http://127.0.0.1:${port}`,authFile=join(dir,'auth');await writeFile(authFile,'mayor:test-password-more-than-20');
 const raw=async(path,headers)=>new Promise((resolve,reject)=>{const req=httpRequest(base+path,{headers},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:()=>JSON.parse(body)}));});req.on('error',reject);req.end();});
 const start=async()=>{child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_NOTIFICATIONS:'false',VILLAGE_PUBLIC_ORIGIN:'https://village.example',VILLAGE_AUTH_FILE:authFile},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),10000);child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Server exited'));});child.stdout.on('data',chunk=>{if(chunk.toString().includes('AI村 →')){clearTimeout(timeout);resolve();}});});};
 const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}};
 try{await start();
 let response=await fetch(base+'/api/todos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:0,action:'add',text:'再起動後も残る'})});assert.equal(response.status,200);const saved=await response.json();
 await stop();await start();assert.deepEqual(await (await fetch(base+'/api/todos')).json(),saved);
 response=await fetch(base+'/api/todos',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"revision":0,"action":"add","text":"stale"}'});assert.equal(response.status,409);
 assert.equal((await raw('/office',{Host:'village.example'})).status,401);
 const headers={Host:'village.example',Origin:'https://village.example',Authorization:'Basic '+Buffer.from('mayor:test-password-more-than-20').toString('base64')};
 assert.equal((await raw('/office',headers)).status,200);assert.deepEqual(await (await raw('/api/todos',headers)).json(),saved);
 assert.equal((await raw('/api/todos',{...headers,Origin:'https://evil.example'})).status,403);
 assert.equal((await raw('/office',{Host:'evil.example'})).status,403);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
