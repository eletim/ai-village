import {test,expect} from '@playwright/test';
for(const width of [1440,390])test(`sidebar toggle keeps draft and scope, grows board, persists at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.route('**/api/**',r=>r.fulfill({json:{workshops:[],projects:[{id:'p',name:'作業'}],agents:[{id:'a',name:'秘書',projectId:'p',location:'mayor',state:'idle',canSend:true,connection:{}}],runs:[],reviews:{},notification:{enabled:false}}}));
 await page.goto('/agents');await page.locator('[data-place="project:p"]').click();
 const input=page.locator('textarea[name=instruction]');await input.fill('書きかけの指示');
 const before=(await page.locator('#agents').boundingBox()).width;
 const toggle=page.locator('#sidebar-toggle');await toggle.focus();await page.keyboard.press('Enter');
 await expect(page.locator('.sidebar')).toBeHidden();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
 expect((await page.locator('#agents').boundingBox()).width).toBeGreaterThan(before+90);await expect(input).toHaveValue('書きかけの指示');await expect(page.locator('#board-title')).toContainText('作業');
 await page.reload();await expect(page.locator('.sidebar')).toBeHidden();await expect(input).toHaveValue('書きかけの指示');
 await page.screenshot({path:`/tmp/village-sidebar-closed-${width}.png`});
 await page.getByRole('button',{name:'サイドバーを開く',exact:true}).click();await expect(page.locator('.sidebar')).toBeVisible();await expect(page.locator('#board-title')).toContainText('作業');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.reload();await expect(page.locator('.sidebar')).toBeVisible();
});
