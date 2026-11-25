import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {purposeFixture} from '../purpose-fixture.js';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import {randomUUID} from 'node:crypto';
for(const width of [1440,390])test('secretary decision, autonomous correction and final report stay one visible purpose '+width,async({page},info)=>{
 const cleanup=[];const {f,human,auth,first,completeJob,args,view}=await purposeFixture({after:fn=>cleanup.push(fn)});
 try{
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/direct'?workspaceSnapshot(f.service.snapshot(),{},[human.agentId]):{providers:{}}}));
  const one=await completeJob(first);
  await page.goto('/agents');await page.locator('[data-zoom="'+human.agentId+'"]').click();
  const root=page.locator('.runs .answer-jobs');
  await expect(root).toContainText('秘書が確認中');await expect(root).not.toContainText('完了');
  const next=await f.service.conversations.job({...args(one),continuesRequestId:first.humanRequestId,authorization:auth,instruction:'目的の未達部分を修正する'});
  await f.complete(one.delivery);await f.service.tick();await notifySnapshot(page);
  await expect(root.locator('.answer-job')).toHaveCount(1);
  await expect(root).not.toContainText('完了');
  await expect(page.locator('#completion-count')).toBeEmpty();
  await expect(page.locator('.agent-recovery-host .conversation-work')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('autonomous-continuation-'+width+'.png')});
  const two=await completeJob(next);
  await f.service.conversations.decide({...args(two,1),decision:'accept'});
  await notifySnapshot(page);await expect(root).not.toContainText('完了');
  await f.complete(two.delivery);two.delivery.finalOutput='資料Aの修正と公開を完了しました。追加の対応はありません。';await f.service.save();await notifySnapshot(page);await expect(root).toHaveCount(0);
  const answer=page.locator('[data-entry='+JSON.stringify(JSON.stringify(['run','',two.delivery.id]))+']');
  await expect(answer.locator('.answer-jobs')).toHaveCount(0);
  await expect(answer).toContainText('資料Aの修正と公開を完了しました。');
  await expect(page.locator('[data-send="'+human.agentId+'"] [type=submit]')).toBeEnabled();
  await page.screenshot({path:info.outputPath('purpose-complete-'+width+'.png')});
  expect(view().decision.state).toBe('committed');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{f.service.close();for(const fn of cleanup)await fn();}
});
for(const width of [1440,390])test('missing judgment recovers automatically then stops after bounded attempts '+width,async({page},info)=>{
 const cleanup=[];const {f,human,first,completeJob}=await purposeFixture({after:fn=>cleanup.push(fn)});
 try{
  const one=await completeJob(first);await f.complete(one.delivery);
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/direct'?workspaceSnapshot(f.service.snapshot(),{},[human.agentId]):{providers:{}}}));
  await page.goto('/agents');await page.locator('[data-zoom="'+human.agentId+'"]').click();
  const jobs=page.locator('.runs .answer-jobs');
  await expect(jobs).toContainText('秘書の確認待ち');await expect(jobs).not.toContainText('停止中');
  const c=f.service.conversations.record(human.conversationId);
  for(let i=0;i<2;i++){const e=c.deliveries.filter(e=>e.decisionRecovery).at(-1),r=f.service.flow.run(e.runId);await f.submit(r);await f.complete(r);}
  await notifySnapshot(page);
  expect(c.deliveries.filter(e=>e.decisionRecovery).length).toBe(2);
  const answer=page.locator('.runs .answer-jobs');
  await expect(answer).toHaveCount(1);await expect(answer).toContainText('停止中');await expect(answer).toContainText('成果は保存されています');await expect(answer).not.toContainText('続きの確認');
  await expect(page.locator('[data-send="'+human.agentId+'"] [type=submit]')).toBeEnabled();
  await page.screenshot({path:info.outputPath('judgment-recovery-'+width+'.png')});
 }finally{f.service.close();for(const fn of cleanup)await fn();}
});
