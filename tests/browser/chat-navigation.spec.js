import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import {humanProjection} from '../../server/report-view.mjs';
import {agentFixture,runFixture,requestFixture} from './helpers/direct-fixtures.js';
function fixture(){
 const agents=['a','b'].map((id,i)=>agentFixture({id,name:i?'工房':'秘書',location:i?'workshop':'mayor',projectId:'p',projectName:'村実装',workshopId:'w',canSend:true,connection:{},nativeTurns:[]}));
 const runs=[runFixture({id:'h',agentId:'a',humanRequestId:'q',workId:'root',origin:'human',instruction:'人間の依頼',output:'受付',createdAt:'2026-01-01'}),runFixture({id:'d',agentId:'b',humanRequestId:'q',workId:'child',origin:'delegation',instruction:'実装指示',output:'実装結果',finalOutput:'実装結果',createdAt:'2026-01-02'}),runFixture({id:'r',agentId:'a',humanRequestId:'q',workId:'root',origin:'result',instruction:'工房からの結果',output:'レビュー中',createdAt:'2026-01-03'}),runFixture({id:'r2',agentId:'a',humanRequestId:'q',workId:'root',origin:'continuation',instruction:'再レビュー',output:'追加の確認',createdAt:'2026-01-04'})];
 const q=requestFixture({id:'q',reportMode:true,instruction:'人間の依頼',works:[{id:'root',agentId:'a',currentRunId:'r2'},{id:'child',parentWorkId:'root',agentId:'b',currentRunId:'d'}]},runs);
 return {agents,runs,requests:[q],workshops:[{id:'w',name:'工房',connectionType:'local'}],projects:[{id:'p',name:'村実装'}],reviews:{},notification:{enabled:false}};
}
for(const width of [1440,390])test(`chat shells stay visible and bodies fold independently at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1050});
 const raw=fixture(),focusRequests=[];
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/direct'){
   const focus=JSON.parse(url.searchParams.get('focus')||'[]');focusRequests.push(focus);
   return route.fulfill({json:workspaceSnapshot(humanProjection(raw),{},focus)});
  }
  return route.fulfill({json:{ok:true,result:{enabled:false}}});
 });
 await page.goto('/agents#project-p');
 // Start zoomed before any worker body has been loaded by navigating to the project.
 await page.locator('[data-place="project:p"]').click();
 await expect(page.locator('#agent-a')).toBeVisible();
 if(!await page.locator('#next-agent').isVisible())await page.locator('#agent-a [data-zoom]').click();
 const log=page.locator('#agent-a .runs');
 await expect(log.getByText('人間の依頼',{exact:true})).toBeVisible();
 await expect(log.locator('details.run-group')).toHaveCount(0);
 await expect(log.locator('.message.internal')).toHaveCount(2);
 await expect(log.locator('.message.internal').first()).toBeVisible();
 await expect(log.getByText('工房からの結果',{exact:true})).not.toBeVisible();
 const first=log.locator('.message.internal details.chat-body').first(),second=log.locator('.message.internal details.chat-body').nth(1);
 const answer=first.locator('xpath=ancestor::div[contains(@class,"run")][1]').locator('.message.assistant');
 await expect(answer).toBeVisible();
 await expect(answer.getByText('レビュー中',{exact:true})).not.toBeVisible();
 await first.locator('summary').click();
 await expect(first.locator('.message.user')).toHaveCount(0);
 await expect(log.locator('.message.internal').first()).toContainText('…（成果の受け取り・レビュー）');
 await expect(second).not.toHaveAttribute('open','');
 await notifySnapshot(page);await expect(first).toHaveAttribute('open','');await expect(second).not.toHaveAttribute('open','');
 const before=focusRequests.length;
 await page.locator('#next-agent').click();
 await expect(page.locator('#agent-b')).toBeVisible();
 await expect(page.locator('#agent-b .runs')).not.toContainText('会話を読み込み中');
 await expect.poll(()=>focusRequests.slice(before).some(ids=>ids.includes('b'))).toBe(true);
 const child=page.locator('#agent-b .runs');
 await expect(child.locator('details.run-group')).toHaveCount(0);
 await expect(child.locator('.message.internal')).toBeVisible();
 await expect(child.locator('.message.assistant')).toBeVisible();
 await expect(child.getByText('実装結果',{exact:true})).not.toBeVisible();
 await expect(child.locator('.chat-author')).toHaveCount(0);
 await expect(child.locator('.message.assistant > details > summary')).toHaveText('…（成果提出（秘書宛））');
 const input=child.locator('.message.internal'),output=child.locator('.message.assistant');
 const align=await child.evaluate(el=>{const i=el.querySelector('.message.internal').getBoundingClientRect(),o=el.querySelector('.message.assistant').getBoundingClientRect();return i.right>o.right&&i.left>o.left;});
 expect(align).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/village-chat-shell-'+width+'.png'});
 await input.locator('summary').click();
 await expect(output.locator('details')).not.toHaveAttribute('open','');
 await output.locator('summary').click();
 await expect(child.getByText('実装結果',{exact:true})).toBeVisible();
 await expect(child.locator('.message.user')).toHaveCount(0);
 await expect(child).toContainText('…（作業依頼（秘書から））');
 await expect(child).toContainText('成果提出（秘書宛）');await expect(child).not.toContainText('最終報告');
 await page.locator('#next-agent').click();await expect(first).toHaveAttribute('open','');
});
