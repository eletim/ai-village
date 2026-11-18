import {test,expect} from '@playwright/test';
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
 const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+(after?0.8:0.2)*b.width,b.y+(after?0.8:0.2)*b.height,{steps:8});await page.mouse.up();
}
test('sidebar drags projects and members across pages, survives reload and keeps all view without text',async({page})=>{
 const {writes}=await setup(page);
 await expect(page.getByRole('button',{name:'全体を表示',exact:true})).toBeVisible();await expect(page.locator('#places')).not.toContainText('全部表示');
 await drag(page,page.getByRole('button',{name:'Qを並べ替え',exact:true}),page.locator('.place-row[data-order-id="p"]').first());
 await expect.poll(()=>writes.length).toBe(1);await expect(page.locator('#places [data-place]').nth(1)).toHaveAttribute('data-place','project:q');
 await drag(page,page.locator('[data-agent-handle][data-order-id="a10"]'),page.locator('[data-agent-handle][data-order-id="a0"]'));
 await expect.poll(()=>writes.length).toBe(2);await expect(page.locator('[data-place="project:p"]').first().locator('[data-agent-dot]').first()).toHaveAttribute('data-agent-dot','a10');
 await page.reload();await expect(page.locator('#places [data-place]').nth(1)).toHaveAttribute('data-place','project:q');
 await page.getByRole('button',{name:'全体を表示',exact:true}).click();await expect(page.locator('[data-place="all"]')).toHaveAttribute('aria-current','page');
});
test('cross-project drop is ignored; conflict restores server order with an error',async({page})=>{
 const {writes}=await setup(page,{conflict:true});
 await drag(page,page.locator('[data-agent-handle][data-order-id="a0"]'),page.locator('[data-agent-handle][data-order-id="a11"]'));expect(writes).toHaveLength(0);
 await drag(page,page.getByRole('button',{name:'Qを並べ替え',exact:true}),page.locator('.place-row[data-order-id="p"]').first());
 await expect(page.locator('#error')).toContainText('一覧が更新');await expect(page.locator('#places [data-place]').nth(1)).toHaveAttribute('data-place','project:p');
});
test('keyboard ordering uses the same save and mobile handles do not overflow',async({page})=>{
 const {writes}=await setup(page);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Qを並べ替え',exact:true}).focus();await page.keyboard.press('Alt+ArrowUp');await expect.poll(()=>writes.length).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('real sidebar reorder endpoint saves both projects together',async({page,request})=>{
 const created=[];
 for(const name of ['Drag HTTP A','Drag HTTP B']){const r=await request.post('/api/direct/projects',{data:{name,requestId:crypto.randomUUID()}});expect(r.ok()).toBe(true);created.push(await r.json());}
 await page.goto('/agents');await drag(page,page.getByRole('button',{name:'Drag HTTP Bを並べ替え',exact:true}),page.locator('.place-row[data-order-id="'+created[0].id+'"]').first());
 await expect.poll(async()=>{const r=await request.get('/api/direct');const s=await r.json();return s.projects.find(p=>p.id===created[1].id).displayOrder;}).toBe(0);
 await page.reload();await expect(page.locator('#places [data-place^="project:"]').first()).toHaveAttribute('data-place','project:'+created[1].id);
});
test('touch drag works and Escape cancels without saving',async({page,context})=>{
 const {writes}=await setup(page);await page.setViewportSize({width:390,height:844});
 const source=page.getByRole('button',{name:'Qを並べ替え',exact:true}),target=page.locator('.place-row[data-order-id="p"]').first();
 const a=await source.boundingBox(),b=await target.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+5,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();expect(writes).toHaveLength(0);
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+5}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>writes.length).toBe(1);
});
