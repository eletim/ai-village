import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,symlink,unlink,readFile} from 'node:fs/promises';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {AttachmentStore} from '../server/attachments.mjs';import {stageAttachment,runInput} from '../server/attachment-transfer.mjs';
test('attachment storage validates IDs/limits, downloads inert data and transfers exact bytes to local and SSH targets',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'village-files-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new AttachmentStore(dir);await store.init();const bytes=Buffer.from('hello; $(never execute)\n'),record=await store.save(bytes,'../../note.txt','text/html');assert.equal(record.name,'note.txt');assert.equal(record.mime,'application/octet-stream');assert.deepEqual(await store.content(record.id),bytes);
 await assert.rejects(store.save(Buffer.from('<script/>'),'bad.html','text/html'));await assert.rejects(store.get('../secret'));await assert.rejects(store.select([record.id,record.id]));await assert.rejects(store.select(Array(5).fill(record.id)));
 for(const type of ['local','ssh']){
  const receipt=await stageAttachment({connection:{connectionType:type,sshHost:'registered-alias'}},record,bytes,async(cmd,args,input)=>{
   if(type==='local'){assert.equal(cmd,'python3');return runInput(cmd,args,input);}
   assert.equal(cmd,'ssh');assert.equal(args.at(-2),'registered-alias');assert(!args.at(-1).includes('hello;'));return runInput('sh',['-c',args.at(-1)],input);
  });t.after(()=>rm(dirname(receipt.path),{recursive:true,force:true}));assert.deepEqual(await readFile(receipt.path),bytes);assert(!receipt.path.startsWith(dir));
 }
 await unlink(join(dir,'attachments',record.id+'.blob'));await symlink('/etc/passwd',join(dir,'attachments',record.id+'.blob'));await assert.rejects(store.content(record.id));
});
