import {notifySnapshot} from './helpers/change-events.js';
import {test,expect} from './helpers/change-events.js';
import {workspaceSnapshot,historyPage,entryBody} from '../../server/conversation-pages.mjs';
// Stage 2 (docs/lean-fetch.md): folded Agent-to-Agent bodies load when the fold is opened.
const at=i=>new Date(1700000000000+i*1000).toISOString();
function fixture(){return {agents:[{id:'a',name:'Fixture',location:'workshop',state:'idle',connection:{},canSend:true,nativeTurns:[]}],projects:[],workshops:[],reviews:{},notification:{enabled:false},capabilities:{attachments:true},
 requests:[{id:'q',status:'active'}],
 runs:[{id:'human',agentId:'a',origin:'human',state:'completed',createdAt:at(1),instruction:'HUMAN QUESTION',output:'HUMAN ANSWER',finalOutput:'HUMAN ANSWER'},
  {id:'delegated',agentId:'a',origin:'delegation',suppressUser:true,humanRequestId:'q',state:'completed',createdAt:at(2),instruction:'AGENT INSTRUCTION',output:'AGENT PROGRESS',finalOutput:'AGENT RESULT'}]};}
async function serve(page,s,{fail=()=>false,hold=null}={}){
 const bodies=[],snapshots=[];
 await page.route('**/api/**',async r=>{
  const u=new URL(r.request().url());
  if(u.pathname.endsWith('/entry-body')){bodies.push(u.searchParams.get('side'));if(hold)await hold.promise;if(fail(u))return r.fulfill({status:500,json:{error:'boom'}});return r.fulfill({json:entryBody(s,'a',u.searchParams.get('entry'),u.searchParams.get('side'))});}
  if(u.pathname.endsWith('/history'))return r.fulfill({json:historyPage(s,'a',u.searchParams.get('before'),{lazyBodies:u.searchParams.get('bodies')==='lazy'})});
  if(u.pathname==='/api/direct'){const snapshot=workspaceSnapshot(s,JSON.parse(u.searchParams.get('ranges')||'{}'),null,{lean:true,lazyBodies:u.searchParams.get('bodies')==='lazy'});snapshots.push(JSON.stringify(snapshot));return r.fulfill({json:snapshot});}
  return r.fulfill({json:{providers:{}}});
 });
 return {bodies,snapshots};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
for(const [name,viewport] of [['desktop',{width:1440,height:1050}],['phone',{width:390,height:844}]]){
 test(`opening a folded exchange loads its body; closed folds never fetch (${name})`,async({page})=>{
  await page.setViewportSize(viewport);const s=fixture(),hold=deferred(),m=await serve(page,s,{hold});
  await page.goto('/agents');const run=page.locator('.run[data-entry*=delegated]');await expect(run).toBeVisible();
  await expect(page.locator('.run[data-entry*=human]')).toContainText('HUMAN ANSWER');
  expect(m.snapshots.some(x=>x.includes('AGENT INSTRUCTION')||x.includes('AGENT RESULT'))).toBe(false);
  await page.waitForTimeout(200);expect(m.bodies).toEqual([]);
  const input=run.locator('.message.internal details.chat-body');await input.locator('summary').click();
  await expect(input.locator('.deferred-body')).toHaveText('読み込み中…');hold.resolve();
  await expect(input).toContainText('AGENT INSTRUCTION');await expect(input).toHaveAttribute('open','');expect(m.bodies).toEqual(['input']);
  const output=run.locator('.message.assistant details.chat-body');await expect(output.locator('summary')).toContainText('回答');await output.locator('summary').click();await expect(output).toContainText('AGENT RESULT');
  // Later syncs keep loaded bodies without refetching; a changed body is fetched again while open.
  await notifySnapshot(page);await page.waitForTimeout(150);await expect(output).toContainText('AGENT RESULT');expect(m.bodies).toEqual(['input','output']);
  s.runs[1].finalOutput='AGENT RESULT v2';await notifySnapshot(page);await expect(output).toContainText('AGENT RESULT v2');expect(m.bodies).toEqual(['input','output','output']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
test('a failed body load says so and retries when the fold is reopened',async({page})=>{
 const s=fixture();let failing=true;const m=await serve(page,s,{fail:()=>failing});
 await page.goto('/agents');const input=page.locator('.run[data-entry*=delegated] .message.internal details.chat-body');
 await input.locator('summary').click();await expect(input.locator('.deferred-body[data-failed]')).toContainText('読み込めませんでした');
 failing=false;await input.locator('summary').click();await expect(input).not.toHaveAttribute('open','');await input.locator('summary').click();
 await expect(input).toContainText('AGENT INSTRUCTION');expect(m.bodies).toEqual(['input','input']);
});
test('a turn started by a background-task notice is labelled as such, never shown as a human message',async({page})=>{
 const s=fixture();s.agents[0].observedSessionId='s';s.agents[0].nativeTurns=[{id:'n1',sessionId:'s',state:'completed',startedAt:at(3),trigger:'task-notification',instruction:'',output:'NOTED',finalOutput:'NOTED'}];
 await serve(page,s);await page.goto('/agents');const turn=page.locator('.run[data-entry*=n1]');
 await expect(turn.locator('.message.internal')).toContainText('裏実行タスクの完了通知');await expect(turn.locator('.message.user')).toHaveCount(0);
 await expect(turn).not.toContainText('task-notification');
});
