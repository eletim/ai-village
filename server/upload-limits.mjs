export {MAX_UPLOAD_BYTES} from '../src/upload-limits.js';
import {MAX_UPLOAD_BYTES,UPLOAD_SIZE_MESSAGE} from '../src/upload-limits.js';
export const uploadError=(message,status)=>Object.assign(Error(message),{status});
export function checkUploadSize(bytes){if(bytes?.length>MAX_UPLOAD_BYTES)throw uploadError(UPLOAD_SIZE_MESSAGE,413);}
// No waiting queue retaining request bodies. Shared by all stores in the process.
export class Capacity {
 constructor(limit){this.limit=limit;this.active=0;}
 async use(fn){
  if(this.active>=this.limit)throw uploadError('アップロードが混み合っています。少し待って再試行してください。',503);
  this.active++;try{return await fn();}finally{this.active--;}
 }
}
export const imageCapacity=new Capacity(2);
const uploads=new Capacity(4);
export function readUpload(req,{limit=MAX_UPLOAD_BYTES,timeout=120000}={}){
 return new Promise((resolve,reject)=>{
  let size=0,chunks=[],settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('error',fail);req.off('aborted',aborted);if(error){req.pause();chunks=[];reject(error);}else resolve(Buffer.concat(chunks,size));};
  const fail=error=>finish(error),aborted=()=>fail(uploadError('アップロードが中断されました。',400));
  const data=chunk=>{size+=chunk.length;if(size>limit)return fail(uploadError(UPLOAD_SIZE_MESSAGE,413));chunks.push(chunk);};
  const end=()=>finish();
  const timer=setTimeout(()=>fail(uploadError('アップロードが時間切れになりました。',408)),timeout);
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>limit)return fail(uploadError(UPLOAD_SIZE_MESSAGE,413));
  req.on('data',data);req.once('end',end);req.once('error',fail);req.once('aborted',aborted);
 });
}
// A close with unread TCP data may reset the connection before the client reads
// the JSON error. Discard only a bounded remainder, with a deadline and no queue.
const rejectedUploads=new Capacity(4);
export function discardRejectedUpload(req,{timeout=1000}={}){
 const declared=Number(req.headers['content-length']);
 const limit=Number.isFinite(declared)&&declared>0?declared:64*1024;
 if(req.readableEnded||req.destroyed||limit>MAX_UPLOAD_BYTES+64*1024)return Promise.resolve();
 return new Promise(resolve=>{
  let discarded=0;
  const done=()=>{clearTimeout(timer);req.off('data',data);req.off('end',done);req.off('error',done);req.off('aborted',done);req.pause();resolve();};
  const data=chunk=>{discarded+=chunk.length;if(discarded>limit)done();};
  const timer=setTimeout(done,timeout);
  req.on('data',data);req.once('end',done);req.once('error',done);req.once('aborted',done);req.resume();
 });
}
export async function receiveUpload(req,res,save){
 // A client may reset after we have already rejected and removed the reader.
 req.on('error',()=>{});
 try{
  const record=await uploads.use(async()=>save(await readUpload(req)));
  res.writeHead(201,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(record));
 }catch(error){
  // Give ordinary near-limit uploads a chance to finish before closing. Huge,
  // endless or stalled bodies still stop at the discard budget/deadline.
  await rejectedUploads.use(()=>discardRejectedUpload(req)).catch(()=>{});
  req.pause();res.shouldKeepAlive=false;
  res.writeHead(error.status||500,{'Content-Type':'application/json; charset=utf-8','Connection':'close','Cache-Control':'no-store'});
  res.end(JSON.stringify({error:error.message}));
 }
}
