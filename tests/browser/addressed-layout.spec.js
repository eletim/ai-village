import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import {test,expect} from './helpers/change-events.js';
test('addressed controls span the composer width at desktop and mobile sizes',async({page})=>{
 const state={agents:[{id:'a',name:'送信秘書',location:'mayor',projectId:'source',state:'idle',canSend:true,connection:{}}],projects:[{id:'source',name:'元Project'},{id:'p1',name:'同名'},{id:'p2',name:'同名'}],workshops:[],runs:[],notification:{},capabilities:{secretaryConversations:true,requestInbox:true},requests:['p1','p2'].map((id,i)=>({id:'q'+i,projectId:id,conversationId:'c'+i,rootWorkId:'work'+i,instruction:'同名の目的',createdAt:'2026-01-01T00:00:00Z',requestGraph:{nodes:[{id:'work'+i,state:{kind:'active'},assignee:'worker'+i}]}}))};
 Object.assign(state,workspaceSnapshot(state));

 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('?view=workspace')?state:{}}));
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto('/agents');const card=page.locator('#agent-a');await card.locator('.input-scope summary').click();const form=await card.locator('form[data-send]').boundingBox(),scope=await card.locator('.input-scope').boundingBox(),select=await card.locator('[name=scopeWork]').boundingBox();expect(scope.width).toBeGreaterThan(form.width*.85);const target=await card.locator('[name=requestTarget]').boundingBox();expect(target.width).toBeGreaterThan(form.width*.85);expect(select.x+select.width).toBeLessThanOrEqual(form.x+form.width+1);await page.screenshot({path:'/tmp/village-common-work-live-e48968b9/scope-layout-'+width+'.png'});}
});
