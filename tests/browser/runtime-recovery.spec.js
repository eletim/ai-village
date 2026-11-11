import {runFixture,requestFixture,setRequestState} from './helpers/direct-fixtures.js';
import {test,expect} from '@playwright/test';
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
