import {notifySnapshot} from './helpers/change-events.js';
import {test,expect} from './helpers/change-events.js';
for(const event of ['visibilitychange','pageshow','online'])test('resume replaces stuck sync without replay or stale overwrite: '+event,async({page})=>{
 await page.addInitScript(()=>{
  const original=window.fetch;window.syncReads=0;window.holdSync=false;
  window.fetch=(url,options)=>{
   if(String(url).includes('?view=workspace')){
    window.syncReads++;
    const snapshot=name=>({workshops:[],agents:[{id:'a',name,state:'idle',canSend:true,connection:{}}],runs:[],notification:{}});
    if(window.holdSync){window.holdSync=false;return new Promise(resolve=>window.releaseOld=()=>resolve(new Response(JSON.stringify(snapshot('OLD')))));}
    return Promise.resolve(new Response(JSON.stringify(snapshot(window.freshName||'Agent'))));
   }
   return original(url,options);
  };
 });
 let mutations=0;await page.route('**/api/**',async route=>{if(route.request().method()==='POST'&&route.request().url().endsWith('/runs'))mutations++;return route.fulfill({json:{}});});
 await page.goto('/agents');const input=page.locator('[name=instruction]');await input.fill('保存する下書き');
 await page.evaluate(()=>{window.holdSync=true;});await notifySnapshot(page);await expect.poll(()=>page.evaluate(()=>!!window.releaseOld)).toBe(true);
 await page.evaluate(event=>{window.freshName='NEW';if(event==='visibilitychange'){Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event(event));}else window.dispatchEvent(event==='pageshow'?new PageTransitionEvent(event,{persisted:true}):new Event(event));},event);
 await expect(page.locator('[data-profile-agent="a"]')).toHaveText('NEW');await expect(input).toHaveValue('保存する下書き');
 await page.evaluate(()=>window.releaseOld());await expect(page.locator('[data-profile-agent="a"]')).toHaveText('NEW');
 await expect(page.locator('#connection')).not.toContainText('同期中');expect(mutations).toBe(0);
});
