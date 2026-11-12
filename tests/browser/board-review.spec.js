import {test,expect} from '@playwright/test';
function fixture(count=4){return {workshops:[{id:'w',name:'E-ryzen',connectionType:'local',workplaces:['/tmp']}],agents:Array.from({length:count},(_,i)=>({id:'a'+i,name:'Agent '+i,createdAt:new Date(1700000000000+i*1000).toISOString(),location:'workshop',workshopId:'w',connection:{name:'E-ryzen'},state:['idle','busy','waiting_input','unknown'][i%4],canSend:false,observedSessionId:'s'+i})),runs:[],reviewedCompletions:[],notification:{}};}
async function mock(page,state,onView=()=>{}){
 state.reviews ||= {};const requests=[];
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST'){
   const path=new URL(route.request().url()).pathname;expect(path).toMatch(/\/agents\/[^/]+\/view$/);
   const id=path.split('/')[4],body=route.request().postDataJSON();requests.push({id,...body});
   await onView(id,body);
   if(state.reviews[id].revision!==body.revision)return route.fulfill({status:409,json:{error:'new completion'}});
   state.reviews[id].unreviewed=false;state.reviews[id].attention=false;state.reviews[id].attentionRequestIds=[];return route.fulfill({json:state.reviews[id]});
  }
  return route.fulfill({json:state});
 });
 await page.goto('/agents');await page.locator('[data-mode=places]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(Math.min(9,state.agents.filter(a=>a.state!=='terminated').length));return requests;
}
const dimensions=page=>page.locator('#agents').evaluate(el=>({cols:getComputedStyle(el).gridTemplateColumns.split(' ').length,rows:getComputedStyle(el).gridTemplateRows.split(' ').length}));
test('four cards use 2x2, nine use 3x3, narrow screen uses readable rows and one consistent state palette',async({page})=>{
 const state=fixture();await mock(page,state);expect(await dimensions(page)).toEqual({cols:2,rows:2});
 for(const agent of state.agents){
  const dot=page.locator(`[data-place=w] [data-agent-dot=${agent.id}]`);await expect(dot).toHaveAttribute('title',new RegExp(agent.name));
  expect(await dot.evaluate(el=>getComputedStyle(el).color)).toBe(await page.locator(`#agent-${agent.id} .panel-heading .dot`).evaluate(el=>getComputedStyle(el).color));
 }
 expect(new Set(await page.locator('[data-place=w] .dot').evaluateAll(els=>els.map(el=>getComputedStyle(el).color))).size).toBe(4);
 await expect(page.locator('[data-place=w] small')).toHaveCount(0);
 await page.screenshot({path:'/tmp/ai-village-grid-four.png'});
 state.agents=fixture(9).agents;await expect(page.locator('.agent-panel:visible')).toHaveCount(9);expect(await dimensions(page)).toEqual({cols:3,rows:3});
 await page.screenshot({path:'/tmp/ai-village-grid-nine.png'});
 await page.setViewportSize({width:1024,height:768});state.agents=fixture(4).agents;await expect(page.locator('.agent-panel:visible')).toHaveCount(4);await expect.poll(()=>dimensions(page)).toEqual({cols:2,rows:2});
 await page.setViewportSize({width:390,height:844});await expect.poll(async()=>(await dimensions(page)).cols).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('virtual groups and all pages reach every Agent, preserve order across activity changes and restore zoom',async({page})=>{
 const state=fixture(22);state.agents.push(...fixture(11).agents.map((a,i)=>({...a,id:'m'+i,location:'mayor'})));
 await mock(page,state);await expect(page.locator('[data-place=w]')).toHaveCount(3);await expect(page.locator('[data-place=mayor]')).toHaveCount(2);
 await expect(page.locator('[data-place=w][data-page="1"]')).toContainText('工房（E-ryzen） (2)');
 await page.locator('[data-place=w][data-page="1"]').click();
 const ids=()=>page.locator('.agent-panel:visible').evaluateAll(els=>els.map(e=>e.id));const before=await ids();expect(before).toHaveLength(9);
 await page.locator('#agent-a12 [data-zoom]').click();await page.waitForTimeout(2100);await page.locator('#agent-a12 [data-zoom]').click();expect(await ids()).toEqual(before);
 state.agents.reverse();state.agents.find(a=>a.id==='a12').state='busy';await page.waitForTimeout(2100);expect(await ids()).toEqual(before);
 await page.locator('[data-place=all]').click();const all=new Set();
 for(let i=0;i<4;i++){for(const id of await ids())all.add(id);if(i<3)await page.locator('#next-page').click();}
 expect(all.size).toBe(33);await expect(page.locator('#next-page')).toBeDisabled();
 await page.locator('.agent-panel:visible [data-zoom]').first().click();await page.getByRole('button',{name:'一覧に戻る',exact:true}).click();await expect(page.locator('#page-number')).toHaveText('4 / 4');
 await page.locator('[data-place=mayor][data-page="1"]').click();await expect(page.locator('.agent-panel:visible')).toHaveCount(2);
 // Groups are only presentation: the add action still targets the original place.
 await page.locator('[data-add=w][data-page="2"]').click();await page.locator('#manual-add').click();await expect(page.locator('#agent-form [name=workshopId]')).toHaveValue('w');
});
test('selection acknowledges only the Agent, supports keyboard and never turns normal completions into attention',async({page})=>{
 const state=fixture(3);state.reviews={a0:{revision:'r0',hasCompleted:true,unreviewed:true},a1:{revision:'r1',hasCompleted:true,unreviewed:true}};
 const requests=await mock(page,state);await page.waitForTimeout(2200);expect(requests).toHaveLength(0);
 await expect(page.locator('[data-review],.reviewed-label,.review-completion')).toHaveCount(0);
 await expect(page.locator('#village-favicon')).toHaveAttribute('data-unread','false');await expect(page.locator('#completion-count')).toBeEmpty();
 await page.locator('#agent-a0 h2').click();await expect.poll(()=>state.reviews.a0.unreviewed).toBe(false);await expect(page.locator('#agent-a0')).toHaveAttribute('data-active','true');await expect(page.locator('#agent-a0')).toHaveAttribute('aria-current','true');expect(state.reviews.a1.unreviewed).toBe(true);
 // Tab from the prior card's last visible attachment control enters the next card.
 await page.locator('#agent-a0 .travel-add').focus();await page.keyboard.press('Tab');await expect(page.locator('#agent-a1')).toHaveAttribute('data-selected','true');await expect.poll(()=>state.reviews.a1.unreviewed).toBe(false);
 state.reviews.a1={revision:'r2',hasCompleted:true,unreviewed:true};await expect.poll(()=>requests.some(r=>r.revision==='r2')).toBe(true);await expect(page.locator('#agent-a1 .unread-badge')).toBeEmpty();
 await page.locator('[data-place=w]').click();await expect(page.locator('.agent-panel[data-selected=true]')).toHaveCount(0);state.reviews.a1={revision:'r3',hasCompleted:true,unreviewed:true};await page.waitForTimeout(2300);expect(state.reviews.a1.unreviewed).toBe(true);
 await expect(page.locator('#village-favicon')).toHaveAttribute('data-unread','false');await expect(page.locator('#agent-a0')).toHaveAttribute('data-state','idle');
 await page.screenshot({path:'/tmp/ai-village-agent-selection.png'});
});
test('hidden, unfocused and modal-covered windows do not acknowledge arrivals; focus restoration acknowledges selected only',async({page})=>{
 await page.addInitScript(()=>{window.testView={visible:true,focused:true};Object.defineProperty(document,'visibilityState',{get:()=>window.testView.visible?'visible':'hidden'});document.hasFocus=()=>window.testView.focused;});
 const state=fixture(2);state.reviews={a0:{revision:'r0',hasCompleted:true,unreviewed:true},a1:{revision:'other',hasCompleted:true,unreviewed:true}};const requests=await mock(page,state);
 await page.locator('#agent-a0 h2').click();await expect.poll(()=>requests.length).toBe(1);
 for(const property of ['visible','focused']){
  await page.evaluate(property=>{window.testView[property]=false;window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));},property);
  const n=requests.length;state.reviews.a0={revision:property,hasCompleted:true,unreviewed:true};await page.waitForTimeout(2200);expect(requests).toHaveLength(n);await expect(page.locator('#agent-a0')).toHaveAttribute('data-active','false');
  await page.evaluate(property=>{window.testView[property]=true;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));},property);await expect.poll(()=>requests.length).toBe(n+1);
 }
 await page.locator('#manage').click();state.reviews.a0={revision:'modal',hasCompleted:true,unreviewed:true};const n=requests.length;await page.waitForTimeout(2200);expect(requests).toHaveLength(n);await page.locator('#manage-dialog [data-close]').click();await expect.poll(()=>requests.length).toBe(n+1);expect(state.reviews.a1.unreviewed).toBe(true);
});
test('stale view rejects newer completion and does not clear it after changing selection',async({page})=>{
 const state=fixture(2);state.reviews={a0:{revision:'old',hasCompleted:true,unreviewed:true}};let release;const held=new Promise(r=>release=r);
 const requests=await mock(page,state,async()=>{await held;});await page.locator('#agent-a0 h2').click();await expect.poll(()=>requests.length).toBe(1);
 await page.locator('#agent-a1 h2').click();state.reviews.a0={revision:'new',hasCompleted:true,unreviewed:true};release();await expect(page.locator('#agent-a0')).toHaveAttribute('data-unread','true');await page.waitForTimeout(2300);expect(state.reviews.a0.unreviewed).toBe(true);expect(requests).toHaveLength(1);
 await page.locator('#agent-a0').focus();await expect.poll(()=>state.reviews.a0.unreviewed).toBe(false);expect(requests.at(-1).revision).toBe('new');
});
test('off-page and archived Agents are not reviewed merely by display',async({page})=>{
 const state=fixture(11);state.agents[10].state='terminated';state.runs=[{id:'end',agentId:'a10',state:'completed',output:'archived completion'}];state.reviews={a9:{revision:'off',hasCompleted:true,unreviewed:true},a10:{revision:'archived',hasCompleted:true,unreviewed:true}};
 const requests=await mock(page,state);await page.locator('#next-page').click();await page.waitForTimeout(2200);expect(requests).toHaveLength(0);
 await page.locator('#agent-a9').focus();await expect.poll(()=>requests.length).toBe(1);
 await page.locator('#manage').click();await page.getByRole('button',{name:'終了Agentの履歴',exact:true}).click();await expect(page.locator('#history-content')).toContainText('archived completion');await page.waitForTimeout(2200);expect(state.reviews.a10.unreviewed).toBe(true);
 await page.locator('#history-content').focus();await expect.poll(()=>state.reviews.a10.unreviewed).toBe(false);await expect(page.locator('#history-content [data-review]')).toHaveCount(0);
});
test('quiet selection preserves blue and muted green; unread turns alone have no wash or ring',async({page})=>{
 const state=fixture(4);state.agents[2].state='idle';state.agents[3].state='idle';
 for(const i of [0,2])state.agents[i].nativeTurns=[{id:'done'+i,sessionId:'s'+i,state:'completed'}];
 state.reviews={a0:{revision:'done0',hasCompleted:true,unreviewed:true},a2:{revision:'done2',hasCompleted:true,unreviewed:false}};
 await mock(page,state);
 const style=id=>page.locator('#agent-'+id).evaluate(el=>({border:getComputedStyle(el).borderTopColor,ring:getComputedStyle(el).boxShadow,outline:getComputedStyle(el).outlineStyle,header:getComputedStyle(el.querySelector('.panel-heading')).backgroundColor,dot:getComputedStyle(el.querySelector('.dot')).color}));
 const unread=await style('a0'),read=await style('a2'),busy=await style('a1');expect(unread.border).toBe('rgb(139, 167, 152)');expect(read.border).toBe(unread.border);expect(unread.ring).toBe('none');expect(read.ring).toBe('none');expect(unread.header).toBe(read.header);expect(busy.border).toBe('rgb(102, 158, 255)');
 await page.locator('#agent-a1 h2').click();expect(await style('a1')).toEqual(busy);await expect(page.locator('#agent-a1')).toHaveAttribute('aria-current','true');
 for(const id of ['a0','a1','a2','a3'])expect(await page.locator('[data-place=w] [data-agent-dot='+id+']').evaluate(el=>getComputedStyle(el).color)).toBe(['a0','a2'].includes(id)?'rgb(119, 155, 136)':(await style(id)).dot);
 await page.screenshot({path:'/tmp/ai-village-quiet-states.png'});
 await page.locator('#agent-a0 h2').click();await expect.poll(()=>state.reviews.a0.unreviewed).toBe(false);await expect.poll(async()=>(await style('a0')).ring).toBe('none');expect((await style('a0')).border).toBe(unread.border);expect((await style('a0')).header).toBe(read.header);
 await page.locator('#agent-a0 .travel-add').focus();await page.keyboard.press('Tab');await expect(page.locator('#agent-a1')).toBeFocused();expect((await style('a1')).outline).toBe('dashed');
 await expect(page.locator('#village-favicon')).toHaveAttribute('data-unread','false');
});
test('strong green attention and favicon require finalized human request, and Agent selection clears only its viewed revision',async({page})=>{
 const state=fixture(11);state.agents[10].state='terminated';state.reviews={a9:{revision:'ordinary',hasCompleted:true,unreviewed:true}};state.requests=[{id:'root',status:'active',finalAgentId:'a9',ticket:{state:'available'}}];
 const requests=await mock(page,state);await expect(page.locator('#village-favicon')).toHaveAttribute('data-unread','false');await expect(page.locator('.request-attention:not(:empty)')).toHaveCount(0);
 state.requests[0].status='completed';state.requests[0].ticket.state='consumed';state.reviews.a9={revision:'final',hasCompleted:true,unreviewed:true,attention:true,attentionRequestIds:['root']};state.reviews.a10={revision:'archived-final',hasCompleted:true,unreviewed:true,attention:true,attentionRequestIds:['archived-root']};
 await expect(page.locator('#village-favicon')).toHaveAttribute('data-unread','true');await expect(page.locator('#completion-count')).toHaveText('依頼完了・要確認 2件');expect(requests).toHaveLength(0);
 await page.locator('#next-page').click();await expect(page.locator('#agent-a9')).toHaveAttribute('data-attention','true');await expect(page.locator('#agent-a9 .request-attention')).toHaveText('依頼完了・要確認');await page.screenshot({path:'/tmp/ai-village-final-request-attention.png'});
 await page.locator('#agent-a9 h2').click();await expect(page.locator('#agent-a9')).toHaveAttribute('data-attention','false');await expect(page.locator('#completion-count')).toHaveText('依頼完了・要確認 1件');expect(state.requests[0].ticket.state).toBe('consumed');
 await page.locator('#manage').click();await page.getByRole('button',{name:'終了Agentの履歴',exact:true}).click();await expect(page.locator('#history-agent')).toContainText('依頼完了・要確認');await page.locator('#history-content').focus();await expect(page.locator('#village-favicon')).toHaveAttribute('data-unread','false');expect(requests.map(r=>r.id)).toEqual(['a9','a10']);
});
