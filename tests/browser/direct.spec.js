import {directSnapshot,mockSnapshot} from './helpers/direct-fixtures.js';
import {test,expect} from '@playwright/test';
// These existing place-operation scenarios start from the persisted Places mode.
test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('ai-village-sidebar-v1'))localStorage.setItem('ai-village-sidebar-v1',JSON.stringify({mode:'places'}));});});
test('direct workshop editor, safe output and persistent instruction draft',async({page})=>{
 const state={workshops:[],agents:[],runs:[],notification:{destinationConfigured:false}};
 await page.route('**/api/direct**',async route=>{
  const request=route.request();const body=request.method()==='GET'?null:request.postDataJSON();
  if(request.method()==='POST'&&request.url().endsWith('/workshops'))state.workshops.push({...body,id:'workshop'});
  if(request.method()==='PUT')Object.assign(state.workshops[0],body);
  await route.fulfill({json:state});
 });
 await page.goto('/agents');
 await page.locator('#manage').click();await page.getByRole('button',{name:'工房設定',exact:true}).click();
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
 await page.route(directSnapshot,async route=>{
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
 await page.locator('#manage').click();await page.getByRole('button',{name:'工房設定',exact:true}).click();
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
 await page.locator('[data-add=local]').click();await page.locator('#manual-add').click();
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
test('sidebar uses registered places, auto layout, same-button restore and archived termination',async({page})=>{
 const state=boardFixture();await page.route(directSnapshot,r=>r.fulfill({json:state}));await page.goto('/agents');
 await expect(page.locator('[data-place]')).toHaveCount(6);await expect(page.locator('.agent-panel:visible')).toHaveCount(9);
 await page.locator('#next-page').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(4);await page.locator('#previous-page').click();
 await expect(page.locator('#scope,#layout,#agent-tabs,[data-launch]:visible')).toHaveCount(0);
 await expect(page.locator('#agent-ended')).toHaveCount(0);
 await page.locator('[data-place=w3]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(3);
 await page.locator('#agent-a7 [data-zoom]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(1);
 await expect(page.locator('[data-place=w3]')).toHaveAttribute('aria-current','page');
 await expect(page.locator('#agent-a7 [data-zoom]')).toHaveAttribute('aria-label','一覧に戻る');
 await page.locator('#agent-a7 [data-zoom]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(3);
 await page.locator('[data-place=mayor]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(1);await expect(page.locator('#agent-a0 .agent-name')).toHaveText('秘書');await expect(page.locator('#agent-a0 .header-status')).toHaveAttribute('aria-label',/秘書/);await page.locator('#agent-a0 .agent-name').click();await expect(page.getByRole('dialog',{name:'Agentのプロフィール'})).toContainText('Codex');await page.keyboard.press('Escape');
 await page.locator('[data-place=all]').click();await page.locator('#agent-a2 [data-zoom]').click();await expect(page.locator('#agent-a2')).toContainText('入力待ち');
 state.agents.find(a=>a.id==='a2').state='stopping';await expect(page.locator('#agent-a2')).toContainText('終了処理中');state.agents.find(a=>a.id==='a2').state='unknown';await expect(page.locator('#agent-a2')).toContainText('接続・状態不明');
 state.agents.find(a=>a.id==='a2').state='terminated';await expect(page.locator('#agent-a2')).toHaveCount(0);await expect(page.locator('.agent-panel:visible')).toHaveCount(9);
 state.workshops.push({id:'new-place',name:'追加工房',connectionType:'ssh',workplaces:['/tmp']});await expect(page.locator('[data-place="new-place"]')).toContainText('追加工房');
 await page.locator('#manage').click();await page.getByRole('button',{name:'終了Agentの履歴',exact:true}).click();await page.locator('#history-agent').selectOption('ended');await expect(page.locator('#history-content')).toContainText('終了後も履歴を保持');
});
test('drafts, conversation and board scroll survive place, zoom, polling and responsive layout',async({page})=>{
 const state=boardFixture();const polls=await mockSnapshot(page,state);await page.goto('/agents');
 const first=page.locator('#agent-a0'),second=page.locator('#agent-a1');await first.locator('textarea').fill('秘書への書きかけ');await second.locator('textarea').fill('別Agentの書きかけ');
 for(const card of [first,second])await expect.poll(()=>card.locator('.runs').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(3);
 await first.locator('.runs').evaluate(el=>el.scrollTop=215);await expect(first.locator('.latest-message')).toBeVisible();await second.locator('.runs').evaluate(el=>el.scrollTop=83);await expect(second.locator('.latest-message')).toBeVisible();
 const previous=polls();await expect.poll(polls).toBeGreaterThan(previous);expect(await first.locator('.runs').evaluate(el=>el.scrollTop)).toBe(215);expect(await second.locator('.runs').evaluate(el=>el.scrollTop)).toBe(83);
 await page.locator('#next-page').click();await page.locator('#agent-a9 [data-zoom]').scrollIntoViewIfNeeded();const top=await page.locator('#agents').evaluate(el=>el.scrollTop);
 await page.locator('#agent-a9 [data-zoom]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(1);
 await page.locator('#agent-a9 [data-zoom]').click();expect(await page.locator('#agents').evaluate(el=>el.scrollTop)).toBe(top);
 await page.locator('#agent-a9 [data-zoom]').click();state.agents.find(a=>a.id==='a9').state='terminated';await expect(page.locator('#agent-a9')).toHaveCount(0);await expect(page.locator('#page-number')).toHaveText('2 / 2');
 await page.locator('[data-place=w3]').click();await page.locator('[data-place=all]').click();await page.locator('#previous-page').click();
 await expect(first.locator('textarea')).toHaveValue('秘書への書きかけ');await expect(second.locator('textarea')).toHaveValue('別Agentの書きかけ');expect(await first.locator('.runs').evaluate(el=>el.scrollTop)).toBe(215);expect(await second.locator('.runs').evaluate(el=>el.scrollTop)).toBe(83);
 const columns=()=>page.locator('#agents').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
 expect(await columns()).toBeGreaterThan(1);
 await page.setViewportSize({width:390,height:844});await expect.poll(columns).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
 await page.locator('[data-place=w3]').click();await page.locator('#agent-a7 [data-zoom]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(1);await page.locator('#agent-a7 [data-zoom]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(3);
 await page.screenshot({path:'/tmp/ai-village-sidebar-mobile.png'});
});
test('notification link to a terminated Agent opens saved history, not an Agent tab',async({page})=>{
 const id='bdeab87b-6247-4355-9b5c-3a17c1a3c955',state={workshops:[],agents:[{id,name:'Archived',state:'terminated',connection:{name:'Local'}}],runs:[{id:'run',agentId:id,state:'completed',instruction:'saved',output:'archive reply'}],notification:{}};
 await page.route(directSnapshot,r=>r.fulfill({json:state}));await page.goto('/agents#agent-'+id);await expect(page.locator('#history-dialog')).toBeVisible();await expect(page.locator('#history-content')).toContainText('archive reply');await expect(page.locator('.agent-panel')).toHaveCount(0);await expect(page.locator('.agent-panel')).toHaveCount(0);
});
test('empty workshop launch inherits context and supports another launch after termination',async({page})=>{
 const state=boardFixture();state.agents=[];state.runs=[];let launched;
 await page.route('**/api/direct**',async r=>{if(r.request().method()==='POST'){const body=r.request().postDataJSON();if(r.request().url().endsWith('/agents')){launched={...body,id:'new-agent',state:'idle',canSend:true,tabId:'tab',connection:{name:'工房 3'}};state.agents.push(launched);return r.fulfill({json:launched});}state.agents[0].state='terminated';}await r.fulfill({json:state});});
 await page.goto('/agents');await page.locator('[data-place=w3]').click();await page.locator('#manage').click();await page.locator('#manual-add').click();await expect(page.locator('#agent-form [name=workshopId]')).toHaveValue('w3');await page.locator('#agent-form [name=provider]').selectOption('claude');await page.locator('#agent-form button').click();await expect(page.locator('#agent-new-agent')).toBeVisible();expect(launched.provider).toBe('claude');await page.locator('[data-manage-agent]').click();await page.locator('#stop-form [name=confirm]').check();await page.locator('#stop-form button').click();await expect(page.locator('#agent-new-agent')).toHaveCount(0);await page.locator('#manage').click();await page.locator('#manual-add').click();await expect(page.locator('#agent-form button')).toBeEnabled();
});
test('server send eligibility, chat alignment, draft and scroll survive refresh and reload',async({page})=>{
 const state=boardFixture();state.agents[0].canSend=false;state.agents[0].sendReason='確認中';state.runs[0].createdAt='2026-11-04T10:00:00Z';state.runs[0].completedAt='2026-11-04T10:01:00Z';
 await page.route(directSnapshot,r=>r.fulfill({json:state}));await page.goto('/agents');await page.locator('#agent-a0 [data-zoom]').click();const card=page.locator('#agent-a0');await card.locator('textarea').fill('再読み込みでも残す');await expect(card.getByRole('button',{name:'送信',exact:true})).toBeDisabled();state.agents[0].canSend=true;await expect(card.getByRole('button',{name:'送信',exact:true})).toBeEnabled();
 expect(await card.locator('.message.user').evaluate(el=>getComputedStyle(el).alignSelf)).toBe('flex-end');expect(await card.locator('.message.assistant').evaluate(el=>getComputedStyle(el).alignSelf)).toBe('flex-start');expect(await card.locator('time').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(10);
 await card.locator('.runs').evaluate(el=>el.scrollTop=120);await page.waitForTimeout(100);await page.reload();await expect(card.locator('textarea')).toHaveValue('再読み込みでも残す');expect(await card.locator('.runs').evaluate(el=>el.scrollTop)).toBe(120);
});
test('lost send response keeps the draft and verifies with the same idempotency key on explicit action',async({page})=>{
 const state=boardFixture();state.agents=[{...state.agents[0],canSend:true}];state.runs=[];const requests=[];
 await page.route('**/api/direct**',async r=>{if(r.request().method()==='POST'){const body=r.request().postDataJSON();requests.push(body);if(requests.length===1)return r.abort('failed');const run={id:'receipt',agentId:'a0',...body,state:'completed',output:'accepted once'};state.runs.push(run);return r.fulfill({json:run});}return r.fulfill({json:state});});
 await page.goto('/agents');const card=page.locator('#agent-a0');await card.locator('textarea').fill('lost acknowledgement');await card.getByRole('button',{name:'送信',exact:true}).click();await expect(card.locator('textarea')).toHaveValue('lost acknowledgement');await expect(card.getByRole('button',{name:'送信結果を確認中',exact:true})).toBeDisabled();await page.reload();await expect(card.locator('textarea')).toHaveValue('lost acknowledgement');expect(requests.length).toBe(1);await card.getByRole('button',{name:'送信結果を確認',exact:true}).click();await expect(card.locator('.runs')).toContainText('accepted once');expect(requests.length).toBe(2);expect(requests[1]).toEqual(requests[0]);await expect(card.getByRole('button',{name:'送信',exact:true})).toBeEnabled();
});

test('each place menu launches and sends to its exact Agent without switching another connection',async({page})=>{
 const state={workshops:[{id:'local',name:'E-ryzen',connectionType:'local',workplaces:['/local/work']},{id:'remote',name:'E-frontier',connectionType:'ssh',sshHost:'E-frontier',workplaces:['/remote/work']}],agents:[],runs:[],notification:{}};
 const launches=[],sends=[];
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();
   if(route.request().url().endsWith('/agents')){launches.push(body);const a={...body,id:'agent'+launches.length,state:'idle',canSend:true,connection:state.workshops.find(w=>w.id===body.workshopId)};state.agents.push(a);return route.fulfill({json:a});}
   sends.push({url:route.request().url(),body});return route.fulfill({json:{state:'completed'}});
  }
  await route.fulfill({json:state});
 });
 await page.goto('/agents');
 for(const [place,workshop,cwd,location] of [['remote','remote','/remote/work','workshop'],['local','local','/local/work','workshop'],['mayor','local','/local/work','mayor']]){
  await page.locator(`[data-add=${place}]`).click();await page.locator('#manual-add').click();
  await expect(page.locator('#agent-form [name=workshopId]')).toHaveValue(workshop);
  await expect(page.locator('#agent-form [name=cwd]')).toHaveValue(cwd);
  await expect(page.locator('#agent-form [name=location]')).toHaveValue(location);
  await page.locator('#agent-form button').click();
  const id='agent'+launches.length;
  await expect(page.locator(`[data-place=${place}]`)).toHaveAttribute('aria-current','page');
  await page.locator(`#agent-${id} textarea`).fill('target '+id);await page.locator(`#agent-${id} textarea`).press('Control+Enter');
  await expect.poll(()=>sends.length).toBe(launches.length);
  expect(sends.at(-1).url).toContain('/agents/'+id+'/runs');
 }
 expect(launches.map(a=>[a.workshopId,a.cwd,a.location])).toEqual([['remote','/remote/work','workshop'],['local','/local/work','workshop'],['local','/local/work','mayor']]);
});

test('secretary setup opens local runtime registration, and zoom survives polling until explicit place change',async({page})=>{
 const state={workshops:[{id:'remote',name:'E-frontier',connectionType:'ssh',workplaces:['/tmp']}],agents:[],runs:[],notification:{}};
 await page.route(directSnapshot,r=>r.fulfill({json:state}));await page.goto('/agents');
 await expect(page.locator('[data-add=mayor]')).toBeEnabled();
 await page.locator('[data-place=mayor]').click();await expect(page.locator('#start-secretary')).toBeEnabled();
 await page.locator('#start-secretary').click();await expect(page.locator('#settings-dialog')).toBeVisible();
 await expect(page.locator('#secretary-setup-help')).toBeVisible();await expect(page.locator('#workshop-form [name=connectionType]')).toHaveValue('local');
 await page.locator('#settings-dialog [data-close]').click();
 state.agents.push({id:'a',workshopId:'remote',name:'Agent',connection:state.workshops[0],state:'idle',canSend:true});
 await page.locator('[data-place=all]').click();await expect(page.locator('#agent-a')).toBeVisible();
 await page.locator('#agent-a [data-zoom]').click();await page.waitForTimeout(2200);await expect(page.locator('#agent-a [data-zoom]')).toHaveAttribute('aria-expanded','true');
 await page.locator('[data-place=remote]').click();await expect(page.locator('#agent-a [data-zoom]')).toHaveAttribute('aria-expanded','false');
});

test('registering a local runtime from secretary entry continues to secretary launch',async({page})=>{
 const state={workshops:[],agents:[],runs:[],notification:{}};
 await page.route('**/api/direct**',route=>{
  if(route.request().method()==='POST'&&new URL(route.request().url()).pathname==='/api/direct/workshops')state.workshops.push({...route.request().postDataJSON(),id:'local'});
  return route.fulfill({json:state});
 });
 await page.goto('/agents');await page.locator('#start-secretary').click();
 await expect(page.locator('#workshop-title')).toHaveText('秘書の実行環境を登録');
 await page.locator('#workshop-form [name=baseUrl]').fill('http://localhost:8022/');
 await page.locator('#workshop-form [name=workplaces]').fill('/tmp');
 await page.locator('#workshop-form button').first().click();
 await expect(page.locator('#agent-dialog')).toBeVisible();
 await expect(page.locator('#agent-form [name=location]')).toHaveValue('mayor');
 await expect(page.locator('#agent-form [name=workshopId]')).toHaveValue('local');
 await expect(page.locator('#agent-form [name=name]')).toHaveValue('秘書');
});
