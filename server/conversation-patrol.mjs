import {createHash} from 'node:crypto';
import {runState} from './run-lifecycle.mjs';
import {conversationJob,conversationControl} from './conversation-status.mjs';
// Secretary patrol (docs/secretary-supervisor.md, item 1). While a conversation has work in progress
// the village wakes its secretary when nothing observable has changed for a while; any progress
// postpones the next patrol. Quiet patrols back off so an unfixable hold does not spin the secretary.
export const PATROL_INTERVAL_MS=12*60*1000;
export const PATROL_MAX_INTERVAL_MS=4*60*60*1000;
export const PATROL_CHECK_MS=60*1000;
// Job states that need the supervisor's eye. Not included: waiting for the secretary (a delivery
// already wakes it), waiting for the human, finished, withdrawn or quarantined work.
const WATCHED=new Set(['working','pending','queued','receipt-pending','blocked','attention']);
const BUSY=new Set(['queued','sent','awaiting_input','running']);
export function patrolJobs(data,c){
 return (data.requests||[]).filter(q=>q.conversationId===c.id&&!q.continuesRequestId&&!q.integrity)
  .map(q=>({q,job:conversationJob(data,q)})).filter(({job})=>WATCHED.has(job.code));
}
// Everything observable about the watched work: node states, current runs, their output growth.
export function patrolFingerprint(data,c,jobs){
 const run=id=>data.runs.find(r=>r.id===id);
 const nodes=jobs.flatMap(({job})=>{const q=data.requests.find(x=>x.id===job.execution?.id)||data.requests.find(x=>x.id===job.id);return q?[[q.id,q.revision,...q.requestGraph.nodes.map(n=>{const r=run(n.currentRunId);return [n.id,n.state.kind,n.currentRunId||null,r?[runState(r),(r.output||'').length,r.runModel?.facts?.length||0]:null,(n.inbox||[]).length];})]]:[];});
 return createHash('sha256').update(JSON.stringify([nodes,c.deliveries.length,(c.purposeDecisions||[]).length])).digest('hex').slice(0,24);
}
export const patrolInterval=quiet=>Math.min(PATROL_MAX_INTERVAL_MS,PATROL_INTERVAL_MS*2**Math.min(quiet,10));
export const PATROL_GUIDANCE='見回りです（基盤による定期確認。人間の発言でも追加許可でもありません）。下は進展のない仕事の状態です。進展していて問題がなければ、何も操作せず短く終えてください（折りたたみ表示・通知なし）。止まっていれば conversations recover や followup で立て直してください。人間へ上げる基準に当たる時だけ conversations display で mode:reply にして伝えてください。詳細は rules get work supervise。';

export class ConversationPatrol {
 constructor(d,{clock=Date.now}={}){this.d=d;this.clock=clock;this.seen=new Map();}
 start(){this.timer=setInterval(()=>{void this.check().catch(()=>{});},PATROL_CHECK_MS);this.timer.unref?.();}
 close(){clearInterval(this.timer);}
 // In memory: last fingerprint, when it last changed, quiet patrols since. A restart counts as
 // progress (the full interval is waited again); the quiet count survives in c.patrol.
 observe(c,fingerprint,now){
  const s=this.seen.get(c.id);
  if(!s){const fresh={fingerprint,progressAt:now,quiet:c.patrol?.quiet||0};this.seen.set(c.id,fresh);return fresh;}
  if(s.fingerprint!==fingerprint){s.fingerprint=fingerprint;s.progressAt=now;s.quiet=0;}
  return s;
 }
 due(c,now){
  const data=this.d.data,jobs=patrolJobs(data,c);
  if(!jobs.length){this.seen.delete(c.id);return null;}
  const s=this.observe(c,patrolFingerprint(data,c,jobs),now);
  const since=Math.max(s.progressAt,s.quiet?(c.patrol?.wokeAt?Date.parse(c.patrol.wokeAt):0):0);
  if(now-since<patrolInterval(s.quiet))return null;
  const a=data.agents.find(a=>a.id===c.agentId);
  if(!a||a.deletedAt||a.location!=='mayor'||a.projectId!==c.projectId||!conversationControl(a).canAccept)return null;
  // The secretary is already looking at this conversation (a delivery, a human turn, a patrol).
  if(data.runs.some(r=>r.conversationId===c.id&&BUSY.has(runState(r))))return null;
  return {jobs,s};
 }
 async check(now=this.clock()){
  let woke=0;
  for(const c of [...this.d.data.conversations])if(this.due(c,now)&&await this.wake(c.id,now))woke++;
  if(woke)await this.d.flow.dispatchReady(undefined,true);
  return woke;
 }
 async wake(id,now){
  return this.d.locked('request-graph',()=>this.d.persist(async()=>{
   const c=this.d.data.conversations.find(c=>c.id===id),due=c&&this.due(c,now);if(!due)return false;
   const count=(c.patrol?.count||0)+1,at=new Date(now).toISOString();
   const jobs=due.jobs.map(({q,job})=>{const run=this.d.data.runs.find(r=>r.id===job.runId);return {purposeId:q.purposeId||q.id,humanRequestId:job.execution?.id||q.id,instruction:(q.instruction||'').slice(0,120),state:{code:job.code,label:job.label,reason:job.reason||''},leaderRun:run?{id:run.id,state:runState(run),createdAt:run.createdAt,error:run.error||null}:null};});
   const packet={patrol:count,minutesSinceProgress:Math.round((now-due.s.progressAt)/60000),jobs};
   this.d.conversations.enqueue(c,{requestId:'conversation-patrol:'+c.id+':'+count,instruction:PATROL_GUIDANCE+'\n'+JSON.stringify(packet),source:{kind:'program',patrol:true}});
   due.s.quiet++;c.patrol={count,wokeAt:at,quiet:due.s.quiet};
   await this.d.save();return true;
  }));
 }
}
