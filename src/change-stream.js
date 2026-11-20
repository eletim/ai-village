// Coalesce notifications while ensuring a change arriving during a fetch is not
// lost. Hidden tabs reconcile once on return instead of collecting requests.
const streams=new WeakMap();
export function subscribeChanges(refresh,{url='/api/direct/events',EventSourceClass=EventSource,documentObject=document,onDisconnect=()=>{}}={}){
 let dirty=true,running=false,closed=false,retry,failures=0;
 const drain=async()=>{
  if(running||closed||documentObject.hidden)return;
  running=true;
  try{while(dirty&&!closed&&!documentObject.hidden){dirty=false;if(await refresh()===false)throw Error('snapshot unavailable');failures=0;clearTimeout(retry);}}
  catch{dirty=true;if(!closed){clearTimeout(retry);retry=setTimeout(changed,Math.min(30000,5000*2**Math.min(failures++,3)));}}
  finally{running=false;}
 };
 const changed=()=>{dirty=true;void drain().catch(()=>{dirty=true;});};
 let byUrl=streams.get(EventSourceClass);if(!byUrl){byUrl=new Map();streams.set(EventSourceClass,byUrl);}
 let stream=byUrl.get(url);
 if(!stream){const source=new EventSourceClass(url);stream={source,listeners:new Set()};byUrl.set(url,stream);
  source.onmessage=()=>{for(const l of stream.listeners)l.changed();};source.onerror=()=>{for(const l of stream.listeners)l.onDisconnect();};
 }
 const listener={changed,onDisconnect};stream.listeners.add(listener);
 documentObject.addEventListener('visibilitychange',changed);
 return ()=>{closed=true;clearTimeout(retry);stream.listeners.delete(listener);if(!stream.listeners.size){stream.source.close();byUrl.delete(url);}documentObject.removeEventListener('visibilitychange',changed);};
}
