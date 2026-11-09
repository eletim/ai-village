import {test,expect} from '@playwright/test';
test('project opening defaults to secretary, preserves manual split, and saves split preference',async({page})=>{
 const s={projects:[{id:'p',name:'Project P'},{id:'q',name:'Project Q'}],agents:[{id:'s',name:'Secretary',role:'secretary',location:'mayor',projectId:'p'},{id:'w',name:'Worker',role:'worker',location:'workshop',projectId:'p'},{id:'q',name:'Only worker',role:'worker',location:'workshop',projectId:'q'}].map(a=>({...a,state:'idle',connection:{},canSend:true,nativeTurns:[]})),workshops:[],runs:[],reviews:{},notification:{enabled:false}};
 await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/direct'?s:{ok:true,result:{enabled:false}}}));
 await page.goto('/agents');const visible=page.locator('.agent-panel:visible');await expect(visible).toHaveCount(3);
 await page.locator('[data-place="project:p"]').click();await expect(visible).toHaveCount(1);await expect(visible).toHaveAttribute('id','agent-s');
 await page.locator('#agent-s [data-zoom]').click();await expect(visible).toHaveCount(2);await page.waitForTimeout(2200);await expect(visible).toHaveCount(2);
 await page.reload();await expect(visible).toHaveCount(1);await expect(visible).toHaveAttribute('id','agent-s');
 await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.getByLabel('Projectを開いたとき')).toHaveValue('secretary');await page.getByLabel('Projectを開いたとき').selectOption('split');await page.locator('#manage-dialog [data-close]').click();
 await page.locator('[data-place="project:q"]').click();await expect(visible).toHaveCount(1);await expect(visible).toHaveAttribute('id','agent-q');
 await page.locator('[data-place="project:p"]').click();await expect(visible).toHaveCount(2);await page.reload();await expect(visible).toHaveCount(2);
 await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByLabel('Projectを開いたとき').selectOption('secretary');await page.locator('#manage-dialog [data-close]').click();await page.locator('[data-place="project:q"]').click();await expect(visible).toHaveAttribute('id','agent-q');
 await page.setViewportSize({width:390,height:844});await page.locator('[data-place="project:p"]').click();await expect(visible).toHaveAttribute('id','agent-s');
});
