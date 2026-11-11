import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateRequestStore} from '../server/request-migration.mjs';
import {migrateDirect} from '../server/state/migrate.ts';
import {transitionRequest,newRequest} from '../server/state/request.ts';
import {checkProgress} from '../server/state/progress.ts';
function fixture(){
 const data={agents:[],workshops:[],runs:[{id:'r',humanRequestId:'q',workId:'w',state:'running',acceptance:'accepted',sessionId:'s',turnId:'t',inputId:'i'}],requests:[{id:'q',status:'active',rootWorkId:'w',works:[{id:'w',parentWorkId:null,currentRunId:'r',runIds:['r']}],inbox:[],ticket:{state:'available'}}]};
 data.runs[0].runModel=migrateDirect(data,{resumeInFlight:true}).runs[0];return data;
}
test('request migration preserves active native ownership, backs up once and rejects invalid versions/graphs',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'request-migrate-'));t.after(()=>rm(dir,{recursive:true,force:true}));const data=fixture(),source=JSON.stringify(data);await writeFile(join(dir,'direct.json'),source);
 const next=await migrateRequestStore(dir,data);assert.equal(next.requestStateVersion,1);assert.deepEqual(next.runs,data.runs);assert.equal(next.requestMigration.counts.stalled,0);assert.equal(next.requestMigration.counts.active,1);assert.equal(await readFile(join(dir,'direct.pre-request-state-v1.json'),'utf8'),source);
 assert.deepEqual(await migrateRequestStore(dir,next),next);await assert.rejects(migrateRequestStore(dir,{...next,requestStateVersion:99}),/Unsupported/);
 const broken=structuredClone(next);broken.requests[0].requestModel.rootRunId='missing';await assert.rejects(migrateRequestStore(dir,broken),/references/);
 assert.equal(await readFile(join(dir,'direct.json'),'utf8'),JSON.stringify(next,null,2));
});
test('legacy idle active gets review; report-ready is an executable step, no send during migration',async t=>{
 for(const reportMode of [false,true]){
  const dir=await mkdtemp(join(tmpdir(),'request-idle-'));t.after(()=>rm(dir,{recursive:true,force:true}));const data=fixture();Object.assign(data.runs[0],{state:'completed',completionEvent:'event'});data.runs[0].runModel=migrateDirect(data).runs[0];data.requests[0].reportMode=reportMode;
  const next=await migrateRequestStore(dir,data),q=next.requests[0].requestModel,p=checkProgress(q);assert(p.ok);assert.equal(next.runs.length,1);
  if(reportMode)assert(p.next.some(s=>s.type==='prepare-report'));else assert(q.state.review.includes('legacy-needs-decision'));
 }
});
test('seeded event sequences retain an exit and actor violations never change state',()=>{
 let seed=713;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 for(let i=0;i<100;i++){
  let q=newRequest('q','r','human',!!(i%2)).value;
  const bad=transitionRequest(q,{type:'withdraw',actor:'agent',reason:'no'});assert.equal(bad.ok,false);
  for(let j=0;j<12;j++){
   const events=[{type:'declare-complete',actor:'agent',id:'d'+j,runId:'r',at:j},{type:'run-event',actor:'program',runId:'r',event:{type:'dispatch',actor:'program',at:j,sessionId:'s',agentIdle:true}},{type:'run-event',actor:'program',runId:'r',event:{type:'lost',actor:'program',at:j,reason:'timeout'}}];
   const result=transitionRequest(q,events[random()%events.length]);if(result.ok)q=result.value;assert(checkProgress(q).ok);
  }
  const ended=transitionRequest(q,{type:'withdraw',actor:'human',reason:'decided'});assert(ended.ok);assert.equal(ended.value.state.kind,'withdrawn');
 }
});
