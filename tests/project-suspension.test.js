import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DirectAgents} from '../server/direct.mjs';
import {VillageOperations} from '../server/operations.mjs';
import {isSuspended,orderedProjects,suspensionSummary} from '../src/board-state.js';
import {villageModel} from '../src/village-model.js';
test('display-only suspend/resume persists, validates revision and preserves pin/rename/membership/requests',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'suspend-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const options={dir,localRun:async()=>{calls++;throw Error('must not execute');},remote:async()=>{calls++;throw Error('must not execute');}};
 const d=new DirectAgents(options);await d.init({watch:false});t.after(()=>d.close());const ops=new VillageOperations({dir},null,{direct:d});
 const p=await d.putProject({name:'Any project',requestId:'project-create-test'});assert.notEqual(p.suspended,true);
 await d.putProject({revision:0,pinned:true},p.id);d.data.agents=[{id:'a',projectId:p.id,state:'busy',connection:{connectionType:'local'}}];d.data.runs=[{id:'run',agentId:'a',state:'running',output:'preserved'}];d.data.requests=[{id:'request',status:'active',works:[],ticket:{state:'available'}}];const original=structuredClone({agents:d.data.agents,runs:d.data.runs,requests:d.data.requests});
 assert.equal((await ops.execute(['projects','suspend',p.id,'1'])).ok,true);assert.equal(d.project(p.id).suspended,true);assert.equal(d.project(p.id).pinned,true);
 assert.equal((await ops.execute(['projects','resume',p.id,'1'])).ok,false);await assert.rejects(d.putProject({revision:2,suspended:'true'},p.id),{status:400});await d.putProject({revision:2,name:'Renamed'},p.id);assert.equal(d.project(p.id).suspended,true);
 assert.deepEqual({agents:d.data.agents,runs:d.data.runs,requests:d.data.requests},original);assert.equal(calls,0);
 const restored=new DirectAgents(options);await restored.init({watch:false});t.after(()=>restored.close());assert.equal(restored.project(p.id).suspended,true);assert.equal(restored.project(p.id).name,'Renamed');
 await restored.updateAgent('a',{revision:0,projectId:null});assert.equal(restored.data.agents[0].projectId,null);await restored.updateAgent('a',{revision:1,projectId:p.id});assert.equal(restored.data.agents[0].projectId,p.id);
 const result=await Promise.allSettled([restored.putProject({revision:3,suspended:false},p.id),restored.putProject({revision:3,name:'stale'},p.id)]);assert.equal(result[0].status,'fulfilled');assert.equal(result[1].reason.status,409);assert.equal(restored.project(p.id).pinned,true);assert.equal(restored.project(p.id).suspended,false);
 const save=restored.save;restored.save=async()=>{throw Error('disk');};await assert.rejects(restored.putProject({revision:4,suspended:true},p.id),/disk/);assert.equal(restored.project(p.id).suspended,false);restored.save=save;
 assert((await ops.execute(['help'])).result.some(x=>x.name==='projects suspend'));
});
test('missing setting active, pins within groups, map hides resting residents but exposes their status and entry',()=>{
 const projects=[{id:'p',name:'Paused',suspended:true,pinned:true},{id:'a',name:'Active'},{id:'b',name:'Pinned active',pinned:true}];const agents=[{id:'worker',name:'Worker',state:'busy',projectId:'p',location:'workshop',workshopId:'w'},{id:'secretary',name:'Secretary',state:'idle',location:'mayor',projectId:'a'},{id:'free',state:'unknown',location:'mayor'}];
 assert.equal(isSuspended(projects,agents[0]),true);assert.equal(isSuspended(projects,agents[2]),false);assert.deepEqual(orderedProjects(projects.filter(p=>!p.suspended)).map(p=>p.id),['b','a']);
 const reviews={worker:{unreviewed:true,attention:true}};const m=villageModel({agents,projects,workshops:[{id:'w',name:'Workshop'}],runs:[],reviews});assert.equal(m.residents.length,2);assert.equal(m.places.find(p=>p.id==='workshop:w').residents.length,0);assert.equal(m.suspendedProjects[0].residents[0].id,'worker');assert.equal(m.suspendedCount.busy,1);assert.equal(m.suspendedCount.attention,1);assert.match(suspensionSummary(agents,reviews),/更新 1/);
});
