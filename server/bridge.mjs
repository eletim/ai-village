import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const activePhases = new Set(['planning', 'connecting', 'working', 'reporting']);
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function run(command, args, { input, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error(`${command}: timeout`)); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 4e6) { child.kill(); finish(new Error(`${command}: output too large`)); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.on('error', error => finish(error));
    child.on('close', code => finish(code === 0 ? null : new Error(`${command} exited ${code}: ${stderr || stdout}`), stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export class WorkshopBridge {
  constructor(options = {}) {
    this.dir = resolve(options.dir || process.env.VILLAGE_STATE_DIR || '.runtime');
    this.host = process.env.VILLAGE_SSH_HOST || 'E-ryzen';
    this.remoteRoot = process.env.VILLAGE_REMOTE_ROOT || '/home/eletim/ai-village-workshop';
    this.baseUrl = process.env.VILLAGE_PMUX_URL || 'http://e-ryzen.tail6bc726.ts.net:8022/';
    this.pollMs = Number(process.env.VILLAGE_POLL_MS || 2000);
    this.timeout = Number(process.env.VILLAGE_JOB_TIMEOUT_MS || 1800000);
    this.job = null;
    this.persistQueue = Promise.resolve();
  }
  async init() {
    await mkdir(this.dir, { recursive: true });
    try { this.job = JSON.parse(await readFile(resolve(this.dir, 'state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.job && activePhases.has(this.job.phase)) {
      // Never resend an uncertain mutation/input after a restart. A fresh tab's result is safe to resume.
      if (this.job.phase === 'working' && this.job.tabId) this.launch(() => this.collect());
      else if (this.job.phase === 'reporting' && this.job.output) this.launch(() => this.report());
      else await this.update({ phase: 'error', error: '接続準備中にサーバーが停止しました。専用workspaceを確認してから新しい依頼を送ってください。自動再送はしていません。' });
    }
  }
  snapshot() { return { connected: true, workshop: this.host, job: this.job }; }
  async update(patch) {
    Object.assign(this.job, patch, { updatedAt: new Date().toISOString() });
    const data = JSON.stringify(this.job, null, 2);
    this.persistQueue = this.persistQueue.then(async () => {
      await writeFile(resolve(this.dir, 'state.tmp'), data, { mode: 0o600 });
      await rename(resolve(this.dir, 'state.tmp'), resolve(this.dir, 'state.json'));
      await writeFile(resolve(this.dir, `${this.job.id}.json`), data, { mode: 0o600 });
    });
    await this.persistQueue;
  }
  launch(task) {
    this.running = task().catch(async error => {
      console.error(error.message);
      await this.update({ phase: 'error', error: error.message });
    });
  }
  async submit(request) {
    if (this.job && activePhases.has(this.job.phase)) throw Object.assign(new Error('現在の依頼が進行中です。'), { status: 409 });
    this.job = { id: randomUUID(), request, phase: 'planning', createdAt: new Date().toISOString(), workerFinishedAt: null, reportFinishedAt: null };
    await this.update({});
    this.launch(() => this.execute());
    return this.snapshot();
  }
  async remote(args) {
    const command = args.map(quote).join(' ');
    return run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', this.host, 'bash -lic ' + quote(command)]);
  }
  async pmux(...args) { return JSON.parse(await this.remote(['purplemux', ...args])); }
  async secretary(kind, prompt) {
    const file = resolve(this.dir, `${this.job.id}-${kind}.txt`);
    await run(process.env.VILLAGE_CODEX_BIN || 'codex', ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', this.dir, '-o', file, '-'], { input: prompt, timeout: 300000 });
    const text = (await readFile(file, 'utf8')).trim();
    if (!text) throw new Error('秘書Codexの出力が空です。');
    return text;
  }
  async execute() {
    const cwd = `${this.remoteRoot}/${this.job.id}`;
    await this.update({ cwd });
    const instruction = await this.secretary('instruction', `あなたはAI村の秘書ミクです。人間の依頼を、工房のCodex Agentレンに渡す自然な日本語の指示にしてください。指示文だけを出力してください。実装やコマンド実行はせず、目的、制作物、確認方法、最後に自然文で成果・ファイルの絶対パス・確認結果・未完了点を報告することを伝えてください。作業は専用ディレクトリ ${cwd} の中で行い、他のセッションに触れないでください。\n人間の依頼:\n${this.job.request}`);
    await this.update({ instruction, phase: 'connecting' });
    await this.remote(['mkdir', '-p', cwd]);
    // Mutations deliberately have no automatic retries: an unknown outcome may have committed.
    const workspace = await this.pmux('workspace', 'create', '--cwd', cwd, '--name', `AI村 ${this.job.id.slice(0, 8)}`);
    await this.update({ workspaceId: workspace.id, initialTabId: workspace.initialTab?.tabId });
    const tab = await this.pmux('tab', 'create', '-w', workspace.id, '-n', 'レン · 第一工房', '-t', 'codex-cli');
    const url = new URL(this.baseUrl);
    url.searchParams.set('workspace', workspace.id); url.searchParams.set('tab', tab.tabId);
    await this.update({ tabId: tab.tabId, sessionName: tab.sessionName, terminalUrl: url.href });
    const deadline = Date.now() + 60000;
    while (true) {
      const status = await this.pmux('tab', 'status', '-w', workspace.id, tab.tabId);
      if (status.alive && status.cliState === 'idle') break;
      if (Date.now() > deadline) throw new Error('工房Codexの起動待ちがタイムアウトしました。端末リンクを確認してください。');
      await sleep(this.pollMs);
    }
    // Persist before send; on restart poll this fresh tab rather than duplicating the request.
    await this.update({ phase: 'working', startedAt: new Date().toISOString(), workerState: 'dispatching' });
    await this.pmux('tab', 'send', '-w', workspace.id, tab.tabId, instruction);
    await this.collect();
  }
  async collect() {
    const deadline = new Date(this.job.startedAt).getTime() + this.timeout;
    let failures = 0;
    while (Date.now() < deadline) {
      let status, result;
      try {
        status = await this.pmux('tab', 'status', '-w', this.job.workspaceId, this.job.tabId);
        result = await this.pmux('tab', 'result', '-w', this.job.workspaceId, this.job.tabId);
        failures = 0;
      } catch (error) {
        if (++failures >= 5) throw error;
        await this.update({ connectionError: error.message });
        await sleep(this.pollMs); continue;
      }
      await this.update({ workerState: status.cliState, agentSessionId: result.agentSessionId || status.agentSessionId, connectionError: null, permissionRequest: status.permissionRequest || null });
      if (result.interrupted || result.status === 'interrupted') throw new Error('工房の作業が中断されました。端末リンクで確認してください。');
      if (result.status === 'completed' && result.text && status.cliState !== 'busy') {
        await this.update({ phase: 'reporting', output: result.text, workerFinishedAt: new Date().toISOString() });
        await this.report(); return;
      }
      if (!status.alive) throw new Error('工房の端末が終了しました。完了報告は取得できていません。');
      await sleep(this.pollMs);
    }
    throw new Error('工房の待機時間を超えました。工房は停止していません。端末リンクから状態を確認してください。');
  }
  async report() {
    const report = await this.secretary('report', `あなたはAI村の秘書ミクです。人間にわかりやすく日本語で成果を報告してください。表示先はプレーンテキストです。Markdown記法を使わず短い段落で書いてください。以下は工房Agentから受け取った自然文です。依頼・成果・保存場所・Agentが実際に行った確認・残る問題を簡潔に説明してください。自分が検証したとは言わず、工房からの報告であることを示してください。工房が失敗や未完了を報告していたら正直に伝えてください。追加の作業やツール実行は不要です。\n人間の依頼:\n${this.job.request}\n作業ディレクトリ:\n${this.job.cwd}\n工房の報告:\n${this.job.output}`);
    await this.update({ phase: 'completed', report, reportFinishedAt: new Date().toISOString() });
  }
}
