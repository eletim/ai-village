import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readJSON} from '../src/read-json.js';
test('slow reads retain progress, bound stalls and overall time, and retry without partial JSON',async()=>{
 const server=createServer((req,res)=>{
  res.writeHead(req.url==='/error'?503:200,{'Content-Type':'application/json'});
  if(req.url==='/error')return res.end('{"error":"busy"}');
  if(req.url==='/ok')return res.end('{"ok":true}');
  res.write('{"text":"');let count=0;
  const timer=setInterval(()=>{if(req.url==='/stall')return;res.write('a');if(++count===8)res.end('"}');},40);
  res.on('close',()=>clearInterval(timer));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const progress=[];assert.deepEqual(await readJSON(base+'/slow',{idleMs:200,totalMs:1500,onProgress:n=>progress.push(n)}),{text:'aaaaaaaa'});assert.ok(progress.length>3);
  await assert.rejects(readJSON(base+'/stall',{idleMs:80,totalMs:1000}),{name:'TimeoutError'});
  await assert.rejects(readJSON(base+'/slow',{idleMs:200,totalMs:120}),/制限時間/);
  assert.deepEqual(await readJSON(base+'/ok'),{ok:true});
  await assert.rejects(readJSON(base+'/error'),{status:503,message:'busy'});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('caller cancellation releases even a transport that ignores abort',async()=>{
 const controller=new AbortController();const read=readJSON('/ignored',{signal:controller.signal,fetcher:()=>new Promise(()=>{})});
 controller.abort(new Error('superseded'));await assert.rejects(read,/superseded/);
});
test('cancellation releases a stalled body and timeout cannot hang on an ignored signal',async()=>{
 const fetcher=async()=>({body:{getReader:()=>({read:()=>new Promise(()=>{})})}});
 const controller=new AbortController();const read=readJSON('/body',{signal:controller.signal,fetcher});await Promise.resolve();controller.abort(new Error('resume'));await assert.rejects(read,/resume/);
 await assert.rejects(readJSON('/timeout',{fetcher,idleMs:10,totalMs:50}),{name:'TimeoutError'});
});
