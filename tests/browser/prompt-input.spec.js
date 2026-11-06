import {test,expect} from '@playwright/test';

for(const view of ['direct','village','office']) {
 test(`${view}: Ctrl+Enter sends, Enter and Shift+Enter add newline, IME never sends`,async({page})=>{
  const state={workshops:[],agents:[{id:'a',name:'Agent',connection:{name:'工房'},state:'idle',canSend:true}],runs:[],notification:{}};
  const village={workshops:[],jobs:[],secretary:{status:'idle',capabilities:{attachments:true},messages:[]}};
  let sends=0;
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(route.request().method()==='POST')sends++;
   await route.fulfill({json:url.pathname==='/api/direct'?state:url.pathname.endsWith('/runs')?{state:'completed'}:village});
  });
  await page.goto(view==='direct'?'/agents':view==='office'?'/office':'/');
  if(view==='village')await page.locator('#mayor').click();
  const input=page.locator(view==='direct'?'[name=instruction]':'#request');
  await input.fill('日本語');await input.press('Enter');await input.press('Shift+Enter');await expect(input).toHaveValue('日本語\n\n');expect(sends).toBe(0);
  await input.dispatchEvent('compositionstart');await input.dispatchEvent('compositionend');
  await input.press('Enter');await expect(input).toHaveValue('日本語\n\n\n');expect(sends).toBe(0);
  await input.fill('日本語\n\n');
  // Blink/Gecko order, WebKit order, and missing/false isComposing.
  for(const order of ['normal','end-first','229','flag']){
   await input.evaluate((el,order)=>{
    const emit=(type,init={})=>el.dispatchEvent(type.startsWith('composition')?new CompositionEvent(type,{bubbles:true}):new KeyboardEvent(type,{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true,...init}));
    if(order!=='flag'&&order!=='229')emit('compositionstart');
    if(order==='end-first')emit('compositionend');
    emit('keydown',{isComposing:order==='flag',keyCode:order==='229'?229:13});
    if(order==='normal')emit('compositionend');
    emit('keydown',{repeat:true});
    emit('keyup');
   },order);
   expect(sends).toBe(0);
  }
  // Candidate/mouse commit has no Enter keyup. A fresh Control press is a new
  // shortcut, even after a render/poll; its first Enter must send.
  await input.dispatchEvent('compositionstart');await input.dispatchEvent('compositionend');
  await page.waitForTimeout(2200);await expect(input).toHaveValue('日本語\n\n');
  await input.press('Control+Enter');await expect.poll(()=>sends).toBe(1);
 });
}

test('direct input respects disabled sending, empty text and pending request',async({page})=>{
 const state={workshops:[],agents:[{id:'a',name:'Agent',connection:{},state:'busy',canSend:false}],runs:[],notification:{}};
 let sends=0,release;
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST'){sends++;await new Promise(r=>release=r);return route.fulfill({json:{state:'completed'}});}
  await route.fulfill({json:state});
 });
 await page.goto('/agents');const input=page.locator('[name=instruction]');
 await input.fill('draft');await input.press('Control+Enter');expect(sends).toBe(0);
 state.agents[0].canSend=true;state.agents[0].state='idle';
 await expect(page.locator('[data-send] button').first()).toBeEnabled();
 await input.fill('   ');await input.press('Control+Enter');expect(sends).toBe(0);
 await input.fill('send once');await input.press('Control+Enter');await expect.poll(()=>sends).toBe(1);
 await input.press('Control+Enter');expect(sends).toBe(1);release();
});

test('office retries lost response after reload with original request ID and saved attachments',async({page})=>{
 const village={workshops:[],jobs:[],secretary:{status:'idle',capabilities:{attachments:true},messages:[]}},payloads=[];
 await page.route('**/api/**',async route=>{
  if(new URL(route.request().url()).pathname==='/api/messages'&&route.request().method()==='POST'){
   payloads.push(route.request().postDataJSON());
   if(payloads.length===1)return route.abort('failed');
  }
  await route.fulfill({json:village});
 });
 await page.goto('/office');
 // A persisted pending upload must retain the same IDs across a page reload.
 await page.evaluate(()=>sessionStorage.setItem('ai-village-office-pending',JSON.stringify({message:'request with attachment',attachments:['image-existing'],requestId:'office-existing-request'})));
 await page.reload();await expect(page.locator('#request')).toHaveValue('request with attachment');
 await page.locator('#request').press('Control+Enter');await expect.poll(()=>payloads.length).toBe(1);
 await page.reload();await page.locator('#request').press('Control+Enter');await expect.poll(()=>payloads.length).toBe(2);
 expect(payloads[1]).toEqual(payloads[0]);expect(payloads[1].attachments).toEqual(['image-existing']);
 await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('ai-village-office-pending'))).toBeNull();
});
test('busy agent accepts consecutive additional instructions into queue',async({page})=>{
 const runs=[],state={workshops:[],agents:[{id:'a',name:'Agent',connection:{},state:'busy',canSend:false,canQueue:true}],runs,notification:{}};
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST'&&route.request().url().endsWith('/runs')){
   const input=route.request().postDataJSON(),run={...input,id:input.requestId,agentId:'a',state:'queued'};runs.push(run);return route.fulfill({json:run});
  }
  await route.fulfill({json:state});
 });
 await page.goto('/agents');const input=page.locator('[name=instruction]');
 for(const text of ['追加1','追加2']){await input.fill(text);await input.press('Control+Enter');await expect(input).toHaveValue('');}
 expect(runs.map(r=>r.instruction)).toEqual(['追加1','追加2']);await expect(page.getByRole('button',{name:'待機キューへ',exact:true})).toBeEnabled();
});
