import {notifySnapshot} from './helpers/change-events.js';
import {runFixture,requestFixture,setRequestState} from './helpers/direct-fixtures.js';
import {test,expect} from './helpers/change-events.js';
test('failed runtime displays model review reason and explicit revision-safe retry/cancel',async({page})=>{
 const r=runFixture({id:'run',agentId:'a',sessionId:'s',turnId:'t',workId:'w',humanRequestId:'q',state:'failed',instruction:'original task',errorCode:'server_overloaded',error:'Selected model is at capacity. <script>bad()</script>',recovery:{status:'scheduled',nextAt:Date.now()+30000}},{kind:'ended',outcome:'failed',reason:'native-error',errorCode:'server_overloaded'});
 const q=requestFixture({id:'q',status:'active',revision:4,instruction:r.instruction,works:[{id:'w',currentRunId:'run',parentWorkId:null}]},[r],{kind:'active',review:['run-needs-review:run']});
 const state={agents:[{id:'a',name:'Agent',observedSessionId:'s',state:'idle',canSend:true,canQueue:true,connection:{name:'Local'},nativeTurns:[{id:'t',state:'failed'}]}],workshops:[],runs:[r],requests:[q],reviews:{},notification:{}};
 const mutations=[];
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST'){
   const path=new URL(route.request().url()).pathname;if(path.endsWith('/requests/get'))return route.fulfill({json:q});
   expect(route.request().headers()['x-village-human-ui']).toBe('1');mutations.push({path,body:route.request().postDataJSON()});
   if(mutations.at(-1).path.endsWith('/cancel'))setRequestState(q,{kind:'withdrawn',reason:'human'});
  }
  await route.fulfill({json:state});
 });
 await page.goto('/agents');
 await expect(page.locator('.runs')).toContainText('server_overloaded');await expect(page.locator('.runs')).toContainText('送信が失敗・中断・確認できず');
 await expect(page.locator('.runs script')).toHaveCount(0);await expect(page.locator('.request-attention')).toBeEmpty();
 await page.screenshot({path:'/tmp/village-runtime-recovery.png'});
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'再試行',exact:true}).click();
 await expect.poll(()=>mutations.length).toBe(1);expect(mutations[0].path).toBe('/api/direct/human/requests/retry');expect(mutations[0].body).toMatchObject({humanRequestId:'q',workId:'w',revision:4});expect(mutations[0].body.instruction).toContain('子作業の再委任');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'取り下げ',exact:true}).click();
 await expect.poll(()=>mutations.length).toBe(2);expect(mutations[1].body).toEqual({humanRequestId:'q',revision:4});await expect(page.getByRole('button',{name:'再試行',exact:true})).toHaveCount(0);
});

test('shared graph normal waits explain progress without recovery controls, stalled progress requires judgment',async({page})=>{
 const {reconcileGraph,waitingReason}=await import('../../server/state/requests.ts');
 const {requestView}=await import('../../server/state/projection.ts');
 const parent=runFixture({id:'p',agentId:'a',workId:'w',humanRequestId:'q',instruction:'工房への依頼',output:'委任しました'});
 const child=runFixture({id:'c',agentId:'b',workId:'cw',humanRequestId:'q',instruction:'実装中'},{kind:'running',sessionId:'s',turnId:'t',inputId:'i'});
 const q=requestFixture({id:'q',revision:0,instruction:parent.instruction,works:[{id:'w',agentId:'a',currentRunId:'p',runIds:['p']},{id:'cw',agentId:'b',parentWorkId:'w',currentRunId:'c',runIds:['c']}]},[parent,child]);
 const evidence=[parent,child].map(r=>({run:r.runModel,ownerId:r.workId,agentId:r.agentId}));
 const project=()=>{q.requestGraph=reconcileGraph(q.requestGraph,evidence);Object.assign(q,requestView(q.requestGraph.nodes[0]));q.waiting=Object.fromEntries(q.requestGraph.nodes.map(n=>[n.id,waitingReason(q.requestGraph,n,evidence)]));};project();
 const state={agents:[{id:'a',name:'工房',state:'idle',canSend:true,canQueue:true,connection:{name:'Local'}}],workshops:[],runs:[parent],requests:[q],reviews:{},notification:{}};
 await page.route('**/api/direct**',route=>route.fulfill({json:state}));await page.goto('/agents');
 await expect(page.locator('.request-waiting')).toHaveText('子依頼の実行を待っています。');await expect(page.locator('.recovery')).toHaveCount(0);
 child.runModel.state={kind:'ended',outcome:'normal',reason:'native'};await notifySnapshot(page);project();await page.reload();
 await expect(page.locator('.request-waiting')).toHaveText('子依頼の結果配送を待っています。');await expect(page.locator('.recovery')).toHaveCount(0);
 child.runModel.state={kind:'ended',outcome:'unconfirmed',reason:'timeout'};await notifySnapshot(page);q.requestGraph.nodes[1].state={kind:'active',review:[]};await notifySnapshot(page);project();await page.reload();
 await expect(page.locator('.recovery')).toContainText('子依頼に失敗');await expect(page.locator('.request-waiting')).toHaveCount(0);
 // No runnable dependency or result delivery remains; a missing parent declaration needs judgment.
 q.requestGraph.nodes[1].replacementId='replacement';await notifySnapshot(page);project();await page.reload();
 await expect(page.locator('.recovery')).toContainText('実行と自動で進む手順が終了');
});
