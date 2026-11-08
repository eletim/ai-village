import {test,expect} from '@playwright/test';
const state=()=>({agents:[{id:'a',name:'秘書',location:'mayor',provider:'codex',state:'busy',connection:{},modelInfo:{available:true,model:'gpt-fixture',serviceTier:'priority',recordedAt:new Date().toISOString()}}],projects:[],workshops:[],runs:[],reviews:{},notification:{enabled:false}});
test('profile records and weekly core-only usage; stale/reset and responsive sidebar remain clear',async({page})=>{
 const s=state(),now=Date.now();let usageCalls=0;
 await page.route('**/api/**',r=>{if(r.request().url().endsWith('/usage')){usageCalls++;return r.fulfill({json:{source:'core-purplemux-cache',providers:{codex:{available:true,usedPercent:27.5,resetsAt:now+3600000,cachedAt:now,stale:false},claude:{available:true,usedPercent:83,resetsAt:now-1000,cachedAt:now-3600000,stale:true}}}});}return r.fulfill({json:s});});
 await page.goto('/agents');await expect(page.locator('#weekly-usage')).toContainText('使用 27.5%');await expect(page.locator('#weekly-usage')).toContainText('古い記録 · 使用 83%');await expect(page.locator('#weekly-usage')).toContainText('コアPC');await expect(page.locator('#weekly-usage meter')).toHaveCount(2);
 await page.getByRole('button',{name:'秘書のプロフィール'}).click();await expect(page.locator('#agent-profile-dialog')).toContainText('gpt-fixture');await expect(page.locator('#agent-profile-dialog')).toContainText('priority');
 s.agents[0].modelInfo={available:true,model:'gpt-changed',serviceTier:null};await expect(page.locator('#agent-profile-dialog')).toContainText('gpt-changed');await expect(page.locator('#agent-profile-dialog')).toContainText('不明（記録なし）');expect(usageCalls).toBe(1);
 await page.screenshot({path:'/tmp/model-profile-desktop.png'});await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/model-usage-mobile.png'});
 await page.getByRole('button',{name:'サイドバーを閉じる'}).click();await expect(page.locator('#weekly-usage')).not.toBeVisible();await page.getByRole('button',{name:'サイドバーを開く'}).click();await expect(page.locator('#weekly-usage')).toBeVisible();
});
test('unavailable model/usage never shows zero or unlimited',async({page})=>{
 const s=state();s.agents[0].modelInfo={available:false};await page.route('**/api/**',r=>r.request().url().endsWith('/usage')?r.fulfill({status:503,json:{error:'private error'}}):r.fulfill({json:s}));await page.goto('/agents');await expect(page.locator('#weekly-usage')).toContainText('取得不能・不明');await expect(page.locator('#weekly-usage meter')).toHaveCount(0);await expect(page.locator('#weekly-usage')).not.toContainText('private error');await page.getByRole('button',{name:'秘書のプロフィール'}).click();await expect(page.locator('#agent-profile-dialog')).toContainText('取得不能・不明');
});
