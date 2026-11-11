import {test,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {WeeklyUsage} from '../../server/weekly-usage.mjs';
const fixture=()=>({agents:[{id:'a',name:'秘書１',location:'mayor',state:'idle',connection:{},canSend:true}],workshops:[],projects:[],reviews:{},notification:{enabled:false},requests:[{id:'q',status:'completed',works:[]}],runs:[{id:'r',agentId:'a',humanRequestId:'q',instruction:'質問',output:'回答',state:'completed',reportStatus:'報告完了'}]});
for(const theme of ['light','dark'])for(const width of [1440,390])test(`${theme} ${width}: rename placeholder, combined completion and real fixture-file usage`,async({page},info)=>{
 const s=fixture();await page.setViewportSize({width,height:width===390?844:1050});await page.addInitScript(theme=>localStorage.setItem('village-display',JSON.stringify({theme})),theme);
 const file=info.outputPath('rate-limits.json'),ts=Date.now()/1000,seven_day={used_percentage:30,resets_at:ts+86400};await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify({claude:{ts,seven_day,five_hour:{used_percentage:12,resets_at:ts+3600}},codex:{ts,seven_day,five_hour:seven_day}}));const usage=new WeeklyUsage({file});
 await page.route('**/api/**',async r=>r.fulfill({json:r.request().url().endsWith('/usage')?await usage.get():s}));await page.goto('/agents');
 const input=page.locator('textarea[name=instruction]');await expect(input).toHaveAttribute('placeholder','秘書１に聞く');await expect(input).toHaveAttribute('title',/Ctrl\+Enterで送信.*Enter \/ Shift\+Enterで改行/);await expect(input).toHaveAttribute('aria-label',/秘書１に聞く.*Ctrl\+Enter/);await input.fill('残す下書き');s.agents[0].name='新しい秘書';await expect(input).toHaveAttribute('placeholder','新しい秘書に聞く');await expect(input).toHaveValue('残す下書き');
 await expect(page.locator('.run-status .completion-icon')).toHaveCount(1);await expect(page.locator('.run-status .completion-icon')).toHaveAttribute('aria-label','報告完了 · 依頼全体完了');
 const claude=page.locator('#weekly-usage [data-provider=claude]'),codex=page.locator('#weekly-usage [data-provider=codex]');await expect(claude.locator('[role=meter]')).toHaveCount(2);await expect(codex.locator('[role=meter]')).toHaveCount(1);await expect(claude.locator('summary')).toContainText('5h');await expect(claude.locator('summary')).toContainText('7d');await expect(codex.locator('summary')).not.toContainText('5h');
 await input.fill('');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`agents-${theme}-${width}.png`),fullPage:true});
 await page.goto('/');await expect(page.locator('#map-connection')).toContainText('●');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`map-${theme}-${width}.png`),fullPage:true});
});
