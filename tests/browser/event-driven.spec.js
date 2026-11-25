import {test,expect} from '@playwright/test';
test('idle page makes no periodic snapshot requests and receives committed changes over SSE',async({page,request})=>{
 let reads=0;page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/direct')reads++;});
 await page.goto('/agents');await expect.poll(()=>reads).toBeGreaterThan(0);
 await page.waitForTimeout(500);const baseline=reads;await page.waitForTimeout(2300);expect(reads).toBe(baseline);
 const name='event-test-'+Date.now();
 const response=await request.post('/api/direct/workshops',{data:{name,connectionType:'local',baseUrl:'http://localhost:8022',workplaces:['/tmp']}});expect(response.ok()).toBe(true);
 await expect.poll(()=>reads).toBeGreaterThan(baseline);
 await page.locator('#manage').click();await page.getByRole('button',{name:'工房設定',exact:true}).click();await expect(page.locator('#workshops')).toContainText(name);
});
test('deadline and latest report are visible, human changes root deadline with version and reason',async({page})=>{
 const reporting={version:1,completionAt:null,reportAt:null,reports:[{at:'2026-11-19T00:00:00Z',text:'調査が完了しました'}],history:[]};
 const q={id:'q',commonRequests:true,status:'active',revision:1,instruction:'検索を追加',rootWorkId:'w',requestGraph:{rootId:'w',nodes:[{id:'w',parentId:null,assignee:'a',state:{kind:'active',review:[]},metadata:{instruction:'検索を追加',reporting},inbox:[]}]}};
 const state={agents:[{id:'a',name:'秘書A',location:'mayor',state:'idle',connection:{},canSend:true}],projects:[],workshops:[],runs:[],requests:[q],reviews:{},notification:{enabled:false},capabilities:{requestSplitting:true,requestInbox:true}};
 const writes=[];
 await page.route('**/api/**',async route=>{
  const url=route.request().url();if(url.endsWith('/requests/get'))return route.fulfill({json:q});
  if(url.endsWith('/human/requests/deadline')){const x=route.request().postDataJSON();writes.push(x);Object.assign(reporting,{completionAt:x.completionAt,reportAt:x.reportAt,version:2});q.revision++;return route.fulfill({json:{}});}
  return route.fulfill({json:state});
 });
 await page.goto('/agents');await expect(page.locator('.agent-recovery-host')).not.toContainText('調査が完了しました');
 await page.locator('[data-profile-agent]').click();await page.locator('.profile-management summary').click();
 await page.getByRole('button',{name:'期限・報告の詳細'}).click();const dialog=page.getByRole('dialog',{name:'依頼の構成'});await dialog.locator('[data-compose-request]').selectOption('q');
 await dialog.locator('summary').filter({hasText:'期限を設定・変更'}).click();await dialog.locator('[name=completionAt]').fill('2026-12-01T12:00');await dialog.locator('[name=reason]').fill('希望納期を指定');await dialog.getByRole('button',{name:'期限を保存'}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0].expectedVersion).toBe(1);expect(writes[0].reportAt).toBeNull();expect(writes[0].reason).toBe('希望納期を指定');
 await expect(dialog.locator('.request-reporting')).toContainText('2026');
});
