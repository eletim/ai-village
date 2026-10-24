import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TodoStore} from '../server/todos.mjs';
test('TODO persists, serializes competing clients, validates and leaves committed state intact on disk failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-todo-'));try{
 const a=new TodoStore(dir);await a.init();
 const changes=await Promise.allSettled([a.update({action:'add',text:'買い物',revision:0}),a.update({action:'add',text:'競合',revision:0})]);
 assert.equal(changes[0].status,'fulfilled');assert.equal(changes[1].reason.status,409);
 const b=new TodoStore(dir);await b.init();assert.deepEqual(a.snapshot(),b.snapshot());
 const id=b.snapshot().items[0].id;
 await b.update({action:'edit',id,text:'更新',revision:1});await b.update({action:'toggle',id,done:true,revision:2});
 await assert.rejects(b.update({action:'edit',id,text:' ',revision:3}),{status:400});
 await assert.rejects(b.update({action:'toggle',id,done:'yes',revision:3}),{status:400});
 await assert.rejects(b.update({action:'add',text:'a'.repeat(501),revision:3}),{status:400});
 await mkdir(b.file+'.tmp');await assert.rejects(b.update({action:'delete',id,revision:3}));assert.equal(b.snapshot().revision,3);
 await rm(b.file+'.tmp',{recursive:true});await b.update({action:'delete',id,revision:3});
 const c=new TodoStore(dir);await c.init();assert.deepEqual(c.snapshot(),{revision:4,items:[]});
 }finally{await rm(dir,{recursive:true,force:true});}
});
