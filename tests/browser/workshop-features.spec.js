import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const shots=new URL('../../../verification/',import.meta.url).pathname;
test('TODO is shared by independent browsers, survives reload, handles edit conflict without starting work',async({page,browser,request})=>{
 const context=await browser.newContext(),other=await context.newPage();
 await page.goto('/office');await other.goto('/office');
 const original=await (await request.get('/api/state')).json();
 await page.getByLabel('TODOの内容').fill('端末間共有');await page.getByRole('button',{name:'TODOを追加',exact:true}).click();
 const row=page.locator('#todo-list li').filter({hasText:'端末間共有'}),remote=other.locator('#todo-list li').filter({hasText:'端末間共有'});
 await expect(remote).toBeVisible();await row.getByRole('button',{name:'編集',exact:true}).click();
 await remote.getByRole('checkbox').check();await expect(row.getByRole('checkbox')).toBeChecked();
 await page.getByLabel('TODOの内容').fill('競合しても入力保持');await page.getByRole('button',{name:'変更を保存'}).click();
 await expect(page.locator('#todo-notice')).toContainText('別の端末');await expect(page.getByLabel('TODOの内容')).toHaveValue('競合しても入力保持');
 await row.getByRole('button',{name:'編集',exact:true}).click();await page.getByLabel('TODOの内容').fill('更新済み');await page.getByRole('button',{name:'変更を保存'}).click();
 await other.reload();await expect(other.locator('#todo-list')).toContainText('更新済み');
 await other.locator('#todo-list li').filter({hasText:'更新済み'}).getByRole('checkbox').uncheck();
 await expect(page.locator('#todo-list li').filter({hasText:'更新済み'}).getByRole('checkbox')).not.toBeChecked();
 await page.locator('#todo-list li').filter({hasText:'更新済み'}).getByRole('button',{name:'削除'}).click();await expect(other.locator('#todo-list')).not.toContainText('更新済み');
 expect((await (await request.get('/api/state')).json()).jobs).toEqual(original.jobs);await context.close();
});
test('resident secretary follows actual status and survives released workshop agents',async({page})=>{
 let state={jobs:[],workshops:[],secretary:{status:'idle',messages:[]}};
 await page.route('**/api/state',route=>route.fulfill({json:state}));await page.goto('/');
 const miku=page.locator('.resident-secretary');await expect(miku).toHaveAttribute('aria-label','ミク・待機中');await expect(page.locator('#legend')).toContainText('工房配置Agent 0人');
 state.secretary.status='thinking';await expect(miku).toHaveAttribute('aria-label','ミク・応答中');await expect(miku).not.toHaveClass(/hammering/);
 state.jobs=[{id:'released',tabId:'test',releaseState:'released',phase:'awaiting_review'}];state.secretary.status='idle';await expect(miku).toHaveAttribute('aria-label','ミク・待機中');
 await miku.click();await expect(page).toHaveURL(/\/office$/);await expect(page.locator('#room-secretary')).toContainText('待機中');
});
test('favicon baselines history, retains unread on village/reload and hidden tabs, clears only visible replies',async({page})=>{
 let state={jobs:[],workshops:[],secretary:{status:'idle',messages:[{id:'old',role:'assistant',content:'過去の履歴',at:new Date().toISOString()}]}};
 await page.route('**/api/state',route=>route.fulfill({json:state}));await page.goto('/');const icon=page.locator('link[rel=icon]');await expect(icon).toHaveAttribute('data-unread','false');
 state.secretary.messages.push({id:'new',role:'assistant',content:'新しい報告',at:new Date().toISOString()});await expect(icon).toHaveAttribute('data-unread','true');await page.reload();await expect(icon).toHaveAttribute('data-unread','true');
 await page.locator('.resident-secretary').click();await page.locator('#conversation-log').scrollIntoViewIfNeeded();await expect(icon).toHaveAttribute('data-unread','false');
 // Explicit visibility simulation avoids headless Chrome's platform-dependent tab focus policy.
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 state.secretary.messages.push({id:'hidden',role:'assistant',content:'非表示中の返信',at:new Date().toISOString()});await expect(icon).toHaveAttribute('data-unread','true');
 await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await page.locator('#conversation-log').scrollIntoViewIfNeeded();await expect(icon).toHaveAttribute('data-unread','false');
 await page.waitForTimeout(1700);await expect(icon).toHaveAttribute('data-unread','false');await page.reload();await expect(icon).toHaveAttribute('data-unread','false');
});
test('theme persistence, system changes, desktop/mobile/landscape and keyboard-sized viewport',async({page})=>{
 await mkdir(shots,{recursive:true});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 for(const [device,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  for(const theme of ['light','dark']){
   await page.getByLabel('配色',{exact:true}).selectOption(theme);
   for(const path of ['/','/office']){
    await page.goto(path);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await expect(page.locator('.resident-secretary')).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.waitForTimeout(400);await page.screenshot({path:shots+`${device}-${theme}-${path==='/'?'village':'office'}.png`,fullPage:true});
   }
  }
 }
 for(const [width,height] of [[320,568],[844,390],[390,360]]){
  await page.setViewportSize({width,height});await page.goto('/office');await page.getByLabel('秘書へのメッセージ').fill('キーボード表示を想定した入力');await page.locator('#send').scrollIntoViewIfNeeded();await expect(page.locator('#send')).toBeInViewport();await expect(page.locator('#attach-image')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
test('TODO save failure preserves draft and reports failure',async({page})=>{
 await page.goto('/office');await expect(page.locator('#todo-save')).toBeEnabled();
 await page.route('**/api/todos',route=>route.request().method()==='POST'?route.fulfill({status:500,json:{error:'保存失敗の検証'}}):route.continue());
 await page.getByLabel('TODOの内容').fill('失敗しても残る入力');await page.locator('#todo-save').click();await expect(page.locator('#todo-notice')).toContainText('保存失敗');await expect(page.getByLabel('TODOの内容')).toHaveValue('失敗しても残る入力');
});
test('mobile touch, long reply, documents and image attachment stay usable in dark mode',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'dark'}),page=await context.newPage();
 await page.route('**/api/state',route=>route.fulfill({json:{jobs:[],workshops:[],secretary:{status:'idle',messages:[{id:'long',role:'assistant',at:new Date().toISOString(),content:'長い会話でも末尾へスクロールできます。\n'.repeat(120)}]}}}));
 await page.goto('/');await page.locator('.resident-secretary').tap();await expect(page.locator('#office-page')).toBeVisible();
 await page.locator('#conversation-log').scrollIntoViewIfNeeded();await page.locator('#conversation-log').evaluate(el=>el.scrollTop=el.scrollHeight);expect(await page.locator('#conversation-log').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<2)).toBe(true);
 await page.locator('#image-picker').setInputFiles({name:'mobile.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64')});await expect(page.locator('.attachment-preview img')).toBeVisible();
 await page.locator('#open-documents').tap();await expect(page.locator('#document-content')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:shots+'mobile-dark-documents-conversation.png',fullPage:true});await context.close();
});
