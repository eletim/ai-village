import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateProjectOrder} from '../server/project-order-migration.mjs';
import {orderedProjects} from '../src/board-state.js';
test('pin retirement preserves active and suspended visible order and is idempotent',()=>{
 const projects=[{id:'a',revision:3,displayOrder:-20},{id:'b',revision:1,pinned:true},{id:'c',revision:2,pinned:true,displayOrder:10,suspended:true},{id:'d',revision:0,pinned:false,suspended:true},{id:'gone',deletedAt:'now',pinned:true}];
 assert.equal(migrateProjectOrder(projects),true);
 assert.deepEqual(orderedProjects(projects.filter(p=>!p.deletedAt)).map(p=>p.id),['c','b','a','d']);
 assert.deepEqual(orderedProjects(projects.filter(p=>!p.deletedAt&&!p.suspended)).map(p=>p.id),['b','a']);
 assert.equal(projects.some(p=>Object.hasOwn(p,'pinned')),false);
 const once=structuredClone(projects);assert.equal(migrateProjectOrder(projects),false);assert.deepEqual(projects,once);
 assert.equal(projects[0].revision,4);
});
test('startup saves pin retirement once and preserves other project fields',async t=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {DirectAgents}=await import('../server/direct.mjs');
 const dir=await mkdtemp(join(tmpdir(),'retire-pin-'));t.after(()=>rm(dir,{recursive:true,force:true}));const options={dir,notifier:{status:()=>({enabled:false})}};
 const d=new DirectAgents(options);await d.init({watch:false});t.after(()=>d.close());
 const p=await d.putProject({name:'P',requestId:'pin-migrate-p'}),q=await d.putProject({name:'Q',requestId:'pin-migrate-q'});
 d.project(p.id).pinned=true;Object.assign(d.project(q.id),{displayOrder:-10,suspended:true});await d.save();
 const restored=new DirectAgents(options);await restored.init({watch:false});t.after(()=>restored.close());
 assert.deepEqual(orderedProjects(restored.data.projects).map(p=>p.id),[p.id,q.id]);assert.equal(restored.project(q.id).suspended,true);
 const saved=JSON.parse(await readFile(join(dir,'direct.json'),'utf8'));assert.equal(saved.projects.some(p=>'pinned' in p),false);
 const again=new DirectAgents(options);await again.init({watch:false});t.after(()=>again.close());assert.deepEqual(again.data.projects,saved.projects);
});
