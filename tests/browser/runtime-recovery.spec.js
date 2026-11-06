import {test,expect} from '@playwright/test';
test('failed runtime displays reason, scheduled recovery and explicit revision-safe retry/cancel',async({page})=>{
 const r={id:'run',agentId:'a',sessionId:'s',turnId:'t',workId:'w',humanRequestId:'q',state:'failed',instruction:'original task',errorCode:'server_overloaded',error:'Selected model is at capacity. <script>bad()</script>',recovery:{status:'scheduled',nextAt:Date.now()+30000}};
 const q={id:'q',status:'active',revision:4,instruction:r.instruction,works:[{id:'w',currentRunId:'run',parentWorkId:null}]};
 const state={agents:[{id:'a',name:'Agent',observedSessionId:'s',state:'idle',canSend:true,canQueue:true,connection:{name:'Local'},nativeTurns:[{id:'t',state:'failed'}]}],workshops:[],runs:[r],requests:[q],reviews:{},notification:{}};
 const mutations=[];
 await page.route('**/api/direct**',async route=>{
  if(route.request().method()==='POST'){
   mutations.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});
   if(mutations.at(-1).path.endsWith('/cancel'))q.status='cancelled';
  }
  await route.fulfill({json:state});
 });
 await page.goto('/agents');
 await expect(page.locator('.runs')).toContainText('server_overloaded');await expect(page.locator('.runs')).toContainText('自動再試行予定');
 await expect(page.locator('.runs script')).toHaveCount(0);await expect(page.locator('.request-attention')).toBeEmpty();
 await page.screenshot({path:'/tmp/village-runtime-recovery.png'});
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'確認して再試行'}).click();
 await expect.poll(()=>mutations.length).toBe(1);expect(mutations[0].path).toBe('/api/direct/requests/retry');expect(mutations[0].body).toMatchObject({humanRequestId:'q',workId:'w',revision:4});expect(mutations[0].body.instruction).toContain('子作業の再委任');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'依頼をキャンセル'}).click();
 await expect.poll(()=>mutations.length).toBe(2);expect(mutations[1].body).toEqual({humanRequestId:'q',revision:4});await expect(page.getByRole('button',{name:'確認して再試行'})).toHaveCount(0);
});
