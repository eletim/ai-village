import { test, expect } from '@playwright/test';
import sharp from 'sharp';
const png=await sharp({create:{width:60,height:40,channels:3,background:'#286bdb'}}).png().toBuffer();
test('file and paste previews, cancel, image-only send, assistant display, reload and upload failures',async({page})=>{
  let messages=[];const snapshot=()=>({jobs:[],job:null,secretary:{status:'idle',messages}});
  await page.route('**/api/state',route=>route.fulfill({json:snapshot()}));
  await page.route('**/api/messages',async route=>{
    const body=route.request().postDataJSON();expect(body.message).toBe('');expect(body.attachments).toHaveLength(1);
    const image={id:body.attachments[0],name:'検証.png',width:60,height:40};messages=[{id:'user',role:'user',content:'',attachments:[image],at:new Date().toISOString()},{id:'reply',role:'assistant',content:'保存画像です',attachments:[image],at:new Date().toISOString()}];await route.fulfill({status:202,json:snapshot()});
  });
  await page.goto('/office');await expect(page.locator('#send')).toBeEnabled();
  await page.locator('#image-picker').setInputFiles({name:'検証.png',mimeType:'image/png',buffer:png});await expect(page.locator('#attachment-preview img')).toHaveCount(1);
  await page.locator('[data-remove]').click();await expect(page.locator('#attachment-preview img')).toHaveCount(0);
  await page.locator('#request').evaluate((element,base64)=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'paste.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},png.toString('base64'));
  await expect(page.locator('#attachment-preview img')).toHaveCount(1);await page.locator('#send').click();await expect(page.locator('.chat-images img')).toHaveCount(2);await expect(page.locator('#attachment-preview img')).toHaveCount(0);
  await page.reload();await expect(page.locator('.chat-images img')).toHaveCount(2);await expect.poll(()=>page.locator('.chat-user img').evaluate(img=>img.naturalWidth)).toBe(60);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#image-picker').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not PNG')});await page.locator('#send').click();await expect(page.locator('#office-notice')).toContainText('画像を読み込めません');await expect(page.locator('#attachment-preview img')).toHaveCount(1);await expect(page.locator('#send')).toBeEnabled();
});
test('image HTTP boundary rejects invalid payloads, oversized uploads and forged image paths',async({request})=>{
  expect((await request.post('/api/images',{headers:{'Content-Type':'image/svg+xml'},data:'<svg/>'})).status()).toBe(415);
  expect((await request.post('/api/images',{headers:{'Content-Type':'image/png'},data:'not PNG'})).status()).toBe(400);
  expect((await request.post('/api/images',{headers:{'Content-Type':'image/png',Origin:'http://other.test'},data:png})).status()).toBe(403);
  expect((await request.post('/api/images',{headers:{'Content-Type':'image/png'},data:Buffer.alloc(8*1024*1024+1)})).status()).toBe(413);
  expect((await request.post('/api/messages',{data:{message:'',attachments:['../../private']}})).status()).toBe(400);
  expect((await request.get('/api/images/00000000-0000-4000-8000-000000000000')).status()).toBe(404);
});
