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
 await expect(page.locator('#agent-form [name=cwd]')).toHaveValue('/tmp/local');
 await page.locator('#agent-form button').click();
 await expect.poll(()=>submitted?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('three places, focused view, provider identity and native waiting state',async({page})=>{
 const state={workshops:[{id:'local',name:'E-ryzen',connectionType:'local',workplaces:['/tmp']},{id:'remote',name:'E-frontier',connectionType:'ssh',workplaces:['/tmp']}],runs:[],notification:{},agents:[{id:'mayor',location:'mayor',name:'ミク',provider:'codex',state:'idle',connection:{name:'E-ryzen'},workshopId:'local'},{id:'remote-agent',name:'Claude係',provider:'claude',state:'waiting_input',connection:{name:'E-frontier'},workshopId:'remote'}]};
 await page.route('**/api/direct',route=>route.fulfill({json:state}));await page.goto('/agents');
 await expect(page.locator('[data-place]')).toHaveCount(3);await expect(page.locator('#place-mayor')).toContainText('ミク · Codex');await expect(page.locator('#place-remote')).toContainText('Claude係 · Claude');await expect(page.locator('#place-remote')).toContainText('入力待ち');
 await page.locator('[data-view=remote]').click();await expect(page.locator('#place-mayor')).toBeHidden();await expect(page.locator('#place-remote')).toBeVisible();await page.locator('[data-view=all]').click();await expect(page.locator('#place-mayor')).toBeVisible();
});
