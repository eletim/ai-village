import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
import {VillageOperations} from '../server/operations.mjs';
import {addressedScope} from '../server/conversation-input-scope.mjs';
async function setup(t){
 const x=await purposeFixture(t),s=x.f.service;
 const p=await s.putProject({requestId:randomUUID(),name:'送信元'}),a=x.f.agents[1];a.projectId=p.id;a.location='mayor';
 const human=await s.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction:'資料の見積りを修正して続けて'});await x.f.submit(human);
 const target={projectId:s.flow.root(x.first.humanRequestId).projectId,workId:x.first.workId,action:'continue',quote:'見積りを修正して続けて'};
 return {...x,s,source:human,target};
}
test('clear human interpretation is atomic, immutable, deduplicated and read after restart',async t=>{
 const {f,s,source,target}=await setup(t),original=JSON.stringify(source.conversationSource);
 const sent=await s.secretaryCommands.order(source.id,'元の範囲で継続',undefined,target);
 assert.deepEqual(await s.secretaryCommands.order(source.id,'元の範囲で継続',undefined,target),sent);
 assert.equal(JSON.stringify(source.conversationSource),original);assert.equal(source.conversationSource.scope,undefined);
 const op=s.conversations.record(source.conversationId).operations.find(o=>o.receipt?.runId===sent.runId);assert.equal(op.resolution.humanRunId,source.id);
 await assert.rejects(s.secretaryCommands.order(source.id,'元の範囲で継続',undefined,{...target,action:'cancel'}),/配送済み/);
 await f.complete(source);await s.tick();const receiver=s.flow.run(sent.runId);await f.submit(receiver);
 assert.equal(addressedScope(s,receiver,'continue',target.workId).w.id,target.workId);
 await assert.rejects(async()=>addressedScope(s,receiver,'cancel',target.workId),/対象・操作/);
 await f.complete(receiver);const restarted=await f.restart();assert.equal(restarted.conversations.record(source.conversationId).operations.find(o=>o.receipt?.runId===sent.runId).resolution.scope.workId,target.workId);
 const result=await restarted.secretaryCommands.status(source.id);assert.match(result.addressedInputs[0].answer,/Final/);
});
test('clarification binds explicit original/question/current answer, never arbitrary old human',async t=>{
 const {f,s,source,target}=await setup(t);await f.complete(source);
 const answer=await s.send(source.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'資料の方です'});await f.submit(answer);
 const resolution={...target,clarification:{humanRunId:source.id,questionRunId:source.id,questionQuote:source.finalOutput,answerQuote:'資料の方'}};
 const sent=await s.secretaryCommands.order(answer.id,'継続',undefined,resolution);assert.equal(s.flow.run(sent.runId).conversationSource.humanRunId,source.id);
 assert.equal(s.conversations.record(answer.conversationId).operations[0].resolution.scope.workId,target.workId);
 await f.complete(answer);const later=await s.send(source.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'資料の方です'});await f.submit(later);
 await assert.rejects(s.secretaryCommands.order(later.id,'継続',undefined,resolution),/別の人間入力/);
});
test('invalid provenance, other question, unknown action and worker actor cannot grant targets',async t=>{
 const {f,s,source,target,first,human}=await setup(t);
 for(const value of [{...target,quote:'他Agentの文章'},{...target,action:'anything'},{...target,clarification:{humanRunId:human.id,questionRunId:human.id,questionQuote:human.finalOutput,answerQuote:source.instruction}}])await assert.rejects(s.secretaryCommands.order(source.id,'継続',undefined,value));
 await f.submit(s.flow.run(first.runId));await assert.rejects(s.secretaryCommands.order(first.runId,'継続',undefined,target),/秘書/);
 assert.equal(s.conversations.record(source.conversationId).operations.length,0);
});
test('renaming preserves stable target, changed original permission and late human prevent dispatch',async t=>{
 const {f,s,source,target,first}=await setup(t);s.data.projects.forEach(p=>p.name='同名');
 const sent=await s.secretaryCommands.order(source.id,'継続',undefined,target);assert.equal(sent.workId,first.workId);
 s.flow.root(first.humanRequestId).requestedBy.authorization.quote+='changed';await f.complete(source);await s.tick();assert.equal(s.flow.run(sent.runId).runModel.state.reason,'dispatch-boundary-changed');
});
test('late source input blocks interpreted delivery with no retry',async t=>{
 const {f,s,source,target}=await setup(t);const sent=await s.secretaryCommands.order(source.id,'継続',undefined,target);
 await s.send(source.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'待って'});await f.complete(source);await s.tick();assert.equal(s.flow.run(sent.runId).runModel.state.reason,'dispatch-boundary-changed');
});
test('interpreted continuation uses same accepted work and no successor',async t=>{
 const {f,s,source,target,first,completeJob}=await setup(t);const result=await completeJob(first);await s.secretaryCommands.accept(result.delivery.id,'確認済み');await f.complete(result.delivery);
 await assert.rejects(s.secretaryCommands.order(source.id,'継続',undefined,target),/元入力より後|順序不明/);await f.complete(source);
 await new Promise(r=>setTimeout(r,2));const fresh=await s.send(source.agentId,{mode:'conversation',requestId:randomUUID(),instruction:source.instruction});await f.submit(fresh);
 const sent=await s.secretaryCommands.order(fresh.id,'継続',undefined,target);await f.complete(fresh);await s.tick();const r=s.flow.run(sent.runId);await f.submit(r);
 const next=await s.secretaryCommands.followup(r.id,undefined,'追加修正');assert.equal(next.workId,first.workId);assert.equal(s.data.requests.length,1);
});

test('normal CLI order accepts interpreted target, rejects target on other actions',async t=>{
 const {f,s,source,target}=await setup(t);const cli=new VillageOperations({dir:f.options.dir},null,{direct:s});
 const result=await cli.execute(['order','--run',source.id,'--target',JSON.stringify(target),'続けて']);assert.equal(result.ok,true,result.error);assert.equal(result.result.workId,target.workId);
 const again=await cli.execute(['order','--run',source.id,'--target',JSON.stringify(target),'続けて']);assert.deepEqual(again.result,result.result);
 const bad=await cli.execute(['followup','--run',source.id,'--target',JSON.stringify(target),'続けて']);assert.equal(bad.ok,false);
});
