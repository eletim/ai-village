import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
export class VillageLibrary {
  constructor(root = process.env.VILLAGE_LIBRARY_DIR || 'village') { this.root = resolve(root); }
  async read(path) {
    if (typeof path !== 'string' || !path.endsWith('.md')) throw new Error('資料はMarkdownファイルを指定してください。');
    const root = await realpath(this.root);
    const file=await realpath(resolve(root,path));
    if (!file.startsWith(root + sep)) throw new Error('資料の範囲外です。');
    if ((await stat(file)).size > 131072) throw new Error('資料は128KiB以内にしてください。');
    const content = await readFile(file, 'utf8');
    return { path: relative(root, file).split(sep).join('/'), content, hash: createHash('sha256').update(content).digest('hex') };
  }
  async catalog() {
    const files = [];
    const walk = async dir => {
      for (const entry of await readdir(resolve(this.root, dir), { withFileTypes: true })) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await walk(path); }
        else if (entry.isFile() && path.endsWith('.md')) {
          const doc = await this.read(path);
          files.push({ path: doc.path, title: doc.content.match(/^# (.+)$/m)?.[1] || entry.name, hash: doc.hash });
        }
      }
    };
    await walk(''); return files.sort((a,b) => a.path.localeCompare(b.path));
  }
}
