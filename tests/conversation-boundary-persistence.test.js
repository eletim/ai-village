import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {purposeFixture} from './purpose-fixture.js';
import {VillageOperations} from '../server/operations.mjs';
const call=async(f,args)=>{const out=await new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute(args);if(!out.ok)throw Error(out.error);return out.result;};
const follow=(human,actor,purposeId)=>({conversationId:human.conversationId,actorRunId:actor.id,operationId:randomUUID(),purposeId,instruction:'元の範囲で残る修正を実施'});
function fresh(dir,expression){
 const code=`import {DirectAgents} from './server/direct.mjs';let external=0;const deny=async()=>{external++;throw Error('external forbidden')};const d=new DirectAgents({dir:process.argv[1],localRun:deny,remote:deny,notifier:{status:()=>({}),enqueue:deny}});await d.init({watch:false});try{${expression}}finally{d.close();}`;
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,dir],{encoding:'utf8'}));
}
test('actual CLI read/material honors actor delivery boundary while retaining old constraints and complete results',async t=>{
 const {f,human,first,completeJob}=await purposeFixture(t),one=await completeJob(first),c=human.conversationId;
 const old=await call(f,['conversations','get',c,human.id]);
 assert.equal(old.projection,'agent-context-v1');assert.equal(old.deliveries.length,0);
 await assert.rejects(call(f,['conversations','read',c,human.id,JSON.stringify({kind:'delivery',id:one.event.id})]),/配送境界/);
 await assert.rejects(call(f,['conversations','read',c,human.id,JSON.stringify({kind:'turn',id:one.delivery.id})]),/配送境界/);
 const current=await call(f,['conversations','get',c,one.delivery.id]);assert.equal(current.currentDeliveries[0].id,one.event.id);
 const material=await call(f,['conversations','read',c,one.delivery.id,JSON.stringify({kind:'delivery',id:one.event.id})]);assert.deepEqual(material.content.material,one.event.material);
 const constraint=await call(f,['conversations','read',c,one.delivery.id,JSON.stringify({kind:'turn',id:human.id})]);assert.equal(constraint.content.instruction,human.instruction);
 await assert.rejects(call(f,['conversations','read',c,randomUUID(),JSON.stringify({kind:'turn',id:human.id})]),/受付照合/);
});
test('fresh process replays saved followup receipt without actor execution or duplicate successor',async t=>{
 const {f,human,first,completeJob}=await purposeFixture(t),one=await completeJob(first),x=follow(human,one.delivery,first.humanRequestId);
 const receipt=await f.service.conversations.followup(x);await f.service.save();const before={runs:f.service.data.runs.length,requests:f.service.data.requests.length};f.service.close();
 const out=fresh(f.options.dir,`const before=JSON.stringify(d.data.requests);const receipt=await d.conversations.followup(${JSON.stringify(x)});console.log(JSON.stringify({receipt,external,runs:d.data.runs.length,requests:d.data.requests.length,unchanged:before===JSON.stringify(d.data.requests)}));`);
 assert.deepEqual(out.receipt,receipt);assert.equal(out.external,0);assert.equal(out.runs,before.runs);assert.equal(out.requests,before.requests);assert.equal(out.unchanged,true);
});
test('fresh process preserves saved decision-review reservation without duplicating or executing old work',async t=>{
 const {f,human,first,completeJob}=await purposeFixture(t),one=await completeJob(first);
 await f.complete(one.delivery); // The ordinary scheduler reserves exactly one reminder.
 const c=f.service.conversations.record(human.conversationId),events=c.deliveries.filter(e=>e.decisionRecovery);assert.equal(events.length,1);
 const before={runs:f.service.data.runs.length,requests:structuredClone(f.service.data.requests),event:structuredClone(events[0])};await f.service.save();f.service.close();
 const out=fresh(f.options.dir,`await Promise.all([d.conversations.recoverDecisions(),d.conversations.recoverDecisions()]);const c=d.conversations.record(${JSON.stringify(c.id)});console.log(JSON.stringify({external,runs:d.data.runs.length,requests:d.data.requests,events:c.deliveries.filter(e=>e.decisionRecovery)}));`);
 assert.equal(out.external,0);assert.equal(out.runs,before.runs);assert.deepEqual(out.requests,before.requests);assert.deepEqual(out.events,[before.event]);
});
for(const reverse of [false,true])test(`leader terminal completion racing followup retains input or closes safely before delivery; reverse=${reverse}`,async t=>{
 const {f,human,first}=await purposeFixture(t),leader=f.service.flow.run(first.runId);await f.submit(leader);
 const h=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'同じ目的の残作業を修正して'});await f.submit(h);
 await f.service.flow.finish({humanRequestId:first.humanRequestId,workId:first.workId,runId:leader.id,operationId:randomUUID(),inputs:f.service.flow.inputs(first.humanRequestId,first.workId).map(i=>i.id),results:[]});
 const x=follow(human,h,first.humanRequestId);
 const operations=[()=>f.service.conversations.followup(x),()=>f.complete(leader)];if(reverse)operations.reverse();
 const outcomes=await Promise.allSettled(operations.map(fn=>fn())),reply=outcomes[reverse?1:0];
 const q=f.service.flow.root(first.humanRequestId),w=f.service.flow.work(q,first.workId);
 assert.equal(f.service.data.requests.length,1); // No speculative successor before formal result delivery.
 if(reply.status==='fulfilled'){
  assert.equal(reply.value.action,'amend');assert.equal(w.inbox.filter(i=>i.text===x.instruction).length,1);
  assert.deepEqual(await f.service.conversations.followup(x),reply.value);assert.equal(w.inbox.filter(i=>i.text===x.instruction).length,1);
 }else{
  assert.match(reply.reason.message,/正式配送|配送後|後着|待って/);assert.doesNotMatch(reply.reason.message,/invalid-supplement/);
  assert.equal(w.inbox.filter(i=>i.text===x.instruction).length,0);
 }
 assert.ok(f.service.data.runs.filter(r=>r.humanRequestId===q.id).length<=2);
});
