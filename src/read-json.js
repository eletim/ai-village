// Read-only requests may transfer history. Allow slow progress, but bound stalls
// and total duration separately. Never retry a mutation here.
export async function readJSON(url,{idleMs=20000,totalMs=120000,onProgress=()=>{},fetcher=fetch,signal}={}){
 const controller=new AbortController();let idle,total,received=0;
 const cancel=()=>controller.abort(signal.reason);
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 // Also release callers if a suspended/custom transport never settles on abort.
 const wait=promise=>new Promise((resolve,reject)=>{
  const stop=()=>reject(controller.signal.reason);
  if(controller.signal.aborted){Promise.resolve(promise).catch(()=>{});stop();return;}
  controller.signal.addEventListener('abort',stop,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',stop));
 });
 const abort=message=>controller.abort(Object.assign(new Error(message),{name:'TimeoutError'}));
 const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>abort('20秒間応答がありませんでした。回線を確認してください。'),idleMs);};
 total=setTimeout(()=>abort('読み込みの制限時間を超えました。回線を確認して再試行してください。'),totalMs);touch();
 try{
  const response=await wait(fetcher(url,{signal:controller.signal}));touch();
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  for(;;){const {done,value}=await wait(reader.read());if(done)break;touch();received+=value.byteLength;text+=decoder.decode(value,{stream:true});onProgress(received);}
  text+=decoder.decode();const value=JSON.parse(text);
  if(!response.ok)throw Object.assign(new Error(value.error||'読み込みに失敗しました'),{status:response.status});
  return value;
 }catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}
 finally{clearTimeout(idle);clearTimeout(total);signal?.removeEventListener('abort',cancel);}
}
