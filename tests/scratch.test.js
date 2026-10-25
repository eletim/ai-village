import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Scratch} from '../server/scratch.mjs';
import {ImageStore} from '../server/images.mjs';
const runtime=process.env.VILLAGE_SCRATCH_RUNTIME;
test('scratch validates paths, persists files and downloads, retains unknown executions',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-'));try{
 const s=new Scratch(dir,new ImageStore(dir));const write=s.commands().find(c=>c.name==='work write');
 await assert.rejects(()=>write.run(['../secret','x']));
 await write.run(['memo.txt','日本語']);
 assert.equal((await new Scratch(dir).files())['memo.txt'],Buffer.from('日本語').toString('base64'));
 const doc=await s.publish('memo.txt');assert.equal((await s.download(doc.id)).bytes.toString(),'日本語');
 const id=randomUUID();await s.save('run-'+id,{id,state:'running'});
 assert.equal((await s.execute(id,'raise Exception()')).state,'unknown');
 assert.throws(()=>s.validate({'a/b':'eA=='}));
 const unavailable=new Scratch(dir,null,'');const failed=await unavailable.execute(randomUUID(),"open('unsafe','w').write('bad')");assert.equal(failed.ok,false);assert.equal(failed.state,'failed');assert.ok(!Object.hasOwn(await unavailable.files(),'unsafe'));
 const write1=write.run(['one.txt','one']);await assert.rejects(()=>write.run(['two.txt','two']),/実行中/);await write1;
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real bwrap/seccomp isolation, limits, persistence and PNG', {skip:!runtime && !process.env.VILLAGE_SCRATCH_REQUIRED && '設備未設定: VILLAGE_SCRATCH_RUNTIME（実隔離未検証）'},async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-'));try{
 const s=new Scratch(dir,new ImageStore(dir),runtime);
 const run=code=>s.execute(randomUUID(),code);
 let result=await run(`import os, socket\nassert not os.path.exists('/home')\nassert not os.path.exists('/etc')\nassert not os.path.exists('/proc/1/root/home')\nassert not os.path.exists('/runtime/../runner-secrets')\nassert 'SSH_AUTH_SOCK' not in os.environ\nfor action in [os.fork, lambda: socket.socket(), lambda: open('/outside','w')]:\n try: action()\n except OSError: pass\n else: raise Exception('boundary')\nopen('memo.txt','w').write('日本語')\nprint('isolated')`);
 assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(result.output.trim(),'isolated');
 assert.equal((await new Scratch(dir).files())['memo.txt'],Buffer.from('日本語').toString('base64'));
 result=await run("import os\nos.symlink('/etc/passwd','link')");assert.equal(result.state,'failed');
 result=await run("import os\nos.link('memo.txt','hardlink')");assert.equal(result.state,'failed');
 result=await run("print('x'*17000)");assert.equal(result.state,'failed');
 result=await run("import os\nos.write(2,b'x'*20000)");assert.equal(result.state,'failed');
 result=await run("while True: pass");assert.equal(result.state,'failed');
 result=await run("x=bytearray(600*1024*1024)");assert.equal(result.state,'failed');
 result=await run("open('big','wb').write(b'x'*(9*1024*1024))");assert.equal(result.state,'failed');
 result=await run("for i in range(12):\n open(str(i),'wb').write(b'x'*(8*1024*1024))");assert.equal(result.state,'failed');
 result=await run("from PIL import Image,ImageDraw,ImageFont\nim=Image.new('RGB',(800,200),'white')\nd=ImageDraw.Draw(im)\nf=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',24)\nd.text((20,60),'村長 → ミク → 複数Computerの工房',font=f,fill='black')\nim.save('diagram.png')");assert.equal(result.state,'succeeded',JSON.stringify(result));
 const image=await s.publish('diagram.png');assert.equal(image.mime,'image/png');assert.equal((await s.images.get(image.id)).width,800);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('cancellation and actual backend interruption retain inquiry records without replay', {skip:!runtime && !process.env.VILLAGE_SCRATCH_REQUIRED && '設備未設定: VILLAGE_SCRATCH_RUNTIME（実隔離未検証）'}, async()=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');const {pathToFileURL}=await import('node:url');
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-crash-'));try{
 const s=new Scratch(dir,new ImageStore(dir),runtime);const id=randomUUID();
 const running=s.execute(id,"import time\ntime.sleep(30)");
 while(!s.child)await new Promise(r=>setTimeout(r,10));
 const receipt=await s.commands().find(c=>c.name==='work cancel').run([id]);assert.equal(receipt.accepted,true);assert.equal((await running).state,'cancelled');const endedRecord=await s.get(id);assert.equal(endedRecord.state,'cancelled');assert.ok(endedRecord.finishedAt);assert.equal(s.child,null);
 const crashId=randomUUID();
 const child=spawn(process.execPath,['--input-type=module','-e',`import {Scratch} from ${JSON.stringify(pathToFileURL(resolve('server/scratch.mjs')).href)};const s=new Scratch(${JSON.stringify(dir)},null,${JSON.stringify(runtime)});s.execute(${JSON.stringify(crashId)},"import time\\nopen('interrupted.txt','w').write('partial')\\ntime.sleep(30)");const timer=setInterval(()=>{if(s.child){process.send('started');clearInterval(timer);}},10);`],{stdio:['ignore','ignore','ignore','ipc'],env:process.env});
 await once(child,'message');const ended=once(child,'exit');child.kill('SIGKILL');await ended;
 const restored=new Scratch(dir,null,runtime);assert.equal((await restored.get(crashId)).state,'unknown');assert.equal((await restored.execute(crashId,"open('replayed','w').write('bad')")).state,'unknown');assert.deepEqual(await restored.files(),{});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('fixture secretary uses operations, ImageStore, read_image and reply attachments', {skip:!runtime && !process.env.VILLAGE_SCRATCH_REQUIRED && '設備未設定: VILLAGE_SCRATCH_RUNTIME（実隔離未検証）'},async()=>{
 const {VillageOperations}=await import('../server/operations.mjs');const {Secretariat}=await import('../server/secretariat.mjs');
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-fixture-'));try{
 const images=new ImageStore(dir),scratch=new Scratch(dir,images,runtime),bridge={dir,jobs:[]};
 assert.equal((await scratch.prepare()).available,true);const operations=new VillageOperations(bridge,null,{scratch,images});const secretary=new Secretariat(bridge,{root:dir,read:async()=>({path:'manual.md',hash:'fixture',content:'fixture manual'})},operations,null,images);await secretary.init();
 let imageId;let step=0;
 secretary.decide=async(turn,observations)=>{
 const last=observations.at(-1);switch(step++){
 case 0:return {action:'read_document',document:'manual.md'};
 case 1:return {action:'village',argv:['work','run',randomUUID(),"from PIL import Image\nImage.new('RGB',(80,60),'white').save('fixture.png')"]};
 case 2:assert.equal(last.result.result.state,'succeeded');return {action:'village',argv:['work','publish','fixture.png']};
 case 3:imageId=last.result.result.id;return {action:'read_image',document:imageId};
 default:return {action:'reply',message:'fixture画像',attachments:[imageId]};
 }};
 await secretary.send('画像を作成');await secretary.running;
 assert.equal(secretary.messages.at(-1).attachments?.[0]?.id,imageId);assert.ok(imageId);assert.ok(secretary.messages.some(m=>m.action==='read_image'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('fixture cancel receipt is not termination; get confirms the later durable terminal record',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-cancel-receipt-'));
 try {
  const s=new Scratch(dir,null,''),id=randomUUID();let signal;
  s.activeId=id;s.child={kill:value=>{signal=value;}};
  await s.save('run-'+id,{id,state:'running'});
  const receipt=await s.commands().find(c=>c.name==='work cancel').run([id]);
  assert.equal(receipt.accepted,true);assert.equal(receipt.stopConfirmed,false);assert.equal(receipt.state,'running');assert.equal(signal,'SIGKILL');
  assert.equal((await s.get(id)).state,'running');
  await s.save('run-'+id,{id,state:'cancelled',finishedAt:new Date().toISOString()});s.activeId=null;
  assert.equal((await s.get(id)).state,'cancelled');
  const again=await s.commands().find(c=>c.name==='work cancel').run([id]);assert.equal(again.accepted,false);assert.equal(again.stopConfirmed,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('disabled scratch does not advertise execution or remove trusted workspace, workshop CLI and recovery commands',async()=>{
 const {VillageOperations}=await import('../server/operations.mjs');
 const dir=await mkdtemp(resolve(tmpdir(),'scratch-disabled-'));
 try {
  const scratch=new Scratch(dir,null,'');assert.equal((await scratch.prepare()).available,false);
  const operations=new VillageOperations({dir,jobs:[]},null,{scratch,tools:{commands:()=>[{name:'workspace exec'},{name:'workshop cli'}]}});
  const names=operations.commands.map(c=>c.name);
  assert.ok(!names.includes('work run'));
  for(const name of ['work status','work get','work write','workspace exec','workshop cli','operations reconcile'])assert.ok(names.includes(name),name);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('deployment diagnosis distinguishes disabled from required or broken equipment and exits nonzero for missing required verification',async()=>{
 const {spawnSync}=await import('node:child_process');
 const env={...process.env};for(const key of ['VILLAGE_SCRATCH_RUNTIME','VILLAGE_SCRATCH_BWRAP','VILLAGE_SCRATCH_REQUIRED'])delete env[key];
 const probe=(args=[],extra={})=>spawnSync(process.execPath,['scripts/diagnose-scratch.mjs',...args],{env:{...env,...extra},encoding:'utf8'});
 let result=probe(['--deployment']);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).verification,'NOT RUN');assert.equal(JSON.parse(result.stdout).available,false);
 result=probe();assert.equal(result.status,1);assert.match(result.stdout,/未設定/);
 result=probe(['--deployment'],{VILLAGE_SCRATCH_REQUIRED:'1'});assert.equal(result.status,1);
 result=probe(['--deployment'],{VILLAGE_SCRATCH_RUNTIME:resolve('.runtime/nonexistent'),VILLAGE_SCRATCH_BWRAP:resolve('.runtime/missing-bwrap')});assert.equal(result.status,1);assert.match(result.stdout,/ENOENT/);
});
