import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DirectAgents} from '../server/direct.mjs';
import {newRequest} from '../server/state/request.ts';
import {quarantineRequests} from '../server/request-integrity.mjs';
import {projectRequest} from '../server/state-projection.mjs';
function fixture(){
 const requests=['q','good'].map(id=>({id,rootWorkId:id+'w',originAgentId:'a',finalAgentId:'a',initialRunId:id+'r',works:[{id:id+'w',agentId:'a',parentWorkId:null,currentRunId:id+'r',runIds:[id+'r']}],requestModel:newRequest(id,id+'r','human',false).value,notification:{status:'pending'}}));
 return {version:1,runStateVersion:1,requestStateVersion:1,agentStateVersion:1,canonicalStateVersion:1,markerVersion:1,workshops:[],projects:[],agents:[{id:'a',connection:{connectionType:'local'},agentModel:{id:'a',intent:null,observation:null}}],requests,runs:requests.map(q=>({id:q.id+'r',humanRequestId:q.id,workId:q.id+'w',agentId:'a',inputMarker:'ai-village-run-'+q.id+'r',runModel:q.requestModel.runs[0]}))};
}
test('healthy graph validation is unchanged and repair clears only isolation overlay',()=>{
 const data=fixture(),before=structuredClone(data);assert(quarantineRequests(data).every(x=>!x.reasons.length));assert.deepEqual(data,before);
 data.requests[0].rootWorkId='missing';quarantineRequests(data);assert(data.requests[0].integrity);data.requests[0].rootWorkId='qw';quarantineRequests(data);assert.deepEqual(data,before);
});
const mutations={
 root:q=>q.rootWorkId='missing',missingRoot:q=>delete q.rootWorkId,parent:q=>q.works[0].parentWorkId='missing',cycle:q=>q.works[0].parentWorkId='qw',
 runIds:q=>q.works[0].runIds.push('missing'),current:q=>q.works[0].currentRunId='missing',initial:q=>q.initialRunId='missing',final:q=>q.finalRunId='missing',
 report:q=>q.report={sourceRunId:'missing'},declaration:q=>q.requestModel.declarations.push({runId:'missing'}),agent:q=>q.works[0].agentId='missing',
 request:(_,d)=>d.runs[0].humanRequestId='missing',work:(_,d)=>d.runs[0].workId='missing',result:(_,d)=>d.runs[0].runModel.resultOf='missing',delegation:(_,d)=>d.runs[0].runModel.parentRunId='missing',model:q=>q.requestModel.rootRunId='missing',
};
for(const [name,mutate] of Object.entries(mutations))test('startup isolates '+name+' reference without dispatch/report/notification',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'integrity-'));t.after(()=>rm(dir,{recursive:true,force:true}));const data=fixture();mutate(data.requests[0],data);const source=structuredClone(data.requests[0]);await writeFile(join(dir,'direct.json'),JSON.stringify(data));
 let calls=0;const d=new DirectAgents({dir,remote:async()=>{calls++;throw Error('unexpected remote');},notifier:{status:()=>({}),enqueue:async()=>{calls++;}}});await d.init({watch:false});t.after(()=>d.close());
 const q=d.data.requests[0];assert(q.integrity?.reasons.length);assert(!d.data.requests[1].integrity);assert.equal(projectRequest(d.data,q).needsReview,true);
 assert.match(d.snapshot().recoveryRequests.find(x=>x.id==='q').reason,/隔離/);
 assert(d.flow.get('q').integrity.reasons.length);
 await d.attemptRun(d.data.runs[0]);await d.flow.pump();await d.flow.notifications();assert.equal(calls,0);assert.equal(d.data.runs.length,2);
 assert.deepEqual(q.requestModel,source.requestModel);assert.deepEqual(q.works,source.works);
});

test('quarantine prevents an otherwise pending completion notification; healthy requests continue',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'integrity-notify-'));t.after(()=>rm(dir,{recursive:true,force:true}));const data=fixture();
 for(const q of data.requests){q.requestModel.state={kind:'completed',by:'program',reason:'done'};q.finalRunId=q.id+'r';}
 data.requests[0].rootWorkId='missing';await writeFile(join(dir,'direct.json'),JSON.stringify(data));const delivered=[];
 const d=new DirectAgents({dir,remote:async()=>{throw Error('remote forbidden');},notifier:{status:()=>({}),enqueue:async x=>{delivered.push(x.id);return {status:'sent'};}}});await d.init({watch:false});t.after(()=>d.close());await d.flow.notifications();await d.flow.notifications();
 assert.deepEqual(delivered,['request:good']);assert.equal(d.data.requests[0].notification.status,'pending');
});

test('legacy broken root and run ownership migrate into isolation without discarding records',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'integrity-legacy-'));t.after(()=>rm(dir,{recursive:true,force:true}));const data=fixture();
 for(const key of ['runStateVersion','requestStateVersion','canonicalStateVersion','markerVersion'])delete data[key];
 for(const q of data.requests){delete q.requestModel;q.status='active';}
 for(const r of data.runs){delete r.runModel;r.state='queued';}
 data.requests[0].rootWorkId='missing';data.runs[0].humanRequestId='missing';await writeFile(join(dir,'direct.json'),JSON.stringify(data));
 const d=new DirectAgents({dir,remote:async()=>{throw Error('network forbidden');},notifier:{status:()=>({})}});await d.init({watch:false});t.after(()=>d.close());
 assert(d.data.requests[0].integrity);assert.equal(d.data.runs.length,2);assert.equal(d.data.requests[0].rootWorkId,'missing');assert.equal(d.data.runs[0].humanRequestId,'missing');
});
