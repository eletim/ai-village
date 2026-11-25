import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {purposeFixture} from '../purpose-fixture.js';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import {inputHash} from '../model-fixtures.mjs';
import {randomUUID} from 'node:crypto';
for(const width of [1440,390])test('contract 3 missing judgment stays visible and can be decided later '+width,async({page},info)=>{
 const cleanup=[],{f,human,first,completeJob}=await purposeFixture({after:fn=>cleanup.push(fn)});
 try{
  f.agents[0].inputEnvelope.contract=3;if(f.service.rules.startup3)f.agents[0].inputEnvelope.hash=inputHash(f.service.rules.startup3());
  const one=await completeJob(first);await f.complete(one.delivery);
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/direct'?workspaceSnapshot(f.service.snapshot(),{},[human.agentId]):{providers:{}}}));
  await page.goto('/agents');await page.locator('[data-zoom="'+human.agentId+'"]').click();
  await expect(page.locator('.runs .answer-jobs')).toContainText('秘書の確認待ち（判断記録なし）');
  expect(f.service.conversations.record(human.conversationId).deliveries.filter(e=>e.decisionRecovery)).toHaveLength(0);
  await page.screenshot({path:info.outputPath('missing-decision-'+width+'.png')});
  const later=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'どうなった？'});await f.submit(later);
  const status=await f.service.secretaryCommands.status(later.id);expect(status.purposes[0].objective).toBe('目的の成果を作る');
  await f.service.conversations.material(human.conversationId,later.id,{kind:'delivery',id:one.event.id});
  await f.service.secretaryCommands.accept(later.id,'成果を確認して達成',first.humanRequestId);await f.complete(later);await notifySnapshot(page);
  await expect(page.locator('.runs .answer-jobs')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('later-decision-'+width+'.png')});
 }finally{f.service.close();for(const fn of cleanup)await fn();}
});
