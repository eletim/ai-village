import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const staleAfter=15*60*1000;
function windowValue(w,ts,now){
 const valid=w&&typeof w.used_percentage==='number'&&Number.isFinite(w.used_percentage)&&w.used_percentage>=0&&w.used_percentage<=100&&typeof w.resets_at==='number'&&Number.isFinite(w.resets_at)&&w.resets_at>0&&w.resets_at<8640000000000&&typeof ts==='number'&&Number.isFinite(ts)&&ts>0&&ts*1000<=now+60000;
 return valid?{available:true,usedPercent:w.used_percentage,resetsAt:w.resets_at*1000,cachedAt:ts*1000,stale:now-ts*1000>staleAfter||w.resets_at*1000<=now}:{available:false};
}
export function normalizeWeekly(cache,now=Date.now()){
 return Object.fromEntries(['codex','claude'].map(provider=>{
  const data=cache?.[provider],weekly=windowValue(data?.seven_day,data?.ts,now),five=windowValue(data?.five_hour,data?.ts,now);
  const duplicate=weekly.available&&five.available&&weekly.usedPercent===five.usedPercent&&weekly.resetsAt===five.resetsAt;
  return [provider,{...weekly,fiveHour:duplicate?{available:false}:five}];
 }));
}
const ageWindow=(v,now)=>({...v,...(v.available?{stale:v.stale||now-v.cachedAt>staleAfter||v.resetsAt<=now}:{})});
// PurpleMux's own provider-specific cache. No credentials, account aggregation,
// provider requests or inferred reset-to-zero. Always core PC, never a workshop.
export class WeeklyUsage {
 constructor({file=process.env.VILLAGE_RATE_LIMITS_FILE||join(homedir(),'.purplemux','rate-limits.json'),read=readFile,clock=Date.now}={}){Object.assign(this,{file,read,clock});this.next=0;}
 async get(){
  if(this.pending)return this.pending;
  if(this.clock()<this.next)return this.result();
  this.pending=(async()=>{
   try{const raw=await this.read(this.file,{encoding:'utf8',signal:AbortSignal.timeout(3000)});if(raw.length>131072)throw Error('oversized');this.cache=normalizeWeekly(JSON.parse(raw),this.clock());}
   catch{this.cache=normalizeWeekly(null,this.clock());}
   this.checkedAt=this.clock();this.next=this.checkedAt+60000;return this.result();
  })();try{return await this.pending;}finally{this.pending=null;}
 }
 result(){const now=this.clock();return {source:'core-purplemux-cache',accountIdentified:false,checkedAt:this.checkedAt,providers:Object.fromEntries(Object.entries(this.cache).map(([p,v])=>[p,{...ageWindow(v,now),fiveHour:ageWindow(v.fiveHour,now)}]))};}
}
