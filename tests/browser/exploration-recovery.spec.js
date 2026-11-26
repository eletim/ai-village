import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import sharp from 'sharp';
const refs=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
for(const width of [1440,390])test(`explore long preview read, image keyboard return, project round trip ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});
 const text='確認中の説明\n\n'+Array.from({length:35},(_,i)=>`段落 ${i} 内容の確認`).join('\n\n')+'\n'+refs.map((id,i)=>`![検証画像${i}](village-image:${id})`).join('\n');
 const run={id:'r',agentId:'s',conversationId:'c',conversationSource:{kind:'human'},sessionId:'ss',turnId:'tt',state:'running',origin:'human',createdAt:'2026-11-26T00:00:00Z',instruction:'画像と長い説明を確認',output:text,livePreview:{runId:'r',sessionId:'ss',turnId:'tt',messages:[{id:'m',phase:'commentary',offset:10,text}]}};
 const state={agents:[{id:'s',name:'検証秘書',location:'mayor',projectId:'p',connection:{},state:'busy',canSend:false},{id:'w',name:'別工房',location:'workshop',projectId:'q',connection:{},state:'idle',canSend:true}],projects:[{id:'p',name:'検証村'},{id:'q',name:'別Project'}],workshops:[],runs:[run],notification:{enabled:false},reviews:{}};
 const writes=[];
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/images/'))return route.fulfill({contentType:'image/png',body:await sharp({create:{width:1500,height:900,channels:3,background:'#316aa8'}}).png().toBuffer()});if(route.request().method()==='POST'){writes.push(u.pathname);return route.fulfill({json:{}});}if(u.pathname==='/api/direct')return route.fulfill({json:workspaceSnapshot(state,{},JSON.parse(u.searchParams.get('focus')||'null'),{lazyBodies:true,previewAgent:u.searchParams.get('preview')})});return route.fulfill({json:{}});});
 await page.goto('/agents');await page.locator('[data-place="project:p"]').click();const log=page.locator('#agent-s .runs');await expect(log.locator('.secretary-preview')).toBeVisible();
 await log.evaluate(e=>e.scrollTop=180);await page.waitForTimeout(100);const old=await log.evaluate(e=>e.scrollTop);
 run.livePreview.messages.push({id:'m2',offset:20,phase:'commentary',text:'後から届いた発言'});await notifySnapshot(page);await expect(log).toContainText('後から届いた発言');expect(Math.abs(await log.evaluate(e=>e.scrollTop)-old)).toBeLessThan(3);
 await page.locator('#agent-s .latest-message').click();await expect.poll(()=>log.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight)).toBeLessThan(4);
 const img=log.getByRole('button',{name:'検証画像0を拡大'});await img.click();await expect(page.locator('.report-lightbox')).toBeVisible();await page.getByRole('button',{name:'次の画像',exact:true}).click();await page.keyboard.press('Escape');
 await expect(log.locator('.secretary-preview')).toBeVisible();await expect(img).toBeFocused();console.log('PREVIEW_AFTER_CLOSE',width,await log.locator('.secretary-preview').count());
 const focus=await page.evaluate(()=>({tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label'),text:document.activeElement.textContent?.slice(0,60)}));console.log('FOCUS_AFTER_IMAGE_CLOSE',width,JSON.stringify(focus));
 await page.screenshot({path:`/tmp/exploration-fixes-after-image-close-${width}.png`});await page.locator('#agent-s textarea').click();await expect(log.locator('.secretary-preview')).toBeVisible();console.log('RECOVERY_BY_INPUT_FOCUS',width,true);
 await page.locator('[data-place="project:q"]').click();await expect(page.locator('#agent-w')).toBeVisible();await page.locator('[data-place="project:p"]').click();await expect(log.locator('.secretary-preview')).toBeVisible();
 run.state='failed';await notifySnapshot(page);await expect(log).toContainText('途中で終了・未確定');expect(writes).toEqual([]);
 // Keyboard focus should return to the image trigger after closing the modal.
 expect(focus.label).toBe('検証画像0を拡大');
});
for(const width of [1440,390])test(`explore slow send double activation, new draft, project switch ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});const state={capabilities:{secretaryConversations:true},agents:[{id:'s',name:'秘書',location:'mayor',projectId:'p',connection:{},state:'idle',canSend:true,conversationControl:{canAccept:true}},{id:'w',name:'工房',projectId:'q',connection:{},state:'idle',canSend:true}],projects:[{id:'p',name:'村'},{id:'q',name:'別'}],workshops:[],runs:[],reviews:{},notification:{enabled:false}};
 let release;const sends=[];
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url());if(r.request().method()==='POST'&&u.pathname.endsWith('/runs')){const body=r.request().postDataJSON();sends.push(body);await new Promise(res=>release=res);const run={id:'sent',agentId:'s',...body,conversationId:'c',conversationSource:{kind:'human'},state:'queued',createdAt:new Date().toISOString()};state.runs.push(run);return r.fulfill({json:run});}return r.fulfill({json:u.pathname==='/api/direct'?state:{}});});
 await page.goto('/agents');await page.locator('[data-place="project:p"]').click();const input=page.locator('#agent-s textarea');await input.fill('最初の依頼');await input.press('Control+Enter');await expect.poll(()=>sends.length).toBe(1);await input.press('Control+Enter');expect(sends.length).toBe(1);
 await input.fill('次に送る補足は消さない');await page.locator('[data-place="project:q"]').click();release();await page.waitForTimeout(100);await page.locator('[data-place="project:p"]').click();await expect(input).toHaveValue('次に送る補足は消さない');await page.reload();await expect(input).toHaveValue('次に送る補足は消さない');expect(sends.length).toBe(1);expect(sends[0].mode).toBe('conversation');
});
test('explore discoverable image help and real local upload on isolated HTTP',async({page,baseURL},info)=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{writeFile}=await import('node:fs/promises');
 const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['scripts/village.mjs',...args],{env:{...process.env,VILLAGE_URL:baseURL,VILLAGE_NOTIFICATIONS:'false'}})).stdout);
 const help=await cli('help');expect(JSON.stringify(help)).toContain('images help');const images=await cli('images','help');expect(images.result.text).toContain('village-image:UUID');
 const file=info.outputPath('generated.png');await writeFile(file,await sharp({create:{width:800,height:600,channels:3,background:'#328b5a'}}).png().toBuffer());const upload=await cli('images','upload',file);expect(upload.ok).toBe(true);
 const list=await cli('images','list');expect(JSON.stringify(list)).toContain(upload.reference.match(/[0-9a-f-]{36}/)[0]);
 const state={agents:[{id:'s',name:'秘書',location:'mayor',connection:{},state:'idle',canSend:true}],workshops:[],runs:[{id:'r',agentId:'s',state:'completed',conversationId:'c',conversationAnswer:true,conversationSource:{kind:'human'},instruction:'画像を表示',output:upload.reference,finalOutput:upload.reference}],notification:{enabled:false},reviews:{}};
 await page.route('**/api/direct**',r=>r.fulfill({json:state}));await page.goto('/agents');const img=page.locator('[data-visual=image] img');await expect.poll(()=>img.evaluate(e=>e.naturalWidth)).toBe(800);await img.click();await expect(page.locator('.report-lightbox')).toBeVisible();await page.getByRole('button',{name:'閉じる',exact:true}).click();await expect(img.locator('..')).toBeFocused();
});
