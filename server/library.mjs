import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
export class VillageLibrary {
  constructor(root = process.env.VILLAGE_LIBRARY_DIR || 'village') { this.root = resolve(root); }
  async read(path) {
    if (typeof path !== 'string' || !path.endsWith('.md')) throw new Error('資料はMarkdownファイルを指定してください。');
    const root = await realpath(this.root), file = await realpath(resolve(root, path));
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
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && path.endsWith('.md')) {
          const doc = await this.read(path);
          files.push({ path: doc.path, title: doc.content.match(/^# (.+)$/m)?.[1] || entry.name, hash: doc.hash });
        }
      }
    };
    await walk(''); return files.sort((a,b) => a.path.localeCompare(b.path));
  }
  async workshop(path) {
    const doc = await this.read(path);
    const header = doc.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!header) throw new Error('工房資料の先頭に接続情報がありません。');
    const fields = {};
    for (const line of header.split(/\r?\n/)) {
      const match = line.match(/^([a-z_]+):\s*(.+?)\s*$/);
      if (match) fields[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
    }
    if (!fields.name || !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(fields.ssh_host || '') || !fields.work_root?.startsWith('/')) throw new Error('工房のname・ssh_host・work_rootを確認してください。');
    const url = new URL(fields.purplemux_url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PurpleMux URLが不正です。');
    return { name: fields.name, sshHost: fields.ssh_host, remoteRoot: fields.work_root, baseUrl: url.href, document: doc.path, documentHash: doc.hash };
  }
  async workshops() {
    const workshops = [];
    for (const doc of await this.catalog()) {
      try {
        const { name, document } = await this.workshop(doc.path);
        workshops.push({ name, document });
      } catch { /* Only documents with valid connection metadata are registered. */ }
    }
    return workshops;
  }
  async firstWorkshop() {
    for (const doc of await this.catalog()) {
      try { return await this.workshop(doc.path); } catch { /* prose documents have no connection header */ }
    }
    throw new Error('接続情報を持つ工房資料がありません。');
  }
}
