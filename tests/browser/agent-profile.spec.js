import {test,expect} from '@playwright/test';
const snapshot={projects:[{id:'p1',name:'村実装'},{id:'p2',name:'別Project'}],workshops:[],agents:[{id:'unknown',name:'役割未確認',role:'other',projectId:'missing',provider:'other',state:'unknown',connection:{}},{id:'a',name:'秘書（村実装）',provider:'codex',cwd:'/private/internal',location:'mayor',projectId:'p1',state:'idle',connection:{},canSend:true},{id:'b',name:'工房',provider:'claude',location:'workshop',projectId:'p1',state:'idle',connection:{name:'登録工房'},canSend:true},{id:'d',name:'別の秘書',location:'mayor',projectId:'p2',provider:'claude',state:'idle',connection:{},canSend:true},{id:'c',name:'未所属秘書',location:'mayor',state:'idle',connection:{},canSend:true}],runs:[],reviews:{},notification:{enabled:false}};
async function fixture(page,handler){await page.route('**/api/**',async r=>{if(r.request().url().endsWith('/api/village'))return handler(r,r.request().postDataJSON().argv[2]);return r.fulfill({json:snapshot});});await page.goto('/agents');}
const dialog=page=>page.locator('#agent-profile-dialog');
test('project and secretary entries, safe Markdown, latest reload, draft and mobile',async({page})=>{
 let version=1;const requests=[];
 await fixture(page,(r,id)=>{requests.push(id);return r.fulfill({json:{ok:true,result:{available:true,projectId:id,content:'# 方針 '+version+'\n\n**工房を確認**\n\n<script>window.xss=1</script>\n\n[x](javascript:alert(1))\n\n'+('長い説明\n\n'.repeat(70))}}});});
 const input=page.locator('#agent-a textarea');await input.fill('保持する下書き');
 await expect(page.locator('#agent-b [data-profile-agent]')).toHaveCount(1);await expect(page.locator('#project-guide,.agent-guide')).toHaveCount(0);
 await page.locator('#agent-a [data-profile-agent]').focus();await page.keyboard.press('Enter');await expect(dialog(page).locator('h1')).toHaveText('方針 1');await expect(dialog(page)).toContainText('対象Project: 村実装');await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('秘書（村実装）');await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('Codex');await expect(dialog(page)).not.toContainText('/private/internal');
 expect(await page.evaluate(()=>window.xss)).toBeUndefined();await expect(dialog(page).locator('script,a[href^="javascript:"]')).toHaveCount(0);
 version=2;await dialog(page).getByRole('button',{name:'再読込'}).click();await expect(dialog(page).locator('h1')).toHaveText('方針 2');
 await page.keyboard.press('Escape');await expect(input).toHaveValue('保持する下書き');
 await page.locator('[data-mode=places]').click();await page.locator('#agent-a [data-profile-agent]').click();await expect(dialog(page).locator('h1')).toHaveText('方針 2');await page.keyboard.press('Escape');await page.locator('[data-mode=projects]').click();
 await page.locator('[data-place="project:p1"]').click();await page.locator('[data-profile-agent]:visible').first().click();await expect(dialog(page).locator('h1')).toHaveText('方針 2');
 await page.screenshot({path:'/tmp/agent-profile-desktop.png'});await page.setViewportSize({width:390,height:844});
 await expect(dialog(page).getByRole('button',{name:'プロフィールを閉じる'})).toBeVisible();expect(await dialog(page).evaluate(e=>e.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'/tmp/agent-profile-mobile.png'});await page.keyboard.press('Escape');expect(requests).toEqual(['p1','p1','p1','p1']);
});
test('unset, errors, loading and no use of another Project guide',async({page})=>{
 let fail=true;await fixture(page,(r,id)=>fail?r.fulfill({status:503,json:{error:'failure'}}):r.fulfill({json:{ok:true,result:{available:false}}}));
 await page.locator('[data-place="project:p2"]').click();await page.locator('[data-profile-agent]:visible').first().click();await expect(dialog(page)).toContainText('対象Project: 別Project');await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('Claude');await expect(dialog(page)).toContainText('取得できません');
 fail=false;await dialog(page).getByRole('button',{name:'再読込'}).click();await expect(dialog(page)).toContainText('未設定です');await page.keyboard.press('Escape');
 await page.locator('[data-place="all"]').click();await page.locator('#agent-c [data-profile-agent]').click();await expect(dialog(page)).toContainText('Project未所属');
});
test('late responses after closing/switching cannot replace current document',async({page})=>{
 // Even if transport cancellation is ignored, the request generation guards UI state.
 await page.addInitScript(()=>{const Native=AbortController;window.AbortController=class extends Native{abort(){}};});
 let release;const gate=new Promise(r=>release=r);
 await fixture(page,async(r,id)=>{if(id==='p1')await gate;await r.fulfill({json:{ok:true,result:{available:true,projectId:id,content:'# '+id}}});});
 await page.locator('#agent-a [data-profile-agent]').click();await expect(dialog(page)).toContainText('読込中');await page.keyboard.press('Escape');
 await page.locator('[data-place="project:p2"]').click();await page.locator('[data-profile-agent]:visible').first().click();await expect(dialog(page).locator('h1')).toHaveText('p2');release();
 await page.waitForTimeout(150);await expect(dialog(page).locator('h1')).toHaveText('p2');await expect(dialog(page)).toContainText('対象Project: 別Project');
});
test('name remains keyboard accessible across polling; existing rename stays in management',async({page})=>{
 await fixture(page,(r,id)=>r.fulfill({json:{ok:true,result:{available:false}}}));
 const name=page.getByRole('button',{name:'秘書（村実装）のプロフィール',exact:true});
 await name.focus();await name.evaluate(e=>window.originalNameButton=e);
 await page.waitForTimeout(2300);
 expect(await name.evaluate(e=>e===window.originalNameButton)).toBe(true);
 await page.keyboard.press('Space');await expect(dialog(page)).toBeVisible();await page.keyboard.press('Escape');await expect(name).toBeFocused();
 await page.locator('#agent-a [data-manage-agent]').click();await expect(page.locator('#metadata-dialog')).toBeVisible();await expect(page.locator('#metadata-form [name=name]')).toHaveValue('秘書（村実装）');await expect(dialog(page)).not.toBeVisible();
});
test('worker and unknown profiles never request secretary guidance; late secretary response is discarded',async({page})=>{
 await page.addInitScript(()=>{const Native=AbortController;window.AbortController=class extends Native{abort(){}};});
 let release,calls=0;const gate=new Promise(r=>release=r);
 await fixture(page,async(r,id)=>{calls++;await gate;await r.fulfill({json:{ok:true,result:{available:true,projectId:id,content:'# SECRET guidance'}}});});
 await page.locator('#agent-a [data-profile-agent]').click();await expect(dialog(page)).toContainText('読込中');await page.keyboard.press('Escape');
 const input=page.locator('#agent-b textarea');await input.fill('工房への下書き');
 const worker=page.getByRole('button',{name:'工房のプロフィール',exact:true});await worker.focus();await page.keyboard.press('Enter');
 await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('工房Agent');await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('登録工房');await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('村実装');await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('Claude');
 await expect(dialog(page).getByRole('heading',{name:'秘書の方針'})).toHaveCount(0);release();await page.waitForTimeout(150);
 await expect(dialog(page)).not.toContainText('SECRET guidance');expect(calls).toBe(1);
 await page.screenshot({path:'/tmp/agent-profile-worker-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/agent-profile-worker-mobile.png'});
 await page.keyboard.press('Escape');await expect(input).toHaveValue('工房への下書き');await worker.focus();await page.keyboard.press('Space');await expect(dialog(page)).toBeVisible();await page.keyboard.press('Escape');
 await page.locator('#agent-unknown [data-profile-agent]').click();await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('不明');await expect(dialog(page).locator('dl:not([data-model-fields])')).toContainText('登録情報を確認できません');await expect(dialog(page).getByRole('button',{name:'再読込'})).toHaveCount(0);expect(calls).toBe(1);
});
