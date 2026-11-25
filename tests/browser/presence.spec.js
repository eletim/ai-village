import {test,expect} from './helpers/change-events.js';
// The village learns that a human is looking at an Agent only from a visible, focused, selected card.
test('viewing a selected Agent reports presence through the human-only route without flooding',async({page})=>{
 const agent={id:'11111111-1111-4111-8111-111111111111',name:'秘書',provider:'claude',location:'mayor',state:'idle',connection:{},canSend:true};
 const state={agents:[agent],workshops:[],runs:[],reviews:{},notification:{enabled:false},capabilities:{presence:true}},presence=[];
 await page.route('**/api/**',r=>{const url=new URL(r.request().url());if(r.request().method()==='POST'&&url.pathname.endsWith('/presence')){presence.push({path:url.pathname,human:r.request().headers()['x-village-human-ui'],viewing:r.request().postDataJSON().viewing});return r.fulfill({json:{ok:true}});}return r.fulfill({json:state});});
 await page.goto('/agents');await page.locator('textarea[name=instruction]').first().click();
 await expect.poll(()=>presence.length).toBeGreaterThan(0);
 expect(presence[0]).toEqual({path:'/api/direct/human/agents/'+agent.id+'/presence',human:'1',viewing:true});
 // Repeated focus within 30s does not flood the server.
 const count=presence.length;await page.locator('textarea[name=instruction]').first().click();await page.waitForTimeout(300);expect(presence.length).toBe(count);
 // Hiding the page reports leaving at once; coming back reports viewing again.
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>presence.at(-1)?.viewing).toBe(false);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>presence.at(-1)?.viewing).toBe(true);
});
test('without the server capability the page never reports presence',async({page})=>{
 const agent={id:'22222222-2222-4222-8222-222222222222',name:'秘書',provider:'claude',location:'mayor',state:'idle',connection:{},canSend:true};
 const state={agents:[agent],workshops:[],runs:[],reviews:{},notification:{enabled:false}},presence=[];
 await page.route('**/api/**',r=>{if(r.request().url().endsWith('/presence'))presence.push(1);return r.fulfill({json:state});});
 await page.goto('/agents');await page.locator('textarea[name=instruction]').first().click();await page.waitForTimeout(500);expect(presence.length).toBe(0);
});
