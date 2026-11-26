import {test,expect,notifySnapshot} from './helpers/change-events.js';
import {fixture} from '../inbox-fixture.js';
import {randomUUID} from 'node:crypto';
import {workspaceSnapshot} from '../../server/conversation-pages.mjs';
for(const width of [1440,390])test('direct assignee appears instead of unrelated default leader '+width,async({page},info)=>{
 const cleanup=[],f=await fixture({after:fn=>cleanup.push(fn)}),d=f.service;
 try{
  const p=await d.putProject({requestId:randomUUID(),name:'Direct assignee'});for(const a of f.agents)a.projectId=p.id;
  await d.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
  const h=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'工房の担当へ直接依頼して'});await f.submit(h);
  const job=await d.secretaryCommands.order(h.id,'指定担当の成果',f.agents[3].id);await f.complete(h);await d.tick();const r=d.flow.run(job.runId);await f.submit(r);
  await page.setViewportSize({width,height:1000});
  await page.route('**/api/**',route=>{const u=new URL(route.request().url());return route.fulfill({json:u.pathname==='/api/direct'?workspaceSnapshot(d.snapshot(),{},[h.agentId]):{providers:{}}});});
  await page.goto('/agents');await page.locator('[data-zoom="'+h.agentId+'"]').click();
  await expect(page.locator('.answer-job-assignee').first()).toHaveText('担当: Worker 3');
  const project=d.project(p.id);await d.putProject({revision:project.revision,leaderAgentId:null},p.id);await notifySnapshot(page);
  await expect(page.locator('.answer-job-assignee').first()).toHaveText('担当: Worker 3');
  await expect(page.locator('[data-send="'+h.agentId+'"] [type=submit]')).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('direct-assignee-'+width+'.png')});
 }finally{d.close();for(const fn of cleanup)await fn();}
});
