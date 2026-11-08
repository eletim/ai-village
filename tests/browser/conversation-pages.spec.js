import {test,expect} from '@playwright/test';
import {workspaceSnapshot,historyPage} from '../../server/conversation-pages.mjs';
function fixture(n=230){return {agents:[{id:'a',name:'Fixture',location:'mayor',state:'idle',connection:{},canSend:true,nativeTurns:[]}],projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{attachments:true},runs:Array.from({length:n},(_,i)=>({id:'r'+i,agentId:'a',createdAt:new Date(1700000000000+i*1000).toISOString(),state:'completed',instruction:'question '+i,output:'answer '+i,finalOutput:'final '+i}))};}
test('100 initial entries; older fetch, stable scroll and polling updates',async({page})=>{
 const s=fixture();let pages=0,snapshots=0;
 await page.route('**/api/**',r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/history')){pages++;const p=historyPage(s,'a',u.searchParams.get('before'));return r.fulfill({json:u.searchParams.get('boundaryOnly')==='1'?{cursor:p.cursor,hasMore:p.hasMore}:p});}if(u.pathname==='/api/direct'){snapshots++;return r.fulfill({json:workspaceSnapshot(s,JSON.parse(u.searchParams.get('ranges')||'{}'))});}return r.fulfill({json:{providers:{}}});});
 await page.goto('/agents');const log=page.locator('.runs'),runs=log.locator('.run');await expect(runs).toHaveCount(100);await expect(runs.first()).toContainText('question 130');
 await log.evaluate(el=>el.scrollTop=0);await page.waitForTimeout(80);
 const first=runs.first(),before=await first.evaluate(n=>n.getBoundingClientRect().top);
 await page.getByRole('button',{name:'古い会話を読み込む'}).click();await expect(runs).toHaveCount(200);expect(pages).toBe(1);
 const restored=await log.locator('[data-entry*=r130]').evaluate(n=>n.getBoundingClientRect().top);expect(Math.abs(restored-before)).toBeLessThan(3);
 expect(pages).toBe(1);await page.locator('textarea[name=instruction]').fill('draft retained');
 s.runs.push({id:'new',agentId:'a',createdAt:'2030-01-01',instruction:'new input',output:'growing',state:'running'});
 await expect(runs).toHaveCount(201);s.runs.at(-1).output='growing updated';await expect(log).toContainText('growing updated');await expect(runs.first()).toContainText('question 30');expect(snapshots).toBeGreaterThan(1);await expect(page.locator('textarea[name=instruction]')).toHaveValue('draft retained');
 await page.screenshot({path:'/tmp/paged-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/paged-mobile.png'});
 const more=page.getByRole('button',{name:'古い会話を読み込む'});await more.focus();await page.keyboard.press('Enter');await expect(runs).toHaveCount(231);await expect(more).toHaveCount(0);expect(pages).toBe(2);
});
test('immediate upload and POST progress, no duplicate send, failure keeps draft and uncertain receipt',async({page})=>{
 const s=fixture(0);let releaseUpload,releaseSend,posts=0;
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url());if(u.pathname==='/api/attachments'){await new Promise(ok=>releaseUpload=ok);return r.fulfill({json:{id:'file',name:'note.txt',size:4,mediaType:'text/plain'}});}if(u.pathname.endsWith('/runs')){posts++;await new Promise(ok=>releaseSend=ok);return r.fulfill({status:503,json:{error:'connection uncertain'}});}if(u.pathname==='/api/direct')return r.fulfill({json:workspaceSnapshot(s)});return r.fulfill({json:{providers:{}}});});
 await page.goto('/agents');await page.locator('textarea[name=instruction]').fill('keep this');
 await page.locator('input[data-file]').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('note')});
 await page.getByRole('button',{name:'送信',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'添付を準備'})).toBeVisible();expect(posts).toBe(0);releaseUpload();
 await expect(page.getByRole('status').filter({hasText:'サーバーへ送信中'})).toBeVisible();await page.screenshot({path:'/tmp/paged-sending.png'});await expect(page.getByRole('button',{name:'送信',exact:true})).toBeDisabled();await page.locator('textarea[name=instruction]').press('Control+Enter');expect(posts).toBe(1);releaseSend();
 await expect(page.locator('#error')).toContainText('connection uncertain');await expect(page.locator('textarea[name=instruction]')).toHaveValue('keep this');await expect(page.getByRole('button',{name:'送信結果を確認',exact:true})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'自動再送しません'})).toBeVisible();expect(posts).toBe(1);
});
test('successful delayed submit shows acceptance status then clears draft, icons accessible and details preserved',async({page})=>{
 const s=fixture(0);let complete;
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/runs')){const body=r.request().postDataJSON();await new Promise(ok=>complete=ok);const run={...body,id:'sent',agentId:'a',createdAt:'2030',state:'awaiting_input'};s.runs.push(run);return r.fulfill({json:run});}if(u.pathname==='/api/direct')return r.fulfill({json:workspaceSnapshot(s)});return r.fulfill({json:{providers:{codex:{available:true,usedPercent:20,resetsAt:Date.now()+60000,cachedAt:Date.now()}}}});});
 await page.goto('/agents');await page.locator('textarea[name=instruction]').fill('new instruction');await page.locator('textarea[name=instruction]').press('Control+Enter');await expect(page.locator('.send-progress')).toContainText('サーバーへ送信中');complete();await expect(page.locator('.runs')).toContainText('受付照合中');await expect(page.locator('textarea[name=instruction]')).toHaveValue('');
 const summary=page.locator('[data-provider=codex] summary');await expect(page.locator('.usage-provider-icon')).toHaveCount(2);await expect(summary).toHaveAttribute('aria-label','Codex 週次使用状況・詳細');await summary.focus();await page.keyboard.press('Enter');await expect(page.getByText('コアPCのPurpleMuxを参照').first()).toBeVisible();
});
test('history failure retains rendered entries, can retry; terminated Agent history pages independently',async({page})=>{
 const s=fixture(130);s.agents[0].state='terminated';let fail=true;
 await page.route('**/api/**',r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/history'))return fail?r.fulfill({status:503,json:{error:'history offline'}}):r.fulfill({json:historyPage(s,'a',u.searchParams.get('before'))});if(u.pathname==='/api/direct')return r.fulfill({json:workspaceSnapshot(s,JSON.parse(u.searchParams.get('ranges')||'{}'))});return r.fulfill({json:{providers:{}}});});
 await page.goto('/agents');await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByRole('button',{name:'終了Agentの履歴',exact:true}).click();const history=page.locator('#history-dialog');await expect(history).toBeVisible();await expect(history.locator('.run')).toHaveCount(100);const more=history.getByRole('button',{name:'古い会話を読み込む'});await more.click();await expect(history.getByRole('alert')).toContainText('history offline');await expect(history.locator('.run')).toHaveCount(100);fail=false;await more.click();await expect(history.locator('.run')).toHaveCount(130);
});
test('recovery fetches full request only on explicit retry and uses current revision',async({page})=>{
 const s=fixture(1);s.runs[0].state='failed';Object.assign(s.runs[0],{humanRequestId:'q',workId:'w',origin:'human'});s.requests=[{id:'q',revision:1,status:'active',instruction:'original instruction',works:[{id:'w',currentRunId:'r0'}]}];let gets=0,retries=0;
 await page.route('**/api/**',r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/requests/get')){gets++;return r.fulfill({json:{...s.requests[0],revision:2}});}if(u.pathname.endsWith('/requests/retry')){retries++;const body=r.request().postDataJSON();expect(body.revision).toBe(2);expect(body.instruction).toContain('original instruction');return r.fulfill({json:{}});}if(u.pathname==='/api/direct')return r.fulfill({json:workspaceSnapshot(s)});return r.fulfill({json:{providers:{}}});});
 page.on('dialog',d=>d.accept());await page.goto('/agents');expect(gets).toBe(0);await page.getByRole('button',{name:'確認して再試行'}).click();await expect.poll(()=>retries).toBe(1);expect(gets).toBe(1);
});
