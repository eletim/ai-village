import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {fixture} from '../notification-fixture.js';
import {workspaceSnapshot,historyPage} from '../../server/conversation-pages.mjs';
for(const width of [1440,390])test('conversation API keeps internal supplements folded after final report '+width,async({page})=>{
 await page.setViewportSize({width,height:900});const state=fixture();
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/history'))return route.fulfill({json:historyPage(state,'a',url.searchParams.get('before'))});
  return route.fulfill({json:workspaceSnapshot(state)});
 });
 await page.goto('/agents');await expect(page.locator('[data-entry="input:progress"] summary')).toBeVisible();await page.locator('[data-entry="input:progress"]').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/notification-collapse-closed-'+width+'.png'});
 for(const id of ['progress','deadline','selfResume','amend','legacy-agent']){
  const entry=page.locator('[data-entry="input:'+id+'"]');await expect(entry.locator('details')).not.toHaveAttribute('open','');await expect(entry.locator('pre')).toBeHidden();await expect(entry.locator('.message.user')).toHaveCount(0);
  await entry.locator('summary').click();await expect(entry.locator('pre')).toBeVisible();await expect(entry.locator('pre')).toHaveText('通知本文 '+id);
 }
 for(const id of ['human','legacy','legacy-human'])await expect(page.locator('[data-entry="input:'+id+'"] .message.user')).toBeVisible();
 await expect(page.locator('[data-entry="input:legacy"]')).toContainText('由来不明');
 await page.locator('[data-entry="input:deadline"] summary').click();state.requests[0].requestGraph.nodes[0].inbox[0].handledBy='final';await notifySnapshot(page);
 await expect(page.locator('[data-entry="input:progress"]')).toContainText('対応済み');await expect(page.locator('[data-entry="input:progress"] pre')).toBeVisible();await expect(page.locator('[data-entry="input:deadline"] pre')).toBeHidden();
 await expect(page.locator('[data-entry="input:progress"]')).toHaveCount(1);await expect(page.locator('.message.assistant').filter({hasText:'最終報告'})).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/notification-collapse-'+width+'.png'});
});
