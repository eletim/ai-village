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
  const root=page.locator('[data-entry='+JSON.stringify(JSON.stringify(['run','',human.id]))+'] .answer-jobs');
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
  await f.complete(two.delivery);await notifySnapshot(page);await expect(root).toContainText('完了');
  const answer=page.locator('[data-entry='+JSON.stringify(JSON.stringify(['run','',two.delivery.id]))+']');
  await expect(answer.locator('.answer-jobs')).toContainText('完了');
  await expect(answer).toContainText('Final '+two.delivery.id);
  await expect(page.locator('[data-send="'+human.agentId+'"] [type=submit]')).toBeEnabled();
  await page.screenshot({path:info.outputPath('purpose-complete-'+width+'.png')});
  expect(view().decision.state).toBe('committed');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{f.service.close();for(const fn of cleanup)await fn();}
});
for(const width of [1440,390])test('missing secretary judgment is visible by the answer and can be resumed '+width,async({page},info)=>{
 const cleanup=[];const {f,human,first,completeJob}=await purposeFixture({after:fn=>cleanup.push(fn)});
 try{
  const one=await completeJob(first);await f.complete(one.delivery);
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/direct'?workspaceSnapshot(f.service.snapshot(),{},[human.agentId]):{providers:{}}}));
  await page.goto('/agents');await page.locator('[data-zoom="'+human.agentId+'"]').click();
  const answer=page.locator('[data-entry='+JSON.stringify(JSON.stringify(['run','',one.delivery.id]))+'] .answer-jobs');
  await expect(answer).toContainText('停止中');await expect(answer).toContainText('成果は保存されています');await expect(answer).not.toContainText('続きの確認');
  await expect(page.locator('[data-send="'+human.agentId+'"] [type=submit]')).toBeEnabled();
  await page.screenshot({path:info.outputPath('judgment-recovery-'+width+'.png')});
 }finally{f.service.close();for(const fn of cleanup)await fn();}
});
