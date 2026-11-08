import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const staleAfter=15*60*1000;
export function normalizeWeekly(cache,now=Date.now()){
 return Object.fromEntries(['codex','claude'].map(provider=>{
  const data=cache?.[provider],w=data?.seven_day;
  const valid=w&&typeof w.used_percentage==='number'&&Number.isFinite(w.used_percentage)&&w.used_percentage>=0&&w.used_percentage<=100&&typeof w.resets_at==='number'&&Number.isFinite(w.resets_at)&&w.resets_at>0&&w.resets_at<8640000000000&&typeof data.ts==='number'&&Number.isFinite(data.ts)&&data.ts>0&&data.ts*1000<=now+60000;
  return [provider,valid?{available:true,usedPercent:w.used_percentage,resetsAt:w.resets_at*1000,cachedAt:data.ts*1000,stale:now-data.ts*1000>staleAfter||w.resets_at*1000<=now}:{available:false}];
 }));
}
// PurpleMux's own provider-specific cache. No credentials, account aggregation,
// provider requests or inferred reset-to-zero. Always core PC, never a workshop.
export class WeeklyUsage {
 constructor({file=join(homedir(),'.purplemux','rate-limits.json'),read=readFile,clock=Date.now}={}){Object.assign(this,{file,read,clock});this.next=0;}
 async get(){
  if(this.pending)return this.pending;
  if(this.clock()<this.next)return this.result();
  this.pending=(async()=>{
   try{const raw=await this.read(this.file,{encoding:'utf8',signal:AbortSignal.timeout(3000)});if(raw.length>131072)throw Error('oversized');this.cache=normalizeWeekly(JSON.parse(raw),this.clock());}
   catch{this.cache=normalizeWeekly(null,this.clock());}
   this.checkedAt=this.clock();this.next=this.checkedAt+60000;return this.result();
  })();try{return await this.pending;}finally{this.pending=null;}
 }
 result(){const now=this.clock();return {source:'core-purplemux-cache',accountIdentified:false,checkedAt:this.checkedAt,providers:Object.fromEntries(Object.entries(this.cache).map(([p,v])=>[p,{...v,...(v.available?{stale:v.stale||now-v.cachedAt>staleAfter||v.resetsAt<=now}:{})}]))};}
}
