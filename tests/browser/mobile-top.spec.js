import {test,expect,devices} from '@playwright/test';
const {defaultBrowserType,...iphone}=devices['iPhone 13'];
const baseline=!!process.env.MOBILE_BASELINE;
for(const device of ['android','iphone','pc'])for(const theme of ['light','dark'])test.describe(`${device} ${theme}`,()=>{
 test.use(device==='iphone'?iphone:device==='android'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:1050}});
 test('toolbar, project and stable keyboard footer',async({page},info)=>{
  const state={workshops:[],projects:[{id:'p',name:'村実装'}],agents:['a','b'].map((id,i)=>({id,name:'秘書'+(i+1),projectId:'p',projectName:'村実装',location:'mayor',state:'idle',canSend:true,connection:{}})),runs:[],reviews:{},notification:{enabled:false}};
  await page.addInitScript(theme=>localStorage.setItem('village-display',JSON.stringify({theme})),theme);
  await page.route('**/api/**',r=>r.fulfill({json:state}));await page.goto('/agents');
  await page.locator('#agent-a [data-zoom]').click();
  const top=()=>page.locator('#agents').evaluate(el=>el.getBoundingClientRect().top);
  const open=await top();await page.locator('#sidebar-toggle').click();await expect(page.locator('.sidebar')).toBeHidden();
  if(!baseline&&device!=='pc')await expect(page.locator('header>.board-heading')).toBeVisible();
  const closed=await top();console.log('HEIGHT',device,theme,JSON.stringify({open,closed}));
  if(!baseline){if(device!=='pc')expect(closed).toBeLessThan(open-30);await expect(page.locator('#board-title')).toHaveText('村実装');await expect(page.locator('#board-title')).not.toContainText('秘書');await page.locator('#next-agent').click();await expect(page.locator('#agent-b')).toBeVisible();await page.locator('#next-agent').click();}
  await page.locator('#manage').click();await expect(page.locator('dialog[open]')).toBeVisible();await page.keyboard.press('Escape');
  await page.screenshot({path:info.outputPath('compact.png'),fullPage:true});
  const input=page.locator('#agent-a textarea');
  await page.evaluate(()=>{window.footerStates=[];window.footerFrame=0;const tick=()=>{const visible=getComputedStyle(document.querySelector('footer')).display!=='none';if(window.footerStates.at(-1)!==visible)window.footerStates.push(visible);window.footerFrame=requestAnimationFrame(tick);};tick();});
  await input.focus();await input.fill('入力\n'.repeat(20));
  const shrink=async height=>page.evaluate(h=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,value:h});window.visualViewport.dispatchEvent(new Event('resize'));},height);
  const full=await page.evaluate(()=>innerHeight);
  await shrink(full-300);await page.waitForTimeout(100);
  if(baseline){console.log('OCCLUDED',device,await page.locator('footer').evaluate(el=>({display:getComputedStyle(el).display,bottom:el.getBoundingClientRect().bottom,visualHeight:visualViewport.height})));}
  else if(device!=='pc')await expect(page.locator('footer')).toBeHidden();else await expect(page.locator('footer')).toBeVisible();
  for(const delta of [280,320,290]){await shrink(full-delta);await input.fill('伸長\n'.repeat(delta/10));await page.waitForTimeout(50);}
  await page.locator('#agent-a h2').click();await page.waitForTimeout(50);
  if(!baseline&&device!=='pc')await expect(page.locator('footer')).toBeHidden();
  await shrink(full);await expect(page.locator('footer')).toBeVisible();await page.waitForTimeout(50);
  const transitions=await page.evaluate(()=>{cancelAnimationFrame(window.footerFrame);return window.footerStates;});console.log('FOOTER',device,theme,JSON.stringify(transitions));
  if(!baseline)expect(transitions).toEqual(device==='pc'?[true]:[true,false,true]);
  await expect(page.locator('footer')).toHaveCSS('font-variant-numeric',baseline?'normal':'tabular-nums');
  if(!baseline){const sizes=await page.evaluate(async()=>{const {connectionStatus}=await import('/src/compact-status.js');return ['11:11:11','22:58:48'].map(time=>{connectionStatus(document.querySelector('#connection'),time,{normal:true});const r=document.querySelector('#connection').getBoundingClientRect();return [r.width,r.height];});});expect(sizes[0]).toEqual(sizes[1]);}
  await page.locator('#sidebar-toggle').click();await expect(page.locator('.sidebar')).toBeVisible();
 });
});
