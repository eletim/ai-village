import {test,expect} from '@playwright/test';
const bottom=locator=>locator.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<3);
for(const mode of ['direct','office'])test(`${mode} attachment-only sends keep draft and request identity; history follows only near bottom`,async({page})=>{
 const stamp=()=>new Date().toISOString(),files=[],sends=[];const state={capabilities:{attachments:true},agents:[{id:'a',name:'Agent',connection:{},state:'idle',canSend:true}],workshops:[],runs:Array.from({length:20},(_,i)=>({id:'r'+i,agentId:'a',instruction:'past '+i,output:'line\n'.repeat(8),state:'completed',createdAt:stamp()})),notification:{}};
 const office={workshops:[],jobs:[],secretary:{status:'idle',capabilities:{attachments:true},messages:state.runs.map(r=>({id:r.id,role:'assistant',content:r.output,at:r.createdAt}))}};
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;
 if(p==='/api/attachments'&&route.request().method()==='POST'){const file={id:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(files.length).padStart(12,'0'),kind:'file',name:'data.csv',size:4};files.push(file);return route.fulfill({status:201,json:file});}
 if(route.request().method()==='POST'&&(p.endsWith('/runs')||p==='/api/messages')){const body=route.request().postDataJSON();sends.push(body);if(sends.length===1)return route.abort();if(mode==='direct'){state.runs.push({id:'new',agentId:'a',...body,attachments:files,state:'running',createdAt:stamp()});return route.fulfill({json:state.runs.at(-1)});}office.secretary.messages.push({id:'new',role:'user',content:body.message,attachments:files,at:stamp()});}
 return route.fulfill({json:p==='/api/direct'?state:p==='/api/todos'?{items:[]}:office});});
 await page.goto(mode==='direct'?'/agents':'/office');const log=page.locator(mode==='direct'?'.runs':'#conversation-log');await expect.poll(()=>bottom(log)).toBe(true);
 await log.evaluate(el=>el.scrollTop=100);await page.waitForTimeout(100);await expect(page.locator('.latest-message')).toBeVisible();if(mode==='direct')state.runs.at(-1).output+='new content\n'.repeat(20);else office.secretary.messages.at(-1).content+='new content\n'.repeat(20);
 await expect(log).toContainText('new content');const latest=page.locator('.latest-message');await expect(latest).toBeVisible();expect(await log.evaluate(el=>el.scrollTop)).toBe(100);await latest.click();await expect.poll(()=>bottom(log)).toBe(true);
 await page.getByRole('button',{name:'添付を追加',exact:true}).click();await expect(page.getByRole('button',{name:'ファイルを追加',exact:true})).toBeVisible();await page.locator('[data-file]').setInputFiles({name:'data.csv',mimeType:'text/csv',buffer:Buffer.from('a,b\n')});await expect(page.locator('.file-composer')).toContainText('data.csv');await page.reload();await expect(page.locator('.file-composer')).toContainText('data.csv');
 await log.evaluate(el=>el.scrollTop=100);await page.waitForTimeout(100);const input=page.locator(mode==='direct'?'[name=instruction]':'#request');await input.press('Control+Enter');await expect.poll(()=>sends.length).toBe(1);await page.reload();await expect(page.locator('.file-composer')).toContainText('data.csv');
 if(mode==='direct')await page.getByRole('button',{name:'送信結果を確認',exact:true}).click();else await input.press('Control+Enter');await expect.poll(()=>sends.length).toBe(2);expect(sends[1]).toEqual(sends[0]);expect(files).toHaveLength(1);expect(sends[1].attachments).toHaveLength(1);await expect(log).toContainText('data.csv');await expect.poll(()=>bottom(log)).toBe(true);await expect(page.locator('.file-composer figure')).toHaveCount(0);
 await page.screenshot({path:`/tmp/ai-village-files-${mode}.png`});
});
test('unsupported server prevents upload without losing existing binary draft',async({page})=>{
 let supported=true,posts=0;await page.route('**/api/**',route=>{if(route.request().method()==='POST')posts++;return route.fulfill({json:{capabilities:{attachments:supported},agents:[{id:'a',name:'Agent',connection:{},state:'idle',canSend:true}],workshops:[],runs:[],notification:{}}});});
 await page.goto('/agents');await page.locator('[data-file]').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('abc')});await expect(page.locator('.file-composer')).toContainText('draft.txt');supported=false;await page.reload();await expect(page.locator('.file-composer')).toContainText('draft.txt');await page.locator('[name=instruction]').press('Control+Enter');await expect(page.locator('#error')).toContainText('サーバー更新');expect(posts).toBe(0);
});
test('image load and streamed text follow newest content, but respect a reader scrolling upward',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({json:{agents:[],workshops:[],runs:[],notification:{}}}));await page.goto('/agents');
 await page.evaluate(async()=>{const {chatScroll}=await import('/src/chat-scroll.js');const log=document.createElement('div');log.id='scroll-fixture';log.style.cssText='position:fixed;top:100px;left:300px;width:300px;height:200px;overflow:auto;background:#fff;z-index:100';log.innerHTML='<div style="height:1000px">history</div>';document.body.append(log);window.fixtureScroll=chatScroll(log);});
 const log=page.locator('#scroll-fixture');await expect.poll(()=>bottom(log)).toBe(true);
 await log.evaluate(el=>{const image=document.createElement('img');image.id='late-image';el.append(image);});
 await page.evaluate(()=>{const image=document.querySelector('#late-image');image.style.cssText='display:block;height:300px;width:100px';image.dispatchEvent(new Event('load'));});await expect.poll(()=>bottom(log)).toBe(true);
 await log.evaluate(el=>el.scrollTop=75);await page.waitForTimeout(100);
 await page.evaluate(()=>{const image=document.querySelector('#late-image');image.style.height='700px';image.dispatchEvent(new Event('load'));image.after(document.createTextNode('streamed reply'));});
 await expect(page.locator('.latest-message')).toBeVisible();expect(await log.evaluate(el=>el.scrollTop)).toBe(75);await page.locator('.latest-message').click();await expect.poll(()=>bottom(log)).toBe(true);
});
test('direct Agent uses the common menu for image and file previews, deletion, image-only upload and history',async({page})=>{
 const {default:sharp}=await import('sharp');const png=await sharp({create:{width:40,height:30,channels:3,background:'blue'}}).png().toBuffer();
 const state={capabilities:{attachments:true},agents:[{id:'a',name:'Agent',connection:{},state:'idle',canSend:true}],workshops:[],runs:[],notification:{}};
 await page.route('**/api/direct**',async route=>{if(route.request().method()==='POST'){const body=route.request().postDataJSON();expect(body.instruction).toBe('');expect(body.attachments).toHaveLength(1);const attachment={id:body.attachments[0],kind:'image',name:'sample.png',size:png.length};state.runs.push({id:'image-run',agentId:'a',...body,attachments:[attachment],state:'completed'});return route.fulfill({json:state.runs[0]});}return route.fulfill({json:state});});
 await page.goto('/agents');await page.getByRole('button',{name:'添付を追加',exact:true}).click();for(const name of ['出張先を追加','画像を追加','ファイルを追加'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await page.locator('[data-image]').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:png});await page.locator('[data-file]').setInputFiles({name:'delete.csv',mimeType:'text/csv',buffer:Buffer.from('a,b')});await expect(page.locator('.file-composer figure')).toHaveCount(2);await expect.poll(()=>page.locator('.file-composer img').evaluate(el=>el.naturalWidth)).toBe(40);await page.getByRole('button',{name:'delete.csvを削除',exact:true}).click();await expect(page.locator('.file-composer figure')).toHaveCount(1);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/ai-village-file-menu-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('[name=instruction]').press('Control+Enter');await expect(page.locator('.file-composer figure')).toHaveCount(0);await expect.poll(()=>page.locator('.runs img').evaluate(el=>el.naturalWidth)).toBe(40);
});

test('legacy scroll positions open at newest and latest is available without a new reply',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({json:{agents:[],workshops:[],runs:[],notification:{}}}));await page.goto('/agents');
 await page.evaluate(async()=>{const {chatScroll}=await import('/src/chat-scroll.js');const log=document.createElement('div');log.id='legacy-scroll';log.style.cssText='position:fixed;top:100px;left:250px;width:300px;height:200px;overflow:auto';log.innerHTML='<div style="height:1000px">history</div>';document.body.append(log);chatScroll(log,{saved:0});});
 const log=page.locator('#legacy-scroll');await expect.poll(()=>bottom(log)).toBe(true);await log.evaluate(el=>el.scrollTop=100);await expect(page.locator('.latest-message')).toBeVisible();await page.locator('.latest-message').click();await expect.poll(()=>bottom(log)).toBe(true);
});
