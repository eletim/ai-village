import {test,expect} from '@playwright/test';
test('busy secretary explicitly chooses A supplement without steering B; closed target never becomes new request',async({page})=>{
 const a={id:'a',name:'秘書',location:'mayor',state:'busy',connection:{},canSend:false,canQueue:true,canSteer:true,steerTarget:{runId:'B',sessionId:'s',turnId:'t'}};
 const q={id:'A',status:'active',instruction:'依頼A',requestGraph:{nodes:[{id:'workA',assignee:'a',state:{kind:'active',review:[]},metadata:{instruction:'依頼A'},inbox:[]}]}};
 const state={agents:[a],projects:[],workshops:[],runs:[],requests:[q],reviews:{},notification:{enabled:false},capabilities:{requestInbox:true}};const sends=[];
 await page.route('**/api/**',async route=>{
  if(route.request().method()==='POST'&&route.request().url().endsWith('/human/requests/supplement')){const body=route.request().postDataJSON();sends.push(body);q.requestGraph.nodes[0].inbox.push({id:'input',operationId:body.operationId,kind:'supplement',text:body.instruction,createdAt:new Date().toISOString(),attempts:[]});return route.fulfill({json:{id:'input'}});}
  return route.fulfill({json:state});
 });
 await page.goto('/agents');const choice=page.getByRole('combobox',{name:'依頼・補足先'});await expect(choice).toHaveValue('');
 await choice.selectOption('A:workA');await page.locator('textarea[name=instruction]').fill('Aへの追加条件');await page.getByRole('button',{name:'補足を送信',exact:true}).click();
 await expect.poll(()=>sends.length).toBe(1);expect(sends[0].humanRequestId).toBe('A');expect(sends[0].workId).toBe('workA');expect(sends[0].steerTarget).toBeUndefined();await expect(page.locator('.runs')).toContainText('Aへの追加条件');
 q.status='completed';await expect(choice).toContainText('補足先は終了済み');await expect(page.getByRole('button',{name:'補足を送信',exact:true})).toBeDisabled();
 await choice.selectOption('');await expect(page.getByRole('button',{name:'待機キューへ',exact:true})).toBeEnabled();
});
