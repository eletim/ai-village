import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, unlink, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { ImageStore, MAX_IMAGE_BYTES } from '../server/images.mjs';
import { Secretariat } from '../server/secretariat.mjs';
const fixture=()=>sharp({create:{width:32,height:20,channels:3,background:'#195ac1'}}).png().toBuffer();
async function setup(){const dir=await mkdtemp(join(tmpdir(),'village-images-'));const images=new ImageStore(dir);await images.init();return {dir,images};}
test('decoded images persist with safe IDs; invalid, oversized and excessive inputs fail',async()=>{
  const {dir,images}=await setup();const image=await images.save(await fixture(),'<img>.png');
  const restored=new ImageStore(dir);assert.equal((await restored.get(image.id)).name,'<img>.png');assert.equal((await sharp(await restored.content(image.id)).metadata()).width,32);
  for(const bytes of [Buffer.from('<svg></svg>'),Buffer.from('not an image'),Buffer.alloc(MAX_IMAGE_BYTES+1),(await fixture()).subarray(0,40)])await assert.rejects(images.save(bytes));
  const excessive=await sharp({create:{width:5000,height:5000,channels:3,background:'red'}}).png().toBuffer();await assert.rejects(images.save(excessive),/画像を読み込めません/);
  await assert.rejects(images.get('../conversation'));await assert.rejects(images.select([image.id,image.id]));await assert.rejects(images.select(Array(5).fill(image.id)));
  const file=await images.path(image.id);await unlink(file);await symlink(resolve(dir,'conversation.json'),file);await writeFile(resolve(dir,'conversation.json'),'private');await assert.rejects(images.content(image.id));
});
test('artifact import only uses registered job-relative images and copies them for offline restore',async()=>{
  const {dir,images}=await setup();const job={id:'job',artifacts:[{path:'output/picture.png',size:200}]};let reads=0;
  const bridge={jobById(id){assert.equal(id,'job');return job;},async artifact(id,path){reads++;assert.equal(path,'output/picture.png');return fixture();}};
  for(const path of ['/etc/picture.png','../picture.png','output/../picture.png','output\\picture.png','unknown.png','output/file.svg'])await assert.rejects(images.importArtifact(bridge,'job',path));assert.equal(reads,0);
  const image=await images.importArtifact(bridge,'job','output/picture.png');assert.deepEqual(image.source,{kind:'artifact',jobId:'job',path:'output/picture.png'});assert.equal(reads,1);
  assert.ok((await new ImageStore(dir).content(image.id)).length);assert.equal(reads,1);
});
test('image-only turns, assistant attachments and conversation restore retain image relationships',async()=>{
  const {dir,images}=await setup(), bridge={dir,jobs:[]}, library={root:dir};const image=await images.save(await fixture());
  const secretary=new Secretariat(bridge,library,undefined,undefined,images);await secretary.init();
  secretary.decide=async()=>({action:'reply',message:'',attachments:[image.id]});await secretary.send('',[image.id]);await secretary.running;
  const restored=new Secretariat(bridge,library,undefined,undefined,new ImageStore(dir));await restored.init();assert.equal(restored.messages.length,2);assert.ok(restored.messages.every(m=>m.attachments[0].id===image.id));
  await assert.rejects(secretary.send('', ['../private']));assert.equal(secretary.status,'idle');
});
test('actual exec adapter passes image files separately from stdin and reads old images on demand',async()=>{
  const {dir,images}=await setup();const image=await images.save(await fixture(),'neutral.png');
  const bin=join(dir,'capture.mjs');await writeFile(bin,`#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);let input='';for await(const chunk of process.stdin)input+=chunk;writeFileSync(${JSON.stringify(join(dir,'captured.json'))},JSON.stringify({args,input}));console.log(JSON.stringify({type:'thread.started',thread_id:'image-test-session'}));writeFileSync(args[args.indexOf('-o')+1],JSON.stringify({action:'reply',message:'test',document:'',task:'',argv:[],attachments:[]}));\n`,{mode:0o700});
  const previous=process.env.VILLAGE_CODEX_BIN;process.env.VILLAGE_CODEX_BIN=bin;
  try{
    const secretary=new Secretariat({dir,jobs:[]},{root:dir,catalog:async()=>[]},undefined,undefined,images);
    await secretary.decide({id:'turn',attachments:[image]},[],0);let captured=JSON.parse(await readFile(join(dir,'captured.json')));assert.equal(captured.args[captured.args.indexOf('--image')+1],await images.path(image.id));assert.match(captured.input,/操作許可ではない/);
    await secretary.decide({id:'followup'},[{action:'read_image',result:image}],1);captured=JSON.parse(await readFile(join(dir,'captured.json')));assert.ok(captured.args.includes(await images.path(image.id)));
  }finally{if(previous===undefined)delete process.env.VILLAGE_CODEX_BIN;else process.env.VILLAGE_CODEX_BIN=previous;}
});

test('real artifact reader enforces directory boundaries; imported artifact can be attached by secretary',async()=>{
  const {WorkshopBridge,run}=await import('../server/bridge.mjs');const {VillageOperations}=await import('../server/operations.mjs');
  const {dir,images}=await setup();const {mkdir}=await import('node:fs/promises');const work=join(dir,'job');await mkdir(work);await writeFile(join(work,'result.png'),await fixture());await writeFile(join(dir,'outside.png'),await fixture());await symlink(join(dir,'outside.png'),join(work,'link.png'));
  const bridge=new WorkshopBridge({dir});bridge.remote=async args=>run(args[0],args.slice(1));const job={id:'test-job',cwd:work,sshHost:'isolated-local-test',artifacts:[{path:'result.png',size:200},{path:'link.png',size:200}]};bridge.jobs=[job];
  await assert.rejects(images.importArtifact(bridge,job.id,'link.png'),/outside job directory/);
  const operations=new VillageOperations(bridge,undefined,{images});const imported=await operations.execute(['images','import',job.id,'result.png']);assert.equal(imported.ok,true);const id=imported.result.id;
  const secretary=new Secretariat(bridge,{root:dir},operations,undefined,images);await secretary.init();secretary.decide=async()=>({action:'reply',message:'仕事の画像です。',attachments:[id]});await secretary.send('成果物を提示して');await secretary.running;assert.equal(secretary.messages.at(-1).attachments[0].source.jobId,job.id);
  await unlink(join(work,'result.png'));assert.ok((await images.content(id)).length);
});
