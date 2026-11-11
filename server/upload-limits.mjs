export {MAX_UPLOAD_BYTES,MAX_IMAGE_PIXELS} from '../src/upload-limits.js';
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
export async function receiveUpload(req,res,save){
 // A client may reset after we have already rejected and removed the reader.
 req.on('error',()=>{});
 try{
  const record=await uploads.use(async()=>save(await readUpload(req)));
  res.writeHead(201,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(record));
 }catch(error){
  // Do not drain an attacker-controlled stream. Send the error, then close it.
  req.pause();res.shouldKeepAlive=false;
  res.once('finish',()=>req.destroy());
  res.writeHead(error.status||500,{'Content-Type':'application/json; charset=utf-8','Connection':'close','Cache-Control':'no-store'});
  res.end(JSON.stringify({error:error.message}));
 }
}
