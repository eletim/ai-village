import {test,expect} from '@playwright/test';
import {WorkspaceSync} from '../../server/workspace-sync.mjs';
import {workspaceSnapshot,historyPage} from '../../server/conversation-pages.mjs';
for(const origin of ['localhost','http']) test('incremental workspace retains history, drafts and repeated text through append, lost base and removal ('+origin+')',async({page})=>{
 if(origin==='http') await page.route('http://village-http.test/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({headers:{},url:new URL(u.pathname+u.search,test.info().project.use.baseURL).href});await route.fulfill({response});});
 const state={agents:[{id:'a',name:'Fixture',location:'mayor',state:'idle',connection:{},canSend:true,nativeTurns:[]}],projects:[],workshops:[],reviews:{},requests:[],notification:{enabled:false},capabilities:{attachments:true},runs:Array.from({length:130},(_,i)=>({id:'r'+i,agentId:'a',createdAt:new Date(1700000000000+i*1000).toISOString(),state:'completed',instruction:'question '+i,output:'answer '+i,finalOutput:'final '+i}))};
 let server=new WorkspaceSync(),deltas=0,fulls=0;
 await page.route('**/api/**',r=>{
  const u=new URL(r.request().url());
  if(u.pathname.endsWith('/history'))return r.fulfill({json:historyPage(state,'a',u.searchParams.get('before'))});
  if(u.pathname==='/api/direct'){
   const envelope=server.reply({client:u.searchParams.get('client'),since:u.searchParams.get('since')},workspaceSnapshot(state,JSON.parse(u.searchParams.get('ranges')||'{}')));
   if(envelope.mode==='delta')deltas++;else fulls++;return r.fulfill({json:envelope});
  }
  return r.fulfill({json:{providers:{}}});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin==='http'?'http://village-http.test/agents':'/agents');if(origin==='http') expect(await page.evaluate(()=>({secure:isSecureContext,uuid:typeof crypto.randomUUID}))).toEqual({secure:false,uuid:'undefined'});const runs=page.locator('.runs .run');await expect(runs).toHaveCount(100);
 await page.locator('textarea[name=instruction]').fill('preserve my draft');
 await page.getByRole('button',{name:'古い会話を読み込む'}).click();await expect(runs).toHaveCount(130);expect(deltas).toBeGreaterThan(0);
 state.runs.push({id:'new',agentId:'a',createdAt:'2030-01-01',instruction:'new question',output:'repeat '.repeat(100),state:'running'});
 await expect(runs).toHaveCount(131);state.runs.at(-1).output+=' repeat';await expect(page.locator('.runs')).toContainText('repeat repeat');
 state.runs.at(-1).output='replacement after correction';await expect(page.locator('.runs')).toContainText('replacement after correction');
 server=new WorkspaceSync();await expect.poll(()=>fulls).toBe(2);await expect(runs).toHaveCount(131);await expect(page.locator('textarea[name=instruction]')).toHaveValue('preserve my draft');
 state.runs.pop();await expect(runs).toHaveCount(130);expect(errors).toEqual([]);
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.runs')).toBeVisible();
});
