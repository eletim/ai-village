import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {completionHTTPFixture} from '../helpers/completion-http-fixture.mjs';

test('notification-target revision drives green and clears only the viewed version',async({page},info)=>{
 test.setTimeout(120000);
 const f=await completionHTTPFixture(15687),a=f.agents[0],samples=[];
 const snapshot=()=>fetch(f.base+'/api/direct?view=workspace').then(r=>r.json());
 const panel=page.locator('#agent-'+a.id);
 const send=async text=>{const result=await f.post('/agents/'+a.id+'/runs',{mode:'conversation',requestId:randomUUID(),instruction:text});expect(result.status).toBe(200);return f.submit(result.body);};
 const sample=async(label,green)=>{
  await expect(panel).toHaveAttribute('data-answer-complete',String(green));
  const result=await panel.evaluate(p=>({green:p.dataset.answerComplete,heading:getComputedStyle(p.querySelector('.panel-heading')).backgroundColor,outline:getComputedStyle(p).boxShadow}));
  expect(result.heading==='rgb(36, 91, 58)').toBe(green);samples.push({label,...result,review:(await snapshot()).reviews[a.id]});
 };
 try{
  await page.goto(f.base+'/agents');
  // No selected conversation: UI cannot acknowledge content the user has not read.
  const first=await send('方針について相談');await f.complete(first,'相談への回答');await sample('normal semantic target, delivery OFF',true);
  const old=(await snapshot()).reviews[a.id].revision;
  await page.screenshot({path:info.outputPath('unread.png')});
  // A new running input must not delay/erase the earlier unread notification.
  const second=await send('途中報告');await sample('new input retains unread target',true);
  const mode=await f.post('/conversations/display',{conversationId:second.conversationId,actorRunId:second.id,operationId:randomUUID(),expectedVersion:0,mode:'progress'});expect(mode.status).toBe(200);
  expect((await f.post('/agents/'+a.id+'/view',{revision:old})).status).toBe(200);await sample('read',false);
  await f.complete(second,'進行中の報告');await sample('progress does not relight',false);
  expect((await snapshot()).reviews[a.id].revision).toBe(old);
  const third=await send('次の相談');await f.complete(third,'次の回答');await sample('next target',true);
  expect((await f.post('/agents/'+a.id+'/view',{revision:old})).status).toBe(409);await sample('late ack refused',true);
  await page.locator('#agent-'+a.id+' textarea').click();
  await expect.poll(async()=>(await snapshot()).reviews[a.id].unreviewed).toBe(false);await sample('actual selected view acknowledged',false);
  await page.reload();await sample('reconnect stays read',false);
  await page.screenshot({path:info.outputPath('read.png')});
  expect(await f.lines(f.notices)).toEqual([]);
  await writeFile(info.outputPath('samples.json'),JSON.stringify(samples,null,2));
 }finally{await f.close();}
});
