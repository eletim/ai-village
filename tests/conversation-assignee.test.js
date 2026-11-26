import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {purposeFixture} from './purpose-fixture.js';
import {VillageOperations} from '../server/operations.mjs';
import {rootNode} from '../server/unified-requests.mjs';
import {AgentRules} from '../server/agent-rules.mjs';
import {execFileSync} from 'node:child_process';
async function setup(t){
 const f=await fixture(t),d=f.service,p=await d.putProject({requestId:randomUUID(),name:'Direct'});
 for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 const h=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'明示した担当へ作業を依頼して進めてください'});await f.submit(h);
 const input=(extra={})=>({conversationId:h.conversationId,actorRunId:h.id,operationId:randomUUID(),instruction:'同じ作業',authorization:{runId:h.id,quote:h.instruction},...extra});
 const leader=async id=>{const p=d.project(h.projectId||f.agents[0].projectId);return d.putProject({revision:p.revision,leaderAgentId:id},p.id);};
 const cli=(...args)=>new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute(args);
 return {f,d,h,input,leader,cli};
}
test('default/explicit recipients are durable, same operation cannot change selection, leader edits never redirect retries',async t=>{
 const {f,d,input,leader}=await setup(t),x=input(),one=await d.conversations.job(x);
 assert.equal(one.assigneeAgentId,f.agents[2].id);assert.equal(one.leaderAgentId,one.assigneeAgentId);
 await leader(f.agents[3].id);
 assert.deepEqual(await d.conversations.job(x),one);
 await assert.rejects(d.conversations.job({...x,assigneeAgentId:f.agents[2].id}),/operationId/);
 await assert.rejects(d.conversations.job({...x,assigneeAgentId:f.agents[3].id}),/operationId/);
 for(const field of ['continuesRequestId','humanRequestId','purposeId','deliveryId','expectedPurposeVersion','reopenRunId'])await assert.rejects(d.conversations.job(input({assigneeAgentId:f.agents[3].id,[field]:one.humanRequestId})),/担当指定/);
 const explicit=input({assigneeAgentId:f.agents[2].id}),two=await d.conversations.job(explicit);
 await leader(null);assert.deepEqual(await d.conversations.job(explicit),two);
 const three=await d.conversations.job(input({assigneeAgentId:f.agents[3].id}));
 assert.equal(three.assigneeAgentId,f.agents[3].id);assert.equal(d.project(f.agents[0].projectId).leaderAgentId,null);
 await assert.rejects(d.conversations.job(input()),/リーダーが未設定/);
 await f.restart();assert.deepEqual(await f.service.conversations.job(explicit),two);assert.equal(f.service.data.requests.length,3);
});
test('CLI explicit destinations, omission and changed leaders have stable separate keys; status reports actual owner',async t=>{
 const {f,d,h,cli,leader}=await setup(t),run=['--run',h.id];
 const a=await cli('order',...run,'作業');assert(a.ok,a.error);
 await leader(f.agents[3].id);
 assert.deepEqual((await cli('order',...run,'作業')).result,a.result);
 const b=await cli('order',...run,'--assignee',f.agents[3].id,'作業');assert(b.ok,b.error);
 assert.deepEqual((await cli('order',...run,'--assignee='+f.agents[3].id,'作業')).result,b.result);
 const c=await cli('order',...run,'--assignee',f.agents[2].id,'作業');assert(c.ok,c.error);
 assert.equal(new Set([a.result.humanRequestId,b.result.humanRequestId,c.result.humanRequestId]).size,3);
 const status=await cli('status',...run);assert(status.ok,status.error);assert.equal(status.result.purposes.find(p=>p.id===b.result.purposeId).assigneeAgentId,f.agents[3].id);
 assert.equal((await cli('followup',...run,'--assignee',f.agents[2].id,'追記')).ok,false);
 assert.equal((await cli('order',...run,'--assignee=','作業')).ok,false);
 assert.equal((await cli('order',...run,'--assignee',f.agents[2].id,'--assignee',f.agents[3].id,'作業')).ok,false);
 assert.equal(d.data.requests.length,3);
});
test('invalid, foreign, secretary, stopped and incompatible targets cannot enqueue; local and ssh roles remain distinct',async t=>{
 const {f,d,input}=await setup(t);
 for(const id of [null,'',13,randomUUID(),f.agents[0].id,f.agents[1].id])await assert.rejects(d.conversations.job(input({assigneeAgentId:id})));
 const a=f.agents[3],pid=a.projectId;a.projectId='foreign';
 await assert.rejects(d.conversations.job(input({assigneeAgentId:a.id})),/担当を利用/);a.projectId=pid;
 const envelope=a.inputEnvelope;a.inputEnvelope={mode:'legacy'};
 await assert.rejects(d.conversations.job(input({assigneeAgentId:a.id})),/起動契約/);a.inputEnvelope=envelope;
 a.runtimeUpgrade={state:'prepared'};await assert.rejects(d.conversations.job(input({assigneeAgentId:a.id})),/担当を利用/);delete a.runtimeUpgrade;
 const intent=a.agentModel.intent;a.agentModel.intent='stop';await assert.rejects(d.conversations.job(input({assigneeAgentId:a.id})),/担当を利用/);a.agentModel.intent=intent;
 assert.equal(d.data.requests.length,0);
 const q=await d.conversations.job(input({assigneeAgentId:a.id}));await d.tick();assert(f.sent.some(s=>s.text.includes(q.runId)&&s.transport==='ssh'));
});
test('followup and continue use root assignee after leader edits; results return to original secretary',async t=>{
 const {f,human,first,completeJob,args}=await purposeFixture(t),d=f.service;
 const one=await completeJob(first),p=d.project(f.agents[0].projectId);
 await d.putProject({revision:p.revision,leaderAgentId:f.agents[3].id},p.id);
 await assert.rejects(d.conversations.job({...args(one),instruction:'修正',continue:true,assigneeAgentId:f.agents[3].id}),/担当指定/);
 const next=await d.conversations.followup({conversationId:human.conversationId,actorRunId:one.delivery.id,operationId:randomUUID(),purposeId:first.purposeId,instruction:'元担当で修正'});
 assert.equal(next.assigneeAgentId,f.agents[2].id);
 await f.complete(one.delivery);
 const two=await completeJob(next);

 const third=await d.conversations.job({conversationId:human.conversationId,actorRunId:two.delivery.id,operationId:randomUUID(),continue:true,instruction:'引継ぎ先へ残作業'});
 assert.equal(third.assigneeAgentId,f.agents[2].id);
 assert.equal(rootNode(d.flow.root(third.humanRequestId)).recipient.conversationId,human.conversationId);
 await f.complete(two.delivery);
 const three=await completeJob(third);
 assert.equal(three.delivery.agentId,human.agentId);
 const accepted=await d.secretaryCommands.accept(three.delivery.id,'成果を確認');assert.equal(accepted.kind,'accept');
 await f.complete(three.delivery);
 assert.equal(d.conversations.get(human.conversationId).jobs.find(j=>j.id===first.humanRequestId).lifecycle.code,'completed');
});
test('explicit work keeps amend/withdraw boundary; unknown send is not retried',async t=>{
 const {f,d,h,input}=await setup(t),x=input({assigneeAgentId:f.agents[3].id});f.lose(true);const job=await d.conversations.job(x);
 const follow={conversationId:h.conversationId,actorRunId:h.id,operationId:randomUUID(),purposeId:job.purposeId,instruction:'追加条件'};
 const out=await d.conversations.followup(follow);assert.equal(out.action,'amend');
 assert.equal(rootNode(d.flow.root(job.humanRequestId)).assignee,f.agents[3].id);
 await d.tick();const count=f.sent.length;assert.equal(d.flow.run(job.runId).runModel.state.kind,'sent');assert(!d.flow.run(job.runId).runModel.facts.some(f=>f.type==='transport-ack'));
 assert.deepEqual(await d.conversations.job(x),job);await d.tick();assert.equal(f.sent.length,count);
 await d.conversations.followup({...follow,operationId:randomUUID(),instruction:'保存だけの追加条件'});await d.tick();assert.equal(f.sent.length,count);
 const withdrawn=await d.conversations.withdraw({conversationId:h.conversationId,actorRunId:h.id,operationId:randomUUID(),humanRequestId:job.humanRequestId,instruction:'取り下げ',authorization:x.authorization});
 assert.equal(withdrawn.action,'withdraw');assert.equal(rootNode(d.flow.root(job.humanRequestId)).state.kind,'withdrawn');
});
test('runtime startup2/3 contracts remain byte-identical to integration base',()=>{
 const original=execFileSync('git',['show','d4c4adc:server/agent-rules.mjs'],{encoding:'utf8'});
 // Only work policy changes; startup bodies are copied verbatim.
 const current=execFileSync('cat',['server/agent-rules.mjs'],{encoding:'utf8'});
 for(const method of ['startup','startup3']){const extract=s=>s.slice(s.indexOf(' '+method+'(){'),s.indexOf('\n }',s.indexOf(' '+method+'(){'))+3);assert.equal(extract(current),extract(original));}
 assert(new AgentRules('http://127.0.0.1:15710').work('x').includes('assigneeAgentId'));
});


test('human-authorized root reassignment is retained by later continuation, without selecting child work',async t=>{
 const {f,d,h,input,leader}=await setup(t),job=await d.conversations.job(input());await f.complete(h);
 await d.tick();const r=d.flow.run(job.runId);await f.submit(r);await f.complete(r,'failed');
 const q=d.flow.root(job.humanRequestId),w=rootNode(q);
 const current=await d.flow.continue({humanRequestId:q.id,workId:w.id,revision:q.revision,operationId:randomUUID(),agentId:f.agents[3].id,instruction:'人間の担当変更による再開'},true);
 assert.equal(rootNode(q).assignee,f.agents[3].id);await d.tick();await f.submit(current);
 await d.flow.finish({humanRequestId:q.id,workId:w.id,runId:current.id,operationId:randomUUID(),inputs:d.flow.inputs(q.id,w.id).filter(i=>!i.handledBy&&i.attempts.includes(current.id)).map(i=>i.id),results:[]});await f.complete(current);
 const c=d.conversations.record(h.conversationId);
 // The earlier failure report is delivered first, then the new formal result.
 for(const event of c.deliveries.filter(e=>e.kind==='attention')){const report=d.flow.run(event.runId);await f.submit(report);await f.complete(report);}
 const delivery=d.flow.run(c.deliveries.findLast(e=>e.humanRequestId===q.id&&e.kind==='result').runId);await f.submit(delivery);
 await leader(f.agents[2].id);
 const next=await d.secretaryCommands.followup(delivery.id,job.purposeId,'同じ実担当へ修正');assert.equal(next.assigneeAgentId,f.agents[3].id);
});
test('explicit order rollback can retry once without duplicate work or changed recipient',async t=>{
 const {f,d,input}=await setup(t),x=input({assigneeAgentId:f.agents[3].id}),save=d.save.bind(d);let fail=true;
 d.save=async()=>{if(fail){fail=false;throw Error('fixture save failed');}return save();};
 await assert.rejects(d.conversations.job(x),/fixture save failed/);assert.equal(d.data.requests.length,0);
 d.save=save;const receipt=await d.conversations.job(x);assert.equal(receipt.assigneeAgentId,f.agents[3].id);
 assert.deepEqual(await d.conversations.job(x),receipt);assert.equal(d.data.requests.length,1);
});
test('busy assignee queues instead of steering or selecting another owner',async t=>{
 const {f,d,input}=await setup(t),a=f.agents[3];
 const busy=await d.send(a.id,{requestId:randomUUID(),instruction:'既存作業'});await f.submit(busy);
 const count=f.sent.length,job=await d.conversations.job(input({assigneeAgentId:a.id}));await d.tick();
 assert.equal(d.flow.run(job.runId).agentId,a.id);assert.equal(d.flow.run(job.runId).runModel.state.kind,'queued');assert.equal(f.sent.length,count);
});
