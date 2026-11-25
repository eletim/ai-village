import {acceptDelivery} from '../purpose-fixture.js';
import {fixture} from '../inbox-fixture.js';
import {randomUUID} from 'node:crypto';
import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {changeRun} from '../../server/run-lifecycle.mjs';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
for(const width of [1440,390])test('answer-local states: advice, active, complete, multiple jobs, question and failure '+width,async({page},info)=>{
 const cleanup=[];const f=await fixture({after:fn=>cleanup.push(fn)});
 try{
 const p=await f.service.putProject({requestId:randomUUID(),name:'回答の状態'});
 for(const a of f.agents)a.projectId=p.id;
 await f.service.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 async function reply(text){const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:text});await f.submit(r);return r;}
 const advice=await reply('相談への回答です。');await f.complete(advice);
 const work=await reply('資料を作っています。');
 async function job(name){return f.service.conversations.job({conversationId:work.conversationId,actorRunId:work.id,operationId:randomUUID(),instruction:name,authorization:{runId:work.id,quote:work.instruction}});}
 const a=await job('資料A'),b=await job('資料B');await f.complete(work);
 await f.service.tick();
 const leader=f.service.flow.run(a.runId);await f.submit(leader);
 await f.service.flow.finish({humanRequestId:leader.humanRequestId,workId:leader.workId,runId:leader.id,operationId:randomUUID(),inputs:f.service.flow.inputs(leader.humanRequestId,leader.workId).map(i=>i.id),results:[]});
 await f.complete(leader);
 const c=f.service.conversations.record(work.conversationId);
 const done=f.service.flow.run(c.deliveries.find(e=>e.humanRequestId===a.humanRequestId).runId);
 await f.submit(done);await acceptDelivery(f,done);await f.complete(done);
 const qb=f.service.data.requests.find(q=>q.id===b.humanRequestId);
 await f.submit(f.service.flow.run(b.runId));
 f.service.conversations.deliver(c,qb,'test-question','question',{text:'公開日を指定してください。'});
 const question=f.service.flow.run(c.deliveries.at(-1).runId);await f.service.tick();await f.submit(question);
 await f.service.conversations.decide({conversationId:c.id,actorRunId:question.id,operationId:randomUUID(),humanRequestId:b.humanRequestId,deliveryId:c.deliveries.at(-1).id,expectedPurposeVersion:0,decision:'question',reason:'公開日は人間の希望が必要',question:'公開日を指定してください。'});
 await f.complete(question);
 await page.setViewportSize({width,height:1000});
 await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/direct'?workspaceSnapshot(f.service.snapshot(),{},[work.agentId]):{providers:{}}}));
 await page.goto('/agents');await page.locator('[data-zoom="'+work.agentId+'"]').click();
 const rows={advice,work,done,question};
 const element=id=>page.locator('[data-entry='+JSON.stringify(JSON.stringify(['run','',rows[id].id]))+']');
 await expect(element('advice').locator('.answer-jobs')).toHaveCount(0);
 await expect(element('work').locator('.answer-job')).toHaveCount(2);
 await expect(element('work').locator('.answer-jobs')).toContainText('回答が必要');
 await expect(element('done').locator('.answer-job')).toHaveCount(1);
 await expect(element('done').locator('.answer-jobs')).toContainText('完了');
 await expect(element('done').locator('.answer-jobs')).not.toContainText('資料B');
 await expect(element('question')).toContainText('公開日を指定してください。');
 await expect(page.locator('body')).not.toContainText('成果確認待ち');
 await expect(page.locator('body')).not.toContainText('会話と仕事の状況は別です');
 await expect(page.locator('body')).not.toContainText('仕事の完了・成果確認は');
 await page.screenshot({path:info.outputPath('answer-states-'+width+'.png')});
 const failed=f.service.flow.run(b.runId);
 if(failed.runModel.state.kind==='queued'){await f.service.tick();}

 changeRun(failed,{type:'lost',actor:'program',at:Date.now(),reason:'受付不明'});failed.error='受付不明';await f.service.save();
 await notifySnapshot(page);await expect(element('work').locator('.answer-jobs')).toContainText('停止中');
 await expect(element('work').locator('.answer-jobs')).toContainText('受付不明');
 await expect(page.locator('[data-send="'+work.agentId+'"] [type=submit]')).toBeEnabled();
 await page.screenshot({path:info.outputPath('answer-failure-'+width+'.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{f.service.close();for(const fn of cleanup)await fn();}
});
