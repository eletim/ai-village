import {test,expect} from '@playwright/test';
const output='# 見出し\n\n本文 **強調**\n\n```js\nconst x = 1;\n```\n\n'+Array.from({length:70},(_,i)=>`段落${i} 読み返す文章です。`).join('\n\n');
async function setup(page){
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().endsWith('/api/village')?{ok:true,result:{enabled:false}}:{agents:[{id:'a',name:'Agent',state:'idle',connection:{},canSend:true}],workshops:[],runs:[{id:'r',agentId:'a',instruction:'人間の入力',output,state:'completed'}],reviews:{},notification:{enabled:false}}}));
 await page.goto('/agents');await expect(page.locator('.markdown-report h1')).toBeVisible();
}
const px=el=>el.evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
test('Direct font sizes, reflow, caret, follow and read position',async({page})=>{
 await setup(page);const input=page.locator('#agent-a textarea'),log=page.locator('.runs'),body=page.locator('.markdown-report'),code=body.locator('pre'),heading=body.locator('h1');
 const medium=await px(body),baseInput=await px(input),ratio=await px(heading)/medium,baseCode=await px(code);
 await input.fill('折り返し確認 '.repeat(22));await input.evaluate(e=>{e.focus();e.setSelectionRange(2,6);window.kept=e;});
 // Programmatic preference updates exercise focus/caret without the dialog taking focus.
 const change=values=>page.evaluate(async v=>(await import('/src/display-preferences.js')).saveDisplay(v),values);
 await change({textSize:'large',font:'meiryo'});await expect(body).toHaveCSS('font-family',/Meiryo/);expect(await px(body)).toBeCloseTo(medium*1.2);expect(await px(input)).toBeCloseTo(baseInput*1.2);expect(await px(code)).toBeCloseTo(baseCode*1.2);expect(await px(heading)/await px(body)).toBeCloseTo(ratio);
 await expect.poll(()=>log.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<3)).toBe(true);
 expect(await input.evaluate(e=>e===window.kept&&document.activeElement===e&&e.selectionStart===2&&e.selectionEnd===6)).toBe(true);
 const largeHeight=await input.evaluate(e=>e.clientHeight);await log.evaluate(e=>e.scrollTop=100);await page.waitForTimeout(80);await change({textSize:'small'});await expect.poll(()=>log.evaluate(e=>e.scrollTop)).toBe(100);expect(await px(body)).toBeCloseTo(medium*.85);await expect.poll(()=>input.evaluate(e=>e.clientHeight)).toBeLessThan(largeHeight);
 await change({viewer:'plain'});await expect(page.locator('.plain-report')).toHaveCSS('font-size',`${medium*.85}px`);await expect.poll(()=>log.evaluate(e=>e.scrollTop)).toBe(100);
 await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.getByLabel('文字サイズ')).toHaveValue('small');await expect(page.getByLabel('書体',{exact:true})).toHaveValue('meiryo');await page.getByLabel('文字サイズ').selectOption('large');await page.keyboard.press('Escape');await page.reload();await expect(page.locator('.plain-report')).toHaveCSS('font-size',`${medium*1.2}px`);
 await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.getByLabel('文字サイズ')).toHaveValue('large');await expect(page.getByLabel('書体',{exact:true})).toHaveValue('meiryo');
});
test('three themes at narrow width and invalid stored values',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('village-display',JSON.stringify({font:'invalid',textSize:'huge',viewer:'markdown'})));await setup(page);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.getByLabel('文字サイズ')).toHaveValue('medium');await expect(page.getByLabel('書体',{exact:true})).toHaveValue('meiryo');await page.getByLabel('文字サイズ').selectOption('large');await page.getByLabel('書体',{exact:true}).selectOption('meiryo');
 for(const theme of ['dark','light','sepia']){await page.getByLabel('配色テーマ').selectOption(theme);await page.screenshot({path:`/tmp/village-font-${theme}-settings.png`});await page.keyboard.press('Escape');await page.screenshot({path:`/tmp/village-font-${theme}-mobile.png`});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'設定',exact:true}).click();}
});
test('terminated Agent history uses stored size and font for both viewer modes',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('village-display',JSON.stringify({textSize:'large',font:'meiryo'})));
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().endsWith('/api/village')?{ok:true,result:{enabled:false}}:{agents:[{id:'old',name:'履歴Agent',state:'terminated',connection:{}}],workshops:[],runs:[{id:'r',agentId:'old',instruction:'以前の依頼',output:'# 過去の報告\n\n本文',state:'completed'}],notification:{enabled:false}}}));await page.goto('/agents');await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByRole('button',{name:'終了Agentの履歴',exact:true}).click();const history=page.locator('#history-content');await expect(history.locator('.markdown-report')).toHaveCSS('font-size','16.8px');await expect(history.locator('.markdown-report')).toHaveCSS('font-family',/Meiryo/);await expect(history.locator('.message.user pre')).toHaveCSS('font-size','15.6px');
 await page.evaluate(async()=>(await import('/src/display-preferences.js')).saveDisplay({viewer:'plain',textSize:'small'}));await expect(history.locator('.plain-report')).toHaveCSS('font-size','11.9px');await expect(history.locator('.plain-report')).toContainText('# 過去の報告');
});
test('touch composers stay at or above the iOS zoom threshold across text sizes and orientations; desktop keeps the plain text-scale size',async({page,browser})=>{
 await setup(page);const input=page.locator('#agent-a textarea');
 const change=p=>p.evaluate(async v=>(await import('/src/display-preferences.js')).saveDisplay(v),{textSize:'small'});
 // Desktop (any-pointer:fine) is unaffected by the touch floor: small/large still fall below 16px.
 const medium=await px(input);await change(page);expect(await px(input)).toBeCloseTo(medium*.85);
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  const touch=await browser.newContext({viewport,isMobile:true,hasTouch:true}),tpage=await touch.newPage();
  await setup(tpage);const tInput=tpage.locator('#agent-a textarea');
  const setSize=textSize=>tpage.evaluate(async v=>(await import('/src/display-preferences.js')).saveDisplay(v),{textSize});
  for(const [textSize,expected] of [['small',16],['medium',16],['large',19.2]]){await setSize(textSize);expect(await px(tInput)).toBeCloseTo(expected,1);}
  await touch.close();
 }
});
