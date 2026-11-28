import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import {test,expect} from './helpers/change-events.js';
test('target selection is stable, explicit, retained with the draft, and sent with its text',async({page})=>{
 const state={agents:[{id:'a',name:'送信秘書',location:'mayor',projectId:'source',state:'idle',canSend:true,connection:{}}],projects:[{id:'source',name:'元Project'},{id:'p1',name:'同名'},{id:'p2',name:'同名'}],workshops:[],runs:[],notification:{},capabilities:{secretaryConversations:true,requestInbox:true},requests:['p1','p2'].map((id,i)=>({id:'q'+i,projectId:id,conversationId:'c'+i,rootWorkId:'work'+i,instruction:'同名の目的',createdAt:'2026-01-01T00:00:00Z',requestGraph:{nodes:[{id:'work'+i,state:{kind:'active'},assignee:'worker'+i}]}}))};
 Object.assign(state,workspaceSnapshot(state));
 const sent=[];
 await page.route('**/api/**',route=>{const r=route.request();if(r.url().includes('?view=workspace'))return route.fulfill({json:state});if(r.method()==='POST'&&r.url().endsWith('/runs')){sent.push(r.postDataJSON());return route.fulfill({status:503,json:{error:'isolated response loss'}});}return route.fulfill({json:{}});});
 await page.goto('/agents');const card=page.locator('#agent-a');await card.locator('[data-manage-agent]').click();await page.locator('#manage-addressed').click();await card.locator('[name=scopeWork]').selectOption('work1');await card.locator('[name=scopeAction][value=continue]').check();await page.keyboard.press('Escape');await card.locator('textarea').fill('選択した仕事を続けて');expect(sent).toHaveLength(0);
 await page.reload();await expect(card.locator('textarea')).toHaveValue('選択した仕事を続けて');await card.locator('[data-manage-agent]').click();await page.locator('#manage-addressed').click();await expect(card.locator('[name=scopeWork]')).toHaveValue('work1');await expect(card.locator('[name=scopeAction][value=continue]')).toBeChecked();
 await page.keyboard.press('Escape');await card.locator('[type=submit]').click();await expect.poll(()=>sent.length).toBe(1);expect(sent[0].scope).toEqual({projectId:'p2',workId:'work1',actions:['continue']});expect(sent[0].instruction).toBe('選択した仕事を続けて');await page.reload();await page.waitForTimeout(200);expect(sent).toHaveLength(1);
});

test("late successful submission preserves the next draft and its scope",async({page})=>{
 const state={agents:[{id:'a',name:'送信秘書',location:'mayor',projectId:'source',state:'idle',canSend:true,connection:{}}],projects:[{id:'source',name:'元Project'},{id:'p1',name:'同名'},{id:'p2',name:'同名'}],workshops:[],runs:[],notification:{},capabilities:{secretaryConversations:true,requestInbox:true},requests:['p1','p2'].map((id,i)=>({id:'q'+i,projectId:id,conversationId:'c'+i,rootWorkId:'work'+i,instruction:'同名の目的',createdAt:'2026-01-01T00:00:00Z',requestGraph:{nodes:[{id:'work'+i,state:{kind:'active'},assignee:'worker'+i}]}}))};

 Object.assign(state,workspaceSnapshot(state));
 let pending;const sent=[];
 await page.route('**/api/**',route=>{const r=route.request();if(r.url().includes('?view=workspace'))return route.fulfill({json:state});if(r.method()==='POST'&&r.url().endsWith('/runs')){sent.push(r.postDataJSON());pending=route;return;}return route.fulfill({json:{}});});
 await page.goto('/agents');const card=page.locator('#agent-a');await card.locator('[data-manage-agent]').click();await page.locator('#manage-addressed').click();await card.locator('[name=scopeWork]').selectOption('work1');await card.locator('[name=scopeAction][value=continue]').check();await page.keyboard.press('Escape');await card.locator('textarea').fill('先行する指示');await page.keyboard.press('Escape');await card.locator('[type=submit]').click();await expect.poll(()=>sent.length).toBe(1);
 await page.keyboard.press('Escape');await card.locator('textarea').fill('次の指示');await pending.fulfill({json:{id:'accepted',state:'running',acceptedAt:'2026-01-01T00:00:00Z'}});await page.waitForTimeout(150);
 await expect(card.locator('textarea')).toHaveValue('次の指示');await expect(card.locator('[name=scopeWork]')).toHaveValue('work1');await expect(card.locator('[name=scopeAction][value=continue]')).toBeChecked();
 await page.reload();await expect(card.locator('textarea')).toHaveValue('次の指示');await card.locator('[data-manage-agent]').click();await page.locator('#manage-addressed').click();await expect(card.locator('[name=scopeWork]')).toHaveValue('work1');await expect(card.locator('[name=scopeAction][value=continue]')).toBeChecked();expect(sent).toHaveLength(1);
});
