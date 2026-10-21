import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkshopBridge } from '../server/bridge.mjs';
const job = () => ({ id:'11111111-1111-4111-8111-111111111111', phase:'awaiting_review', report:'できました', request:'小さな制作', workspaceId:'ws-own', tabId:'tab-own', sessionName:'session-own', agentSessionId:'agent-own', sshHost:'original-host', cwd:'/work/own', releaseState:'held', artifacts:[{path:'result.txt',size:12}] });
class ReleaseWorkshop extends WorkshopBridge {
  constructor(dir) {
    super({dir}); this.calls=[];
    this.tabs=[{workspaceId:'ws-own',tabId:'tab-own',sessionName:'session-own',agentSessionId:'agent-own',panelType:'codex-cli'},{workspaceId:'ws-own',tabId:'tab-other',sessionName:'session-other',panelType:'terminal'}];
    this.fail=false; this.loseResponse=false;
  }
  async remote(args,host) {
    this.calls.push({args,host});
    if(args[0]!=='purplemux')return Buffer.from('成果物を保持').toString('base64');
    const [,group,action]=args;
    if(group==='workspaces')return JSON.stringify({workspaces:[{id:'ws-own'}]});
    if(group==='tab'&&action==='list')return JSON.stringify({tabs:this.tabs});
    if(group==='tab'&&action==='close') {
      assert.equal(args.at(-1),'tab-own');
      if(this.fail)throw new Error('SSH disconnected');
      this.tabs=this.tabs.filter(tab=>tab.tabId!=='tab-own');
      if(this.loseResponse){this.loseResponse=false;throw new Error('response lost');}
      return 'ok\n';
    }
    if(group==='workspace'&&action==='delete')return JSON.stringify({status:'deleted'});
    throw new Error(args.join(' '));
  }
}
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'village-release-'));
  const bridge=new ReleaseWorkshop(dir);await bridge.init();bridge.job=job();bridge.jobs.push(bridge.job);await bridge.persist();return {bridge,dir};
}
test('OK is single-flight and durable; only the owned agent closes, artifacts and other tabs survive',async()=>{
  const {bridge,dir}=await setup();
  const a=bridge.approve(bridge.job.id),b=bridge.approve(bridge.job.id);assert.equal(a,b);await Promise.all([a,b]);
  assert.equal(bridge.job.releaseState,'released');assert.ok(bridge.job.approvedAt);assert.ok(bridge.job.releasedAt);assert.equal(bridge.job.workspaceRetained,true);
  await bridge.approve(bridge.job.id);
  assert.equal(bridge.calls.filter(c=>c.args[2]==='close').length,1);
  assert.deepEqual(bridge.tabs.map(tab=>tab.tabId),['tab-other']);
  assert.equal(bridge.calls.every(c=>c.host==='original-host'),true);
  const restored=new ReleaseWorkshop(dir);await restored.init();await restored.approve(bridge.job.id);assert.equal(restored.calls.length,0);
  assert.equal((await restored.artifact(bridge.job.id,'result.txt')).toString(),'成果物を保持');
  assert.equal(restored.job.report,'できました');
  await assert.rejects(restored.artifact(bridge.job.id,'../../private'),{status:404});
});
test('release failure stays visible and retry reconciles after a lost close response',async()=>{
  const {bridge}=await setup();bridge.fail=true;await bridge.approve(bridge.job.id);
  assert.equal(bridge.job.releaseState,'failed');assert.equal(bridge.tabs.length,2);assert.match(bridge.job.releaseError,/disconnected/);
  const approvedAt=bridge.job.approvedAt;bridge.fail=false;bridge.loseResponse=true;await bridge.approve(bridge.job.id);
  assert.equal(bridge.job.releaseState,'failed');assert.equal(bridge.tabs.length,1);
  await bridge.approve(bridge.job.id);assert.equal(bridge.job.releaseState,'released');assert.equal(bridge.job.approvedAt,approvedAt);
  assert.equal(bridge.calls.filter(c=>c.args[2]==='close').length,2);
});
test('restart during release never invents success; retry uses original job identity',async()=>{
  const {bridge,dir}=await setup();await bridge.update({approvedAt:new Date().toISOString(),releaseState:'releasing'});
  const restored=new ReleaseWorkshop(dir);await restored.init();assert.equal(restored.job.releaseState,'failed');assert.ok(restored.job.approvedAt);assert.equal(restored.calls.length,0);
  await restored.approve(restored.job.id);assert.equal(restored.job.releaseState,'released');
});
test('identity drift fails closed and empty workspaces use if-empty guard',async()=>{
  const {bridge}=await setup();bridge.tabs[0].agentSessionId='another-agent';await bridge.approve(bridge.job.id);
  assert.equal(bridge.job.releaseState,'failed');assert.equal(bridge.calls.some(c=>c.args[2]==='close'),false);
  bridge.tabs[0].agentSessionId='agent-own';bridge.tabs.pop();await bridge.approve(bridge.job.id);
  assert.equal(bridge.job.releaseState,'released');assert.ok(bridge.calls.some(c=>c.args.includes('--if-empty')));
});
test('legacy current job and historical reports migrate without approval or automatic cleanup',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'village-migrate-'));
  const current={...job(),phase:'completed'};delete current.releaseState;
  const previous={...current,id:'22222222-2222-4222-8222-222222222222',report:'以前の報告'};
  await writeFile(join(dir,'state.json'),JSON.stringify(current));await writeFile(join(dir,`${previous.id}.json`),JSON.stringify(previous));
  const bridge=new ReleaseWorkshop(dir);await bridge.init();assert.equal(bridge.jobs.length,2);assert.equal(bridge.job.id,current.id);assert.equal(bridge.job.phase,'awaiting_review');assert.equal(bridge.job.releaseState,'held');assert.equal(bridge.calls.length,0);
  const saved=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));assert.equal(saved.version,2);assert.equal(saved.jobs.length,2);
});
test('OK before a report or for a different job cannot close any resources',async()=>{
  const {bridge}=await setup();bridge.job.phase='working';assert.throws(()=>bridge.approve(bridge.job.id),{status:409});assert.throws(()=>bridge.approve('unknown'),{status:404});assert.equal(bridge.calls.length,0);
});
