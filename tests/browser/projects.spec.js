import {test,expect} from '@playwright/test';
function fixture(){return {projects:[{id:'p',name:'Village',revision:0},{id:'q',name:'Other',revision:0}],workshops:[{id:'local',name:'Local',connectionType:'local',workplaces:['/tmp']},{id:'remote',name:'Remote',connectionType:'ssh',workplaces:['/remote']}],agents:Array.from({length:12},(_,i)=>({id:'a'+i,name:'Agent '+i,createdAt:String(i).padStart(2,'0'),location:i===0?'mayor':'workshop',workshopId:i%2?'remote':'local',connection:{name:i%2?'Remote':'Local'},projectId:i<11?'p':'q',metadataRevision:0,state:'idle',tabId:'tab'+i})),runs:[],notification:{}};}
async function mock(page,state){const writes=[];await page.route('**/api/direct**',async r=>{if(r.request().method()==='GET')return r.fulfill({json:state});const body=r.request().postDataJSON(),path=new URL(r.request().url()).pathname;writes.push({path,body});if(path.startsWith('/api/direct/agents/')){const a=state.agents.find(a=>a.id===path.split('/')[4]);if(path.endsWith('/stop'))a.state='terminated';else{if(body.revision!==a.metadataRevision)return r.fulfill({status:409,json:{error:'Agentが更新されています。再読込してください'}});Object.assign(a,body,{metadataRevision:a.metadataRevision+1});}return r.fulfill({json:a});}if(path==='/api/direct/projects'){state.projects.push({...body,id:'new',revision:0});return r.fulfill({json:state.projects.at(-1)});}return r.fulfill({json:state});});await page.goto('/agents');return writes;}
test('Project spans places with nine-card groups, zoom restore, dots and explicit membership',async({page})=>{
 const state=fixture();await mock(page,state);
 await expect(page.locator('[data-place="project:p"]')).toHaveCount(2);
 await page.locator('[data-place="project:p"][data-page="0"]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(9);
 await expect(page.locator('[data-place="project:p"][data-page="0"] [data-agent-dot]')).toHaveCount(9);
 await expect(page.locator('#agent-a0')).toBeVisible();await expect(page.locator('#agent-a1')).toBeVisible();
 await page.locator('[data-place="project:p"][data-page="1"]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(2);
 await page.locator('#agent-a9 [data-zoom]').click();await page.locator('#agent-a9 [data-zoom]').click();await expect(page.locator('#board-title')).toHaveText('Village');
 await page.locator('#agent-a9 [data-manage-agent]').click();await page.locator('#metadata-form [name=projectId]').selectOption('q');await page.locator('#metadata-form [name=name]').fill('Renamed');await page.locator('#metadata-form button').click();
 await expect(page.locator('.agent-panel:visible')).toHaveCount(1);await page.locator('[data-place="project:q"]').click();await expect(page.locator('#agent-a9')).toContainText('Renamed');
 await expect(page.locator('[data-stop]')).toHaveCount(0);expect(state.agents[9].workshopId).toBe('remote');
 await page.reload();await page.locator('[data-place="project:q"]').click();await expect(page.locator('#agent-a9')).toBeVisible();
});
test('human management survives absent secretary, requires stop confirmation and does not overwrite a stale edit',async({page})=>{
 const state=fixture();state.agents=state.agents.slice(1,2);const writes=await mock(page,state);
 await expect(page.locator('#start-secretary')).toBeVisible();await page.locator('[data-place="project:q"]').click();await page.locator('#start-secretary').click();
 await expect(page.locator('#agent-form [name=location]')).toHaveValue('mayor');await expect(page.locator('#agent-form [name=workshopId]')).toHaveValue('local');await expect(page.locator('#agent-form [name=projectId]')).toHaveValue('q');await page.locator('#agent-dialog [data-close]').click();
 await page.locator('[data-place=all]').click();await page.locator('[data-manage-agent]').click();await page.locator('#metadata-form [name=name]').fill('Draft');state.agents[0].metadataRevision=1;
 await page.waitForTimeout(2200);await expect(page.locator('#metadata-form [name=name]')).toHaveValue('Draft');await page.locator('#metadata-form button').click();await expect(page.locator('#metadata-dialog .dialog-error')).toContainText('更新されています');
 await page.locator('#stop-form button').click();expect(writes.filter(w=>w.path.endsWith('/stop'))).toHaveLength(0);await page.locator('#stop-form [name=confirm]').check();await page.locator('#stop-form button').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(0);
 await page.locator('#manage').click();await page.getByRole('button',{name:'Project管理',exact:true}).click();await page.locator('#project-form [name=name]').fill('New Project');await page.locator('#project-form button').click();await expect(page.locator('[data-place="project:new"]')).toContainText('New Project');
});
test('sidebar modes persist their own group, restore drafts and reach unassigned Agents without auto-view',async({page})=>{
 const state=fixture();state.agents[11].projectId=null;const writes=await mock(page,state);
 await expect(page.locator('[data-mode=projects]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-place=remote]')).toHaveCount(0);await expect(page.locator('[data-place=all]')).toHaveCount(1);
 await page.locator('[data-place="project:p"][data-page="1"]').click();await page.locator('#agent-a9 textarea').fill('preserved across modes');await page.locator('#agent-a9 [data-zoom]').click();
 await page.locator('[data-mode=places]').click();await expect(page.locator('[data-place^="project:"]')).toHaveCount(0);await expect(page.locator('#board-title')).toHaveText('Village');await page.locator('[data-place=remote]').click();await expect(page.locator('#agent-a11')).toBeVisible();
 state.reviews={a9:{revision:'new',hasCompleted:true,unreviewed:true}};
 await page.locator('[data-mode=projects]').click();await expect(page.locator('#board-title')).toHaveText('Village');await expect(page.locator('.agent-panel:visible')).toHaveCount(2);await expect(page.locator('#agent-a9 textarea')).toHaveValue('preserved across modes');await expect(page.locator('.agent-panel[data-selected=true]')).toHaveCount(0);
 await page.waitForTimeout(2200);expect(writes).toHaveLength(0);await page.reload();await expect(page.locator('#board-title')).toHaveText('Village');await expect(page.locator('#agent-a9 textarea')).toHaveValue('preserved across modes');
 await page.locator('[data-mode=places]').focus();await page.keyboard.press('Space');await expect(page.locator('#board-title')).toHaveText('複数プロジェクト・未所属');await expect(page.locator('[data-place=all]')).toHaveCount(1);
 await page.locator('[data-place=all]').click();await page.locator('#next-page').click();await page.locator('[data-mode=projects]').click();await expect(page.locator('#board-title')).toHaveText('Village');await page.locator('[data-mode=places]').click();await expect(page.locator('#page-number')).toHaveText('2 / 2');await page.reload();await expect(page.locator('[data-mode=places]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#page-number')).toHaveText('2 / 2');expect(writes).toHaveLength(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('invalid or removed saved scopes and virtual groups safely fall back to all',async({page})=>{
 await page.addInitScript(()=>{if(!localStorage.getItem('ai-village-sidebar-v1'))localStorage.setItem('ai-village-sidebar-v1',JSON.stringify({mode:'projects',projects:{id:'project:deleted',page:0},places:{id:'remote',page:999}}));});
 const state=fixture();await mock(page,state);await expect(page.locator('#board-title')).toHaveText('Village');await page.locator('[data-mode=places]').click();await expect(page.locator('#board-title')).toHaveText('Village');
 await page.locator('[data-mode=projects]').click();await page.locator('[data-place="project:p"][data-page="1"]').click();state.projects=[];await expect(page.locator('#board-title')).toHaveText('プロジェクト名未取得');await expect(page.locator('.agent-panel[data-selected=true]')).toHaveCount(0);
 await page.reload();await expect(page.locator('#board-title')).toHaveText('プロジェクト名未取得');await expect(page.locator('[data-place=all]')).toHaveCount(1);
 await page.evaluate(()=>localStorage.setItem('ai-village-sidebar-v1','null'));await page.reload();await expect(page.locator('[data-mode=projects]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#board-title')).toHaveText('プロジェクト名未取得');
});
