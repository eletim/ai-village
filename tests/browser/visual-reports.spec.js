import {test,expect} from '@playwright/test';
import sharp from 'sharp';import {writeFile,mkdir} from 'node:fs/promises';import {dirname} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
test('local upload CLI, real Mermaid, inline image zoom, safe fallback and poll stability',async({page,baseURL},info)=>{
 const file=info.outputPath('report.png');await mkdir(dirname(file),{recursive:true});await writeFile(file,await sharp({create:{width:320,height:160,channels:3,background:'#3183a8'}}).png().toBuffer());
 const uploaded=JSON.parse((await promisify(execFile)(process.execPath,['scripts/village.mjs','images','upload',file],{env:{...process.env,VILLAGE_URL:baseURL}})).stdout);
 expect(uploaded.ok).toBe(true);
 const output='経路の説明\n```mermaid\nflowchart LR\n A[依頼] --> B[検証] --> C[報告]\n```\n'+uploaded.reference+'\nhttps://example.com';
 const state={agents:[{id:'a',name:'Agent',state:'busy',connection:{name:'Local'}}],workshops:[],runs:[{id:'r',agentId:'a',state:'running',instruction:'報告',output}],notification:{},reviews:{}};
 await page.route('**/api/direct**',r=>r.fulfill({json:state}));await page.goto('/agents');
 const diagram=page.locator('[data-visual=mermaid] img'),image=page.locator('[data-visual=image] img');

 await expect(diagram).toBeVisible();await expect.poll(()=>diagram.evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);await expect(image).toBeVisible();
 await diagram.evaluate(el=>window.reportDiagram=el);await image.evaluate(el=>window.reportImage=el);
 await page.waitForTimeout(2200);expect(await diagram.evaluate(el=>el===window.reportDiagram)).toBe(true);
 state.runs[0].output+='\n追加の説明';await expect(page.locator('.runs')).toContainText('追加の説明');expect(await diagram.evaluate(el=>el===window.reportDiagram)).toBe(true);expect(await image.evaluate(el=>el===window.reportImage)).toBe(true);await expect(diagram).toHaveCount(1);
 await image.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(image.locator('..')).toBeFocused();
 await diagram.locator('..').focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'閉じる',exact:true}).click();
 await page.screenshot({path:'/tmp/village-visual-reports.png'});
 let externalImages=0;await page.route('https://evil.test/**',r=>{externalImages++;return r.abort();});
 state.runs[0].output+='\n![unsafe](https://evil.test/x.png)\n```mermaid\nnot a diagram\n```\n```mermaid\nflowchart LR\n A[<img src=x onerror=alert(1)>]\n```\n```mermaid\nflowchart LR\n A-->';
 await expect(page.locator('.runs')).toContainText('not a diagram');await expect(page.locator('.runs script')).toHaveCount(0);await expect(page.locator('[data-visual=mermaid]')).toHaveCount(2);expect(externalImages).toBe(0);await expect(diagram).toHaveCount(1);

});
