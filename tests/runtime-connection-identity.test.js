import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {runtimeConnectionIdentity,sameRuntimeConnection} from '../server/runtime-connection-identity.mjs';
async function setup(t,type='local'){
 const f=await fixture(t),s=f.service,[a,b]=f.agents;
 const w=await s.putWorkshop({name:'fixture',connectionType:type,sshHost:type==='ssh'?'alice@fixture-host':null,baseUrl:'http://127.0.0.1:1',workplaces:['/fixture/work']});
 for(const agent of [a,b])Object.assign(agent,{workshopId:w.id,cwd:'/fixture/work',location:'workshop',connection:structuredClone(w)});
 a.connection.updatedAt='old';b.connection.updatedAt='new';b.connection.workplaces.push('/other');b.connection.iconPattern=Array(8).fill('none');b.connection.name='renamed';b.connection.baseUrl='http://127.0.0.1:2';
 const x={operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id};return {f,s,a,b,w,x};
}
for(const type of ['local','ssh'])test(type+' metadata drift adopts; queued/history unchanged and same operation is durable',async t=>{
 const {f,s,a,b,w,x}=await setup(t,type);a.inputEnvelope={mode:'legacy'};
 const r=await s.send(a.id,{instruction:'preserve queued purpose',requestId:randomUUID()});
 const before=JSON.stringify(s.flow.root(r.humanRequestId)),runs=s.data.runs.map(r=>r.id),connection=structuredClone(a.connection);
 assert.equal(r.dispatchAttemptedAt,undefined);
 const result=await s.adoptRuntime(a.id,x);assert.equal(JSON.stringify(s.flow.root(r.humanRequestId)),before);assert.deepEqual(s.data.runs.map(r=>r.id),runs);assert.deepEqual(a.connection,connection);assert.equal(f.sent.length,0);
 assert.deepEqual(await s.adoptRuntime(a.id,x),result);await assert.rejects(s.adoptRuntime(a.id,{...x,handover:'different'}),/再利用/);
 await f.restart();assert.deepEqual(await f.service.adoptRuntime(a.id,x),result);assert.equal(f.service.flow.run(r.id).agentId,a.id);
 // Receipt lookup remains valid even if current permission later changes: no new swap.
 f.service.data.workshops.find(v=>v.id===w.id).workplaces=['/revoked'];assert.deepEqual(await f.service.adoptRuntime(a.id,x),result);
});
for(const [label,mutate] of [
 ['target',({b})=>b.connection.sshHost='alice@other-host'],
 ['user',({b})=>b.connection.sshHost='bob@fixture-host'],
 ['transport',({b})=>b.connection.connectionType='local'],
 ['project',({b})=>b.projectId='different-project'],
 ['cwd',({b})=>b.cwd='/other'],
 ['provider',({b})=>b.provider='claude'],
 ['location',({b})=>b.location='mayor'],
 ['workshop',({b})=>b.workshopId='another'],
 ['current cwd revoked',({w})=>w.workplaces=['/other']],
 ['current target changed',({w})=>w.sshHost='bob@other-host'],
 ['missing workshop',({s})=>s.data.workshops=[]],
 ['invalid transport',({a,b})=>{a.connection.connectionType='unknown';b.connection.connectionType='unknown';}]
])test('reject '+label+' without native observation or ownership mutation',async t=>{
 const data=await setup(t,'ssh'),{s,a,b,x}=data;mutate(data);const before=JSON.stringify(s.data);let observations=0;s.observe=async()=>{observations++;throw Error('must not observe');};
 await assert.rejects(s.adoptRuntime(a.id,x),/同じ場所|現在の工房/);assert.equal(JSON.stringify(s.data),before);assert.equal(observations,0);assert.equal(b.runtimeRetiredTo,undefined);
});
test('current cwd revoked while observing is rejected before atomic swap',async t=>{
 const {s,a,b,w,x}=await setup(t),observe=s.observe.bind(s),old=a.workspaceId,fresh=b.workspaceId;
 s.observe=async agent=>{const value=await observe(agent);if(agent.id===b.id)await s.putWorkshop({workplaces:['/elsewhere']},w.id);return value;};
 await assert.rejects(s.adoptRuntime(a.id,x),/現在の工房/);assert.equal(a.workspaceId,old);assert.equal(b.workspaceId,fresh);assert.equal(a.runtimeMigrations,undefined);
});
test('metadata drift does not bypass rollback after failed save',async t=>{
 const {s,a,b,x}=await setup(t),save=s.save.bind(s),old=a.workspaceId,fresh=b.workspaceId;
 s.save=async()=>{if(a.runtimeMigrations?.length)throw Error('fixture disk full');return save();};
 await assert.rejects(s.adoptRuntime(a.id,x),/disk full/);assert.equal(a.workspaceId,old);assert.equal(b.workspaceId,fresh);assert.equal(a.runtimeMigrations,undefined);
 s.save=save;const receipt=await s.adoptRuntime(a.id,x);assert.deepEqual(await s.adoptRuntime(a.id,x),receipt);
});
test('identity mirrors execute dispatch, preserving SSH user and legacy default without guessing aliases',async t=>{
 const {s,a}=await setup(t);const seen=[];s.localRun=async(cmd,args)=>{seen.push(['local',cmd,args]);return '';};s.remote=async(args,host,id)=>{seen.push(['ssh',host,id,args]);return '';};
 await s.pmux(a,'workspaces').catch(()=>{}); // stub emits empty JSON, but records exact routing
 assert.equal(seen[0][0],'local');a.connection={sshHost:'alice@fixture-host'};await s.execute(a,['purplemux','workspaces']);assert.equal(seen[1][1],'alice@fixture-host');
 assert(sameRuntimeConnection(a.connection,{connectionType:'ssh',sshHost:'alice@fixture-host'}));assert(!sameRuntimeConnection(a.connection,{connectionType:'ssh',sshHost:'fixture-host'}));assert(!sameRuntimeConnection({connectionType:'local'},{connectionType:'ssh',sshHost:'localhost'}));assert.equal(runtimeConnectionIdentity({}),null);
});
