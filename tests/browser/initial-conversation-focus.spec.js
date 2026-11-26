import {test,expect} from './helpers/change-events.js';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import {WorkspaceSync} from '../../server/workspace-sync.mjs';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
for(const role of ['secretary','leader','worker'])test('initial deep link fetches only selected '+role+' without an overview round trip',async({page})=>{
 const state={agents:[{id,name:role,role,location:role==='secretary'?'mayor':'workshop',state:'idle',canSend:true,connection:{},nativeTurns:[]},{id:other,name:'Other',location:'workshop',state:'idle',canSend:true,connection:{},nativeTurns:[]}],projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{},runs:[{id:'r',agentId:id,state:'completed',instruction:'actual question',output:'actual answer',finalOutput:'actual answer'},{id:'other',agentId:other,state:'completed',instruction:'other question',output:'OTHER BODY'}]};
 const sync=new WorkspaceSync(),focus=[];
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());if(u.pathname!=='/api/direct')return route.fulfill({json:{providers:{}}});
  const ids=JSON.parse(u.searchParams.get('focus'));focus.push(ids);
  const snapshot=workspaceSnapshot(state,{},ids);
  if(ids.length===1)expect(JSON.stringify(snapshot)).not.toContain(ids[0]===id?'OTHER BODY':'actual answer');
  await route.fulfill({json:sync.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},snapshot)});
 });
 await page.goto('/agents#agent-'+id);
 await expect(page.locator('#agent-'+id+' .runs')).toContainText('actual answer');
 expect(focus[0]).toEqual([id]);await expect(page.locator('#agent-'+other)).toBeHidden();
 await expect(page.locator('#agent-'+id+' textarea')).toBeEditable();
 await page.locator('#agent-'+id+' textarea').fill('draft retained');
 await page.evaluate(other=>location.hash='agent-'+other,other);
 await expect(page.locator('#agent-'+other+' .runs')).toContainText('OTHER BODY');
 await page.evaluate(id=>location.hash='agent-'+id,id);
 await expect(page.locator('#agent-'+id+' textarea')).toHaveValue('draft retained');
});
test('unknown initial deep link falls back without claiming an unloaded conversation is empty',async({page})=>{
 const state={agents:[{id:other,name:'Other',location:'workshop',state:'idle',canSend:true,connection:{},nativeTurns:[]}],projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{},runs:[{id:'r',agentId:other,state:'completed',instruction:'question',output:'fallback answer'}]};
 const sync=new WorkspaceSync();const focus=[];
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname!=='/api/direct')return route.fulfill({json:{providers:{}}});const ids=JSON.parse(u.searchParams.get('focus'));focus.push(ids);await route.fulfill({json:sync.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},workspaceSnapshot(state,{},ids))});});
 await page.goto('/agents#agent-'+id);await expect(page.locator('#agent-'+other+' .runs')).toContainText('fallback answer');expect(focus[0]).toEqual([id]);expect(focus.some(x=>x.includes(other))).toBe(true);
});
test('a delayed initial focus cannot replace a newer selected conversation',async({page})=>{
 const state={agents:[id,other].map(x=>({id:x,name:x,location:'workshop',state:'idle',canSend:true,connection:{},nativeTurns:[]})),projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{},runs:[id,other].map(x=>({id:x,agentId:x,state:'completed',instruction:'question '+x,output:'answer '+x}))};
 const sync=new WorkspaceSync();let release,held=false;
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname!=='/api/direct')return route.fulfill({json:{providers:{}}});const ids=JSON.parse(u.searchParams.get('focus'));const body=sync.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},workspaceSnapshot(state,{},ids));if(!held){held=true;await new Promise(r=>release=r);}await route.fulfill({json:body});});
 await page.goto('/agents#agent-'+id);await expect.poll(()=>held).toBe(true);
 await page.evaluate(x=>location.hash='agent-'+x,other);release();
 await expect(page.locator('#agent-'+other+' .runs')).toContainText('answer '+other);
 await expect(page.locator('#agent-'+id)).toBeHidden();
 await expect(page.locator('#agent-'+other+' .runs')).not.toContainText('answer '+id);
});
test('real static route compresses assets without changing content, cookie or access boundary',async({request})=>{
 const compressed=await request.get('/src/direct.js',{headers:{'Accept-Encoding':'gzip'}}),plain=await request.get('/src/direct.js',{headers:{'Accept-Encoding':'identity'}});
 expect(compressed.headers()['content-encoding']).toBe('gzip');expect(plain.headers()['content-encoding']).toBeUndefined();
 expect(await compressed.text()).toBe(await plain.text());expect(Number(compressed.headers()['content-length'])).toBeLessThan(Number(plain.headers()['content-length']));
 expect(compressed.headers()['vary']).toBe('Accept-Encoding');expect(compressed.headers()['cache-control']).toBe('no-store');
 const html=await request.get('/agents',{headers:{'Accept-Encoding':'gzip'}});expect(html.headers()['set-cookie']).toBeTruthy();expect(await html.text()).toContain('src/direct.js');
 expect((await request.get('/server/direct.mjs')).status()).toBe(404);
 // Static HEAD was unsupported before this change; do not silently change its contract.
 expect((await request.head('/src/direct.js')).status()).toBe(404);
 const denied=await request.get('/src/direct.js',{headers:{'Accept-Encoding':'gzip;q=0'}});expect(denied.headers()['content-encoding']).toBeUndefined();expect(await denied.text()).toBe(await plain.text());
});
test('initial selected thread restores a saved reader position before subsequent renders',async({page})=>{
 const state={agents:[{id,name:'Saved',location:'workshop',state:'idle',canSend:true,connection:{},nativeTurns:[]}],projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{},runs:Array.from({length:100},(_,i)=>({id:'r'+i,agentId:id,state:'completed',createdAt:new Date(1700000000000+i*1000).toISOString(),instruction:'question '+i,output:'saved answer '+i}))};
 await page.addInitScript(id=>sessionStorage.setItem('ai-village-direct-drafts-v2',JSON.stringify({positions:{[id]:{top:400,follow:false}}})),id);
 const sync=new WorkspaceSync();await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname!=='/api/direct')return route.fulfill({json:{providers:{}}});await route.fulfill({json:sync.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},workspaceSnapshot(state,{},JSON.parse(u.searchParams.get('focus'))))});});
 await page.goto('/agents#agent-'+id);await expect(page.locator('#agent-'+id+' .run')).toHaveCount(100);
 await expect.poll(()=>page.locator('#agent-'+id+' .runs').evaluate(n=>n.scrollTop)).toBe(400);
});
test('terminated deep link opens history while a live empty thread remains fetched-empty',async({page})=>{
 const state={agents:[{id,name:'Archived',location:'workshop',state:'terminated',connection:{},nativeTurns:[]},{id:other,name:'Empty',location:'workshop',state:'idle',connection:{},nativeTurns:[]}],projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{},runs:[{id:'r',agentId:id,state:'completed',instruction:'archived question',output:'archived answer'}]};
 const sync=new WorkspaceSync();await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname!=='/api/direct')return route.fulfill({json:{providers:{}}});await route.fulfill({json:sync.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},workspaceSnapshot(state,{},JSON.parse(u.searchParams.get('focus'))))});});
 await page.goto('/agents#agent-'+id);await expect(page.locator('#history-dialog')).toBeVisible();await expect(page.locator('#history-content')).toContainText('archived answer');
 await page.keyboard.press('Escape');await page.evaluate(id=>location.hash='agent-'+id,other);
 await expect(page.locator('#agent-'+other+' .runs')).toHaveAttribute('data-loading','false');await expect(page.locator('#agent-'+other+' .run')).toHaveCount(0);
});

test('deep link in another Project uses normal scope fallback without changing membership',async({page})=>{
 const state={agents:[{id,name:'Target',projectId:'p2',location:'workshop',state:'idle',canSend:true,connection:{},nativeTurns:[]},{id:other,name:'Previous',projectId:'p1',location:'workshop',state:'idle',connection:{},nativeTurns:[]}],projects:[{id:'p1',name:'Previous project'},{id:'p2',name:'Target project'}],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{},runs:[{id:'r',agentId:id,state:'completed',instruction:'target question',output:'target answer'}]};
 await page.addInitScript(()=>localStorage.setItem('ai-village-sidebar-v1',JSON.stringify({mode:'projects',projects:{id:'project:p1',page:0},places:{id:'all',page:0}})));
 const sync=new WorkspaceSync();let mutations=0;await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname!=='/api/direct'){if(!u.pathname.endsWith('/view')&&!u.pathname.endsWith('/presence')&&route.request().method()!=='GET')mutations++;return route.fulfill({json:{providers:{}}});}await route.fulfill({json:sync.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},workspaceSnapshot(state,{},JSON.parse(u.searchParams.get('focus'))))});});
 await page.goto('/agents#agent-'+id);await expect(page.locator('#agent-'+id+' .runs')).toContainText('target answer');await expect(page.locator('#agent-'+other)).toBeHidden();expect(state.agents[0].projectId).toBe('p2');expect(mutations).toBe(0);
});
