import { mkdir, writeFile, readFile, rename, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = message => Object.assign(new Error(message), {status:400});
export class ImageStore {
  constructor(dir) { this.root = resolve(dir, 'images'); }
  async init() { await mkdir(this.root, {recursive:true, mode:0o700}); }
  async save(bytes, name = '画像', source = {kind:'upload'}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw fail('画像は1枚8 MiB以内にしてください。');
    let output, metadata;
    try {
      const decoder = sharp(bytes, {limitInputPixels:20_000_000, failOn:'warning'});
      metadata = await decoder.metadata();
      if (!['png','jpeg','webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('format');
      output = await decoder.rotate().png().toBuffer();
    } catch { throw fail('画像を読み込めません。静止画のPNG・JPEG・WebP（最大2000万画素）を選んでください。'); }
    if (output.length > MAX_IMAGE_BYTES) throw fail('展開後の画像が8 MiBを超えています。画像を小さくしてください。');
    const id = randomUUID(), info = await sharp(output).metadata();
    const record = {id, name:basename(String(name)).slice(0,160), mime:'image/png', size:output.length, width:info.width, height:info.height, source, at:new Date().toISOString()};
    await this.init();
    await writeFile(resolve(this.root,`${id}.png`),output,{flag:'wx',mode:0o600});
    await writeFile(resolve(this.root,`${id}.tmp`),JSON.stringify(record),{flag:'wx',mode:0o600});
    await rename(resolve(this.root,`${id}.tmp`),resolve(this.root,`${id}.json`));
    return record;
  }
  async safeRead(file, limit) {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > limit) throw fail('保存画像のサイズまたは形式が不正です。');
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  async get(id) {
    if (typeof id !== 'string' || !uuid.test(id)) throw fail('画像IDが不正です。ローカルパスは指定できません。');
    try { return JSON.parse(await this.safeRead(resolve(this.root,`${id}.json`),4096)); }
    catch(error) { if(error.code==='ENOENT') throw Object.assign(new Error('保存画像が見つかりません。'),{status:404}); throw error; }
  }
  async content(id) { await this.get(id); return this.safeRead(resolve(this.root,`${id}.png`),MAX_IMAGE_BYTES); }
  async path(id) { await this.content(id); return resolve(this.root,`${id}.png`); }
  async select(ids = []) {
    if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length) throw fail('画像は重複なしで4枚まで添付できます。');
    return Promise.all(ids.map(id=>this.get(id)));
  }
  async list() { await this.init(); const files=await readdir(this.root); return Promise.all(files.filter(name=>uuid.test(name.slice(0,-5))&&name.endsWith('.json')).map(name=>this.get(name.slice(0,-5)))); }
  async importArtifact(bridge, jobId, path) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part=>!part||part==='.'||part==='..') || !/\.(png|jpe?g|webp)$/i.test(path)) throw fail('仕事内のPNG・JPEG・WebPの相対パスを指定してください。');
    const job = bridge.jobById(jobId);
    if (!job.artifacts) await bridge.update({artifacts:await bridge.listArtifacts(job)},job);
    const file = job.artifacts.find(file=>file.path===path);
    if (!file || file.size > MAX_IMAGE_BYTES) throw fail('許可された8 MiB以内の画像成果物が見つかりません。');
    return this.save(await bridge.artifact(jobId,path),basename(path),{kind:'artifact',jobId,path});
  }
}
