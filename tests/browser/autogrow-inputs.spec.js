import {test,expect} from '@playwright/test';
const height=input=>input.evaluate(el=>el.getBoundingClientRect().height);
async function setup(page,mode){
 const state={workshops:[],agents:[{id:'a',name:'Agent',connection:{},state:'idle',canSend:true}],runs:Array.from({length:20},(_,i)=>({id:'r'+i,agentId:'a',instruction:'past',output:'応答\n'.repeat(10),state:'completed'})),notification:{}};
 const office={workshops:[],jobs:[],secretary:{status:'idle',messages:state.runs.map(r=>({id:r.id,role:'assistant',content:r.output,at:new Date().toISOString()}))}};let failure=false,sends=0;
 await page.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;if(r.request().method()==='POST'&&(path.endsWith('/runs')||path==='/api/messages')){sends++;if(failure)return r.fulfill({status:409,json:{error:'fixture failure'}});return r.fulfill({json:mode==='direct'?{state:'completed'}:office});}return r.fulfill({json:path==='/api/direct'?state:path==='/api/todos'?{items:[]}:office});});
 await page.goto(mode==='direct'?'/agents':mode==='office'?'/office':'/');if(mode==='village')await page.locator('#mayor').click();
 const input=page.locator(mode==='direct'?'[name=instruction]':'#request'),log=page.locator(mode==='direct'?'.runs':'#conversation-log');await expect(input).toBeVisible();await expect.poll(()=>height(input)).toBeGreaterThan(20);
 return {input,log,sends:()=>sends,fail:value=>failure=value};
}
for(const mode of ['direct','office','village'])test(`${mode}: grow/shrink, wrap, IME, draft, resize, cap, send failure and clear`,async({page})=>{
 const f=await setup(page,mode),input=f.input;await input.fill('短文');await page.waitForTimeout(60);const small=await height(input);
 await input.fill('折り返し確認用の文章です。'.repeat(24));await expect.poll(()=>height(input)).toBeGreaterThan(small);const wide=await height(input);
 await page.setViewportSize({width:700,height:900});await expect.poll(()=>height(input)).toBeGreaterThan(wide);if(mode==='direct')await expect.poll(()=>f.log.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<3)).toBe(true);
 await input.fill('改行\n'.repeat(70));await expect.poll(()=>input.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);expect(await height(input)).toBeLessThanOrEqual(361);if(mode==='direct')expect(await height(input)).toBeLessThanOrEqual(await page.locator('.agent-panel').evaluate(el=>Math.max(60,el.clientHeight*.4+1)));
 await page.screenshot({path:`/tmp/village-autogrow-${mode}-long.png`});await page.reload();await expect(input).toHaveValue('改行\n'.repeat(70));await expect.poll(()=>input.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await input.fill('短文');await expect.poll(()=>height(input)).toBeLessThan(90);
 await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='変換中\n'.repeat(8);el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText'}));el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',ctrlKey:true,isComposing:true,keyCode:229}));});await expect.poll(()=>height(input)).toBeGreaterThan(small);expect(f.sends()).toBe(0);
 await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));});
 f.fail(true);const draft=await input.inputValue();await input.press('Control+Enter');await expect.poll(()=>f.sends()).toBe(1);await expect(input).toHaveValue(draft);const failedHeight=await height(input);expect(failedHeight).toBeGreaterThan(small);
 await expect(input).toBeEnabled();await expect(page.locator(mode==='direct'?'[data-send] > button[type=submit]':'#send')).toBeEnabled();f.fail(false);await input.press('Control+Enter');await expect(input).toHaveValue('');await expect.poll(()=>height(input)).toBeLessThan(failedHeight);await page.screenshot({path:`/tmp/village-autogrow-${mode}.png`});
});
test('Direct input growth preserves reader position, follow mode, poll identity and selection',async({page})=>{
 const {input,log}=await setup(page,'direct');const bottom=()=>log.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<3);await expect.poll(bottom).toBe(true);
 await input.fill('入力中\n'.repeat(10));await expect.poll(bottom).toBe(true);await log.evaluate(el=>el.scrollTop=100);await expect(page.locator('.latest-message')).toBeVisible();
 await input.fill('長い入力\n'.repeat(50));await page.waitForTimeout(100);expect(await log.evaluate(el=>el.scrollTop)).toBe(100);await input.evaluate(el=>{el.focus();el.setSelectionRange(12,17);window.keptInput=el;});
 await page.waitForTimeout(2200);expect(await input.evaluate(el=>el===window.keptInput&&document.activeElement===el&&el.selectionStart===12&&el.selectionEnd===17)).toBe(true);expect(await log.evaluate(el=>el.scrollTop)).toBe(100);
 await input.fill('短い');await page.waitForTimeout(100);expect(await log.evaluate(el=>el.scrollTop)).toBe(100);await page.locator('.latest-message').click();await expect.poll(bottom).toBe(true);
});
test('Direct paste and card resize keep conversation space, and zoom/reload retain input sizing',async({page})=>{
 const state={workshops:[],agents:Array.from({length:4},(_,i)=>({id:'a'+i,name:'Agent '+i,connection:{},state:'idle',canSend:true})),runs:[],notification:{}};
 await page.route('**/api/**',r=>r.fulfill({json:state}));await page.goto('/agents');const card=page.locator('#agent-a0'),input=card.locator('textarea');await expect(card).toBeVisible();
 await input.evaluate(el=>{el.focus();el.setRangeText('貼付した長文\n'.repeat(60),0,el.value.length,'end');el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));});
 await expect.poll(()=>input.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);await expect.poll(()=>height(input)).toBeGreaterThan(100);const grouped=await height(input);expect(await card.locator('.runs').evaluate(el=>el.clientHeight)).toBeGreaterThan(30);
 await card.locator('[data-zoom]').click();await expect.poll(()=>height(input)).toBeGreaterThan(grouped);await card.locator('[data-zoom]').click();await expect.poll(()=>height(input)).toBeLessThanOrEqual(grouped+1);
 await page.reload();await expect(input).toHaveValue('貼付した長文\n'.repeat(60));await expect.poll(()=>height(input)).toBeLessThanOrEqual(grouped+1);
 await page.setViewportSize({width:1440,height:720});await expect.poll(()=>height(input)).toBeLessThan(grouped);expect(await card.locator('.runs').evaluate(el=>el.clientHeight)).toBeGreaterThan(20);await page.screenshot({path:'/tmp/village-autogrow-grid.png'});
});
