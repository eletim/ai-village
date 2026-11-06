import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const bytes=await readFile(new URL('../fixtures/attachment.docx',import.meta.url));
for(const mode of ['direct','office'])test(`${mode}: DOCX selection, draft restore, real upload and inert exact download`,async({page,request})=>{
 const state={capabilities:{attachments:true,steering:true},agents:[{id:'a',name:'Agent',connection:{},state:'busy',canSteer:true,steerTarget:{runId:'r',sessionId:'s',turnId:'t'}}],workshops:[],runs:[],notification:{}};
 const office={jobs:[],workshops:[],secretary:{status:'idle',capabilities:{attachments:true},messages:[]}};let record,submitted;
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;
  if(p==='/api/attachments'&&route.request().method()==='POST'){expect(route.request().postDataBuffer()).toEqual(bytes);const response=await route.fetch();expect(response.status()).toBe(201);record=await response.json();return route.fulfill({response});}
  if(p.startsWith('/api/attachments/'))return route.continue();
  if(route.request().method()==='POST'&&(p.endsWith('/runs')||p==='/api/messages')){submitted=route.request().postDataJSON();expect(submitted.attachments).toEqual([record.id]);if(mode==='direct'){expect(submitted.steerTarget).toEqual(state.agents[0].steerTarget);state.runs.push({id:'docx-run',agentId:'a',...submitted,attachments:[record],state:'running'});return route.fulfill({json:state.runs[0]});}office.secretary.messages.push({id:'docx-message',role:'user',content:submitted.message,attachments:[record],at:new Date().toISOString()});}
  return route.fulfill({json:p==='/api/direct'?state:p==='/api/todos'?{items:[]}:office});
 });
 await page.goto(mode==='direct'?'/agents':'/office');await page.getByRole('button',{name:'添付を追加',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'ファイルを追加',exact:true}).click();await (await chooser).setFiles({name:'報告.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:bytes});expect((await page.locator('[data-file]').getAttribute('accept')).split(',')).toContain('.docx');await expect(page.locator('.file-composer')).toContainText('報告.docx');await expect(page.locator('.file-composer img')).toHaveCount(0);await page.reload();await expect(page.locator('.file-composer')).toContainText('報告.docx');
 await page.locator(mode==='direct'?'[name=instruction]':'#request').press('Control+Enter');await expect.poll(()=>submitted?.attachments?.length).toBe(1);await expect(page.locator('.file-composer figure')).toHaveCount(0);await expect(page.locator('a[download]').filter({hasText:'報告.docx'})).toBeVisible();
 expect(record.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(record.size).toBe(bytes.length);expect(record.kind).toBe('file');const download=await request.get('/api/attachments/'+record.id);expect(await download.body()).toEqual(bytes);expect(download.headers()['content-type']).toBe('application/octet-stream');expect(download.headers()['content-disposition']).toContain('attachment;');expect(download.headers()['x-content-type-options']).toBe('nosniff');
});
