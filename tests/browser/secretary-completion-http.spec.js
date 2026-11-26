import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {completionHTTPFixture} from '../helpers/completion-http-fixture.mjs';

// No API routes or attention flags are mocked: native JSONL is the only execution fixture.
test('real conversation API/native terminal → projection → secretary completion and read acknowledgement',async({page},info)=>{
 test.setTimeout(240000);
 const f=await completionHTTPFixture(Number(process.env.VILLAGE_COMPLETION_PORT||15585));
 const a=f.agents[0],leader=f.agents[1],samples=[];
 const snapshot=async()=> (await fetch(f.base+'/api/direct?view=workspace')).json();
 const send=async text=>{const x=await f.post('/agents/'+a.id+'/runs',{mode:'conversation',requestId:randomUUID(),instruction:text});expect(x.status).toBe(200);return x.body;};
 const sample=async(label,complete)=>{
  const panel=page.locator('#agent-'+a.id),dot=page.locator('[data-place=all] [data-agent-dot="'+a.id+'"]');
  await expect(panel).toHaveAttribute('data-answer-complete',String(complete));await expect(dot).toHaveAttribute('data-answer-complete',String(complete));
  const value=await panel.evaluate(p=>{const h=p.querySelector('.panel-heading'),i=document.querySelector('[data-place=all] [data-agent-dot="'+p.id.slice(6)+'"]');return {panel:{...p.dataset},heading:getComputedStyle(h).backgroundColor,headingText:getComputedStyle(h).color,headerIcon:getComputedStyle(h.querySelector('.dot')).color,shadow:getComputedStyle(p).boxShadow,iconColor:i.classList.contains('status-icon')?getComputedStyle(i).color:getComputedStyle(i).backgroundColor,outline:getComputedStyle(i).outlineStyle};});
  if(complete){expect(value.heading).toBe('rgb(36, 91, 58)');expect(value.headingText).toBe('rgb(216, 255, 228)');expect(value.shadow).toContain('rgb(34, 197, 94)');expect(value.iconColor).toBe('rgb(34, 197, 94)');expect(value.outline).toBe('solid');}else{expect(value.heading).not.toBe('rgb(36, 91, 58)');}
  const api=await snapshot(),agent=api.agents.find(x=>x.id===a.id),entry=api.conversations[a.id].entries.at(-1);
  samples.push({label,...value,api:{agentState:agent.state,answerComplete:agent.answerComplete,review:api.reviews[a.id],runId:entry.id,state:entry.state,conversationAnswer:entry.conversationAnswer,displayMode:entry.displayMode}});
 };
 try{
  await page.goto(f.base+'/agents');
  for(const width of [1440,390])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const r=await f.submit(await send('普通の相談 '+width+' '+theme));
   await page.locator('#agent-'+a.id+' textarea').click();await sample('running '+width+theme,false);
   await f.native(a,[{type:'response_item',payload:{type:'message',role:'assistant',id:randomUUID(),phase:'commentary',recipient:null,content:[{type:'output_text',text:'途中の説明です'}]}}]);
   await expect(page.locator('#agent-'+a.id)).toContainText('途中の説明です');await sample('preview '+width+theme,false);
   await f.complete(r,'普通の相談への回答です');await sample('normal '+width+theme,true);
   await expect.poll(async()=> (await snapshot()).reviews[a.id].unreviewed).toBe(false);
   await sample('ack '+width+theme,true);
   if(width===390&&theme==='light')await info.attach('mobile-light-completed',{body:await page.screenshot({path:info.outputPath('mobile-light-completed.png')}),contentType:'image/png'});
   if(width===1440&&theme==='dark')await info.attach('desktop-dark-completed',{body:await page.screenshot({path:info.outputPath('desktop-dark-completed.png')}),contentType:'image/png'});
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
   await sample('hidden '+width+theme,true);
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
   await page.locator('[data-place=all]').click();await page.reload();await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await sample('reload-unselected '+width+theme,true);
   await page.locator('#agent-'+a.id+' textarea').click();await sample('revisit '+width+theme,true);
  }
  const unseen=await f.submit(await send('未選択で完了する相談'));
  await page.reload();await f.complete(unseen,'未読の正常回答');await sample('unselected unread',true);
  expect((await snapshot()).reviews[a.id].unreviewed).toBe(true);
  await page.locator('#agent-'+a.id+' textarea').click();
  await expect.poll(async()=> (await snapshot()).reviews[a.id].unreviewed).toBe(false);await sample('selected read',true);
  // A real leader job: its internal result is progress until a formal decision commits.
  const human=await f.submit(await send('成果を作成してください。'));
  const job=await f.post('/conversations/job',{conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),instruction:'隔離成果',authorization:{runId:human.id,quote:'成果を作成してください。'}});expect(job.status).toBe(200);
  await f.complete(human,'依頼しました');
  const q=(await f.post('/requests/get',{humanRequestId:job.body.humanRequestId})).body;
  const work=await f.submit(q.runs[0]);await f.finish(work,randomUUID());await f.complete(work,'成果本文');
  let c=await f.until(async()=>{const x=(await f.post('/conversations/get',{conversationId:human.conversationId})).body;return x.deliveries.length&&x;});
  let delivery=await f.submit(c.runs.find(r=>r.id===c.deliveries[0].runId));
  await sample('result review running',false);
  const follow=await f.post('/conversations/followup',{conversationId:c.id,actorRunId:delivery.id,operationId:randomUUID(),purposeId:job.body.humanRequestId,instruction:'残作業を修正してください'});expect(follow.status).toBe(200);
  await f.complete(delivery,'修正作業を依頼しました（内部の途中報告）');await sample('internal progress only',false);
  const updated=(await f.post('/conversations/get',{conversationId:c.id})).body;
  const nextJob=updated.jobs.find(j=>j.id!==job.body.humanRequestId);
  const nextQ=(await f.post('/requests/get',{humanRequestId:nextJob.id})).body;
  const revision=await f.submit(nextQ.runs[0]);await f.finish(revision,randomUUID());await f.complete(revision,'修正済み成果');
  c=await f.until(async()=>{const x=(await f.post('/conversations/get',{conversationId:c.id})).body;return x.deliveries.length>1&&x;});
  const event=c.deliveries.at(-1);delivery=await f.submit(c.runs.find(r=>r.id===event.runId));
  const decision=await f.post('/conversations/decide',{conversationId:c.id,actorRunId:delivery.id,operationId:randomUUID(),humanRequestId:nextJob.id,deliveryId:event.id,expectedPurposeVersion:1,decision:'accept',reason:'成果を確認'});expect(decision.status).toBe(200);
  await f.complete(delivery,'成果を確認して採用しました。');await sample('accepted leader result',true);
  const done=await snapshot();expect(done.reviews[a.id].attention).toBe(false);expect(done.agents.find(x=>x.id===leader.id).answerComplete).toBe(false);
  // Next human input invalidates completion before native input acceptance.
  const next=await send('次の相談');expect((await snapshot()).agents.find(x=>x.id===a.id).answerComplete).toBe(false);await sample('new send',false);
  const current=await f.submit(next);
  const queued=await send('実行中に次の相談');expect(queued.state).toBe('queued');await sample('queued',false);
  await f.complete(current,'先の回答');await sample('older normal cannot override newer queue',false);
  const pending=await f.submit(queued);await f.native(a,[{type:'event_msg',payload:{type:'turn_aborted',turn_id:pending.turnId}}]);
  await f.until(async()=>(await f.run(pending.id)).state==='interrupted');await sample('interrupted',false);
  const fail=await f.submit(await send('失敗fixture'));
  await f.native(a,[{type:'event_msg',payload:{type:'task_complete',turn_id:fail.turnId,error:{message:'fixture failure'}}}]);
  await f.until(async()=>(await f.run(fail.id)).state==='failed');await sample('failed',false);
  await writeFile(f.capture+'.lose','fixture');
  const unknown=await send('受付不明fixture');expect(unknown.state).toBe('awaiting_input');expect(unknown.runModel.state.kind).toBe('sent');expect(unknown.runModel.facts.some(x=>x.type==='transport-ack')).toBe(false);await sample('send unknown',false);
  await page.reload();await sample('reconnect still unknown',false);
  expect((await f.lines(f.capture)).filter(x=>x.text.includes(unknown.id))).toHaveLength(1);
  // Read acknowledgement and browser reconnection do not produce extra notifications.
  expect(await f.lines(f.notices)).toEqual([]);
  await writeFile(info.outputPath('completion-api-browser-evidence.json'),JSON.stringify({fixture:'actual HTTP + fake native JSONL, notifications OFF',samples},null,2));
  await info.attach('completion-api-browser-evidence',{body:JSON.stringify({fixture:'actual HTTP + fake native JSONL, notifications OFF',samples},null,2),contentType:'application/json'});
 }finally{await f.close();}
});
