import {notifySnapshot} from './helpers/change-events.js';
import {test,expect} from './helpers/change-events.js';
const fixture=()=>({projects:[{id:'p',name:'P',revision:0},{id:'q',name:'Q',revision:0}],workshops:[],agents:Array.from({length:12},(_,i)=>({id:'a'+i,name:'Agent '+i,createdAt:String(i).padStart(2,'0'),projectId:i<11?'p':'q',state:'idle',metadataRevision:0,location:'mayor',connection:{}})),runs:[],notification:{}});
async function setup(page,{conflict=false}={}){
 const state=fixture(),writes=[];await page.route('**/api/direct**',async r=>{
  if(r.request().method()==='GET')return r.fulfill({json:state});
  const body=r.request().postDataJSON();if(!r.request().url().endsWith('/reorder'))return r.fulfill({json:{}});
  writes.push(body);if(conflict)return r.fulfill({status:409,json:{error:'一覧が更新されています'}});
  const items=body.kind==='projects'?state.projects:state.agents.filter(a=>a.projectId===body.projectId);
  const sorted=items.slice().sort((a,b)=>(a.displayOrder??999)-(b.displayOrder??999));const moved=sorted.splice(sorted.findIndex(x=>x.id===body.id),1)[0];sorted.splice(sorted.findIndex(x=>x.id===body.targetId)+(body.position==='after'?1:0),0,moved);
  sorted.forEach((x,i)=>{x.displayOrder=i;x[body.kind==='projects'?'revision':'metadataRevision']++;});return r.fulfill({json:{ok:true}});
 });await page.goto('/agents');return {state,writes};
}
async function drag(page,source,target,{after=false}={}){
 await expect(source).toBeVisible();await expect(target).toBeVisible();const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+(after?0.8:0.2)*b.width,b.y+(after?0.8:0.2)*b.height,{steps:8});await page.mouse.up();
}
test('sidebar drags projects and members across pages, survives reload and keeps all view without text',async({page})=>{
 const {writes}=await setup(page);
 await expect(page.getByRole('button',{name:'全体を表示',exact:true})).toBeVisible();await expect(page.locator('#places')).not.toContainText('全部表示');
 await drag(page,page.locator('[data-place="project:q"] [data-project-handle]'),page.locator('.place-row[data-order-id="p"]').first());
 await expect.poll(()=>writes.length).toBe(1);await expect(page.locator('#places [data-place]').nth(1)).toHaveAttribute('data-place','project:q');
 await expect(page.locator('#places [data-agent-handle]')).toHaveCount(0);
 await page.locator('[data-add="project:p"]').first().click();await expect(page.locator('#project-agent-order [data-agent-handle]')).toHaveCount(11);
 await drag(page,page.locator('[data-agent-handle][data-order-id="a10"]'),page.locator('[data-agent-handle][data-order-id="a0"]'));
 await expect.poll(()=>writes.length).toBe(2);await expect(page.locator('[data-place="project:p"]').first().locator('[data-agent-dot]').first()).toHaveAttribute('data-agent-dot','a10');
 await page.reload();await expect(page.locator('#places [data-place]').nth(1)).toHaveAttribute('data-place','project:q');
 await page.getByRole('button',{name:'全体を表示',exact:true}).click();await expect(page.locator('[data-place="all"]')).toHaveAttribute('aria-current','page');
});
test('cross-project drop is ignored; conflict restores server order with an error',async({page})=>{
 const {writes}=await setup(page,{conflict:true});
 await drag(page,page.locator('[data-place="project:p"] [data-agent-dot="a0"]'),page.locator('[data-place="project:q"] [data-agent-dot="a11"]'));expect(writes).toHaveLength(0);
 await drag(page,page.locator('[data-place="project:q"] [data-project-handle]'),page.locator('.place-row[data-order-id="p"]').first());
 await expect(page.locator('#error')).toContainText('一覧が更新');await expect(page.locator('#places [data-place]').nth(1)).toHaveAttribute('data-place','project:p');
});
test('keyboard ordering uses the same save and mobile handles do not overflow',async({page})=>{
 const {writes}=await setup(page);await page.setViewportSize({width:390,height:844});await page.locator('[data-place="project:q"]').focus();await page.keyboard.press('Alt+ArrowUp');await expect.poll(()=>writes.length).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('real sidebar reorder endpoint saves both projects together',async({page,request})=>{
 const created=[];
 for(const name of ['Drag HTTP A','Drag HTTP B']){const r=await request.post('/api/direct/projects',{data:{name,requestId:crypto.randomUUID()}});expect(r.ok()).toBe(true);created.push(await r.json());await notifySnapshot(page);}
 await page.goto('/agents');await drag(page,page.locator('[data-project-handle]').filter({hasText:'Drag HTTP B'}),page.locator('.place-row[data-order-id="'+created[0].id+'"]').first());
 await expect.poll(async()=>{const r=await request.get('/api/direct');const s=await r.json();return s.projects.find(p=>p.id===created[1].id).displayOrder;}).toBe(0);
 await page.reload();await expect(page.locator('#places [data-place^="project:"]').first()).toHaveAttribute('data-place','project:'+created[1].id);
});
test('touch drag works and Escape cancels without saving',async({page,context})=>{
 const {writes}=await setup(page);await page.setViewportSize({width:390,height:844});
 const source=page.locator('[data-place="project:q"] [data-project-handle]'),target=page.locator('.place-row[data-order-id="p"]').first();
 await expect(source).toBeVisible();await expect(target).toBeVisible();const a=await source.boundingBox(),b=await target.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+5,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();expect(writes).toHaveLength(0);
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+5}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>writes.length).toBe(1);
});

test('project name click still selects; settings order preserves rename draft and Escape keeps dialog open',async({page})=>{
 const {writes}=await setup(page);
 await page.locator('[data-place="project:q"] [data-project-handle]').click();await expect(page.locator('[data-place="project:q"]')).toHaveAttribute('aria-current','page');
 await page.locator('[data-add="project:p"]').first().click();await page.locator('#project-rename-form input').fill('未保存の名前');
 const first=page.locator('[data-agent-handle][data-order-id="a0"]'),last=page.locator('[data-agent-handle][data-order-id="a10"]');
 // Read geometry atomically: a valid background sync may replace an idle reorder button.
 const rect=el=>{const {x,y}=el.getBoundingClientRect();return {x,y};};const a=await first.evaluate(rect),b=await last.evaluate(rect);await page.mouse.move(a.x+10,a.y+10);await page.mouse.down();await page.mouse.move(b.x+10,b.y+10,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('#project-actions-dialog')).toBeVisible();expect(writes).toHaveLength(0);
 await last.focus();await page.keyboard.press('Alt+ArrowLeft');await expect.poll(()=>writes.length).toBe(1);await expect(page.locator('#project-rename-form input')).toHaveValue('未保存の名前');
 await page.locator('#project-actions-dialog [data-close]').click();await page.locator('[data-add="project:q"]').click();await expect(page.locator('#project-agent-order [data-agent-handle]')).toHaveCount(1);
});
test('settings up/down moves keep dialog and draft; boundaries and drag share the same order',async({page})=>{
 const {writes,state}=await setup(page);await page.locator('[data-add="project:p"]').first().click();
 await expect(page.locator('#project-pin')).toHaveCount(0);await expect(page.locator('#project-move-up')).toBeDisabled();await expect(page.locator('#project-move-down')).toBeEnabled();
 await page.locator('#project-rename-form input').fill('名前の下書き');await page.locator('#project-move-down').click();
 await expect.poll(()=>writes.length).toBe(1);await expect(page.locator('#project-move-down')).toBeDisabled();await expect(page.locator('#project-move-up')).toBeEnabled();await expect(page.locator('#project-rename-form input')).toHaveValue('名前の下書き');
 await page.locator('#project-move-up').click();await expect.poll(()=>writes.length).toBe(2);await expect(page.locator('#project-move-up')).toBeDisabled();
 await page.locator('#project-actions-dialog [data-close]').click();await drag(page,page.locator('[data-place="project:q"] [data-project-handle]'),page.locator('.place-row[data-order-id="p"]').first());await expect.poll(()=>writes.length).toBe(3);
 await page.locator('[data-add="project:q"]').click();await expect(page.locator('#project-move-up')).toBeDisabled();
});
test('settings reorder conflict shows error without changing displayed order',async({page})=>{
 await setup(page,{conflict:true});await page.locator('[data-add="project:p"]').first().click();await page.locator('#project-move-down').click();await expect(page.locator('#project-actions-dialog .dialog-error')).toContainText('一覧が更新');await expect(page.locator('#project-move-up')).toBeDisabled();await expect(page.locator('#project-move-down')).toBeEnabled();
});
