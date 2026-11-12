import {test,expect} from '@playwright/test';
import sharp from 'sharp';
test('mobile composer explains oversize and uploads a real screenshot to the isolated server',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const state={capabilities:{attachments:true},agents:[{id:'a',name:'Agent',connection:{},state:'idle',canSend:true}],workshops:[],runs:[],notification:{}};let submitted;
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST'&&new URL(route.request().url()).pathname.endsWith('/runs')){submitted=route.request().postDataJSON();const run={id:'test-run',agentId:'a',state:'completed',createdAt:new Date().toISOString(),...submitted};state.runs.push(run);return route.fulfill({json:run});}
  return route.fulfill({json:state});
 });
 await page.goto('/agents');
 await page.locator('[data-file]').setInputFiles({name:'too-large.txt',mimeType:'text/plain',buffer:Buffer.alloc(40*1024*1024+1)});
 await expect(page.locator('.file-error')).toContainText('40 MiB');await expect(page.locator('.file-composer figure')).toHaveCount(0);
 const png=await sharp({create:{width:1220,height:2712,channels:3,background:'blue'}}).png().toBuffer();
 await page.locator('[data-image]').setInputFiles({name:'screen.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('.file-composer figure')).toHaveCount(1);
 await page.locator('[name=instruction]').press('Control+Enter');
 await expect.poll(()=>submitted?.attachments?.length).toBe(1);
 const response=await page.request.get('/api/images/'+submitted.attachments[0]);expect(response.ok()).toBe(true);
 expect((await sharp(await response.body()).metadata()).height).toBe(2712);
 await expect(page.locator('.file-composer figure')).toHaveCount(0);
 const bomb=await sharp({create:{width:5000,height:5000,channels:3,background:'red'}}).png().toBuffer();
 await page.locator('[data-image]').setInputFiles({name:'bomb.png',mimeType:'image/png',buffer:bomb});await page.locator('[name=instruction]').press('Control+Enter');
 await expect(page.locator('body')).toContainText('2400万画素');
});
