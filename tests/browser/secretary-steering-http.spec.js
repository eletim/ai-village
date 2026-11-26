import {test,expect} from '@playwright/test';
import {writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {completionHTTPFixture} from '../helpers/completion-http-fixture.mjs';

test('HTTP → native same-turn additions → preview/final/history on desktop and mobile',async({page},info)=>{
 test.setTimeout(180000);const f=await completionHTTPFixture(Number(process.env.VILLAGE_STEERING_PORT||15662)),a=f.agents[0],evidence=[];
 const send=async instruction=>{const x=await f.post('/agents/'+a.id+'/runs',{mode:'conversation',requestId:randomUUID(),instruction});expect(x.status).toBe(200);return x.body;};
 const textFor=async r=>(await f.until(async()=>(await f.lines(f.capture)).find(x=>x.text.includes(r.id)))).text;
 const accept=async(r,turn)=>{const text=await textFor(r);await f.native(a,[{type:'response_item',payload:{type:'message',role:'user',internal_chat_message_metadata_passthrough:{turn_id:turn,content_item_kinds:['user.text']},content:[{type:'input_text',text}]}}]);return f.until(async()=>{const x=await f.run(r.id);return x.acceptedAt&&x;});};
 try{
  await page.goto(f.base+'/agents');
  for(const width of [1440,390])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const first=await f.submit(await send('原文 '+width+theme));await writeFile(f.capture+'.busy','1');
   const panel=page.locator('#agent-'+a.id);await panel.locator('textarea').click();
   await f.native(a,[{type:'response_item',payload:{type:'message',id:randomUUID(),role:'assistant',phase:'commentary',content:[{type:'output_text',text:'変更前の途中報告 '+width+theme}]}}]);
   await expect(panel).toContainText('変更前の途中報告');
   // Send from the real UI while the first native turn has not ended.
   await panel.locator('textarea').fill('訂正A '+width+theme);await panel.locator('button[type=submit]').click();
   const second=await f.until(async()=>{const s=await f.get();return s.runs.find(r=>r.instruction==='訂正A '+width+theme);});
   await textFor(second);expect(second.steerTarget?.turnId||(await f.run(second.id)).steerTarget.turnId).toBe(first.turnId);
   const third=await send('訂正B '+width+theme);expect(third.state).toBe('queued');
   const before=await f.post('/conversations/get',{conversationId:first.conversationId,actorRunId:first.id});expect(before.body.current.id).toBe(first.id);
   await accept(second,first.turnId);const last=await accept(third,first.turnId);
   const read=await f.post('/conversations/get',{conversationId:first.conversationId,actorRunId:first.id});expect(read.body.current.id).toBe(last.id);
   expect(read.body.humanInputs.slice(-3).map(r=>r.id)).toEqual([first.id,second.id,last.id]);
   await expect(panel).toContainText('実行中への追記を受付済み');await expect(panel).toHaveAttribute('data-answer-complete','false');
   await f.native(a,[{type:'response_item',payload:{type:'message',id:randomUUID(),role:'assistant',phase:'commentary',content:[{type:'output_text',text:'訂正Bを反映中 '+width+theme}]}}]);
   await expect(panel).toContainText('訂正Bを反映中');
   await page.reload();await panel.locator('textarea').click();await expect(panel).toContainText('訂正Bを反映中');
   await f.complete(last,'訂正Bを反映した最終回答 '+width+theme);await rm(f.capture+'.busy',{force:true});
   await expect(panel).toContainText('訂正Bを反映した最終回答');
   expect((await f.run(first.id)).state).toBe('superseded');expect((await f.run(second.id)).state).toBe('superseded');
   expect((await f.lines(f.capture)).filter(x=>x.text.includes(last.id))).toHaveLength(1);
   evidence.push({width,theme,first:first.id,second:second.id,last:last.id,turnId:last.turnId,sessionId:last.sessionId,states:(await f.get()).runs.filter(r=>[first.id,second.id,last.id].includes(r.id)).map(r=>({id:r.id,state:r.state,output:r.output}))});
   await info.attach(width+'-'+theme,{body:await page.screenshot({path:info.outputPath(width+'-'+theme+'.png')}),contentType:'image/png'});
  }
  expect(await f.lines(f.notices)).toHaveLength(0);
  await writeFile(info.outputPath('native-api-history.json'),JSON.stringify(evidence,null,2));
  await info.attach('native-api-history',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
 }finally{await f.close();}
});
