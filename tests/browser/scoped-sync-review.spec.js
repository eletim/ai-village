import {test,expect} from '@playwright/test';
import {WorkspaceSync} from '../../server/workspace-sync.mjs';
import {workspaceSnapshot,historyPage} from '../../server/conversation-pages.mjs';
test('scoped HTTP conversations: summary, switch, paging, race, unread, drafts and reconnect',async({page})=>{
 test.setTimeout(60000);
 const fixture={agents:[{id:'a',name:'Secretary A',projectId:'p1',role:'secretary',location:'mayor',state:'idle',connection:{},canSend:true,nativeTurns:[]},{id:'b',name:'Secretary B',projectId:'p2',role:'secretary',location:'mayor',state:'idle',connection:{},canSend:true,nativeTurns:[]},{id:'old',name:'Old',projectId:'p2',state:'terminated',nativeTurns:[]}],projects:[{id:'p1',name:'One'},{id:'p2',name:'Two'}],workshops:[],reviews:{b:{unreviewed:true,revision:1}},requests:[],notification:{enabled:false},capabilities:{},runs:[...Array.from({length:180},(_,i)=>({id:'a'+i,agentId:'a',state:'completed',createdAt:new Date(1700000000000+i*1000).toISOString(),instruction:'A question '+i,output:'A answer '+i})),{id:'b1',agentId:'b',state:'completed',instruction:'HIDDEN_B_BODY',output:'B answer'},{id:'o1',agentId:'old',state:'completed',instruction:'HIDDEN_OLD_BODY',output:'Old answer'}]};
 await page.addInitScript(()=>localStorage.setItem('ai-village-sidebar-v1',JSON.stringify({mode:'projects',projects:{id:'project:p1',page:0},places:{id:'all',page:0}})));
 await page.route('http://scope-http.test/**',async r=>{const u=new URL(r.request().url());await r.fulfill({response:await r.fetch({headers:{},url:new URL(u.pathname+u.search,test.info().project.use.baseURL).href})});});
 let server=new WorkspaceSync(),seen=[],hold=false,release,blocked=false;
 await page.route('**/api/**',async r=>{
  const u=new URL(r.request().url());if(u.pathname.endsWith('/history'))return r.fulfill({json:historyPage(fixture,'a',u.searchParams.get('before'))});
  if(u.pathname!=='/api/direct')return r.fulfill({json:{providers:{}}});
  const focus=u.searchParams.has('focus')?JSON.parse(u.searchParams.get('focus')):null;
  const snap=workspaceSnapshot(fixture,JSON.parse(u.searchParams.get('ranges')||'{}'),focus);
  const body=server.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},snap);seen.push({focus,body});
  if(hold&&focus?.includes('b')){hold=false;blocked=true;await new Promise(resolve=>release=resolve);}
  await r.fulfill({json:body});
 });
 await page.goto('http://scope-http.test/agents');await expect(page.locator('#agent-a .run')).toHaveCount(100);
 expect(seen[0].focus).toEqual([]);expect(JSON.stringify(seen)).not.toContain('HIDDEN_B_BODY');expect(JSON.stringify(seen)).not.toContain('HIDDEN_OLD_BODY');
 await page.locator('#agent-a textarea').fill('retained draft');
 await page.locator('#agent-a [data-load-history]').click();await expect(page.locator('#agent-a .run')).toHaveCount(180);
 const log=page.locator('#agent-a .runs');await log.evaluate(e=>{e.scrollTop=200;});await page.waitForTimeout(150);
 const before=await log.evaluate(e=>e.scrollTop);
 await page.locator('[data-place="project:p2"]').click();await expect(page.locator('#agent-b .run')).toContainText('HIDDEN_B_BODY');
 expect(JSON.stringify(seen)).not.toContain('HIDDEN_OLD_BODY');
 await page.locator('[data-place="project:p1"]').click();await expect(page.locator('#agent-a .run')).toHaveCount(180);await expect(page.locator('#agent-a textarea')).toHaveValue('retained draft');
 ;await expect.poll(()=>log.evaluate(e=>e.scrollTop)).toBeCloseTo(before,0);
 hold=true;await page.locator('[data-place="project:p2"]').click();await expect.poll(()=>blocked).toBe(true);await page.locator('[data-place="project:p1"]').click();release();
 await expect(page.locator('#agent-a')).toBeVisible();await expect(page.locator('#agent-a .run')).toHaveCount(180);await expect(page.locator('#agent-b')).toBeHidden();
 server=new WorkspaceSync();await page.waitForTimeout(2500);await expect(page.locator('#agent-a textarea')).toHaveValue('retained draft');await expect(page.locator('#agent-a .run')).toHaveCount(180);
});
