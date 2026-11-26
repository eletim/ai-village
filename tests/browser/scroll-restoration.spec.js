import {test,expect} from '@playwright/test';
async function setup(page){
 await page.route('**/api/**',r=>r.fulfill({json:{agents:[],workshops:[],runs:[],notification:{}}}));await page.goto('/agents');
 await page.evaluate(async()=>{
  const {chatScroll}=await import('/src/chat-scroll.js');const area=document.createElement('div');area.id='restore-log';area.tabIndex=0;area.style.cssText='position:fixed;top:20px;left:20px;width:300px;height:200px;overflow:auto;overflow-anchor:none;z-index:99999';area.dataset.loading='true';document.body.append(area);
  const saved=[];const controller=chatScroll(area,{saved:{follow:false,top:400},onSave:v=>saved.push({...v})});
  window.restoreFixture={area,controller,saved,fill(){area.innerHTML=Array.from({length:20},(_,i)=>`<div data-entry="${i}" style="height:100px">line ${i}</div>`).join('');area.dataset.loading='false';}};
 });
}
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
test('loaded then repeated renderBoard capture/prepare retains pending saved position',async({page})=>{
 await setup(page);await page.evaluate(()=>{const f=window.restoreFixture;f.fill();f.controller.loaded();for(let i=0;i<4;i++){f.controller.capture();f.controller.prepare()();}});await frames(page);
 const result=await page.evaluate(()=>({top:restoreFixture.area.scrollTop,saved:restoreFixture.saved}));expect(result.top).toBe(400);expect(result.saved.every(s=>s.top===400&&s.follow===false)).toBe(true);
});
test('hidden/loading display-change keeps pending restoration without hidden geometry reads',async({page})=>{
 await setup(page);await page.evaluate(()=>{const f=restoreFixture;f.fill();f.area.hidden=true;Object.defineProperty(f.area,'clientHeight',{configurable:true,get(){throw Error('hidden geometry');}});f.controller.loaded();f.controller.capture();f.controller.prepare()();window.dispatchEvent(new Event('display-change'));});await frames(page);
 await page.evaluate(()=>{const f=restoreFixture;delete f.area.clientHeight;f.area.hidden=false;window.dispatchEvent(new Event('display-change'));f.controller.capture();f.controller.prepare()();});await frames(page);expect(await page.locator('#restore-log').evaluate(n=>n.scrollTop)).toBe(400);
});
test('pending anchor survives capture and multiple history prepends',async({page})=>{
 await setup(page);await page.evaluate(()=>{restoreFixture.fill();restoreFixture.controller.loaded();});await frames(page);
 await page.evaluate(()=>{const f=restoreFixture;f.controller.prepare();f.area.insertAdjacentHTML('afterbegin','<div style="height:150px">older</div>');f.controller.changed();f.controller.capture();f.controller.prepare();f.area.insertAdjacentHTML('afterbegin','<div style="height:50px">more</div>');f.controller.loaded();f.controller.capture();});await frames(page);expect(await page.locator('#restore-log').evaluate(n=>n.scrollTop)).toBe(600);
});
test('real wheel before pending restoration wins over saved position',async({page})=>{
 await setup(page);await frames(page);
 // Hold only this controller batch so Chromium can perform a real wheel scroll first.
 await page.evaluate(()=>{window.originalRAF=window.requestAnimationFrame;window.heldFrames=[];window.requestAnimationFrame=cb=>{heldFrames.push(cb);return 100000+heldFrames.length;};restoreFixture.fill();restoreFixture.controller.loaded();});
 expect(await page.locator('#restore-log').evaluate(n=>n.scrollTop)).toBe(0);
 await page.mouse.move(100,100);await page.mouse.wheel(0,170);await expect.poll(()=>page.locator('#restore-log').evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
 const top=await page.locator('#restore-log').evaluate(n=>n.scrollTop);
 await page.evaluate(()=>{restoreFixture.controller.capture();restoreFixture.controller.prepare()();window.requestAnimationFrame=originalRAF;for(const cb of heldFrames)originalRAF(cb);});await frames(page);
 expect(await page.locator('#restore-log').evaluate(n=>n.scrollTop)).toBe(top);expect(top).not.toBe(400);
});
test('destroy before restoration cancels writes and scroll saving',async({page})=>{
 await setup(page);await page.evaluate(()=>{const f=restoreFixture;f.fill();f.controller.loaded();f.controller.destroy();f.area.scrollTop=100;f.area.dispatchEvent(new Event('scroll'));f.controller.restore();});await frames(page);
 expect(await page.evaluate(()=>restoreFixture.saved)).toEqual([]);expect(await page.locator('#restore-log').evaluate(n=>n.scrollTop)).toBe(100);
});
