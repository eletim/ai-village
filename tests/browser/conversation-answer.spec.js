import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {conversationFixture} from '../helpers/conversation-answer-fixture.mjs';
import {humanProjection} from '../../server/report-view.mjs';
import {workspaceSnapshot,historyPage} from '../../server/conversation-pages.mjs';
for(const width of [1440,390])test('leader-sourced conversation answer remains visible through paging and repaint '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const data=conversationFixture();data.agents[0].agentModel.observation.process='alive';
 const view=()=>humanProjection(data);let pages=0;
 await page.route('**/api/**',r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/history')){pages++;return r.fulfill({json:historyPage(view(),'s',u.searchParams.get('before'))});}if(u.pathname==='/api/direct')return r.fulfill({json:workspaceSnapshot(view(),JSON.parse(u.searchParams.get('ranges')||'{}'))});return r.fulfill({json:{providers:{}}});});
 await page.goto('/agents');const row=id=>page.locator('[data-entry]').filter({has:page.locator(`[data-disclosure="chat:${id}:input"]`)});
 const latest=row('r103');await expect(latest.locator('.message.assistant')).toContainText('秘書の回答 103');await expect(latest.locator('.message.assistant details')).toHaveCount(0);await expect(latest.locator('.message.internal pre')).toBeHidden();
 await latest.locator('.message.internal summary').click();await expect(latest.locator('.message.internal pre')).toHaveText('内部資料 103');await notifySnapshot(page);await expect(latest.locator('.message.internal details')).toHaveAttribute('open','');
 await latest.locator('.message.internal summary').click();
 const screenshot=name=>page.screenshot({path:process.env.LEADER_ANSWER_EVIDENCE?`${process.env.LEADER_ANSWER_EVIDENCE}/${name}-${width}.png`:info.outputPath(`${name}-${width}.png`)});
 await screenshot('conversation-current');await page.getByRole('button',{name:'古い会話を読み込む'}).click();await expect.poll(()=>pages).toBe(1);
 const old=row('r1');await old.scrollIntoViewIfNeeded();await expect(old.locator('.message.assistant')).toContainText('秘書の回答 1');await expect(old.locator('.message.assistant details')).toHaveCount(0);await expect(old.locator('.message.internal pre')).toBeHidden();await notifySnapshot(page);await expect(old.locator('.message.assistant details')).toHaveCount(0);await screenshot('conversation-history');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
