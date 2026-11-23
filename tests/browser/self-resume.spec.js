import {test,expect} from './helpers/change-events.js';
for(const width of [1440,390])test('single resume reservation is visible without adding human controls '+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 const reservation={id:'timer',at:'2030-01-02T03:04:05Z',text:'ファイルの変更を確認し、観察した結果を報告する',actorRunId:'r',status:'scheduled'};
 const q={id:'q',commonRequests:true,status:'active',revision:1,instruction:'後で確認',rootWorkId:'w',waiting:{w:'self-resume'},requestGraph:{rootId:'w',nodes:[{id:'w',parentId:null,assignee:'a',state:{kind:'active',review:[]},metadata:{instruction:'後で確認'},inbox:[],selfResume:{version:1,current:reservation,history:[]}}]}};
 const state={agents:[{id:'a',name:'確認担当',location:'mayor',state:'idle',connection:{},canSend:true}],projects:[],workshops:[],runs:[],requests:[q],reviews:{},notification:{enabled:false},capabilities:{requestSplitting:true,requestInbox:true}};
 const writes=[];await page.route('**/api/**',async route=>{const url=route.request().url();if(url.endsWith('/requests/get'))return route.fulfill({json:q});if(route.request().method()!=='GET')writes.push(url);return route.fulfill({json:state});});
 await page.goto('/agents');await page.locator('[data-manage-agent="a"]').click();await page.getByRole('button',{name:'依頼の構成・分割'}).click();const dialog=page.getByRole('dialog',{name:'依頼の構成'});await dialog.locator('[data-compose-request]').selectOption('q');
 const status=dialog.locator('.request-self-resume');await expect(status).toContainText('再確認待ち');await expect(status).toContainText('2030');await expect(status).toContainText(reservation.text);await expect(status).toContainText('期限とは別');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/self-resume-'+width+'.png'});
 reservation.status='cancelled';await dialog.locator('[data-compose-request]').selectOption('');await dialog.locator('[data-compose-request]').selectOption('q');await expect(dialog.locator('.request-self-resume')).toContainText('取消済み');expect(writes).toEqual([]);
});
