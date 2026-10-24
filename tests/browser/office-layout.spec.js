import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const shots=new URL('../../../verification/',import.meta.url).pathname;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
async function fixture(page) {
 const state={jobs:[{id:'11111111-1111-4111-8111-111111111111',phase:'awaiting_review',releaseState:'held',request:'執務室の確認',report:'村の仕事を確かめる報告です。\n'.repeat(100),artifacts:[]}],workshops:[],secretary:{status:'idle',messages:Array.from({length:30},(_,i)=>({id:`layout-${i}`,role:i%2?'assistant':'user',at:'2026-10-24T00:00:00Z',content:`会話 ${i}：村の資料と仕事について相談します。\n`.repeat(3)}))}};
 await page.route('**/api/state',r=>r.fulfill({json:state}));
 await page.route('**/api/secretary/memo',r=>r.fulfill({json:{memo:{updatedAt:'2026-10-24T00:00:00Z',value:{topic:'執務室を整える',purpose:'会話と資料を並べて読む',decisions:'メモは選択した時だけ表示',unfinished:'村長の確認',references:'村長発言4246dae7-3a52-4a11-b24f-d0f9eb26b183'}}}}));
 return state;
}
const top=locator=>locator.evaluate(el=>el.scrollTop);
test('desktop split preserves chat, attachments and independent scroll across every panel and delayed document response',async({page})=>{
 await fixture(page);await page.goto('/office');await expect(page.locator('.chat-message')).toHaveCount(30);
 const chat=page.locator('.office-conversation'),log=page.locator('#conversation-log'),reports=page.locator('.office-inbox');
 await expect(chat).toBeVisible();await expect(reports).toBeVisible();await expect(page.locator('.memo-panel')).toBeHidden();await expect(page.locator('.todo-panel')).toBeHidden();
 const a=await chat.boundingBox(),b=await reports.boundingBox();expect(a.x+a.width).toBeLessThan(b.x);expect(a.width/b.width).toBeGreaterThan(.95);expect(a.width/b.width).toBeLessThan(1.05);
 await page.locator('#request').fill('切替えても残す下書き');await page.locator('#image-picker').setInputFiles({name:'draft.png',mimeType:'image/png',buffer:png});
 await log.evaluate(el=>el.scrollTop=180);const anchor=await top(log);await reports.evaluate(el=>el.scrollTop=250);expect(await top(log)).toBe(anchor);
 await log.evaluate(el=>el.scrollTop+=100);expect(await top(reports)).toBe(250);const kept=await top(log);
 for(const name of ['memo','todos','documents','reports']) {
  await page.locator(`#open-${name}`).click();await expect(chat).toBeVisible();await expect(page.locator('#request')).toHaveValue('切替えても残す下書き');await expect(page.locator('#attachment-preview img')).toHaveCount(1);expect(await top(log)).toBe(kept);await expect(page.locator('#send')).toBeInViewport();
  await expect(page.locator(`#open-${name}`)).toHaveAttribute('aria-pressed','true');
  const controlled=await page.locator(`#open-${name}`).getAttribute('aria-controls');await expect(page.locator(`#${controlled}`)).toHaveAttribute('aria-hidden','false');
 }
 expect(await top(reports)).toBe(250);
 await page.locator('#open-documents').click();await expect(page.locator('#document-content')).not.toBeEmpty();await page.locator('#close-library').click();await expect(reports).toBeVisible();await expect(page.locator('#open-documents')).toBeFocused();expect(await top(log)).toBe(kept);
 let release;const gate=new Promise(r=>release=r);await page.route('**/api/documents/content?**',async r=>{await gate;await r.fulfill({json:{path:'README.md',content:'遅れて届いた資料'}});});
 await page.locator('#open-documents').click();await page.locator('#open-memo').click();release();await expect(page.locator('#document-content')).toHaveText('遅れて届いた資料');await expect(page.locator('#village-library')).toBeHidden();
 await page.waitForTimeout(1700);await expect(page.locator('.memo-panel')).toBeVisible();await expect(page.locator('.todo-panel')).toBeHidden();
 await page.locator('#open-conversation').focus();await page.keyboard.press('Enter');await expect(page.locator('#request')).toBeFocused();await expect(page.locator('.memo-panel')).toBeVisible();
 for(const width of [800,1024,1920]) {
  await page.setViewportSize({width,height:768});await expect(chat).toBeVisible();await expect(page.locator('#send')).toBeInViewport();const left=await chat.boundingBox(),right=await page.locator('.office-panels').boundingBox();expect(left.x+left.width).toBeLessThan(right.x);expect(Math.abs(left.width-right.width)).toBeLessThan(2);
 }
 await page.reload();await expect(reports).toBeVisible();await expect(page.locator('.memo-panel')).toBeHidden();await expect(page.locator('.todo-panel')).toBeHidden();
});
test('mobile switches, resize focus, hidden unread replies and keyboard-height composer',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.goto('/office');await expect(page.locator('.chat-message')).toHaveCount(30);
 await expect(page.locator('.office-conversation')).toBeVisible();await expect(page.locator('.office-panels')).toBeHidden();
 await page.locator('#request').fill('幅変更でも保持');await page.locator('#image-picker').setInputFiles({name:'mobile-draft.png',mimeType:'image/png',buffer:png});await page.locator('#conversation-log').evaluate(el=>el.scrollTop=170);const anchor=await top(page.locator('#conversation-log'));
 for(const name of ['reports','documents','memo','todos']) {
  await page.locator(`#open-${name}`).click();await expect(page.locator('.office-conversation')).toBeHidden();await expect(page.locator(`#open-${name}`)).toHaveAttribute('aria-pressed','true');
  const controlled=await page.locator(`#open-${name}`).getAttribute('aria-controls');await expect(page.locator(`#${controlled}`)).toHaveAttribute('aria-hidden','false');
 }
 state.secretary.messages.push({id:'hidden-new',role:'assistant',content:'非表示中の新着',at:'2026-10-24T00:00:00Z'});
 await expect(page.locator('link[rel=icon]')).toHaveAttribute('data-unread','true');
 await page.setViewportSize({width:1440,height:900});await expect(page.locator('.office-conversation')).toBeVisible();await expect(page.locator('.todo-panel')).toBeVisible();
 await page.locator('#request').focus();await page.setViewportSize({width:390,height:844});await expect(page.locator('#open-todos')).toBeFocused();
 await page.locator('#open-conversation').click();await expect(page.locator('#request')).toHaveValue('幅変更でも保持');await expect(page.locator('#attachment-preview img')).toHaveCount(1);await page.locator('[data-remove]').click();expect(await top(page.locator('#conversation-log'))).toBe(anchor);
 await page.locator('#conversation-log').evaluate(el=>el.scrollTop=el.scrollHeight);await expect(page.locator('link[rel=icon]')).toHaveAttribute('data-unread','false');
 await page.setViewportSize({width:390,height:360});await expect(page.locator('#request')).toBeInViewport();await expect(page.locator('#attach-image')).toBeInViewport();await expect(page.locator('#send')).toBeInViewport();
 expect(await page.locator('#conversation-log').evaluate(el=>el.clientHeight)).toBeGreaterThan(20);
 await page.reload();await expect(page.locator('.office-conversation')).toBeVisible();await expect(page.locator('.memo-panel')).toBeHidden();await expect(page.locator('.todo-panel')).toBeHidden();
});
test('reviewable desktop and mobile light/dark images of all panels',async({page})=>{
 await mkdir(shots,{recursive:true});await fixture(page);await page.goto('/office');await expect(page.locator('.chat-message')).toHaveCount(30);
 for(const [device,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
  await page.setViewportSize({width,height});
  for(const theme of ['light','dark']) {
   await page.getByLabel('配色',{exact:true}).selectOption(theme);
   for(const name of ['conversation','reports','documents','memo','todos']) {
    await page.locator(`#open-${name}`).click();if(name==='documents')await expect(page.locator('#document-content')).not.toBeEmpty();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({animations:'disabled',path:shots+`study-${device}-${theme}-${name}.png`});
   }
  }
 }
});

test('conversation report link opens and scrolls only the matching report on desktop and mobile',async({page})=>{
 const state=await fixture(page),id='22222222-2222-4222-8222-222222222222';
 state.jobs.push({...state.jobs[0],id,request:'対応する二つ目の報告',report:'この報告へ移動',artifacts:[]});state.secretary.messages.at(-1).jobId=id;
 await page.goto('/office');await expect(page.locator('.chat-report-link')).toBeVisible();await page.locator('#open-memo').click();
 const log=page.locator('#conversation-log'),anchor=await top(log);await page.locator('.chat-report-link').click();
 await expect(page.locator(`[data-report="${id}"] h3`)).toBeInViewport();expect(await top(log)).toBe(anchor);await expect(page.locator('#send')).toBeInViewport();
 await page.setViewportSize({width:390,height:844});await page.locator('#open-conversation').click();await page.locator('.chat-report-link').click();
 await expect(page.locator(`[data-report="${id}"] h3`)).toBeInViewport();await expect(page.locator('.office-conversation')).toBeHidden();await expect(page.locator('#open-reports')).toHaveAttribute('aria-pressed','true');
 await page.route('**/approve',r=>r.fulfill({status:503,json:{error:'接続失敗の検証'}}));await page.locator(`[data-report="${id}"] [data-approve]`).check();await expect(page.locator('#report-notice')).toBeInViewport();await expect(page.locator('#report-notice')).toHaveText('接続失敗の検証');
});
