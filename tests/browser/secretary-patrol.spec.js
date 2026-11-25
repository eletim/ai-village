import {test,expect} from './helpers/change-events.js';
import {conversationFixture} from '../helpers/conversation-answer-fixture.mjs';
import {humanProjection} from '../../server/report-view.mjs';
import {workspaceSnapshot,historyPage} from '../../server/conversation-pages.mjs';
import {PATROL_GUIDANCE} from '../../server/conversation-patrol.mjs';
// A patrol turn (docs/secretary-supervisor.md) is folded and labelled; only an explicit reply opens it.
for(const width of [1440,390])test('patrol turns are folded and labelled; an explicit reply is shown '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});const data=conversationFixture();data.agents[0].agentModel.observation.process='alive';
 Object.assign(data.runs[103],{conversationSource:{kind:'program',patrol:true},instruction:PATROL_GUIDANCE+'\n{"patrol":1,"jobs":[]}',output:'進捗を確認しました。問題ありません。',finalOutput:'進捗を確認しました。問題ありません。'});
 Object.assign(data.runs[104],{conversationSource:{kind:'program',patrol:true},instruction:PATROL_GUIDANCE+'\n{"patrol":2,"jobs":[]}',output:'リーダーが止まったため立て直しました。',finalOutput:'リーダーが止まったため立て直しました。',conversationDisplay:{mode:'reply',version:1}});
 const view=()=>humanProjection(data);
 await page.route('**/api/**',r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/history'))return r.fulfill({json:historyPage(view(),'s',u.searchParams.get('before'))});if(u.pathname==='/api/direct')return r.fulfill({json:workspaceSnapshot(view(),JSON.parse(u.searchParams.get('ranges')||'{}'))});return r.fulfill({json:{providers:{}}});});
 await page.goto('/agents');
 const quiet=page.locator('[data-entry]').filter({has:page.locator('[data-disclosure="chat:r103:input"]')});
 await expect(quiet.locator('[data-disclosure="chat:r103:input"] > summary')).toContainText('見回り（定期確認）');
 await expect(quiet.locator('.message.user')).toHaveCount(0);
 await expect(quiet.locator('[data-disclosure="chat:r103:output"]')).not.toHaveAttribute('open','');
 await expect(quiet.getByText('進捗を確認しました。問題ありません。')).toBeHidden();
 const reply=page.locator('[data-entry]').filter({has:page.locator('[data-disclosure="chat:r104:input"]')});
 await expect(reply.getByText('リーダーが止まったため立て直しました。')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
