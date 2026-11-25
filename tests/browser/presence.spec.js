import {test,expect} from './helpers/change-events.js';
// The village learns that a human is looking at an Agent only from a visible, focused, selected card.
test('viewing a selected Agent reports presence through the human-only route without flooding',async({page})=>{
 const agent={id:'11111111-1111-4111-8111-111111111111',name:'秘書',provider:'claude',location:'mayor',state:'idle',connection:{},canSend:true};
 const state={agents:[agent],workshops:[],runs:[],reviews:{},notification:{enabled:false},capabilities:{presence:true}},presence=[];
 await page.route('**/api/**',r=>{const url=new URL(r.request().url());if(r.request().method()==='POST'&&url.pathname.endsWith('/presence')){presence.push({path:url.pathname,human:r.request().headers()['x-village-human-ui']});return r.fulfill({json:{ok:true}});}return r.fulfill({json:state});});
 await page.goto('/agents');await page.locator('textarea[name=instruction]').first().click();
 await expect.poll(()=>presence.length).toBeGreaterThan(0);
 expect(presence[0]).toEqual({path:'/api/direct/human/agents/'+agent.id+'/presence',human:'1'});
 // Repeated focus within 30s does not flood the server.
 const count=presence.length;await page.locator('textarea[name=instruction]').first().click();await page.waitForTimeout(300);expect(presence.length).toBe(count);
});
test('without the server capability the page never reports presence',async({page})=>{
 const agent={id:'22222222-2222-4222-8222-222222222222',name:'秘書',provider:'claude',location:'mayor',state:'idle',connection:{},canSend:true};
 const state={agents:[agent],workshops:[],runs:[],reviews:{},notification:{enabled:false}},presence=[];
 await page.route('**/api/**',r=>{if(r.request().url().endsWith('/presence'))presence.push(1);return r.fulfill({json:state});});
 await page.goto('/agents');await page.locator('textarea[name=instruction]').first().click();await page.waitForTimeout(500);expect(presence.length).toBe(0);
});
