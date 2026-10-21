import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkshopBridge } from '../server/bridge.mjs';
import { personActivity } from '../src/live.js';

class FakeWorkshop extends WorkshopBridge {
  constructor(options) { super(options); this.calls = []; this.statuses = []; this.remoteRoot = '/work'; }
  async secretary(kind, prompt) {
    this.calls.push({ kind, prompt });
    if (kind === 'report') {
      assert.equal(this.job.phase, 'reporting');
      assert.ok(this.job.workerFinishedAt);
      assert.equal(this.job.reportFinishedAt, null);
      assert.equal(personActivity('レン', this.job).active, false);
    }
    return kind === 'instruction' ? '自然文の制作指示' : '制作物と検証結果の人間向け報告';
  }
  async remote(args) { this.calls.push(args); return ''; }
  async pmux(...args) {
    this.calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (key === 'workspace create') return { id: 'ws-1', initialTab: { tabId: 'tab-0' } };
    if (key === 'tab create') return { tabId: 'tab-1', sessionName: 'session-1' };
    if (key === 'tab send') return { status: 'sent' };
    if (key === 'tab status') return { alive: true, cliState: this.statuses.shift() || 'ready-for-review' };
    if (key === 'tab result') return { status: 'completed', text: '成果は /work/hello.html。確認済み。', agentSessionId: 'session-id', interrupted: false };
    throw new Error(key);
  }
}

test('real state flow separates worker completion from secretary report and persists natural outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'village-test-'));
  const bridge = new FakeWorkshop({ dir }); bridge.statuses = ['idle'];
  await bridge.init(); await bridge.submit('挨拶のページを作って');
  await assert.rejects(bridge.submit('二重依頼'), { status: 409 });
  await bridge.running;
  assert.equal(bridge.job.phase, 'completed');
  assert.ok(bridge.job.reportFinishedAt);
  assert.equal(bridge.job.output, '成果は /work/hello.html。確認済み。');
  assert.equal(bridge.job.instruction, '自然文の制作指示');
  const url = new URL(bridge.job.terminalUrl);
  assert.equal(url.searchParams.get('workspace'), 'ws-1');
  assert.equal(url.searchParams.get('tab'), 'tab-1');
  assert.equal(bridge.calls.filter(c => Array.isArray(c) && c[0] === 'tab' && c[1] === 'send').length, 1);
  const persisted = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal(persisted.report, bridge.job.report);
});

test('hammer only follows live busy state, stops during report, and never uses demo villagers', () => {
  assert.equal(personActivity('レン', null).active, false);
  assert.equal(personActivity('レン', { phase: 'working', workerState: 'busy' }).active, true);
  for (const phase of ['planning', 'connecting', 'reporting', 'completed', 'error']) {
    assert.equal(personActivity('レン', { phase, workerState: 'busy' }).active, false);
  }
  assert.equal(personActivity('レン', { phase: 'working', workerState: 'busy' }, false).active, false);
  assert.equal(personActivity('ソラ', { phase: 'working', workerState: 'busy' }).active, false);
});

test('restart resumes result collection without resending a mutation or instruction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'village-test-'));
  await writeFile(join(dir, 'state.json'), JSON.stringify({ id: 'recover', phase: 'working', request: '依頼', tabId: 'tab-1', workspaceId: 'ws-1', startedAt: new Date().toISOString(), reportFinishedAt: null }));
  const bridge = new FakeWorkshop({ dir }); await bridge.init(); await bridge.running;
  assert.equal(bridge.job.phase, 'completed');
  assert.equal(bridge.calls.some(c => Array.isArray(c) && ['create', 'send'].includes(c[1])), false);
});

test('uncertain workspace creation is not retried after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'village-test-'));
  await writeFile(join(dir, 'state.json'), JSON.stringify({ id: 'uncertain', phase: 'connecting' }));
  const bridge = new FakeWorkshop({ dir }); await bridge.init();
  assert.equal(bridge.job.phase, 'error'); assert.equal(bridge.calls.length, 0);
});

test('interrupted worker does not generate a successful secretary report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'village-test-'));
  const bridge = new FakeWorkshop({ dir }); bridge.statuses = ['idle'];
  const pmux = bridge.pmux.bind(bridge);
  bridge.pmux = async (...args) => args[1] === 'result' ? { status: 'completed', text: 'previous result', interrupted: true } : pmux(...args);
  await bridge.init(); await bridge.submit('依頼'); await bridge.running;
  assert.equal(bridge.job.phase, 'error'); assert.equal(bridge.job.report, undefined);
});
