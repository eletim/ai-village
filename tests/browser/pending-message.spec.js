import {test,expect} from '@playwright/test';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
function fixture(){return {agents:[{id:'a',name:'Fixture',location:'mayor',state:'idle',connection:{},canSend:true,nativeTurns:[]}],projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{attachments:true,travelContexts:true,steering:true},runs:[]};}
async function setup(page,s,handler){await page.route('**/api/**',async r=>{const u=new URL(r.request().url());if(u.pathname==='/api/direct')return r.fulfill({json:workspaceSnapshot(s)});if(await handler?.(r,u))return;return r.fulfill({json:{providers:{}}});});await page.goto('/agents');}
const input=p=>p.locator('textarea[name=instruction]');
const local=p=>p.locator('.runs .local-message');
async function send(page,text){await input(page).fill(text);await input(page).press('Control+Enter');}
test('immediate safe bubble, poll before POST, unchanged identity and later edited draft retained',async({page})=>{
 const s=fixture();let release,body,posts=0;
 await setup(page,s,async(r,u)=>{if(!u.pathname.endsWith('/runs'))return false;posts++;body=r.request().postDataJSON();await new Promise(ok=>release=ok);await r.fulfill({json:s.runs.at(-1)});return true;});
 await send(page,'<img src=x onerror=alert(1)> original');await expect(local(page)).toContainText('<img src=x');await expect(local(page).locator('img')).toHaveCount(0);await expect(local(page)).toContainText('サーバーへ送信中');await expect(page.locator('form .send-progress')).toHaveCount(0);
 await input(page).fill('new draft');s.runs.push({...body,agentId:'a',id:'r',state:'awaiting_input',createdAt:new Date().toISOString()});await expect(local(page)).toHaveCount(0);await expect(page.locator('.runs .message.user')).toHaveCount(1);await expect(input(page)).toHaveValue('new draft');release();await expect(page.getByRole('button',{name:'送信',exact:true})).toBeEnabled();await expect(input(page)).toHaveValue('new draft');expect(posts).toBe(1);
});
test('attachment-only upload bubble, failed upload and reload interrupted upload preserve draft',async({page})=>{
 const s=fixture();let release,posts=0;
 await setup(page,s,async(r,u)=>{if(u.pathname==='/api/attachments'){await new Promise(ok=>release=ok);await r.fulfill({status:400,json:{error:'bad attachment'}});return true;}if(u.pathname.endsWith('/runs')){posts++;return true;}return false;});
 await page.locator('input[data-file]').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('notes')});await expect(page.locator('.file-composer')).toContainText('notes.txt');await input(page).press('Control+Enter');await expect(local(page)).toContainText('notes.txt');await expect(local(page)).toContainText('アップロード中');release();await expect(local(page)).toContainText('未送信');expect(posts).toBe(0);await page.reload();await expect(local(page)).toContainText('未送信');await expect(page.locator('.file-composer')).toContainText('notes.txt');
});
test('upload snapshots text before await, retyped same draft is not cleared; repeated same text is distinct',async({page})=>{
 const s=fixture();let release,posts=[];
 await setup(page,s,async(r,u)=>{if(u.pathname==='/api/attachments'){await new Promise(ok=>release=ok);await r.fulfill({json:{id:'11111111-1111-4111-8111-111111111111',name:'note.txt',size:4,mime:'text/plain'}});return true;}if(u.pathname.endsWith('/runs')){const body=r.request().postDataJSON();posts.push(body);const run={...body,attachments:[],id:'r'+posts.length,agentId:'a',state:'queued',createdAt:new Date().toISOString()};s.runs.push(run);await r.fulfill({json:run});return true;}return false;});
 await page.locator('input[data-file]').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('note')});await send(page,'same');await expect(local(page)).toContainText('アップロード中');await input(page).fill('edited');await input(page).fill('same');release();await expect(page.locator('.runs')).toContainText('送信待ち');await expect(input(page)).toHaveValue('same');expect(posts[0].instruction).toBe('same');await input(page).press('Control+Enter');await expect(page.locator('.runs .message.user')).toHaveCount(2);expect(posts[0].requestId).not.toBe(posts[1].requestId);await expect(input(page)).toHaveValue('');
});
test('uncertain receipt persists reload, explicit reconcile uses same request ID; queue and steering labels',async({page})=>{
 const s=fixture();Object.assign(s.agents[0],{canSend:false,canQueue:true});let bodies=[],fail=true;
 await setup(page,s,async(r,u)=>{if(!u.pathname.endsWith('/runs'))return false;const body=r.request().postDataJSON();bodies.push(body);if(fail){await r.fulfill({status:503,json:{error:'uncertain'}});}else{const run={...body,id:'r',agentId:'a',state:'queued',createdAt:new Date().toISOString()};s.runs.push(run);await r.fulfill({json:run});}return true;});
 await send(page,'queue');await expect(local(page)).toContainText('待機キューへの送信');await expect(local(page)).toContainText('送信結果不明');await page.reload();await expect(local(page)).toContainText('自動再送しません');expect(bodies.length).toBe(1);fail=false;await page.getByRole('button',{name:'送信結果を確認',exact:true}).click();await expect(local(page)).toHaveCount(0);expect(bodies[0]).toEqual(bodies[1]);await expect(page.locator('.runs .message.user')).toHaveCount(1);
 Object.assign(s.agents[0],{canSteer:true,steerTarget:{runId:'active'}});await expect(page.getByRole('button',{name:'実行中に補足',exact:true})).toBeVisible();fail=true;await send(page,'supplement');await expect(local(page)).toContainText('補足 · 送信結果不明');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/bubbles-mobile.png'});
});
test('new default settings preserve explicit saved choices',async({page})=>{
 await setup(page,fixture());await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.getByLabel('書体',{exact:true})).toHaveValue('meiryo');await expect(page.getByLabel('文字サイズ')).toHaveValue('medium');
 await page.getByLabel('書体',{exact:true}).selectOption('standard');await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.getByLabel('書体',{exact:true})).toHaveValue('standard');
});
test('interrupted upload reload never POSTs and travel/attachment labels stay local',async({page})=>{
 const s=fixture();let posts=0,upload;
 await page.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');sessionStorage.setItem('ai-village-direct-drafts-v2',JSON.stringify({travelDrafts:{a:[{name:'Destination',sshHost:'host',cwd:'/work',notes:''}]}}));}});
 await setup(page,s,async(r,u)=>{if(u.pathname==='/api/attachments'){await new Promise(ok=>upload=ok);await r.abort().catch(()=>{});return true;}if(u.pathname.endsWith('/runs')){posts++;await r.fulfill({status:400,json:{error:'invalid'}});return true;}return false;});
 await page.locator('input[data-file]').setInputFiles({name:'resume.txt',mimeType:'text/plain',buffer:Buffer.from('data')});await send(page,'keep');await expect(local(page)).toContainText('アップロード中');await expect(local(page)).toContainText('Destination');await page.reload();upload();await expect(local(page)).toContainText('未送信');await expect(input(page)).toHaveValue('keep');await expect(page.locator('.file-composer')).toContainText('resume.txt');expect(posts).toBe(0);
});
test('explicit rejection is not accepted, draft survives, desktop pending bubble',async({page})=>{
 const s=fixture();let release;
 await setup(page,s,async(r,u)=>{if(!u.pathname.endsWith('/runs'))return false;await new Promise(ok=>release=ok);await r.fulfill({status:409,json:{error:'状態が変更されました'}});return true;});
 await send(page,'送信中の文章です。');await expect(local(page)).toContainText('サーバーへ送信中');await page.screenshot({path:'/tmp/bubbles-desktop.png'});release();await expect(local(page)).toContainText('未送信');await expect(input(page)).toHaveValue('送信中の文章です。');await expect(page.getByRole('button',{name:'送信',exact:true})).toBeEnabled();
});
