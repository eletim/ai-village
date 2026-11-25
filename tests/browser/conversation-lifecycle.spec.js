import {initializeRun} from '../../server/run-lifecycle.mjs';
import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {fixtureModels} from '../model-fixtures.mjs';
import {humanProjection} from '../../server/report-view.mjs';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
for(const width of [1440,390])test('secretary mailbox remains available while leader work is blocked; explicit status and next action '+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 const data=fixtureModels({projects:[{id:'p',name:'Lifecycle',leaderAgentId:'l'}],workshops:[],agents:[
  {id:'s',name:'秘書',projectId:'p',location:'mayor',state:'idle',connection:{},inputEnvelope:{mode:'startup-v2'}},
  {id:'l',name:'リーダー',projectId:'p',location:'workshop',state:'busy',connection:{},inputEnvelope:{mode:'migration-required',reason:'startup-instructions-missing-or-changed'}}
 ],runs:[],requests:[],notification:{enabled:false},reviews:{}});
 data.capabilities={secretaryConversations:true,requestInbox:true};
 data.conversations=[{id:'c',agentId:'s',projectId:'p',deliveries:[]}];
 let sends=0;
 const view=()=>humanProjection(data);
 await page.route('**/api/**',route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('/runs')&&route.request().method()==='POST'){sends++;const input=route.request().postDataJSON(),r={id:'sent',agentId:'s',requestId:input.requestId,instruction:input.instruction,origin:'human',conversationId:'c',conversationSource:{kind:'human'},createdAt:new Date().toISOString()};initializeRun(r);data.runs.push(r);return route.fulfill({json:r});}
  if(u.pathname==='/api/direct')return route.fulfill({json:workspaceSnapshot(view(),{},['s'])});
  return route.fulfill({json:{providers:{}}});
 });
 await page.goto('/agents');
 const send=page.getByRole('button',{name:'会話を送信',exact:true}).first();
 await expect(send).toBeEnabled();
 await expect(page.getByText(/仕事のリーダー（リーダー）: 正式セッションへの移行待ち/)).toBeVisible();
 await page.getByRole('textbox',{name:/秘書に聞く/}).fill('復旧状況を確認してください');
 await send.click();await expect.poll(()=>sends).toBe(1);
 await notifySnapshot(page);await expect(send).toBeEnabled();
 await page.screenshot({path:info.outputPath('leader-blocked-'+width+'.png')});
 data.agents[0].inputEnvelope={mode:'migration-required',reason:'startup-instructions-missing-or-changed'};await notifySnapshot(page);
 await expect(send).toBeDisabled();await expect(page.getByText('プロフィールの起動契約から正式な移行を確認してください。既存の送信待ちは保持されています。',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('secretary-migration-'+width+'.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

import {fixture} from '../inbox-fixture.js';
import {randomUUID} from 'node:crypto';
for(const width of [1440,390])test('actual graph and delivery projections distinguish working, completed return, review and failed receipt '+width,async({page},info)=>{
 const cleanup=[];const f=await fixture({after:fn=>cleanup.push(fn)});
 try{
  const p=await f.service.putProject({requestId:randomUUID(),name:'Lifecycle states'});
  for(const a of f.agents)a.projectId=p.id;
  await f.service.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
  const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'成果を作ってください'});
  await f.submit(r);
  const j=await f.service.conversations.job({conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),instruction:'検証用の成果',authorization:{runId:r.id,quote:r.instruction}});
  await f.service.tick();const leader=f.service.flow.run(j.runId);await f.submit(leader);await f.complete(r);
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/api/direct')return route.fulfill({json:workspaceSnapshot(f.service.snapshot(),{},[r.agentId])});return route.fulfill({json:{providers:{}}});});
  await page.goto('/agents');
  await page.locator('[data-zoom="'+r.agentId+'"]').click();
  const summary=page.locator('[data-disclosure="conversation-work:'+r.agentId+'"]');
  await summary.locator('summary').click();await expect(summary).toContainText('リーダーが作業中');
  const button=page.locator('[data-send="'+r.agentId+'"] [type=submit]');await expect(button).toBeEnabled();
  await f.service.flow.finish({humanRequestId:leader.humanRequestId,workId:leader.workId,runId:leader.id,operationId:randomUUID(),inputs:f.service.flow.inputs(leader.humanRequestId,leader.workId).map(i=>i.id),results:[]});
  await f.complete(leader);await notifySnapshot(page);await expect(summary).toContainText('仕事完了・秘書へ返答待ち');
  const delivery=f.service.flow.run(f.service.conversations.record(r.conversationId).deliveries[0].runId);await f.submit(delivery);await f.complete(delivery);await notifySnapshot(page);
  await expect(summary).toContainText('仕事完了・秘書回答済み（成果確認待ち）');await expect(summary).toHaveAttribute('open','');
  await page.screenshot({path:info.outputPath('completed-review-'+width+'.png')});
  const bad=await f.service.send(r.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'受付不明の新しい入力'});
  const {changeRun}=await import('../../server/run-lifecycle.mjs');changeRun(bad,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});bad.error='competing-or-unmatched-input';await f.service.save();await notifySnapshot(page);
  await expect(page.locator('.run-status').filter({hasText:'秘書の受付・結果が未確認'})).toBeVisible();await expect(button).toBeEnabled();
  await page.screenshot({path:info.outputPath('unconfirmed-'+width+'.png')});
 }finally{f.service.close();for(const fn of cleanup)await fn();}
});
