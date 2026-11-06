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
 await assert.rejects(stageAttachment({connection:{connectionType:'local'}},record,Buffer.alloc(bytes.length)),/添付を接続先へ転送できませんでした/);
 await unlink(join(dir,'attachments',record.id+'.blob'));await symlink('/etc/passwd',join(dir,'attachments',record.id+'.blob'));await assert.rejects(store.content(record.id));
});
test('DOCX package preserves original bytes/hash on restart and local/SSH transfer',async t=>{
 const {createHash}=await import('node:crypto'),{execFileSync}=await import('node:child_process');
 const bytes=await readFile(new URL('./fixtures/attachment.docx',import.meta.url));
 execFileSync('python3',['-c',"import sys,io,zipfile,xml.etree.ElementTree as ET; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert set(z.namelist()) == {'[Content_Types].xml','_rels/.rels','word/document.xml'}; [ET.fromstring(z.read(n)) for n in z.namelist()]"],{input:bytes});
 const dir=await mkdtemp(join(tmpdir(),'village-docx-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new AttachmentStore(dir);await store.init();const record=await store.save(bytes,'報告.DOCX','application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.equal(record.kind,'file');assert.equal(record.mime,'application/octet-stream');assert.equal(record.size,bytes.length);assert.equal(record.sha256,createHash('sha256').update(bytes).digest('hex'));
 const restored=new AttachmentStore(dir);await restored.init();assert.deepEqual(await restored.get(record.id),record);assert.deepEqual(await restored.content(record.id),bytes);
 for(const type of ['local','ssh']){
  const receipt=await stageAttachment({connection:{connectionType:type,sshHost:'registered-alias'}},record,await restored.content(record.id),async(cmd,args,input)=>{
   if(type==='local'){assert.equal(cmd,'python3');return runInput(cmd,args,input);}
   assert.equal(cmd,'ssh');assert.equal(args.at(-2),'registered-alias');return runInput('sh',['-c',args.at(-1)],input);
  });t.after(()=>rm(dirname(receipt.path),{recursive:true,force:true}));assert(receipt.path.endsWith('/data.docx'));assert.equal(receipt.sha256,record.sha256);assert.deepEqual(await readFile(receipt.path),bytes);
 }
 await assert.rejects(stageAttachment({connection:{connectionType:'local'}},record,Buffer.alloc(bytes.length)),/転送できません/);
 for(const name of ['unsupported.doc','unsupported.docm','unsupported.zip'])await assert.rejects(store.save(bytes,name,'application/octet-stream'));
});
