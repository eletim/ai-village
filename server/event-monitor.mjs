import {HostEvents,hostKey} from './host-events.mjs';
export class EventMonitor {
 constructor(direct,{hostFactory=(connection)=>new HostEvents(connection,{localBin:direct.localBin})}={}){this.d=direct;this.hostFactory=hostFactory;this.hosts=new Map();this.agents=new Map();this.dirty=new Set();this.running=new Set();this.fired=new Set();this.closed=false;}
 start(){this.update();}
 update(){
  if(this.closed)return;
  const live=this.d.data.agents.filter(a=>a.tabId&&!(a.agentModel?.intent==='stop'&&a.agentModel?.observation?.process==='absent'));
  const keys=new Set(live.map(hostKey));
  for(const [key,host] of this.hosts)if(!keys.has(key)){host.close();this.hosts.delete(key);}
  for(const a of live){
   const key=hostKey(a);let host=this.hosts.get(key);
   if(!host){
    host=this.hostFactory(a.connection);this.hosts.set(key,host);
    host.on('ready',()=>{for(const a of this.d.data.agents.filter(a=>hostKey(a)===key))this.invalidate(a.id);});
    host.on('offline',()=>{for(const a of this.d.data.agents.filter(a=>hostKey(a)===key))this.invalidate(a.id);});
    host.on('changed',event=>{
     for(const a of this.d.data.agents.filter(a=>hostKey(a)===key)){
      const sid=a.runtime?.agentSessionId;
      if(event.all||event.agentIds?.includes(a.id)||event.paths?.some(p=>p.endsWith('/layout.json')||!sid||p.includes(sid)))this.invalidate(a.id);
     }
    });host.start();
   }
   const identity=JSON.stringify([key,a.tabId,a.sessionName]);
   if(this.agents.get(a.id)!==identity){this.agents.set(a.id,identity);if(host.ready)this.invalidate(a.id);}
  }
  this.reserveRecovery();
 }
 execute(a,args){const host=this.hosts.get(hostKey(a));return host?host.execute(args):Promise.reject(Error('変更通知の接続がありません'));}
 async status(a){const host=this.hosts.get(hostKey(a));if(!host)throw Error('変更通知の接続がありません');
  const status=JSON.parse(await host.execute(['purplemux','tab','status','-w',a.workspaceId,a.tabId]));
  const process=await host.inspect(a);
  return {...status,alive:status.alive&&process.paneAlive&&process.agentAlive,...(!process.agentAlive?{cliState:'inactive'}:{})};
 }
 invalidate(id){
  if(this.closed)return;this.dirty.add(id);if(this.running.has(id))return;
  this.running.add(id);
  // Coalesce bursts, not periodic polling. An event during observation remains dirty.
  const timer=setTimeout(()=>void this.drain(id),100);timer.unref();
 }
 async drain(id){
  try{
   while(this.dirty.delete(id)&&!this.closed){
    const a=this.d.data.agents.find(a=>a.id===id);if(!a||!a.tabId||a.agentModel?.intent==='stop'&&a.agentModel?.observation?.process==='absent')break;
    const observation=await this.d.locked(a.id,()=>this.d.observe(a));
    if(observation?.changed)await this.d.progress();
    if(observation?.more||observation?.reason==='index-catching-up')this.dirty.add(id);
   }
  }catch(error){this.error=error.message;}finally{this.running.delete(id);}
 }
 reserveRecovery(){
  clearTimeout(this.timer);
  const candidates=this.d.data.runs.flatMap(r=>[
   ...(r.unknownSince&&!r.unknownResolvedAt?[{r,kind:'unknown',at:Date.parse(r.unknownSince)+600000}]:[]),
   ...(r.runModel?.state.kind==='queued'&&Number.isFinite(r.nextTransferAt)?[{r,kind:'attachment',at:r.nextTransferAt}]:[]),
   ...(r.recovery?.status==='scheduled'?[{r,kind:'recovery',at:r.recovery.nextAt}]:[])
  ]).map(e=>({...e,key:e.r.id+':'+e.kind+':'+e.at})).filter(e=>!this.fired.has(e.key));
  const first=candidates.sort((a,b)=>a.at-b.at)[0];if(!first)return;
  this.timer=setTimeout(()=>{
   this.fired.add(first.key);
   void this.d.persist(async()=>{this.d.releaseStuckRuns({id:first.r.agentId});await this.d.save();}).then(()=>this.d.progress()).catch(error=>{this.error=error.message;}).finally(()=>{if(!this.closed)this.reserveRecovery();});
  },Math.max(0,Math.min(2147483647,first.at-Date.now())));this.timer.unref();
 }
 close(){this.closed=true;clearTimeout(this.timer);for(const h of this.hosts.values())h.close();this.hosts.clear();}
}
