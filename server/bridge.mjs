import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, readdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isOnDesk, isSettled, jobStatus } from '../src/job-state.js';
import { captureProcessesScript, stopProcessesScript } from './processes.mjs';
import { VillageLibrary } from './library.mjs';
import { randomUUID } from 'node:crypto';

export const activePhases = new Set(['planning', 'connecting', 'working', 'reporting', 'cancelling']);
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function run(command, args, { input, timeout = 60000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('処理はキャンセルされました。')); return; }
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: !!signal });
    let stdout = '', stderr = '', settled = false, stopped, killTimer;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const stop = error => {
      stopped ||= error;
      const kill = name => { try { if (signal) process.kill(-child.pid, name); else child.kill(name); } catch {} };
      kill('SIGTERM'); killTimer ||= setTimeout(() => kill('SIGKILL'), 1000);
    };
    const abort = () => stop(new Error('処理はキャンセルされました。'));
    const timer = setTimeout(() => stop(new Error(`${command}: timeout`)), timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 15e6) stop(new Error(`${command}: output too large`)); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.on('error', error => finish(error));
    child.on('close', code => finish(stopped || (code === 0 ? null : new Error(`${command} exited ${code}: ${stderr || stdout}`)), stdout));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    signal?.addEventListener('abort', abort, {once:true}); if (signal?.aborted) abort();
  });
}

export class WorkshopBridge {
  constructor(options = {}) {
    this.dir = resolve(options.dir || process.env.VILLAGE_STATE_DIR || '.runtime');
    this.library = options.library || new VillageLibrary();
    this.pollMs = Number(process.env.VILLAGE_POLL_MS || 2000);
    this.timeout = Number(process.env.VILLAGE_JOB_TIMEOUT_MS || 1800000);
    this.job = null;
    this.jobs = [];
    this.releases = new Map();
    this.executions = new Map();
    this.persistQueue = Promise.resolve();
  }
  async init() {
    await mkdir(this.dir, { recursive: true });
    let stored;
    try { stored = JSON.parse(await readFile(resolve(this.dir, 'state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stored?.version === 2) {
      this.jobs = stored.jobs;
      this.job = this.jobs.find(job => job.id === stored.currentJobId) || null;
    } else if (stored) {
      // One-time migration: retain previous reports and every original resource identity.
      for (const file of await readdir(this.dir)) {
        if (/^[0-9a-f-]{36}\.json$/.test(file)) this.jobs.push(JSON.parse(await readFile(resolve(this.dir, file), 'utf8')));
      }
      this.jobs = this.jobs.filter(job => job.id !== stored.id);
      this.jobs.push(stored); this.job = stored;
    }
    for (const job of this.jobs) {
      if (!job.sshHost) job.sshHost = (await this.library.firstWorkshop()).sshHost;
      if (job.phase === 'completed') job.phase = 'awaiting_review';
      job.releaseState ||= 'held';
      if (job.cancelRequestedAt && !job.cancelledAt) {
        job.phase = 'cancelling'; job.releaseState = 'failed';
        job.releaseError = '停止・解放の完了は未確認です。再試行で実際の残存状態を確認してください。';
      }
      if (job.releaseState === 'releasing') {
        job.releaseState = 'failed'; job.releaseError = '解放中にサーバーが停止しました。対象の残存状態を確認して再試行できます。';
      }
    }
    await this.persist();
    if (this.job && activePhases.has(this.job.phase) && !this.job.cancelRequestedAt) {
      if (this.job.phase === 'working' && this.job.tabId) this.launch(() => this.collect());
      else if (this.job.phase === 'reporting' && this.job.output) this.launch(() => this.report());
      else await this.update({ phase: 'error', error: '接続準備中にサーバーが停止しました。専用workspaceを確認してから新しい依頼を送ってください。自動再送はしていません。' });
    }
  }
  snapshot() {
    const describe = job => job ? { ...job, status: jobStatus(job), onDesk: isOnDesk(job) } : null;
    return { connected: true, workshop: this.job?.workshopName || null, job: describe(this.job), desk: this.jobs.filter(isOnDesk).map(describe), jobs: [...this.jobs].sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(describe) };
  }
  async persist() {
    const data = JSON.stringify({ version: 2, currentJobId: this.job?.id, jobs: this.jobs }, null, 2);
    const operation = this.persistQueue.catch(() => {}).then(async () => {
      await writeFile(resolve(this.dir, 'state.tmp'), data, { mode: 0o600 });
      await rename(resolve(this.dir, 'state.tmp'), resolve(this.dir, 'state.json'));
    });
    this.persistQueue = operation;
    await operation;
  }
  async update(patch, job = this.job) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    await this.persist();
  }
  assertRunning(job = this.job) {
    if (job.cancelRequestedAt) throw new Error('仕事のキャンセルが指示されています。');
  }
  launch(task) {
    const job = this.job, controller = new AbortController();
    const promise = task().catch(async error => {
      if (!job.cancelRequestedAt) { console.error(error.message); await this.update({ phase: 'error', error: error.message }, job); }
    }).finally(() => this.executions.delete(job.id));
    this.executions.set(job.id, { controller, promise }); this.running = promise;
  }
  async submit(request, connection, instruction = null) {
    if (!connection?.sshHost || !connection.remoteRoot || !connection.baseUrl) throw new Error('資料から工房の接続先を選んでください。');
    if (this.jobs.some(job => activePhases.has(job.phase) || (job.tabId && job.releaseState !== 'released') || job.releaseState === 'releasing')) throw Object.assign(new Error('先に進行中の仕事と、届いた報告の確認・Agentの解放を完了してください。'), { status: 409 });
    this.job = { id: randomUUID(), request, phase: 'planning', sshHost: connection.sshHost, remoteRoot: connection.remoteRoot, baseUrl: connection.baseUrl, workshopName: connection.name, workshopDocument: connection.document, documentHash: connection.documentHash, instruction, resourceStep: 'local', releaseState: 'held', approvedAt: null, releasedAt: null, createdAt: new Date().toISOString(), workerFinishedAt: null, reportFinishedAt: null };
    this.jobs.push(this.job);
    await this.update({});
    this.launch(() => this.execute());
    return this.snapshot();
  }
  async remote(args, host = this.job?.sshHost, jobId = this.job?.id || null) {
    if (!host) throw new Error('保存された接続先がありません。');
    await appendFile(resolve(this.dir, 'ssh-audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), host, command: args[0], operation: args[0] === 'purplemux' ? args.slice(1,3) : [], jobId }) + '\n', { mode: 0o600 });
    const command = args.map(quote).join(' ');
    return run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, 'bash -lic ' + quote(command)]);
  }
  async pmux(...args) { return JSON.parse(await this.remote(['purplemux', ...args])); }
  async secretary(kind, prompt) {
    const file = resolve(this.dir, `${this.job.id}-${kind}.txt`);
    await run(process.env.VILLAGE_CODEX_BIN || 'codex', ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', this.dir, '-o', file, '-'], { input: prompt, timeout: 300000, signal: this.executions.get(this.job.id)?.controller.signal });
    const text = (await readFile(file, 'utf8')).trim();
    if (!text) throw new Error('秘書Codexの出力が空です。');
    return text;
  }
  async execute() {
    this.assertRunning();
    const cwd = `${this.job.remoteRoot}/${this.job.id}`;
    await this.update({ cwd });
    const instruction = this.job.instruction || await this.secretary('instruction', `あなたはAI村の秘書ミクです。人間の依頼を、工房のCodex Agentレンに渡す自然な日本語の指示にしてください。指示文だけを出力してください。実装やコマンド実行はせず、目的、制作物、確認方法、最後に自然文で成果・ファイルの絶対パス・確認結果・未完了点を報告することを伝えてください。作業は専用ディレクトリ ${cwd} の中で行い、他のセッションに触れないでください。\n人間の依頼:\n${this.job.request}`);
    this.assertRunning();
    await this.update({ instruction, phase: 'connecting', resourceStep: 'remote-directory' });
    this.assertRunning();
    await this.remote(['mkdir', '-p', cwd]);
    this.assertRunning();
    await this.update({ resourceStep: 'workspace-create' });
    this.assertRunning();
    // Mutations deliberately have no automatic retries: an unknown outcome may have committed.
    const workspace = await this.pmux('workspace', 'create', '--cwd', cwd, '--name', `AI村 ${this.job.id.slice(0, 8)}`);
    await this.update({ workspaceId: workspace.id, initialTabId: workspace.initialTab?.tabId, resourceStep: 'agent-create' });
    this.assertRunning();
    const tab = await this.pmux('tab', 'create', '-w', workspace.id, '-n', 'レン · 第一工房', '-t', 'codex-cli');
    const url = new URL(this.job.baseUrl);
    url.searchParams.set('workspace', workspace.id); url.searchParams.set('tab', tab.tabId);
    await this.update({ tabId: tab.tabId, sessionName: tab.sessionName, terminalUrl: url.href, resourceStep: 'agent-ready' });
    this.assertRunning();
    const deadline = Date.now() + 60000;
    while (true) {
      this.assertRunning();
      const status = await this.pmux('tab', 'status', '-w', workspace.id, tab.tabId);
      if (status.alive && status.cliState === 'idle') break;
      if (Date.now() > deadline) throw new Error('工房Codexの起動待ちがタイムアウトしました。端末リンクを確認してください。');
      await sleep(this.pollMs);
    }
    // Persist before send; on restart poll this fresh tab rather than duplicating the request.
    this.assertRunning();
    await this.update({ resourceStep: 'sending', phase: 'working', startedAt: new Date().toISOString(), workerState: 'dispatching' });
    this.assertRunning();
    await this.pmux('tab', 'send', '-w', workspace.id, tab.tabId, instruction);
    this.assertRunning();
    await this.collect();
  }
  async collect() {
    const deadline = new Date(this.job.startedAt).getTime() + this.timeout;
    let failures = 0;
    while (Date.now() < deadline) {
      this.assertRunning();
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
      this.assertRunning();
      await this.update({ workerState: status.cliState, agentSessionId: result.agentSessionId || status.agentSessionId, connectionError: null, permissionRequest: status.permissionRequest || null });
      this.assertRunning();
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
    this.assertRunning();
    const report = await this.secretary('report', `あなたはAI村の秘書ミクです。人間にわかりやすく日本語で成果を報告してください。表示先はプレーンテキストです。Markdown記法を使わず短い段落で書いてください。以下は工房Agentから受け取った自然文です。依頼・成果・保存場所・Agentが実際に行った確認・残る問題を簡潔に説明してください。自分が検証したとは言わず、工房からの報告であることを示してください。工房が失敗や未完了を報告していたら正直に伝えてください。追加の作業やツール実行は不要です。\n人間の依頼:\n${this.job.request}\n作業ディレクトリ:\n${this.job.cwd}\n工房の報告:\n${this.job.output}`);
    this.assertRunning();
    let artifacts = [], artifactError = null;
    try { artifacts = await this.listArtifacts(this.job); } catch (error) { artifactError = error.message; }
    this.assertRunning();
    await this.update({ phase: 'awaiting_review', report, artifacts, artifactError, reportFinishedAt: new Date().toISOString() });
    await this.onReport?.(this.job);
  }

  // All cleanup mutations are scoped to the immutable IDs captured at creation.
  jobById(id) {
    const job = this.jobs.find(candidate => candidate.id === id);
    if (!job) throw Object.assign(new Error('仕事が見つかりません。'), { status: 404 });
    return job;
  }
  async listArtifacts(job) {
    const script = `import os,json,sys
root=os.path.realpath(sys.argv[1]); files=[]
for directory, dirs, names in os.walk(root, followlinks=False):
 dirs[:]=[d for d in dirs if d not in ('.git','node_modules','.venv') and not os.path.islink(os.path.join(directory,d))]
 for name in sorted(names):
  path=os.path.join(directory,name)
  if not os.path.islink(path) and os.path.isfile(path) and os.path.getsize(path)<=10*1024*1024:
   files.append({'path':os.path.relpath(path,root),'size':os.path.getsize(path)})
  if len(files)>=100: break
 if len(files)>=100: break
print(json.dumps(files))`;
    return JSON.parse(await this.remote(['python3', '-c', script, job.cwd], job.sshHost, job.id));
  }
  async artifact(id, path) {
    const job = this.jobById(id);
    // Legacy reports can discover their directory contents lazily; the prose is never executed.
    if (!job.artifacts) {
      const artifacts = await this.listArtifacts(job); await this.update({ artifacts }, job);
    }
    if (!job.artifacts.some(file => file.path === path)) throw Object.assign(new Error('成果物が見つかりません。'), { status: 404 });
    const script = `import os,sys,base64
root=os.path.realpath(sys.argv[1]); path=os.path.realpath(os.path.join(root,sys.argv[2]))
if os.path.commonpath([root,path])!=root or not os.path.isfile(path): raise ValueError('outside job directory')
with open(path,'rb') as f: data=f.read(10*1024*1024+1)
if len(data)>10*1024*1024: raise ValueError('file too large')
print(base64.b64encode(data).decode())`;
    return Buffer.from(await this.remote(['python3', '-c', script, job.cwd, path], job.sshHost, job.id), 'base64');
  }
  async cleanupResources(job) {
    // A new job still in its local stage has never contacted the workshop.
    if (!job.workspaceId && !job.tabId && job.resourceStep === 'local') return { source: 'local stage; no remote execution started' };
    const pmux = async (...args) => JSON.parse(await this.remote(['purplemux', ...args], job.sshHost, job.id));
    const { workspaces } = await pmux('workspaces');
    if (!job.workspaceId) {
      const candidates = workspaces.filter(workspace => workspace.directories?.includes(job.cwd));
      if (candidates.length) throw new Error('記録されていないworkspaceが残っています。対象Agentを安全に特定できず、停止は未確認です。');
      await this.verifyNoUntrackedAgent(job);
      return { source: 'no workspace for job directory; no Agent process in job directory' };
    }
    if (workspaces.some(workspace => workspace.id === job.workspaceId)) {
      let { tabs } = await pmux('tab', 'list', '-w', job.workspaceId);
      const target = tabs.find(tab => tab.tabId === job.tabId);
      if (target) {
        if (target.workspaceId !== job.workspaceId || target.sessionName !== job.sessionName || target.panelType !== 'codex-cli' || (target.agentSessionId && job.agentSessionId && target.agentSessionId !== job.agentSessionId)) throw new Error('Agentの識別情報が変わっています。停止・解放は未確認です。');
        const ownedProcesses = JSON.parse(await this.remote(['python3', '-c', captureProcessesScript, job.sessionName], job.sshHost, job.id));
        await this.update({ ownedProcesses: [...(job.ownedProcesses || []), ...ownedProcesses] }, job);
        // Persist descendants before closing: their process groups may differ.
        await this.remote(['purplemux', 'tab', 'close', '-w', job.workspaceId, job.tabId], job.sshHost, job.id);
      } else if (!job.tabId && tabs.some(tab => tab.panelType === 'codex-cli')) {
        throw new Error('Agent tabの作成結果が不明です。別のtabを推測で閉じず、停止未確認として保持します。');
      }
      ({ tabs } = await pmux('tab', 'list', '-w', job.workspaceId));
      if (tabs.some(tab => tab.tabId === job.tabId)) throw new Error('対象tabがまだ残っています。');
      await this.stopAgentProcesses(job, tabs);
      if (!tabs.length) {
        await pmux('workspace', 'delete', '-w', job.workspaceId, '--if-empty');
        await this.update({ workspaceRetained: false }, job);
      } else await this.update({ workspaceRetained: true }, job);
    } else await this.verifyNoUntrackedAgent(job);
    return { source: 'PurpleMux scoped tab close, owned descendant termination and fresh inventory', processes: job.processVerification, workspaceId: job.workspaceId, tabId: job.tabId };
  }
  async verifyNoUntrackedAgent(job) {
    if (!job.cwd) throw new Error('作業場所が不明で、Agentの不在を確認できません。');
    await this.stopAgentProcesses(job, []);
  }
  async stopAgentProcesses(job, otherTabs) {
    const processVerification = JSON.parse(await this.remote(['python3', '-c', stopProcessesScript, JSON.stringify(job.ownedProcesses || []), job.cwd, JSON.stringify(otherTabs.map(tab=>tab.sessionName).filter(Boolean))], job.sshHost, job.id));
    await this.update({ processVerification }, job);
  }

  approve(id) {
    const job = this.jobById(id);
    if (job.cancelRequestedAt) throw Object.assign(new Error('キャンセルの停止確認を先に完了してください。'), {status:409});
    if (job.releaseState === 'released') return Promise.resolve(this.snapshot());
    if (this.releases.has(id)) return this.releases.get(id);
    if (job.phase !== 'awaiting_review' || !job.report) throw Object.assign(new Error('報告が届いてからOKを出してください。'), { status: 409 });
    const operation = (async () => {
      await this.update({ approvedAt: job.approvedAt || new Date().toISOString(), releaseState: 'releasing', releaseError: null }, job);
      try {
        const verification = await this.cleanupResources(job);
        const at = new Date().toISOString();
        await this.update({ releaseState: 'released', releasedAt: at, deskClearedAt: at, cleanupVerification: { ...verification, at }, releaseError: null }, job);
      } catch (error) { await this.update({ releaseState: 'failed', releaseError: error.message }, job); }
      return this.snapshot();
    })().finally(() => this.releases.delete(id));
    operation.kind = 'approve'; this.releases.set(id, operation); return operation;
  }
  cancel(id, reason = '村長のキャンセル指示') {
    const job = this.jobById(id);
    if (job.cancelledAt && job.releaseState === 'released') return Promise.resolve(this.snapshot());
    if (this.releases.has(id)) {
      const running = this.releases.get(id);
      if (running.kind !== 'cancel') throw Object.assign(new Error('承認・解放の処理中です。結果を確認してください。'), {status:409});
      return running;
    }
    if (isSettled(job)) throw Object.assign(new Error('この仕事は既に承認・解放済みです。履歴の事実は変更しません。'), {status:409});
    const operation = (async () => {
      await this.update({ cancelRequestedAt: job.cancelRequestedAt || new Date().toISOString(), cancelReason: reason, phase: 'cancelling', releaseState: 'releasing', releaseError: null }, job);
      const execution = this.executions.get(id);
      execution?.controller.abort();
      // Allow in-flight SSH mutations to return their resource IDs before cleanup.
      if (execution) await execution.promise;
      try {
        const verification = await this.cleanupResources(job), at = new Date().toISOString();
        await this.update({ phase: 'cancelled', cancelledAt: at, stopConfirmedAt: at, releaseState: 'released', releasedAt: job.releasedAt || at, deskClearedAt: at, cleanupVerification: { ...verification, at }, releaseError: null }, job);
      } catch (error) {
        await this.update({ phase: 'cancelling', releaseState: 'failed', releaseError: error.message, stopConfirmedAt: null }, job);
      }
      return this.snapshot();
    })().finally(() => this.releases.delete(id));
    operation.kind = 'cancel'; this.releases.set(id, operation); return operation;
  }
  async dismiss(id) {
    const job = this.jobById(id);
    if (!isSettled(job)) throw Object.assign(new Error('未確認・停止未確認・解放未完了の仕事は机から下げられません。'), {status:409});
    if (!job.deskClearedAt) await this.update({ deskClearedAt: new Date().toISOString() }, job);
    return this.snapshot();
  }
}
