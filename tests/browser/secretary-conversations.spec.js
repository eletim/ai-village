import {test,expect} from './helpers/change-events.js';
test('conversation choice, leader setting and internal result differ from human answer',async({page},testInfo)=>{
 const calls=[];const snapshot={capabilities:{requestInbox:true,secretaryConversations:true},projects:[{id:'p1',name:'会話Project',revision:0,leaderAgentId:'b'}],workshops:[],agents:[{id:'a',name:'秘書',location:'mayor',projectId:'p1',state:'idle',connection:{},canSend:true},{id:'b',name:'実装リーダー',location:'workshop',projectId:'p1',state:'idle',connection:{name:'工房'},canSend:true}],runs:[{id:'answer',agentId:'a',conversationId:'c',state:'completed',instruction:'相談です',output:'その進め方でよいと思います。',createdAt:'2026-11-24T01:00:00Z'},{id:'return',agentId:'a',conversationId:'c',state:'completed',suppressUser:true,reportStatus:'リーダーの資料への返答',instruction:'内部の成果資料',output:'成果が揃いました。次の点を確認してください。',createdAt:'2026-11-24T02:00:00Z'}],requests:[],reviews:{},notification:{enabled:false}};
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET'){calls.push({url:route.request().url(),body:route.request().postDataJSON()});return route.fulfill({json:{id:'accepted'}});}
  return route.fulfill({json:snapshot});
 });
 await page.goto('/agents');
 const secretary=page.locator('#agent-a');await expect(secretary.locator('[name=requestTarget]')).toHaveValue('');await expect(secretary).not.toContainText('仕事のリーダー: 実装リーダー');
 await expect(secretary).toContainText('その進め方でよいと思います。');await expect(secretary).toContainText('成果が揃いました');
 await secretary.locator('textarea').fill('今日は相談だけです');await secretary.locator('form [type=submit]').click();await expect.poll(()=>calls.length).toBe(1);expect(calls[0].body.mode).toBe('conversation');
 await page.locator('[data-add="project:p1"]').click();await expect(page.locator('#project-leader-form')).toBeVisible();await expect(page.locator('#project-leader-form select')).toHaveValue('b');
 await page.locator('#project-leader-form select').selectOption('');await page.getByRole('button',{name:'リーダーを保存',exact:true}).click();await expect.poll(()=>calls.length).toBe(2);expect(calls[1].body).toEqual({revision:0,leaderAgentId:null});
 await page.screenshot({path:testInfo.outputPath('conversation-desktop.png')});
});
