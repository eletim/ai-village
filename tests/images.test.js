import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, unlink, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { ImageStore } from '../server/images.mjs';
const fixture=()=>sharp({create:{width:32,height:20,channels:3,background:'#195ac1'}}).png().toBuffer();
async function setup(){const dir=await mkdtemp(join(tmpdir(),'village-images-'));const images=new ImageStore(dir);await images.init();return {dir,images};}
test('decoded images persist with safe IDs; invalid images and excessive counts fail with pixel caps',async()=>{
  const {dir,images}=await setup();const image=await images.save(await fixture(),'<img>.png');
  const restored=new ImageStore(dir);assert.equal((await restored.get(image.id)).name,'<img>.png');assert.equal((await sharp(await restored.content(image.id)).metadata()).width,32);
  for(const bytes of [Buffer.from('<svg></svg>'),Buffer.from('not an image'),(await fixture()).subarray(0,40)])await assert.rejects(images.save(bytes));
  const excessive=await sharp({create:{width:5000,height:5000,channels:3,background:'red'}}).png().toBuffer();await assert.rejects(images.save(excessive),e=>e.status===413);
  await assert.rejects(images.get('../conversation'));await assert.rejects(images.select([image.id,image.id]));await assert.rejects(images.select(Array(5).fill(image.id)));
  const file=await images.path(image.id);await unlink(file);await symlink(resolve(dir,'conversation.json'),file);await writeFile(resolve(dir,'conversation.json'),'private');await assert.rejects(images.content(image.id));
});
