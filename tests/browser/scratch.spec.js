import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const runtime=process.env.VILLAGE_SCRATCH_RUNTIME;
test('scratch document download remains inert and local links render safely',async({page,request})=>{
 const operation=async argv=>(await(await request.post('/api/village',{data:{argv}})).json());
 expect((await operation(['work','write','notes.html','<script>window.pwned=true</script>資料'])).ok).toBe(true);
 const published=await operation(['work','publish','notes.html']);expect(published.ok).toBe(true);
 const file=await request.get(published.result.url);expect(file.headers()['content-type']).toBe('application/octet-stream');expect(file.headers()['content-disposition']).toMatch(/^attachment/);expect(file.headers()['content-security-policy']).toContain('sandbox');
 expect((await operation(['work','write','../outside','x'])).ok).toBe(false);
 expect((await request.get(published.result.url,{headers:{Origin:'http://other.test'}})).status()).toBe(403);
 await page.route('**/api/state',route=>route.fulfill({json:{jobs:[],job:null,secretary:{status:'idle',messages:[{id:'doc',role:'assistant',content:`[調査メモ](${published.result.url}) <script>window.pwned=true</script> [外部](https://example.com)`,at:new Date().toISOString()}]}}}));
 await page.goto('/office');await expect(page.locator('.chat-assistant a')).toHaveCount(1);await expect(page.locator('.chat-assistant a')).toHaveAttribute('download','');expect(await page.evaluate(()=>window.pwned)).toBeUndefined();
});
test('real sandbox produces Japanese PNG for conversation image display',async({page,request})=>{
 test.skip(!runtime && !process.env.VILLAGE_SCRATCH_REQUIRED,'VILLAGE_SCRATCH_RUNTIME required for real sandbox');
 const operation=async argv=>(await(await request.post('/api/village',{data:{argv}})).json());
 const result=await operation(['work','run',randomUUID(),"from PIL import Image,ImageDraw,ImageFont\nim=Image.new('RGB',(800,150),'white')\nImageDraw.Draw(im).text((20,50),'村長 → ミク → 成果統合',font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',30),fill='black')\nim.save('ui-diagram.png')"]);expect(result.result.state).toBe('succeeded');
 const image=(await operation(['work','publish','ui-diagram.png'])).result;
 await page.route('**/api/state',route=>route.fulfill({json:{jobs:[],job:null,secretary:{status:'idle',messages:[{id:'png',role:'assistant',content:'日本語構想図',attachments:[image],at:new Date().toISOString()}]}}}));
 await page.goto('/office');await expect(page.locator('.chat-assistant img')).toHaveCount(1);await expect.poll(()=>page.locator('.chat-assistant img').evaluate(img=>img.naturalWidth)).toBe(800);
 await page.reload();await expect.poll(()=>page.locator('.chat-assistant img').evaluate(img=>img.naturalWidth)).toBe(800);
});
