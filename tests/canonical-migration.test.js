import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {canonicalData,migrateCanonicalStore} from '../server/canonical-migration.mjs';
import {newRequest} from '../server/state/request.ts';
import {initializeRun,changeRun,observeRun} from '../server/run-lifecycle.mjs';
import {projectState} from '../server/state-projection.mjs';
function fixture(){
 const r={id:'r',humanRequestId:'q',workId:'w',agentId:'a',state:'unknown',inputMarker:'ai-village-run-r',baselineRuntime:{sessionId:'s',cursor:10,fileIdentity:'file'},inputHash:'old',priorInputs:[]};
 initializeRun(r);changeRun(r,{type:'dispatch',actor:'program',at:1,sessionId:'s',agentIdle:true});
 const q={id:'q',status:'active',ticketId:'t',inbox:[],works:[{id:'w',currentRunId:'r',runIds:['r'],state:'active'}],requestModel:newRequest('q','r','human').value};q.requestModel={...q.requestModel,runs:[r.runModel]};
 return {agents:[{id:'a',state:'idle',canSend:true,agentModel:{id:'a',intent:null,observation:{connected:true,process:'alive',activity:'running',canSteer:false}}}],runs:[r],requests:[q]};
}
test('canonical conversion is pure, deterministic, idempotent and preserves in-flight checkpoint and Agent identity',()=>{
 const old=fixture(),before=structuredClone(old),next=canonicalData(old);assert.deepEqual(old,before);assert.deepEqual(canonicalData(next),next);
 assert.deepEqual(next.runs[0].baselineRuntime,old.runs[0].baselineRuntime);assert.equal(next.runs[0].runModel.state.kind,'sent');assert.deepEqual(next.agents[0].agentModel,old.agents[0].agentModel);
 for(const k of ['state','acceptance','blocksInput','dispatchConfirmed'])assert(!Object.hasOwn(next.runs[0],k));
 for(const k of ['ticket','ticketId','inbox','status'])assert(!Object.hasOwn(next.requests[0],k));assert(!Object.hasOwn(next.requests[0].works[0],'state'));
 const r=next.runs[0];observeRun(r,{state:'completed',sessionId:'s',turnId:'turn',inputId:'input'},{inputs:[{id:'input',turnId:'turn',text:'ai-village-run-r',offset:11}]});assert.equal(r.runModel.state.outcome,'normal');
 const projected=projectState(next);assert.equal(projected.runs[0].state,'completed');projected.runs[0].state='failed';assert.equal(r.runModel.state.outcome,'normal');
});
test('canonical migration fsyncs exclusive original backup before replacing; restart neither changes nor overwrites it',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'canonical-'));t.after(()=>rm(dir,{recursive:true,force:true}));const old=fixture(),bytes=JSON.stringify(old);await writeFile(join(dir,'direct.json'),bytes);
 const next=await migrateCanonicalStore(dir,old);assert.equal(await readFile(join(dir,'direct.pre-canonical-state-v1.json'),'utf8'),bytes);assert.deepEqual(await migrateCanonicalStore(dir,next),next);
 await assert.rejects(migrateCanonicalStore(dir,{...old,version:'different-source'}));assert.equal(await readFile(join(dir,'direct.pre-canonical-state-v1.json'),'utf8'),bytes);
 assert.throws(()=>canonicalData({...next,canonicalStateVersion:99}),/Unsupported/);
});
test('stalled active requests retain review and raw unknown state cannot override model truth',()=>{
 const old=fixture();old.runs[0].runModel={...old.runs[0].runModel,state:{kind:'ended',outcome:'unconfirmed',reason:'legacy-unknown'}};old.runs[0].state='completed';
 const q=canonicalData(old).requests[0];assert.equal(q.requestModel.state.kind,'active');assert(q.requestModel.state.review.length>0);
});
