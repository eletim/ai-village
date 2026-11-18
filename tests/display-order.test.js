import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DirectAgents} from '../server/direct.mjs';
import {VillageOperations} from '../server/operations.mjs';
import {orderedAgents,orderedProjectAgents,orderedProjects} from '../src/board-state.js';
test('secretary ordering persists, rejects stale/invalid input, rolls back failed writes and resets on move',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'display-order-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let calls=0;const options={dir,notifier:{status:()=>({enabled:false})},localRun:async()=>{calls++;throw Error('external call');},remote:async()=>{calls++;throw Error('external call');}};
 const d=new DirectAgents(options);await d.init({watch:false});t.after(()=>d.close());const ops=new VillageOperations({dir},null,{direct:d});
 const p=await d.putProject({name:'P',requestId:'order-project-p'}),q=await d.putProject({name:'Q',requestId:'order-project-q'});
 d.data.agents=[{id:'a',projectId:p.id,state:'idle',agentModel:{id:'a',intent:null,observation:{connected:true,process:'alive',activity:'idle',canSteer:false}},metadataRevision:0,connection:{connectionType:'local'}}];
 assert.equal((await ops.execute(['projects','order',q.id,'0','-10'])).ok,true);
 assert.equal((await ops.execute(['agents','order','a','0','20'])).ok,true);
 assert.equal(d.discovery().agents[0].displayOrder,20);
 assert.equal(d.snapshot().agents[0].displayOrder,20);
 for(const value of ['1.5','"2"','true','{}','9007199254740992']){
  assert.equal((await ops.execute(['projects','order',q.id,'1',value])).ok,false);
  assert.equal((await ops.execute(['agents','order','a','1',value])).ok,false);
 }
 assert.equal((await ops.execute(['agents','order','a','0','30'])).ok,false);
 assert.equal(d.agent('a').displayOrder,20);assert.equal(d.agent('a').metadataRevision,1);
 const save=d.save;d.save=async()=>{throw Error('disk');};
 await assert.rejects(d.updateAgent('a',{revision:1,displayOrder:30}),/disk/);
 await assert.rejects(d.putProject({revision:1,displayOrder:30},q.id),/disk/);d.save=save;
 assert.equal(d.agent('a').displayOrder,20);assert.equal(d.project(q.id).displayOrder,-10);
 const restored=new DirectAgents(options);await restored.init({watch:false});t.after(()=>restored.close());
 assert.equal(restored.agent('a').displayOrder,20);assert.equal(restored.project(q.id).displayOrder,-10);
 await restored.updateAgent('a',{revision:1,projectId:q.id});assert.equal(restored.agent('a').displayOrder,null);
 await restored.updateAgent('a',{revision:2,projectId:null});await assert.rejects(restored.updateAgent('a',{revision:3,displayOrder:10}),{status:400});
 await restored.putProject({revision:1,displayOrder:null},q.id);assert.equal(restored.project(q.id).displayOrder,null);assert.equal(calls,0);
});
test('project order keeps pins first; project member order does not change place order',()=>{
 const projects=[{id:'a'},{id:'b',displayOrder:20},{id:'c',displayOrder:10},{id:'p',pinned:true},{id:'q',pinned:true,displayOrder:3}];
 assert.deepEqual(orderedProjects(projects).map(x=>x.id),['q','p','c','b','a']);
 const agents=[{id:'1',createdAt:'2020'},{id:'2',createdAt:'2021',displayOrder:10},{id:'3',createdAt:'2022',displayOrder:10},{id:'4',createdAt:'2023',displayOrder:-1}];
 assert.deepEqual(orderedAgents(agents).map(x=>x.id),['1','2','3','4']);
 assert.deepEqual(orderedProjectAgents(agents).map(x=>x.id),['4','2','3','1']);assert.equal(agents[0].id,'1');
});
test('drag order is atomic, revision guarded, scoped and persistent',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'drag-order-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const options={dir,notifier:{status:()=>({enabled:false})}};const d=new DirectAgents(options);await d.init({watch:false});t.after(()=>d.close());
 const p=await d.putProject({name:'P',requestId:'drag-project-p'}),q=await d.putProject({name:'Q',requestId:'drag-project-q'});
 await d.reorder({kind:'projects',id:q.id,targetId:p.id,position:'before',revision:0,targetRevision:0});
 assert.deepEqual(orderedProjects(d.data.projects).map(p=>p.id),[q.id,p.id]);
 await assert.rejects(d.reorder({kind:'projects',id:q.id,targetId:p.id,position:'after',revision:0,targetRevision:0}));
 d.data.agents=['a','b','c'].map((id,i)=>({id,projectId:i===2?q.id:p.id,metadataRevision:0,connection:{connectionType:'local'},agentModel:{id,intent:null,observation:{connected:true,process:'alive',activity:'idle',canSteer:false}}}));
 const move={kind:'agents',projectId:p.id,id:'b',targetId:'a',position:'before',revision:0,targetRevision:0};
 const before=structuredClone(d.data.agents),save=d.save;d.save=async()=>{throw Error('disk');};await assert.rejects(d.reorder(move),/disk/);d.save=save;
 assert.deepEqual(d.data.agents,before);
 await assert.rejects(d.reorder({...move,targetId:'c'}));assert.deepEqual(d.data.agents,before);
 await d.reorder(move);assert.deepEqual(orderedProjectAgents(d.data.agents.filter(a=>a.projectId===p.id)).map(a=>a.id),['b','a']);
 const restored=new DirectAgents(options);await restored.init({watch:false});t.after(()=>restored.close());assert.equal(restored.agent('b').displayOrder,0);assert.equal(restored.agent('c').displayOrder,undefined);
 await d.putProject({revision:1,pinned:true},p.id);await assert.rejects(d.reorder({kind:'projects',id:q.id,targetId:p.id,position:'before',revision:1,targetRevision:2}),/先頭固定/);
});
