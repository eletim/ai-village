import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWeekly,WeeklyUsage} from '../server/weekly-usage.mjs';
const now=1800000000000,seven_day={used_percentage:30,resets_at:now/1000+86400},five_hour={used_percentage:12,resets_at:now/1000+3600};
const provider=(extra={})=>({ts:now/1000,seven_day,five_hour,...extra});
test('distinct five-hour windows are exposed by data for either provider, preserving weekly fields',()=>{
 for(const name of ['claude','codex']){
  const v=normalizeWeekly({[name]:provider()},now)[name];assert.equal(v.usedPercent,30);assert.equal(v.resetsAt,seven_day.resets_at*1000);assert.equal(v.fiveHour.usedPercent,12);assert.equal(v.fiveHour.available,true);assert.equal(v.fiveHour.stale,false);
 }
 const sameReset=normalizeWeekly({codex:provider({five_hour:{...seven_day,used_percentage:10}})},now).codex;assert.equal(sameReset.fiveHour.available,true);
});
test('duplicated weekly windows, missing and invalid five-hour data are unavailable without losing weekly data',()=>{
 for(const five of [seven_day,undefined,null,{}, {used_percentage:-1,resets_at:1},{used_percentage:101,resets_at:1},{used_percentage:NaN,resets_at:1},{used_percentage:Infinity,resets_at:1},{used_percentage:'12',resets_at:1},{used_percentage:12,resets_at:0},{used_percentage:12,resets_at:Infinity},{used_percentage:12,resets_at:'123'},{used_percentage:12,resets_at:8640000000000}]){
  const v=normalizeWeekly({codex:provider({five_hour:five})},now).codex;assert.equal(v.available,true);assert.equal(v.fiveHour.available,false);
 }
 const v=normalizeWeekly({claude:provider({seven_day:null})},now).claude;assert.equal(v.available,false);assert.equal(v.fiveHour.available,true);
});
test('five-hour timestamps and stale/expired boundaries match weekly validation',()=>{
 for(const ts of [0,NaN,Infinity,'123',now/1000+61])assert.equal(normalizeWeekly({claude:provider({ts})},now).claude.fiveHour.available,false);
 for(const age of [900000,900001]){const v=normalizeWeekly({claude:provider({ts:(now-age)/1000})},now).claude;assert.equal(v.stale,age>900000);assert.equal(v.fiveHour.stale,age>900000);}
 const expired=normalizeWeekly({claude:provider({five_hour:{...five_hour,resets_at:now/1000}})},now).claude;assert.equal(expired.fiveHour.stale,true);assert.equal(expired.stale,false);
});
test('cached five-hour window ages without resetting and read failure clears both windows',async()=>{
 let clock=now,reads=0,broken=false;const usage=new WeeklyUsage({clock:()=>clock,read:async()=>{reads++;if(broken)throw Error('secret');return JSON.stringify({claude:provider({ts:(now-890000)/1000})});}});
 assert.equal((await usage.get()).providers.claude.fiveHour.stale,false);clock+=20000;const v=(await usage.get()).providers.claude;assert.equal(reads,1);assert.equal(v.fiveHour.stale,true);assert.equal(v.fiveHour.usedPercent,12);clock+=41000;broken=true;const failed=(await usage.get()).providers.claude;assert.equal(failed.available,false);assert.equal(failed.fiveHour.available,false);
});
