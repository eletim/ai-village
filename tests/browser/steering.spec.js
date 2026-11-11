import {test,expect} from '@playwright/test';
test('busy supplement sends pinned target, while queue and unknown are labelled honestly',async({page})=>{
 const target={runId:'original',sessionId:'session',turnId:'turn'},agent={id:'a',name:'Codex',provider:'codex',state:'busy',connection:{},canSend:false,canQueue:true,canSteer:true,steerTarget:target};let sends=[];
 const state={agents:[agent],workshops:[],runs:[],reviews:{},notification:{enabled:false},capabilities:{steering:true}};
 await page.route('**/api/**',r=>{if(r.request().url().endsWith('/runs')){sends.push(r.request().postDataJSON());return r.fulfill({status:409,json:{error:'補足対象が変わりました'}});}return r.fulfill({json:state});});await page.goto('/agents');const input=page.locator('textarea[name=instruction]');await expect(page.getByRole('button',{name:'実行中に補足',exact:true})).toBeEnabled();await page.screenshot({path:'/tmp/village-steering-direct.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/village-steering-mobile.png'});await input.fill('補足内容');await input.press('Control+Enter');await expect.poll(()=>sends.length).toBe(1);expect(sends[0].steerTarget).toEqual(target);await expect(input).toHaveValue('補足内容');await expect(page.locator('#error')).toContainText('補足対象');
 agent.canSteer=false;delete agent.steerTarget;await expect(page.getByRole('button',{name:'待機キューへ',exact:true})).toBeVisible();await page.getByRole('button',{name:'待機キューへ',exact:true}).click();await expect.poll(()=>sends.length).toBe(2);expect(sends[1].steerTarget).toBeUndefined();agent.canQueue=false;agent.state='unknown';await expect(page.getByRole('button',{name:'送信',exact:true})).toBeDisabled();
});
test('Workspace entry uses steering and preserves failed draft',async({page})=>{
 let sent;const target={runId:'r',sessionId:'s',turnId:'t'};
 const state={agents:[{id:'a',name:'秘書',location:'mayor',state:'busy',connection:{},canSteer:true,steerTarget:target}],projects:[],workshops:[],runs:[],reviews:{},notification:{enabled:false},capabilities:{steering:true}};
 await page.route('**/api/**',r=>{if(r.request().url().endsWith('/runs')){sent=r.request().postDataJSON();return r.fulfill({status:409,json:{error:'補足対象が変わりました'}});}return r.fulfill({json:state});});
 await page.goto('/agents');await expect(page).toHaveURL(/\/agents$/);await expect(page.getByRole('button',{name:'実行中に補足',exact:true})).toBeEnabled();
 const input=page.locator('textarea[name=instruction]');await input.fill('秘書に補足');await input.press('Control+Enter');await expect.poll(()=>sent?.steerTarget).toEqual(target);await expect(input).toHaveValue('秘書に補足');await expect(page.locator('#error')).toContainText('補足対象');
});
test('accepted supplement displays its segment, not the cumulative native turn',async({page})=>{
 const native={id:'t',sessionId:'s',state:'running',output:'以前の途中報告'};
 const s={agents:[{id:'a',name:'秘書',location:'mayor',state:'busy',connection:{},nativeTurns:[native]}],projects:[],workshops:[],reviews:{},notification:{enabled:false},runs:[{id:'old',agentId:'a',sessionId:'s',turnId:'t',state:'superseded',instruction:'元の依頼',output:'以前の途中報告'},{id:'new',agentId:'a',sessionId:'s',turnId:'t',state:'running',origin:'steering',instruction:'補足',output:''}]};
 await page.route('**/api/**',r=>r.fulfill({json:s}));await page.goto('/agents');const messages=page.locator('.message.assistant');await expect(messages).toHaveCount(1);await expect(messages).toContainText('以前の途中報告');
 s.runs[1].output='以前の途中報告';native.output+='\n\n以前の途中報告';await expect(messages).toHaveCount(2);await expect(messages.nth(1)).toContainText('以前の途中報告');
});

test('Claude steering labels uncertain timing without changing Codex label',async({page})=>{
 const a={id:'c',name:'Claude',provider:'claude',state:'busy',canSteer:true,canQueue:true,connection:{},steerTarget:{runId:'r',turnId:'t',sessionId:'s'}};
 await page.route('**/api/**',r=>r.fulfill({json:{agents:[a],workshops:[],projects:[],runs:[],reviews:{},notification:{enabled:false}}}));
 await page.goto('/agents');const button=page.locator('form[data-send]>button[type=submit]');await expect(button).toHaveText('実行中に補足');await expect(button).toHaveAttribute('title',/保証されません/);await expect(button).toHaveAttribute('aria-label',/保証されません/);
 a.provider='codex';await expect(button).toHaveAttribute('aria-label','実行中に補足');await expect(button).not.toHaveAttribute('title',/保証されません/);
});
