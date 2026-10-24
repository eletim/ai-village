import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkshopBridge } from '../server/bridge.mjs';
import { Secretariat } from '../server/secretariat.mjs';
import { reportingPolicy } from '../server/reporting-policy.mjs';

const sha = 'a'.repeat(40);
const cases = [
  ['success', null, '依頼されていた手紙について、完了しました。'],
  ['workshop-only', {autoApply:false,result:{commit:sha,pushed:true}}, '工房から、修正と確認が終わったと報告がありました。村への反映はまだ行っていません。'],
  ['workshop-auto', {autoApply:true,result:{commit:sha,pushed:true}}, '修正と確認が終わりました。次に村へ反映します。'],
  ['workshop-failure', {autoApply:true,inspectionError:'remote mismatch'}, '修正は終わりましたが、送った変更の一致を確認できていません。反映前に確認が必要です。'],
];
for (const [name, development, reply] of cases) test(`workshop report route: ${name}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-policy-'));
  const bridge = new WorkshopBridge({dir});
  bridge.job = {id:name,phase:'reporting',development,request:'手紙を修正',cwd:dir,output:'詳細な工房報告 SHA '+sha};
  bridge.jobs = [bridge.job];
  const calls = [];
  bridge.inspectResult = async () => calls.push('inspect');
  bridge.secretary = async (kind, prompt) => {
    calls.push('generate'); assert.equal(kind,'report'); assert.ok(prompt.includes(reportingPolicy));
    assert.ok(prompt.includes(JSON.stringify(development))); assert.match(prompt,/inspectionError/);
    assert.match(prompt,/autoApplyがfalse/); assert.match(prompt,/工房報告だけで村への反映完了と言わない/);
    return reply;
  };
  bridge.listArtifacts = async () => [{name:'result.txt',path:'result.txt'}];
  bridge.onReport = async () => calls.push('publish');
  bridge.onDevelopmentReady = async () => calls.push('ready');
  await bridge.report();
  assert.deepEqual(calls,['inspect','generate','publish','ready']);
  assert.equal(bridge.job.report,reply); assert.match(bridge.job.output,new RegExp(sha));
  assert.equal(bridge.job.artifacts.length,1); assert.deepEqual(bridge.job.development,development);
});

const deploymentCases = [
  ['applied', {phase:'succeeded',targetCommit:sha,appliedCommit:sha,verification:{office:true},restarted:true,pushed:true}, '手紙の修正は、村への反映まで完了しました。'],
  ['failed', {phase:'failed',error:'validation failed'}, '検証に失敗したため、村には反映していません。原因の確認が必要です。'],
  ['partial', {phase:'failed',appliedCommit:sha,error:'restart unverified'}, '変更の取り込みは終わりましたが、稼働は未確認です。村の起動状態を確認する必要があります。'],
  ['unknown', {phase:'succeeded'}, '反映を確かめる記録が不足しています。実際の状態を確認する必要があります。'],
];
for (const [name, facts, reply] of deploymentCases) test(`deployment report route: ${name}, durable delivery and no inferred release`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'deployment-policy-'));
  let notices = 0, generations = 0;
  const bridge = {dir,jobs:[]}, library = {root:dir};
  const secretary = new Secretariat(bridge,library,null,{enqueue(){notices++;}});
  await secretary.init();
  const record = {id:name,jobId:'job',...facts};
  const original = structuredClone(record);
  secretary.runCodex = async (_bin,args,{input}) => {
    generations++; assert.ok(input.includes(reportingPolicy));
    assert.deepEqual(JSON.parse(input.split('反映記録:\n')[1]),record);
    assert.match(input,/phaseだけで成功を断定しない/); assert.match(input,/承認・解放の実測がなければその状態には言及しない/);
    assert.doesNotMatch(input,/まだ確認待ちの場合があると伝える|対象commitの完全SHA/);
    await writeFile(args[args.indexOf('-o')+1],reply); return '';
  };
  await secretary.receiveDeployment(record); await secretary.receiveDeployment(record);
  assert.equal(generations,1); assert.equal(notices,1); assert.equal(secretary.messages[0].content,reply);
  assert.deepEqual(record,original);
  const restored = new Secretariat(bridge,library); await restored.init();
  restored.runCodex = () => {throw new Error('must not regenerate');};
  await restored.receiveDeployment(record); assert.equal(restored.messages.length,1);
  assert.equal(await readFile(join(dir,`deployment-report-${name}.txt`),'utf8'),reply);
});

test('deployment generation/persistence failure remains retryable; notification follows saved conversation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'report-retry-'));
  let notices=0;const secretary=new Secretariat({dir,jobs:[]},{root:dir},null,{enqueue(){notices++;}});
  await secretary.init();const record={id:'retry',phase:'failed'};
  secretary.runCodex=async()=>{throw new Error('model unavailable');};
  await assert.rejects(secretary.receiveDeployment(record),/model unavailable/);
  assert.deepEqual(secretary.knownDeployments,[]);assert.equal(notices,0);
  secretary.runCodex=async(_bin,args)=>{await writeFile(args[args.indexOf('-o')+1],'反映できませんでした。原因を確認する必要があります。');};
  const persist=secretary.persist.bind(secretary);secretary.persist=async()=>{throw new Error('disk unavailable');};
  await assert.rejects(secretary.receiveDeployment(record),/disk unavailable/);
  assert.deepEqual(secretary.knownDeployments,[]);assert.equal(secretary.messages.length,0);assert.equal(notices,0);
  secretary.persist=persist;await secretary.receiveDeployment(record);assert.equal(notices,1);
});
