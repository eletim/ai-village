import {test,expect} from '@playwright/test';
const fixture=()=>({agents:[{id:'a',name:'工房Agent',location:'workshop',workshopId:'w',state:'idle',connection:{},canSend:true}],workshops:[{id:'w',name:'工房'}],projects:[],reviews:{},notification:{enabled:false},requests:[{id:'q',status:'completed',works:[]}],runs:[{id:'r',agentId:'a',humanRequestId:'q',instruction:'依頼',output:'回答',state:'completed',reportStatus:'報告完了'}]});
for(const theme of ['light','dark'])for(const width of [1440,390])test(`${theme} ${width}: normal icons retain accessible labels on both screens`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.addInitScript(t=>localStorage.setItem('village-display',JSON.stringify({theme:t})),theme);
 await page.route('**/api/**',r=>r.fulfill({json:fixture()}));await page.goto('/agents');
 const send=page.getByRole('button',{name:'送信',exact:true});await expect(send).toBeEnabled();await expect(send).toHaveAttribute('title',/送信/);await expect(send.locator('svg')).toHaveCount(1);await expect(send).toHaveText('');
 await expect(page.locator('.run-status [aria-label="報告完了"]')).toHaveAttribute('title','報告完了');await expect(page.locator('.run-status [aria-label="依頼全体完了"]')).toBeVisible();await expect(page.locator('.panel-info [aria-label="応答完了"]')).toBeVisible();
 await expect(page.locator('#connection')).toHaveText(/^● \S/);await expect(page.locator('#connection')).not.toContainText('接続');await expect(page.locator('#connection')).toHaveAttribute('aria-label',/^接続 · /);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/');await expect(page.locator('#village-lots [aria-label="応答完了"]')).toBeVisible();await expect(page.locator('#map-connection')).toHaveText(/^● \S/);await expect(page.locator('#map-connection')).toHaveAttribute('title',/接続中/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('sending, queue, steering, failed request and disconnected states retain words',async({page})=>{
 const s=fixture();let offline=false,release;
 await page.route('**/api/**',async r=>{if(offline)return r.abort();if(r.request().url().endsWith('/runs')&&r.request().method()==='POST'){await new Promise(resolve=>release=resolve);return r.fulfill({status:409,json:{error:'確認が必要です'}});}return r.fulfill({json:s});});
 await page.goto('/agents');await page.locator('textarea[name=instruction]').fill('送信テスト');await page.getByRole('button',{name:'送信',exact:true}).click();await expect(page.getByRole('button',{name:'送信中…',exact:true})).toBeDisabled();release();await expect(page.locator('#error')).toContainText('確認が必要');
 Object.assign(s.agents[0],{canSend:false,canQueue:true,state:'busy'});await expect(page.getByRole('button',{name:'待機キューへ',exact:true})).toHaveText('待機キューへ');s.agents[0].canSteer=true;await expect(page.getByRole('button',{name:'実行中に補足',exact:true})).toHaveText('実行中に補足');
 Object.assign(s.agents[0],{state:'unknown',canQueue:false,canSteer:false});s.runs[0].state='failed';s.runs[0].reportStatus='要確認';s.runs[0].error='実行に失敗しました';s.requests[0].status='active';await expect(page.locator('.run-status')).toContainText('要確認');await expect(page.locator('.run-status')).toContainText('実行に失敗しました');await expect(page.getByRole('button',{name:'送信',exact:true})).toBeDisabled();
 offline=true;await expect(page.locator('#connection')).toContainText('接続不明');await expect(page.locator('#connection')).toHaveAttribute('aria-label',/接続不明/);
 await page.goto('/');await expect(page.locator('#map-connection')).toContainText('接続未確認');
});
test('review keeps completion wording and recovery actions; merged success becomes a check',async({page})=>{
 const s=fixture();s.runs[0].reportStatus='作業完了（報告に統合済み）';
 await page.route('**/api/**',r=>r.fulfill({json:s}));await page.goto('/agents');await expect(page.locator('.run-status [aria-label="作業完了（報告に統合済み）"]')).toBeVisible();
 Object.assign(s.requests[0],{status:'active',rootWorkId:'work',requestModel:{state:{kind:'active',review:['legacy-needs-decision']}},works:[{id:'work',currentRunId:'r',agentId:'a',parentWorkId:null}]});
 await expect(page.locator('.run-status')).toContainText('作業完了（報告に統合済み）');await expect(page.locator('.run-status .completion-icon')).toHaveCount(0);await expect(page.locator('.recovery').getByRole('button',{name:'再試行',exact:true})).toBeVisible();await expect(page.locator('.recovery').getByRole('button',{name:'完了扱い',exact:true})).toBeVisible();await expect(page.locator('.recovery').getByRole('button',{name:'取り下げ',exact:true})).toBeVisible();
 await page.screenshot({path:'docs/verification/ui-icons/review-text.png'});
});
