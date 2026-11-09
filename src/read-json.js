// Read-only requests may transfer history. Allow slow progress, but bound stalls
// and total duration separately. Never retry a mutation here.
export async function readJSON(url,{idleMs=20000,totalMs=120000,onProgress=()=>{},fetcher=fetch}={}){
 const controller=new AbortController();let idle,total,received=0;
 const abort=message=>controller.abort(Object.assign(new Error(message),{name:'TimeoutError'}));
 const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>abort('20秒間応答がありませんでした。回線を確認してください。'),idleMs);};
 total=setTimeout(()=>abort('読み込みの制限時間を超えました。回線を確認して再試行してください。'),totalMs);touch();
 try{
  const response=await fetcher(url,{signal:controller.signal});touch();
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  for(;;){const {done,value}=await reader.read();if(done)break;touch();received+=value.byteLength;text+=decoder.decode(value,{stream:true});onProgress(received);}
  text+=decoder.decode();const value=JSON.parse(text);
  if(!response.ok)throw Object.assign(new Error(value.error||'読み込みに失敗しました'),{status:response.status});
  return value;
 }catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}
 finally{clearTimeout(idle);clearTimeout(total);}
}
