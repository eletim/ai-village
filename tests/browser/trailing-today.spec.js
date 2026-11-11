import {test,expect} from '@playwright/test';
for(const screen of ['agents'])test(`${screen}: empty, past and new today messages have one today marker`,async({page})=>{
 const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);let messages=[];
 await page.route('**/api/**',r=>r.fulfill({json:{agents:[{id:'a',name:'秘書',location:'mayor',state:'idle',connection:{},canSend:true}],runs:messages.map(m=>({...m,agentId:'a',createdAt:m.at,instruction:m.content,state:'completed'})),projects:[],workshops:[],reviews:{},notification:{enabled:false},items:[],jobs:[],secretary:{status:'idle',messages}}}));
 await page.goto('/'+screen);const log=page.locator('#agent-a .runs');
 await expect(log.locator('.date-divider')).toHaveText(['今日']);
 messages=[{id:'old',role:'user',content:'昨日の話',at:yesterday.toISOString()}];await page.reload();
 await expect(log.locator('.date-divider')).toHaveText(['昨日','今日']);await expect(log.locator(':scope > :last-child')).toHaveText('今日');
 messages.push({id:'new',role:'user',content:'今日の話',at:new Date().toISOString()});await page.reload();
 await expect(log.locator('.date-divider')).toHaveText(['昨日','今日']);await expect(log.locator(':scope > :last-child')).toContainText('今日の話');
});
