import sharp from 'sharp';import {randomBytes} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {once} from 'node:events';
test('attachment HTTP uses existing authentication and origin policy; data is download-only and survives restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'file-api-'));const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port,credentials='mayor:long-test-password-123456';await writeFile(join(dir,'auth'),credentials);const authorization='Basic '+Buffer.from(credentials).toString('base64');let child;
 const start=async()=>{child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_VPN_ADDRESS:'',VILLAGE_PUBLIC_ORIGIN:'https://village.example',VILLAGE_AUTH_FILE:join(dir,'auth'),VILLAGE_NOTIFICATIONS:'false'},stdio:['ignore','pipe','pipe']});await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('timeout')),10000);child.once('exit',()=>{clearTimeout(timer);no(Error('server exited'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);ok();}});});};
 const stop=async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
 try{await start();const path='/api/attachments?name=notes.txt',body='<script>alert(1)</script>';
 assert.equal((await fetch(base+path,{method:'POST',body})).status,401);
 assert.equal((await fetch(base+path,{method:'POST',headers:{authorization,Origin:'https://evil.example'},body})).status,403);
 const upload=await fetch(base+path,{method:'POST',headers:{authorization,'Content-Type':'text/plain'},body});assert.equal(upload.status,201);const file=await upload.json();
 assert.equal((await fetch(base+'/api/attachments/'+file.id)).status,401);
 await stop();await start();const download=await fetch(base+'/api/attachments/'+file.id,{headers:{authorization}});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/octet-stream');assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.match(download.headers.get('content-security-policy'),/sandbox/);assert.equal(await download.text(),body);
 assert.equal((await fetch(base+'/api/attachments?name=evil.svg',{method:'POST',headers:{authorization,'Content-Type':'image/svg+xml'},body:'<svg/>'})).status,400);
 assert.equal((await fetch(base+'/api/attachments/not-an-id',{headers:{authorization}})).status,404);
 const imageBytes=await sharp(randomBytes(2100*2100*3),{raw:{width:2100,height:2100,channels:3}}).png().toBuffer();assert(imageBytes.length>8*1024*1024);
 const imagePath=join(dir,'report.png');await writeFile(imagePath,imageBytes);
 const uploaded=JSON.parse((await promisify(execFile)(process.execPath,['scripts/village.mjs','images','upload',imagePath],{env:{...process.env,VILLAGE_URL:base,VILLAGE_PUBLIC_ORIGIN:'https://village.example',VILLAGE_AUTH_FILE:join(dir,'auth')}})).stdout);
 assert.equal(uploaded.ok,true);assert.match(uploaded.reference,/village-image:/);assert(uploaded.result.size>8*1024*1024);
 assert.equal((await fetch(base+'/api/images/'+uploaded.result.id)).status,401);
 await stop();await start();const image=await fetch(base+'/api/images/'+uploaded.result.id,{headers:{authorization}});assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),imageBytes);
 for(const body of ['not PNG','{"path":"/etc/passwd"}'])assert.equal((await fetch(base+'/api/images',{method:'POST',headers:{authorization,'Content-Type':'image/png'},body})).status,400);
 assert.equal((await fetch(base+'/api/images',{method:'POST',headers:{authorization,'Content-Type':'image/svg+xml'},body:'<svg/>'})).status,415);
 const remotePath=await fetch(base+'/api/village',{method:'POST',headers:{authorization,'Content-Type':'application/json'},body:JSON.stringify({argv:['images','upload','/etc/passwd']})});assert.equal((await remotePath.json()).ok,false);

 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
