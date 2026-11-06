import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TravelRegistry} from '../server/travel-registry.mjs';
test('registry CRUD, IDs, parent boundaries, snapshots, revision serialization and restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-registry-'));try{
 const store=new TravelRegistry(dir);await store.init();
 const update=x=>store.update({revision:store.snapshot().revision,...x});
 let state=await update({entity:'computer',action:'add',name:'同名',sshHost:'one'});const a=state.computers[0].id;
 state=await update({entity:'computer',action:'add',name:'同名',sshHost:'two'});const b=state.computers[1].id;assert.notEqual(a,b);
 state=await update({entity:'folder',action:'add',computerId:a,name:'資料',cwd:'/docs',notes:'補足'});const f=state.computers[0].folders[0].id;
 const snapshot={name:'資料',sshHost:'one',cwd:'/docs',notes:'補足'};
 await assert.rejects(update({entity:'folder',action:'edit',computerId:b,id:f,name:'wrong',cwd:'/bad'}),{status:404});
 await assert.rejects(update({entity:'computer',action:'add',name:'bad',sshHost:'host;command'}));
 await assert.rejects(update({entity:'folder',action:'add',computerId:a,name:'bad',cwd:'/bad\npath'}));
 const revision=store.snapshot().revision;
 const concurrent=await Promise.allSettled([store.update({revision,entity:'computer',action:'edit',id:a,name:'変更',sshHost:'new'}),store.update({revision,entity:'computer',action:'delete',id:b})]);
 assert.equal(concurrent[0].status,'fulfilled');assert.equal(concurrent[1].reason.status,409);
 await update({entity:'folder',action:'edit',computerId:a,id:f,name:'変更資料',cwd:'/new',notes:''});
 assert.deepEqual(state.computers[0].folders[0],{id:f,name:'資料',cwd:'/docs',notes:'補足'});assert.equal(snapshot.cwd,'/docs');
 const restarted=new TravelRegistry(dir);await restarted.init();assert.deepEqual(restarted.snapshot(),store.snapshot());
 await update({entity:'folder',action:'delete',computerId:a,id:f});assert.equal(store.snapshot().computers[0].folders.length,0);
 await update({entity:'computer',action:'delete',id:a});assert.equal(store.snapshot().computers.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
