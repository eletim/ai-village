import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
function fixture(){return {agents:[{id:'s',name:'秘書',location:'mayor',state:'busy',connection:{},canSend:true},{id:'w',name:'工房',location:'workshop',state:'busy',connection:{}}],projects:[],workshops:[],runs:[{id:'r',agentId:'s',conversationId:'c',conversationSource:{kind:'human'},sessionId:'session',turnId:'turn',state:'running',origin:'human',createdAt:'2026-11-26T00:00:00Z',instruction:'質問',output:'最初の途中発言',livePreview:{runId:'r',sessionId:'session',turnId:'turn',messages:[{id:'m1',offset:10,phase:'commentary',text:'最初の途中発言'}]}}],requests:[],reviews:{},notification:{enabled:false}};}
async function setup(page,state){
 const scopes=[],writes=[];
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='POST'){writes.push(url.pathname);return route.fulfill({json:{}});}if(url.pathname==='/api/direct'){const previewAgent=url.searchParams.get('preview');scopes.push(previewAgent);return route.fulfill({json:workspaceSnapshot(state,{},JSON.parse(url.searchParams.get('focus')||'null'),{lazyBodies:true,previewAgent})});}return route.fulfill({json:{}});});
 await page.goto('/agents');return {scopes,writes};
}
for(const width of [1440,390])test(`secretary preview starts mid-run, follows, leaves, revisits and finalizes once ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});const state=fixture(),{scopes,writes}=await setup(page,state);const card=page.locator('#agent-s');
 await expect(card.locator('.secretary-preview')).toHaveCount(0);
 await card.locator('h2').click();await expect(card.locator('.secretary-preview')).toContainText('最初の途中発言');await expect.poll(()=>scopes.at(-1)).toBe('s');
 state.runs[0].livePreview.messages.push({id:'m2',offset:20,phase:'commentary',text:'続きの発言 <script>secret</script>'});state.runs[0].output+='\n\n続き';await notifySnapshot(page);
 await expect(card.locator('[data-preview-message]')).toHaveCount(2);await expect(card.locator('.secretary-preview')).toContainText('<script>secret</script>');await expect(card.locator('.secretary-preview script')).toHaveCount(0);
 await page.locator('#agent-w h2').click();await expect(card.locator('.secretary-preview')).toHaveCount(0);await expect.poll(()=>scopes.at(-1)).toBe('');
 state.runs[0].livePreview.messages.push({id:'m3',offset:30,phase:'final',text:'回答です'});await notifySnapshot(page);
 await card.locator('h2').click();await expect(card.locator('[data-preview-message]')).toHaveCount(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/secretary-preview-live-${width}.png`});
 state.runs[0].state='completed';state.runs[0].conversationAnswer=true;state.runs[0].finalOutput='回答です';state.runs[0].output='最初の途中発言\n\n続き\n\n回答です';await notifySnapshot(page);
 await expect(card.locator('.secretary-preview')).toHaveCount(0);await expect(card.locator('.message.assistant')).toHaveCount(1);await expect(card.locator('.response-final')).toContainText('回答です');expect(writes).toEqual([]);
 await page.screenshot({path:`/tmp/secretary-preview-${width}.png`});
});
test('hidden/blurred view and reconnect restore latest; failed preview never final; foreign identities rejected',async({page})=>{
 const state=fixture(),{scopes}=await setup(page,state);const card=page.locator('#agent-s');await card.locator('h2').click();await expect(card.locator('.secretary-preview')).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(card.locator('.secretary-preview')).toHaveCount(0);
 state.runs[0].livePreview.messages[0].text='離脱中も実行継続';await notifySnapshot(page);
 await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await expect(card.locator('.secretary-preview')).toContainText('離脱中も実行継続');
 await page.evaluate(()=>window.__testChangeStreams[0].onerror());await expect(card.locator('.secretary-preview')).toHaveCount(0);await notifySnapshot(page);await expect(card.locator('.secretary-preview')).toBeVisible();
 state.runs[0].livePreview.sessionId='foreign';await notifySnapshot(page);await expect(card.locator('.secretary-preview')).toHaveCount(0);
 state.runs[0].livePreview.sessionId='session';state.runs[0].state='interrupted';await notifySnapshot(page);await expect(card.locator('.secretary-preview')).toContainText('途中で終了・未確定');await expect(card.locator('.response-final')).toHaveCount(0);
 expect(scopes).toContain('');expect(scopes).toContain('s');
});
test('separate run identities and workshop output do not become secretary previews',async({page})=>{
 const state=fixture();state.runs.push({...structuredClone(state.runs[0]),id:'r2',turnId:'turn2',output:'新しい回',livePreview:{runId:'r2',sessionId:'session',turnId:'turn2',messages:[{id:'m1',offset:40,phase:'commentary',text:'新しい回'}]}});
 state.runs.push({...structuredClone(state.runs[0]),id:'worker-run',agentId:'w'});
 await setup(page,state);await page.locator('#agent-s h2').click();await expect(page.locator('#agent-s .secretary-preview')).toHaveCount(2);await expect(page.locator('#agent-s [data-preview-message]')).toHaveCount(2);
 await page.locator('#agent-w h2').click();await expect(page.locator('#agent-w .secretary-preview')).toHaveCount(0);await expect(page.locator('#agent-w .message.assistant details')).not.toHaveAttribute('open');
});
test('project secretary opens preview without an extra card click; blur and dialogs stop only preview',async({page})=>{
 const state=fixture();state.projects=[{id:'p',name:'Project'}];state.agents.forEach(a=>a.projectId='p');const {scopes}=await setup(page,state);
 await page.locator('[data-place="project:p"]').click();await expect(page.locator('#agent-s .secretary-preview')).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'));});await expect(page.locator('.secretary-preview')).toHaveCount(0);await expect.poll(()=>scopes.at(-1)).toBe('');
 await page.evaluate(()=>{delete document.hasFocus;window.dispatchEvent(new Event('focus'));});await expect(page.locator('.secretary-preview')).toBeVisible();
 await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.locator('.secretary-preview')).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.locator('.secretary-preview')).toBeVisible();
});
test('late response after leaving cannot restore preview, two tabs keep independent scopes',async({page,context})=>{
 const state=fixture();const first=await setup(page,state);await page.locator('#agent-s h2').click();await expect(page.locator('.secretary-preview')).toBeVisible();
 let release,started;const pending=new Promise(r=>started=r);let held=false;
 await page.route('**/api/direct?**',async route=>{const url=new URL(route.request().url());if(!held&&url.searchParams.get('preview')==='s'){held=true;const stale=workspaceSnapshot(state,{},['s','w'],{lazyBodies:true,previewAgent:'s'});started();await new Promise(r=>release=r);return route.fulfill({json:stale}).catch(()=>{});}return route.fallback();});
 await notifySnapshot(page);await pending;await page.locator('#agent-w h2').click();release();await expect(page.locator('.secretary-preview')).toHaveCount(0);await expect.poll(()=>first.scopes.at(-1)).toBe('');
 const other=await context.newPage();await other.addInitScript(()=>{window.__testChangeStreams=[];window.EventSource=class{constructor(){window.__testChangeStreams.push(this);}close(){};dispatchEvent(e){this.onmessage?.(e);}};});
 const second=await setup(other,state);await other.locator('#agent-s h2').click();await expect(other.locator('.secretary-preview')).toBeVisible();await expect.poll(()=>second.scopes.at(-1)).toBe('s');
 await expect(page.locator('.secretary-preview')).toHaveCount(0);await other.close();
});
for(const width of [1440,390])test(`preview images enlarge, navigate, survive completion and reopen ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});const state=fixture();
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
 const text=ids.map((id,i)=>`![画像${i+1}](village-image:${id})`).join('\n');
 state.runs[0].livePreview.messages[0].text=text;state.runs[0].output=text;
 await setup(page,state);
 await page.route('**/api/images/*',async route=>route.fulfill({contentType:'image/png',body:await (await import('sharp')).default({create:{width:1600,height:1000,channels:3,background:route.request().url().includes(ids[0])?'#3183a8':'#ab5631'}}).png().toBuffer()}));
 await page.locator('#agent-s h2').click();const card=page.locator('#agent-s');
 await expect(card.locator('.secretary-preview [data-visual=image]')).toHaveCount(2);
 await card.getByRole('button',{name:'画像1を拡大'}).click();const dialog=page.locator('.report-lightbox');
 await expect(dialog).toBeVisible();await expect(dialog.locator('img')).toHaveAttribute('src','/api/images/'+ids[0]);
 await expect(dialog.getByRole('button',{name:'前の画像'})).toBeDisabled();
 const before=await dialog.locator('img').boundingBox();await dialog.getByRole('button',{name:'拡大',exact:true}).click();
 const after=await dialog.locator('img').boundingBox();expect(after.width).toBeGreaterThan(before.width*1.9);
 expect(await dialog.locator('.report-image-viewport').evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
 await dialog.getByRole('button',{name:'次の画像'}).click();await expect(dialog.locator('img')).toHaveAttribute('src','/api/images/'+ids[1]);await expect(dialog.getByRole('button',{name:'次の画像'})).toBeDisabled();
 await page.keyboard.press('ArrowLeft');await expect(dialog.locator('img')).toHaveAttribute('src','/api/images/'+ids[0]);
 state.runs[0].state='completed';state.runs[0].conversationAnswer=true;state.runs[0].finalOutput=text;await notifySnapshot(page);
 await expect(dialog.locator('img')).toHaveAttribute('src','/api/images/'+ids[0]);await page.screenshot({path:`/tmp/secretary-images-${width}.png`});
 await dialog.getByRole('button',{name:'閉じる',exact:true}).click();await expect(card.locator('.secretary-preview')).toHaveCount(0);
 await card.locator('.response-final').getByRole('button',{name:'画像2を拡大'}).click();await expect(dialog.locator('img')).toHaveAttribute('src','/api/images/'+ids[1]);await page.keyboard.press('Escape');
 // Single-image reply has no available navigation and starts fitted after reopening.
 state.runs[0].finalOutput=`![画像1](village-image:${ids[0]})`;state.runs[0].output=state.runs[0].finalOutput;await notifySnapshot(page);
 await card.getByRole('button',{name:'画像1を拡大'}).click();await expect(dialog.getByRole('button',{name:'前の画像'})).toBeDisabled();await expect(dialog.getByRole('button',{name:'次の画像'})).toBeDisabled();await expect(dialog.getByRole('button',{name:'拡大',exact:true})).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
