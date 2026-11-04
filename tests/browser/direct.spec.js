import {test,expect} from '@playwright/test';
test('direct workshop editor, safe output and persistent instruction draft',async({page})=>{
 const state={workshops:[],agents:[],runs:[],notification:{destinationConfigured:false}};
 await page.route('**/api/direct**',async route=>{
  const request=route.request();const body=request.method()==='GET'?null:request.postDataJSON();
  if(request.method()==='POST'&&request.url().endsWith('/workshops'))state.workshops.push({...body,id:'workshop'});
  if(request.method()==='PUT')Object.assign(state.workshops[0],body);
  await route.fulfill({json:state});
 });
 await page.goto('/agents');
 await page.getByRole('button',{name:'起動・工房設定',exact:true}).click();
 await page.locator('#workshop-form [name=name]').fill('First');
 await page.locator('[name=sshHost]').fill('E-frontier');
 await page.locator('[name=baseUrl]').fill('http://localhost:8022/');
 await page.locator('[name=workplaces]').fill('/tmp/a\n/tmp/b');
 await page.locator('#workshop-form button').first().click();
 await expect(page.locator('#workshops')).toContainText('First');
 await page.getByRole('button',{name:'編集',exact:true}).click();
 await page.locator('#workshop-form [name=name]').fill('Edited');
 await page.locator('#workshop-form button').first().click();
 await expect(page.locator('#workshops')).toContainText('Edited');
 await page.locator('#settings-dialog [data-close]').click();
 state.agents.push({id:'agent',name:'Agent',connection:{name:'Edited'},cwd:'/tmp/a',state:'idle',tabId:'tab',terminalUrl:'http://localhost:8022/?workspace=ws&tab=tab'});
 state.runs.push({id:'run',agentId:'agent',state:'completed',instruction:'<script>bad()</script>',output:'<img src=x onerror=bad()>',notification:{status:'sent'}});
 await expect(page.locator('[data-send]')).toBeVisible();
 await page.locator('[data-send] textarea').fill('draft stays');
 await expect(page.locator('.runs')).toContainText('<img src=x onerror=bad()>');
 await expect(page.locator('.runs img')).toHaveCount(0);
 await page.waitForTimeout(2300);
 await expect(page.locator('[data-send] textarea')).toHaveValue('draft stays');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('notification deep link focuses the matching Agent after asynchronous loading',async({page})=>{
 const id='bdeab87b-6247-4355-9b5c-3a17c1a3c955';
 await page.route('**/api/direct',async route=>{
  await new Promise(resolve=>setTimeout(resolve,150));
  await route.fulfill({json:{workshops:[],runs:[],notification:{},agents:[{id,name:'通知対象',connection:{name:'工房'},cwd:'/tmp',state:'idle'}]}});
 });
 await page.goto('/agents#agent-'+id);
 await expect(page.locator('#agent-'+id)).toBeFocused();
 await expect(page.locator('#agent-'+id)).toContainText('通知対象');
});
test('local workshop registration and editing do not require an SSH host',async({page})=>{
 const state={workshops:[],agents:[],runs:[],notification:{}};
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST')state.workshops.push({...route.request().postDataJSON(),id:'local'});
  await route.fulfill({json:state});
 });
 await page.goto('/agents');
 await page.getByRole('button',{name:'起動・工房設定',exact:true}).click();
 await page.locator('[name=connectionType]').selectOption('local');
 await expect(page.locator('#ssh-host-field')).toBeHidden();
 await page.locator('#workshop-form [name=name]').fill('E-ryzen');
 await page.locator('[name=baseUrl]').fill('http://e-ryzen:8022');
 await page.locator('[name=workplaces]').fill('/tmp/local');
 await page.locator('#workshop-form button').first().click();
 await expect(page.locator('#workshops')).toContainText('ローカル');
 await page.getByRole('button',{name:'編集',exact:true}).click();
 await expect(page.locator('[name=connectionType]')).toHaveValue('local');
 await expect(page.locator('#ssh-host-field')).toBeHidden();
});
test('Agent launch creates an idempotency key without secure-context randomUUID',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined}));
 let submitted;
 const state={workshops:[{id:'local',name:'Local',connectionType:'local',workplaces:['/tmp/local']}],agents:[],runs:[],notification:{}};
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST')submitted=route.request().postDataJSON();
  await route.fulfill({json:state});
 });
 await page.goto('/agents');
 await page.getByRole('button',{name:'起動・工房設定',exact:true}).click();
 await expect(page.locator('#agent-form [name=cwd]')).toHaveValue('/tmp/local');
 await page.locator('#agent-form button').click();
 await expect.poll(()=>submitted?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
function boardFixture(){
 const workshops=Array.from({length:4},(_,i)=>({id:'w'+i,name:'工房 '+i,connectionType:i?'ssh':'local',workplaces:['/tmp']}));
 const agents=Array.from({length:13},(_,i)=>({id:'a'+i,location:i===0?'mayor':'workshop',workshopId:'w'+(i%4),name:i===0?'秘書':'Agent '+i,provider:i%2?'claude':'codex',state:i===2?'waiting_input':'idle',tabId:'tab'+i,connection:{name:'工房 '+(i%4)},cwd:'/tmp'}));
 const runs=agents.map(a=>({id:'run-'+a.id,agentId:a.id,state:'completed',instruction:'長い会話の確認',output:Array.from({length:90},(_,i)=>'会話の行 '+i).join('\n')}));
 agents.push({id:'ended',name:'終了済み',state:'terminated',connection:{name:'工房 0'}});runs.push({id:'ended-run',agentId:'ended',state:'completed',instruction:'保存された指示',output:'終了後も履歴を保持'});
 return {workshops,agents,runs,notification:{}};
}
test('dynamic places, nine panels, overflow paging, three filters and archived termination',async({page})=>{
 const state=boardFixture();await page.route('**/api/direct',r=>r.fulfill({json:state}));await page.goto('/agents');
 await expect(page.getByRole('tab')).toHaveCount(13);await expect(page.locator('#agent-ended')).toHaveCount(0);
 await page.locator('#layout').selectOption('9');await expect(page.locator('.agent-panel:visible')).toHaveCount(9);await page.locator('#next').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(4);await expect(page.locator('#agent-a12')).toBeVisible();
 await page.getByRole('tab',{name:'Agent 1 工房 1',exact:true}).click();await expect(page.locator('#agent-a1')).toBeVisible();await expect(page.locator('#page-count')).toContainText('1 / 2');
 await page.locator('#scope').selectOption('workshop');await expect(page.locator('#place option')).toHaveCount(5);await page.locator('#place').selectOption('w3');await expect(page.getByRole('tab')).toHaveCount(3);
 await page.locator('#scope').selectOption('agent');await page.locator('#agent-choice').selectOption('a7');await expect(page.locator('.agent-panel:visible')).toHaveCount(1);await expect(page.locator('#agent-a7')).toBeVisible();
 await page.locator('#place').selectOption('mayor');await expect(page.getByRole('tab')).toHaveCount(1);await expect(page.locator('#agent-a0')).toContainText('秘書 · Codex');
 await page.locator('#scope').selectOption('all');await page.locator('#layout').selectOption('1');await page.getByRole('tab',{name:'Agent 2 工房 2',exact:true}).click();await expect(page.locator('#agent-a2')).toContainText('入力待ち');
 state.agents.find(a=>a.id==='a2').state='stop_unknown';await expect(page.locator('#agent-a2')).toContainText('終了結果不明');state.agents.find(a=>a.id==='a2').state='terminated';await expect(page.locator('#agent-a2')).toHaveCount(0);await expect(page.locator('#tab-a2')).toHaveCount(0);await expect(page.locator('.agent-panel:visible')).toHaveCount(1);
 await page.getByRole('button',{name:'終了Agentの履歴',exact:true}).click();await page.locator('#history-agent').selectOption('ended');await expect(page.locator('#history-content')).toContainText('終了後も履歴を保持');
});
test('independent conversation scroll and drafts survive tabs, filters, polling and layout switches',async({page})=>{
 const state=boardFixture();await page.route('**/api/direct',r=>r.fulfill({json:state}));await page.goto('/agents');await page.locator('#layout').selectOption('2');
 const first=page.locator('#agent-a0'),second=page.locator('#agent-a1');await first.locator('textarea').fill('秘書への書きかけ');await second.locator('textarea').fill('別Agentの書きかけ');
 await first.locator('.runs').evaluate(el=>el.scrollTop=215);await second.locator('.runs').evaluate(el=>el.scrollTop=83);
 await page.waitForTimeout(2300);expect(await first.locator('.runs').evaluate(el=>el.scrollTop)).toBe(215);expect(await second.locator('.runs').evaluate(el=>el.scrollTop)).toBe(83);
 await page.locator('#layout').selectOption('1');await page.getByRole('tab',{name:'Agent 9 工房 1',exact:true}).click();await expect(page.locator('#agent-a9')).toBeVisible();
 await page.locator('#scope').selectOption('workshop');await page.locator('#place').selectOption('w3');await page.locator('#scope').selectOption('all');await page.getByRole('tab',{name:'秘書 村長の家（秘書）',exact:true}).click();await page.locator('#layout').selectOption('2');
 await expect(first.locator('textarea')).toHaveValue('秘書への書きかけ');await expect(second.locator('textarea')).toHaveValue('別Agentの書きかけ');expect(await first.locator('.runs').evaluate(el=>el.scrollTop)).toBe(215);expect(await second.locator('.runs').evaluate(el=>el.scrollTop)).toBe(83);
 const body=await page.evaluate(()=>({scroll:document.documentElement.scrollHeight,height:innerHeight}));expect(body.scroll).toBeLessThanOrEqual(body.height);
 await page.locator('#layout').selectOption('9');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
});
test('notification link to a terminated Agent opens saved history, not an Agent tab',async({page})=>{
 const id='bdeab87b-6247-4355-9b5c-3a17c1a3c955',state={workshops:[],agents:[{id,name:'Archived',state:'terminated',connection:{name:'Local'}}],runs:[{id:'run',agentId:id,state:'completed',instruction:'saved',output:'archive reply'}],notification:{}};
 await page.route('**/api/direct',r=>r.fulfill({json:state}));await page.goto('/agents#agent-'+id);await expect(page.locator('#history-dialog')).toBeVisible();await expect(page.locator('#history-content')).toContainText('archive reply');await expect(page.getByRole('tab')).toHaveCount(0);await expect(page.locator('.agent-panel')).toHaveCount(0);
});
test('empty workshop launch inherits context and supports another launch after termination',async({page})=>{
 const state=boardFixture();state.agents=[];state.runs=[];let launched;
 await page.route('**/api/direct**',async r=>{if(r.request().method()==='POST'){const body=r.request().postDataJSON();if(r.request().url().endsWith('/agents')){launched={...body,id:'new-agent',state:'idle',canSend:true,tabId:'tab',connection:{name:'工房 3'}};state.agents.push(launched);return r.fulfill({json:launched});}state.agents[0].state='terminated';}await r.fulfill({json:state});});
 await page.goto('/agents');await page.locator('#scope').selectOption('workshop');await page.locator('#place').selectOption('w3');await page.getByRole('button',{name:'この場所でAgentを起動'}).click();await expect(page.locator('#agent-form [name=workshopId]')).toHaveValue('w3');await page.locator('#agent-form [name=provider]').selectOption('claude');await page.locator('#agent-form button').click();await expect(page.locator('#agent-new-agent')).toBeVisible();expect(launched.provider).toBe('claude');await page.locator('[data-stop]').click();await expect(page.locator('#agent-new-agent')).toHaveCount(0);await page.getByRole('button',{name:'この場所でAgentを起動'}).click();await expect(page.locator('#agent-form button')).toBeEnabled();
});
test('server send eligibility, chat alignment, draft and scroll survive refresh and reload',async({page})=>{
 const state=boardFixture();state.agents[0].canSend=false;state.agents[0].sendReason='確認中';state.runs[0].createdAt='2026-11-04T10:00:00Z';state.runs[0].completedAt='2026-11-04T10:01:00Z';
 await page.route('**/api/direct',r=>r.fulfill({json:state}));await page.goto('/agents');await page.locator('#layout').selectOption('1');const card=page.locator('#agent-a0');await card.locator('textarea').fill('再読み込みでも残す');await expect(card.getByRole('button',{name:'送信',exact:true})).toBeDisabled();state.agents[0].canSend=true;await expect(card.getByRole('button',{name:'送信',exact:true})).toBeEnabled();
 expect(await card.locator('.message.user').evaluate(el=>getComputedStyle(el).alignSelf)).toBe('flex-end');expect(await card.locator('.message.assistant').evaluate(el=>getComputedStyle(el).alignSelf)).toBe('flex-start');expect(await card.locator('time').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(10);
 await card.locator('.runs').evaluate(el=>el.scrollTop=120);await page.waitForTimeout(100);await page.reload();await expect(card.locator('textarea')).toHaveValue('再読み込みでも残す');expect(await card.locator('.runs').evaluate(el=>el.scrollTop)).toBe(120);
});
test('lost send response keeps the draft and verifies with the same idempotency key on explicit action',async({page})=>{
 const state=boardFixture();state.agents=[{...state.agents[0],canSend:true}];state.runs=[];const requests=[];
 await page.route('**/api/direct**',async r=>{if(r.request().method()==='POST'){const body=r.request().postDataJSON();requests.push(body);if(requests.length===1)return r.abort('failed');const run={id:'receipt',agentId:'a0',...body,state:'completed',output:'accepted once'};state.runs.push(run);return r.fulfill({json:run});}return r.fulfill({json:state});});
 await page.goto('/agents');const card=page.locator('#agent-a0');await card.locator('textarea').fill('lost acknowledgement');await card.getByRole('button',{name:'送信',exact:true}).click();await expect(card.locator('textarea')).toHaveValue('lost acknowledgement');await expect(card.getByRole('button',{name:'送信',exact:true})).toBeDisabled();await page.reload();await expect(card.locator('textarea')).toHaveValue('lost acknowledgement');expect(requests.length).toBe(1);await card.getByRole('button',{name:'送信結果を確認',exact:true}).click();await expect(card.locator('.runs')).toContainText('accepted once');expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);await expect(card.getByRole('button',{name:'送信',exact:true})).toBeEnabled();
});
