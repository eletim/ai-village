import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
import sharp from 'sharp';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
async function setup(page,width){
 await page.setViewportSize({width,height:844});
 const text=ids.map((id,i)=>`![image${i}](village-image:${id})`).join('\n');
 const r={id:'r',agentId:'s',conversationId:'c',conversationSource:{kind:'human'},sessionId:'ss',turnId:'tt',state:'running',origin:'human',createdAt:'2026-11-26T00:00:00Z',instruction:'images',output:text,livePreview:{runId:'r',sessionId:'ss',turnId:'tt',messages:[{id:'m',phase:'commentary',offset:10,text}]}};
 const state={agents:[{id:'s',name:'Secretary',location:'mayor',connection:{},state:'busy'}],projects:[],workshops:[],runs:[r],reviews:{},notification:{enabled:false}};
 const writes=[];const bytes=await sharp({create:{width:1200,height:900,channels:3,background:'#268392'}}).png().toBuffer();
 await page.route('**/api/**',route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/images/'))return route.fulfill({contentType:'image/png',body:bytes});if(route.request().method()!=='GET'){writes.push(u.pathname);return route.fulfill({json:{}});}return route.fulfill({json:u.pathname==='/api/direct'?workspaceSnapshot(state,{},JSON.parse(u.searchParams.get('focus')||'null'),{lazyBodies:true,previewAgent:u.searchParams.get('preview')}):{}});});
 await page.goto('/agents');await page.locator('#agent-s h2').click();await page.getByRole('button',{name:'image0を拡大'}).click();
 const d=page.locator('.report-lightbox'),v=d.locator('.report-image-viewport');await expect(v).toHaveAttribute('data-scale','1');await expect.poll(()=>d.locator('img').evaluate(e=>e.naturalWidth)).toBe(1200);
 return {r,state,d,v,writes};
}
for(const width of [1440,390])test(`wheel anchor, bounds, keyboard, snapshot and focus ${width}`,async({page})=>{
 const {r,d,v,writes}=await setup(page,width),box=await v.boundingBox(),img=d.locator('img');
 const p={x:box.x+box.width*.55,y:box.y+box.height*.5},before=await img.boundingBox();await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-200);
 await expect.poll(async()=>Number(await v.getAttribute('data-scale'))).toBeGreaterThan(1.7);const after=await img.boundingBox();
 expect(Math.abs((p.x-before.x)/before.width-(p.x-after.x)/after.width)).toBeLessThan(.002);expect(Math.abs((p.y-before.y)/before.height-(p.y-after.y)/after.height)).toBeLessThan(.002);
 await page.mouse.wheel(0,-200);await expect.poll(async()=>Number(await v.getAttribute('data-scale'))).toBeGreaterThan(3);
 await page.mouse.down();await page.mouse.move(p.x+100,p.y+80,{steps:6});await page.mouse.up();const pan=await img.boundingBox();expect(pan.x).not.toBe(after.x);
 // Trackpad pinch arrives as Ctrl+wheel: zoom the image, not the page.
 const scale=Number(await v.getAttribute('data-scale'));await page.keyboard.down('Control');await page.mouse.wheel(0,-60);await page.keyboard.up('Control');await expect.poll(async()=>Number(await v.getAttribute('data-scale'))).toBeGreaterThan(scale);expect(await page.evaluate(()=>visualViewport.scale)).toBe(1);
 // Keyboard arrows pan while enlarged; no accidental image navigation.
 await v.focus();await page.keyboard.press('ArrowRight');await expect(d.locator('[data-count]')).toHaveText('1 / 2');await page.keyboard.press('0');await expect(v).toHaveAttribute('data-scale','1');await page.keyboard.press('ArrowRight');await expect(d.locator('[data-count]')).toHaveText('2 / 2');await expect(v).toHaveAttribute('data-scale','1');
 for(let i=0;i<14;i++)await page.keyboard.press('+');await expect(v).toHaveAttribute('data-scale','8');for(let i=0;i<30;i++)await page.keyboard.press('ArrowLeft');await expect(v).toHaveAttribute('data-scale','8');await expect(d.locator('[data-count]')).toHaveText('2 / 2');const clamped=await img.boundingBox(),currentBox=await v.boundingBox();expect(clamped.x).toBeLessThanOrEqual(currentBox.x+1);expect(clamped.x+clamped.width).toBeGreaterThanOrEqual(currentBox.x+currentBox.width-1);
 const src=await img.getAttribute('src');r.livePreview.messages[0].text='Images removed during viewing';r.output='Images removed during viewing';await notifySnapshot(page);await expect(img).toHaveAttribute('src',src);await page.keyboard.press('Escape');await expect(page.locator('.secretary-preview')).toContainText('Images removed during viewing');await expect(page.locator('#agent-s .runs')).toBeFocused();
 expect(writes).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/exploration-fixes-focus-${width}.png`});
});
test('Chromium touch pinch continuously zooms and pans; switching and reopening reset',async({page,context})=>{
 const {d,v,writes}=await setup(page,390);const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});const b=await v.boundingBox(),cx=b.x+b.width/2,cy=b.y+b.height/2;
 const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([x,y],i)=>({x,y,id:i,radiusX:5,radiusY:5,force:1}))});
 for(let round=0;round<2;round++){
  await touch('touchStart',[[cx-35,cy],[cx+35,cy]]);for(let x=40;x<=70;x+=5)await touch('touchMove',[[cx-x,cy],[cx+x,cy]]);await touch('touchEnd',[]);
 }
 await expect.poll(async()=>Number(await v.getAttribute('data-scale'))).toBeGreaterThan(3.8);await expect(d.locator('[data-count]')).toHaveText('1 / 2');
 const enlarged=Number(await v.getAttribute('data-scale'));await touch('touchStart',[[cx-70,cy],[cx+70,cy]]);for(let x=68;x>=60;x-=2)await touch('touchMove',[[cx-x,cy],[cx+x,cy]]);await touch('touchEnd',[]);await expect.poll(async()=>Number(await v.getAttribute('data-scale'))).toBeLessThan(enlarged);
 const before=await d.locator('img').boundingBox();await touch('touchStart',[[cx,cy]]);for(let i=1;i<=5;i++)await touch('touchMove',[[cx+i*10,cy+i*8]]);await touch('touchEnd',[]);const after=await d.locator('img').boundingBox();expect(after.x-before.x).toBeGreaterThan(40);expect(after.y-before.y).toBeGreaterThan(30);
 expect(await page.evaluate(()=>scrollY)).toBe(0);await d.getByRole('button',{name:'次の画像'}).click();await expect(v).toHaveAttribute('data-scale','1');await page.screenshot({path:'/tmp/exploration-fixes-touch.png'});
 await d.getByRole('button',{name:'閉じる',exact:true}).click();await expect(page.locator('.secretary-preview')).toBeVisible();await expect(page.getByRole('button',{name:'image0を拡大'})).toBeFocused();await page.getByRole('button',{name:'image1を拡大'}).click();await expect(v).toHaveAttribute('data-scale','1');expect(writes).toEqual([]);
});
test('close sync removes a formerly connected opener: focus falls back to conversation',async({page})=>{
 const {r,d}=await setup(page,390);r.state='completed';r.conversationAnswer=true;r.finalOutput=r.output;await notifySnapshot(page);await expect(page.locator('#agent-s .response-final')).toBeVisible();
 let release,started;const pending=new Promise(r=>started=r);let held=false;
 await page.route('**/api/direct?**',async route=>{if(!held){held=true;started();await new Promise(r=>release=r);}return route.fallback();});
 await d.getByRole('button',{name:'閉じる',exact:true}).click();await pending;
 r.finalOutput='更新後の回答・画像なし';r.output=r.finalOutput;release();await expect(page.locator('#agent-s .response-final')).toContainText('画像なし');await expect(page.locator('#agent-s .runs')).toBeFocused();
});
