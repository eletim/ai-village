import {transitionReporting} from './state/auxiliary.ts';
import {randomUUID} from 'node:crypto';
import {applyGraph} from './unified-requests.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:409});};
export function deadline(value){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))fail('期限はタイムゾーン付き日時で指定してください');
 return new Date(value).toISOString();
}
export function initialDeadlines(x){return {version:1,completionAt:deadline(x.completionAt),reportAt:deadline(x.reportAt),history:[],reports:[]};}
function notify(flow,q,target,event){
 if(!target||!['active','submitted'].includes(target.state.kind))return;
 applyGraph(flow.d.data,q,{type:'supplement',actor:'program',requestId:target.id,input:{id:event.id,kind:'supplement',text:'依頼の通知（実行指示ではなく報告データ）: '+JSON.stringify(event),createdAt:event.at,attempts:[]}});
}
export class RequestReports {
 constructor(flow,{clock=Date.now}={}){this.flow=flow;this.clock=clock;this.enabled=false;this.reservations=new Map();}
 start(){this.enabled=true;this.schedule();}
 close(){this.enabled=false;clearTimeout(this.timer);}
 async change(x,actor='agent') {return this.mutate(x,'deadline',actor,async(q,w)=>{
  const parent=w.parentId?this.flow.work(q,w.parentId):null;
  if(actor==='agent'){if(!parent)fail('自分が受けた依頼の期限は変更できません');await this.flow.actor(q,parent,x.actorRunId);}
  else {if(parent)fail('子依頼の期限は管理する秘書が変更します');this.flow.version(q,x.revision);}
  if(typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>4000)fail('期限変更の理由が必要です');
  const current=w.metadata.reporting||initialDeadlines({});
  if(!Object.hasOwn(x,'completionAt')||!Object.hasOwn(x,'reportAt'))fail('完成期限・報告期限を明示してください。指定なしはnullです');
  const dates={completionAt:deadline(x.completionAt),reportAt:deadline(x.reportAt)};
  const event={id:randomUUID(),kind:'deadline-changed',workId:w.id,at:new Date(this.clock()).toISOString(),actor,actorRunId:x.actorRunId||null,reason:x.reason,...dates};
  w.metadata.reporting=transitionReporting(current,{type:'change',expectedVersion:x.expectedVersion,...dates,now:this.clock(),event});
  if(!w.planned)notify(this.flow,q,w,event);
  return event;
 });}
 async report(x){return this.mutate(x,'report','agent',async(q,w)=>{
  await this.flow.actor(q,w,x.actorRunId);
  if(!['progress','question','extension'].includes(x.kind)||typeof x.text!=='string'||!x.text.trim()||x.text.length>16000)fail('報告の種類と本文を指定してください');
  const event={id:randomUUID(),kind:x.kind,workId:w.id,at:new Date(this.clock()).toISOString(),actorRunId:x.actorRunId,text:x.text,proposedCompletionAt:deadline(x.proposedCompletionAt),proposedReportAt:deadline(x.proposedReportAt)};
  const current=w.metadata.reporting||initialDeadlines({});
  w.metadata.reporting=transitionReporting(current,{type:'report',event});
  // Persisted immediately, independently of a later native execution outcome.
  if(w.parentId)notify(this.flow,q,this.flow.work(q,w.parentId),event);
  return event;
 });}
 async mutate(x,type,actor,action){const f=this.flow;return f.d.locked('request-graph',()=>f.d.persist(async()=>{
  if(typeof x.operationId!=='string'||!/^[\w-]{8,100}$/.test(x.operationId))fail('operationIdが必要です');
  const q=f.root(x.humanRequestId),w=f.work(q,x.workId),payload=JSON.stringify({type,actor,workId:x.workId,actorRunId:x.actorRunId,revision:x.revision,kind:x.kind,text:x.text,proposedCompletionAt:x.proposedCompletionAt,proposedReportAt:x.proposedReportAt,expectedVersion:x.expectedVersion,completionAt:x.completionAt,reportAt:x.reportAt,reason:x.reason});
  const old=q.requestGraph.operations.find(o=>o.id===x.operationId);
  if(old){if(old.payload!==payload)fail('operationIdの再利用です');return structuredClone(old.receipt);}
  f.active(q);if(w.state.kind!=='active'||q.report)fail('作業受付中の依頼にだけ操作できます');
  const receipt=await action(q,w);q.requestGraph.operations.push({id:x.operationId,payload,receipt});q.revision++;
  await f.d.save();return structuredClone(receipt);
 }));}
 pending(requests=this.flow.requests){return requests.filter(q=>!q.integrity).flatMap(q=>q.requestGraph.nodes.flatMap(w=>{
  const s=w.metadata.reporting;
  if(!s||w.planned||w.state.kind!=='active')return [];
  return ['report','completion'].flatMap(kind=>s[kind+'At']&&!s.expired?.[kind]&&!(kind==='report'&&s.reportReceivedAt)?[{q,w,kind,at:Date.parse(s[kind+'At']),version:s.version}]:[]);
 }));}
 schedule(changedIds){
  if(!this.enabled)return;
  const requests=changedIds?[...new Set(changedIds)].map(id=>this.flow.requests.find(q=>q.id===id)).filter(Boolean):this.flow.requests;
  for(const q of requests)this.reservations.set(q.id,this.pending([q]));
  clearTimeout(this.timer);
  const at=Math.min(...[...this.reservations.values()].flat().map(e=>e.at));if(!Number.isFinite(at))return;
  this.timer=setTimeout(()=>void this.expire().catch(error=>{this.error=error.message;}),Math.max(0,Math.min(2147483647,at-this.clock())));this.timer.unref?.();
 }

 async expire(){
  const f=this.flow,entries=this.enabled?[...this.reservations.values()].flat():this.pending();
  const ids=[...new Set(entries.filter(e=>e.at<=this.clock()).map(e=>e.q.id))];
  for(const id of ids)await f.d.units.run(id,()=>f.d.locked('request-graph',()=>f.d.persist(async()=>{
   const q=f.root(id),due=this.pending([q]).filter(e=>e.at<=this.clock());if(!due.length)return;
   for(const {w,kind,version} of due){
    const s=w.metadata.reporting,event={id:randomUUID(),kind:'deadline-exceeded',deadlineKind:kind,workId:w.id,version,at:new Date(this.clock()).toISOString(),deadline:s[kind+'At']};
    w.metadata.reporting=transitionReporting(s,{type:'expire',kind,version,now:this.clock(),event});q.revision++;
    if(w.parentId)notify(f,q,f.work(q,w.parentId),event);
   }
   await f.d.save();
  })));
  this.schedule(ids);await f.d.progress();
 }
}
