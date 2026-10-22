import test from 'node:test';
import assert from 'node:assert/strict';
import { placedAgents, agentState, workshopAgents } from '../src/village-state.js';
import { VillageLibrary } from '../server/library.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
test('registration comes from valid documents, including other workshop names',async()=>{
  const root=await mkdtemp(resolve('.test-library-'));
  try {
    await mkdir(`${root}/workshops`);
    await writeFile(`${root}/notes.md`,'# 未登録の説明');
    await writeFile(`${root}/workshops/second.md`,'---\nname: 第二工房\nssh_host: missing-host\nwork_root: /work\npurplemux_url: http://missing-host:8022/\n---\n# 工房');
    assert.deepEqual(await new VillageLibrary(root).workshops(),[{name:'第二工房',document:'workshops/second.md'}]);
  } finally {await rm(root,{recursive:true});}
});
test('counts deployed terminals across jobs, keeps failed release and removes released agents',()=>{
  const job={id:'one',tabId:'tab',workshopDocument:'second.md',phase:'working',workerState:'busy'};
  assert.equal(placedAgents({job,jobs:[job,{id:'planning'},{...job,id:'released',releaseState:'released'}],capacity:20}).length,1);
  assert.equal(agentState(job).label,'作業中');
  assert.equal(agentState({...job,phase:'awaiting_review'}).label,'確認待ち');
  assert.equal(agentState({...job,releaseState:'failed'}).label,'解放失敗');
  assert.equal(workshopAgents({document:'second.md'},[job]).length,1);
});
