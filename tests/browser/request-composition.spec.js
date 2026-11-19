import {test,expect} from '@playwright/test';
test('human saves an unassigned child, chooses an Agent and starts it once',async({page})=>{
 const q={id:'q',commonRequests:true,status:'active',revision:1,instruction:'検索を追加',rootWorkId:'w',requestGraph:{rootId:'w',nodes:[{id:'w',parentId:null,assignee:'a',state:{kind:'active',review:[]},metadata:{instruction:'検索を追加'},inbox:[]}]}};
 const state={agents:[{id:'a',name:'秘書A',location:'mayor',state:'idle',connection:{},canSend:true},{id:'b',name:'秘書B',location:'mayor',state:'idle',connection:{},canSend:true}],projects:[],workshops:[],runs:[],requests:[q],reviews:{},notification:{enabled:false},capabilities:{requestSplitting:true,requestInbox:true}};
 const writes=[];
 await page.route('**/api/**',async route=>{
  const url=route.request().url();if(url.endsWith('/requests/get'))return route.fulfill({json:q});
  if(url.includes('/human/requests/')){const x=route.request().postDataJSON();writes.push({url,x});if(url.endsWith('/plan'))q.requestGraph.nodes.push({id:'child',parentId:'w',assignee:null,planned:true,state:{kind:'active',review:[]},metadata:{instruction:x.instruction},inbox:[]});else {q.requestGraph.nodes[1].assignee=x.agentId;q.requestGraph.nodes[1].planned=false;}q.revision++;return route.fulfill({json:{id:'child'}});}
  return route.fulfill({json:state});
 });
 await page.goto('/agents');await page.locator('[data-manage-agent="a"]').click();await page.getByRole('button',{name:'依頼の構成・分割'}).click();const dialog=page.getByRole('dialog',{name:'依頼の構成'});
 await dialog.locator('[data-compose-request]').selectOption('q');await dialog.locator('textarea').fill('検索APIを実装しテストする');await dialog.getByRole('button',{name:'子依頼を追加'}).click();await expect(dialog.locator('.request-tree')).toContainText('担当未定');expect(writes).toHaveLength(1);
 await expect(dialog.locator('[data-assignee=child] option[value=a]')).toHaveCount(0);await dialog.locator('[data-assignee=child]').selectOption('b');await dialog.getByRole('button',{name:'開始',exact:true}).click();await expect(dialog.locator('.request-tree')).toContainText('秘書B · 進行中');expect(writes).toHaveLength(2);expect(writes[1].x.revision).toBe(2);expect(writes[1].x.workId).toBe('child');await expect(dialog.getByRole('button',{name:'開始',exact:true})).toHaveCount(0);
});
