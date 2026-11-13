import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createServer,request} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {readUpload,receiveUpload,MAX_UPLOAD_BYTES,imageCapacity} from '../server/upload-limits.mjs';
import {ImageStore} from '../server/images.mjs';
import {AttachmentStore} from '../server/attachments.mjs';
import {run} from '../server/execution.mjs';
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'village-limits-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('chunked body stops at first excess chunk; no drain or retained unbounded chunks',async()=>{
 const req=new PassThrough({highWaterMark:1024});req.headers={};let read=0;req.on('data',c=>read+=c.length);
 const result=assert.rejects(readUpload(req,{limit:4096}),e=>e.status===413);
 for(let i=0;i<5;i++)req.write(Buffer.alloc(1024));await result;
 assert.equal(read,5120);assert(req.isPaused());assert(req.readableLength<=1024);
 req.destroy();
});
test('declared excess and stalled uploads are rejected before processing',async()=>{
 const req=new PassThrough();req.headers={'content-length':String(MAX_UPLOAD_BYTES+1)};
 await assert.rejects(readUpload(req),e=>e.status===413);assert(req.isPaused());req.destroy();
 const slow=new PassThrough();slow.headers={};await assert.rejects(readUpload(slow,{timeout:10}),e=>e.status===408);slow.destroy();
});
test('both stores retain byte limits and preserve 48MP image dimensions',async t=>{
 const dir=await directory(t),images=new ImageStore(dir),files=new AttachmentStore(dir);
 for(const store of [images,files])await assert.rejects(store.save(Buffer.alloc(MAX_UPLOAD_BYTES+1),'file.txt','text/plain'),e=>e.status===413);
 const large=await sharp({create:{width:8000,height:6000,channels:3,background:'white'}}).png().toBuffer();
 for(const store of [images,files]){
  const record=await store.save(large,'48mp.png','image/png');assert.equal(record.width,8000);assert.equal(record.height,6000);
  const saved=await store.content(record.id),metadata=await sharp(saved,{limitInputPixels:false}).metadata();
  assert.equal(metadata.width,8000);assert.equal(metadata.height,6000);assert.deepEqual(saved,large);
 }
 const screenshot=await sharp({create:{width:1220,height:2712,channels:3,background:'#193456'}}).png().toBuffer();
 const result=await files.save(screenshot,'screenshot.png','image/png');assert.equal(result.width,1220);assert.equal(result.height,2712);
});
test('image decoder gate is shared across stores and releases on failure',async t=>{
 const dir=await directory(t);let release;const gate=new Promise(r=>release=r);
 const held=[imageCapacity.use(()=>gate),imageCapacity.use(()=>gate)];
 try{await assert.rejects(new ImageStore(dir).save(Buffer.from('image')),e=>e.status===503);await assert.rejects(new AttachmentStore(dir).save(Buffer.from('image'),'image.png','image/png'),e=>e.status===503);}finally{release();await Promise.all(held);}
 assert.equal(imageCapacity.active,0);
 await assert.rejects(new ImageStore(dir).save(Buffer.from('invalid')));assert.equal(imageCapacity.active,0);
});
test('HTTP chunked oversize returns 413 before client ends; fifth simultaneous request gets 503',async t=>{
 let saves=0;const server=createServer((req,res)=>void receiveUpload(req,res,async bytes=>{saves++;return {size:bytes.length};}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const clients=[];t.after(()=>{for(const client of clients)client.destroy();server.closeAllConnections();return new Promise(r=>server.close(r));});
 const port=server.address().port;
 const open=()=>{let response;const result=new Promise((resolve,reject)=>{response=resolve;});const req=request({host:'127.0.0.1',port,method:'POST',headers:{'Transfer-Encoding':'chunked'}},res=>{res.resume();res.on('end',()=>response(res.statusCode));});req.on('error',()=>{});clients.push(req);req.flushHeaders();return {req,result};};
 const big=open();for(let i=0;i<41;i++){if(!big.req.write(Buffer.alloc(1024*1024)))await new Promise(r=>big.req.once('drain',r));}
 assert.equal(await big.result,413);assert.equal(big.req.writableEnded,false);assert.equal(saves,0);
 const held=Array.from({length:4},open);await new Promise(r=>setTimeout(r,50));
 const rejected=open();assert.equal(await rejected.result,503);assert.equal(saves,0);
 for(const c of held)c.req.end('ok');assert.deepEqual(await Promise.all(held.map(c=>c.result)),[201,201,201,201]);assert.equal(saves,4);
});
for(const kind of ['timeout','abort','output'])test('command '+kind+' kills its descendant group promptly',async t=>{
 const dir=await directory(t),pidFile=join(dir,'pid');const controller=new AbortController();
 const started=Date.now();const child=run('bash',['-c','sleep 30 & echo $! > "$1"; '+(kind==='output'?'printf overflow; ':'')+'wait','test',pidFile],{timeout:kind==='timeout'?100:10000,...(kind==='abort'?{signal:controller.signal}:{}),maxOutput:kind==='output'?1:100});
 if(kind==='abort')setTimeout(()=>controller.abort(),100);
 await assert.rejects(child);assert(Date.now()-started<1500);
 const pid=(await readFile(pidFile,'utf8')).trim();
 try{const stat=await readFile('/proc/'+pid+'/stat','utf8');assert.equal(stat.split(') ')[1][0],'Z','descendant must not be executing');}catch(e){if(e.code!=='ENOENT')throw e;}
});
test('UTF-8 streaming stays intact and another process group is unaffected',async()=>{
 const independent=run('bash',['-c','sleep .2; printf alive']);
 await assert.rejects(run('bash',['-c','sleep 20 & wait'],{timeout:30}));assert.equal(await independent,'alive');
 assert.equal(await run(process.execPath,['-e',"const b=Buffer.from('村');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),10)"]),'村');
});
test('original sleep 2 background timeout regression returns near the 50ms deadline',async t=>{
 const start=Date.now();await assert.rejects(run('bash',['-c','sleep 2 & wait'],{timeout:50}),/timeout/);
 const elapsed=Date.now()-start;t.diagnostic('elapsed='+elapsed+'ms');assert(elapsed<1000);
});
