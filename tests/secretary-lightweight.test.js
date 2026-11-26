import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AgentRules} from '../server/agent-rules.mjs';
import {DEFAULT_SECRETARY_POLICY,SECRETARY_POLICY,secretaryGuide} from '../server/project-guides.mjs';
import {purposeFixture} from './purpose-fixture.js';
import {VillageOperations} from '../server/operations.mjs';

test('compatible entry routes management to leader and retains custom policy verbatim',()=>{
 const r=new AgentRules('http://127.0.0.1:5173'),entry=r.specification();
 assert(entry.text.length<1700);assert(!entry.text.includes('requests finish'));assert(!entry.text.includes('requests delegate'));
 const leader=r.action('leader');assert.equal(leader.revision,entry.revision);assert.match(leader.text,/requests finish/);assert.match(leader.text,/projects guide/);
 const fixed=r.startup();r.leader=()=> 'changed leader rules';assert.notEqual(r.specification().revision,entry.revision);assert.equal(r.startup(),fixed);
 const suffix='\n独自制約: main禁止、反映許可、期限は金曜。';
 const full={available:true,projectId:'p',content:DEFAULT_SECRETARY_POLICY+suffix,revision:'r'};
 const short=secretaryGuide(full);assert.equal(short.content,SECRETARY_POLICY+suffix);assert.equal(short.revision,'r');
 assert(!short.content.includes('追加push'));assert(full.content.includes('追加push'));
 assert.equal(secretaryGuide({...full,content:'独自の全文'}).content,'独自の全文');
 assert.deepEqual(secretaryGuide({available:false}),{available:false});
});

test('light secretary reads compact context, continues using bound permission, then reports through official operations',async t=>{
 const {f,human,auth,first,completeJob,view}=await purposeFixture(t),one=await completeJob(first);
 const invoke=async(action,input)=>{const r=await new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute(['conversations',action,JSON.stringify(input)]);if(!r.ok)throw Error(r.error);return r.result;};
 // Native internals must not become secretary reading material. Evidence remains available in deliveries.
 const baseline=one.delivery.baselineRuntime,output=one.delivery.output;
 one.delivery.output='raw repetitive transport output'.repeat(100);one.delivery.baselineRuntime={sessionId:'secret-native',cursor:999};
 const compact=await f.service.conversations.read(human.conversationId,one.delivery.id),raw=f.service.conversations.get(human.conversationId);
 assert(JSON.stringify(compact).length<JSON.stringify(raw).length*.75);
 assert(!JSON.stringify(compact).includes('secret-native'));
 assert.equal(compact.currentDeliveries[0].material.output,one.event.material.output);
 const full=await f.service.conversations.material(human.conversationId,one.delivery.id,{kind:'turn',id:human.id});assert.equal(full.content.instruction,human.instruction);assert(full.content.humanAnswer);
 one.delivery.baselineRuntime=baseline;one.delivery.output=output;
 const input={conversationId:human.conversationId,actorRunId:one.delivery.id,operationId:randomUUID(),continue:true,instruction:'不足点だけを修正する'};
 const next=await invoke('job',input);assert.deepEqual(await invoke('job',input),next);
 assert.deepEqual(f.service.flow.root(next.humanRequestId).requestedBy.authorization,auth);
 assert.equal(view().requestIds.length,2);await assert.rejects(invoke('job',{...input,operationId:randomUUID()}),/後続/);
 await f.complete(one.delivery);await f.restart();
 const two=await completeJob(next),decision={conversationId:human.conversationId,actorRunId:two.delivery.id,operationId:randomUUID(),decision:'accept',reason:'依頼の不足が解消された'};
 await invoke('decide',decision);assert.equal(view().decision.state,'pending');await f.complete(two.delivery);assert.equal(view().decision.state,'committed');
 assert(f.notifications.some(n=>n.content.includes(two.delivery.id)));assert(!f.notifications.some(n=>n.content.includes(one.delivery.id)));
 await f.restart();assert.deepEqual((await invoke('decide',decision)).kind,'accept');assert.equal(view().requestIds.length,2);
});

test('simple operations never select a latest job on a human turn or accept mixed selectors and permissions',async t=>{
 const {f,human,auth,first,completeJob}=await purposeFixture(t),one=await completeJob(first);
 const base={conversationId:human.conversationId,actorRunId:one.delivery.id,operationId:randomUUID(),continue:true,instruction:'修正'};
 for(const extra of [{authorization:auth},{humanRequestId:first.humanRequestId},{deliveryId:one.event.id},{expectedPurposeVersion:0}])await assert.rejects(f.service.conversations.job({...base,...extra}),/別の対象や許可/);
 delete one.event.decisionRecoveryVersion; // explicit legacy compatibility path
 await f.complete(one.delivery);
 const human2=await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'状況を教えて'});await f.submit(human2);
 await assert.rejects(f.service.conversations.job({...base,actorRunId:human2.id}),/今回の正式配送/);
 await assert.rejects(f.service.conversations.decide({conversationId:human.conversationId,actorRunId:human2.id,operationId:randomUUID(),decision:'accept',reason:'結果があるから'}),/今回の正式配送/);
 assert.equal(f.service.data.requests.length,1);
});

test('simple judgment and continuation retain late-human-input fence and failure does not imply adoption',async t=>{
 for(const kind of ['accept','continue']){
  const {f,human,first,completeJob,view}=await purposeFixture(t),one=await completeJob(first);
  await f.service.send(human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'新しい制約'});
  const base={conversationId:human.conversationId,actorRunId:one.delivery.id,operationId:randomUUID()};
  await assert.rejects(kind==='accept'?f.service.conversations.decide({...base,decision:'accept',reason:'完成'}):f.service.conversations.job({...base,continue:true,instruction:'修正'}),/受付照合/);
  assert.equal(view().decision,null);assert.equal(f.service.data.requests.length,1);
 }
});

test('missing judgment returns saved results autonomously without human prompting or work replay',async t=>{
 const {f,human,first,completeJob,args,view}=await purposeFixture(t),one=await completeJob(first);
 await f.complete(one.delivery);await f.restart();
 const status=()=>f.service.conversations.get(human.conversationId).jobs[0].lifecycle;
 assert.equal(status().code,'evaluating');
 const c=f.service.conversations.record(human.conversationId),event=c.deliveries.find(e=>e.decisionRecovery),r=f.service.flow.run(event.runId);await f.submit(r);
 await f.service.conversations.decide({...args(one),actorRunId:r.id,decision:'accept'});await f.complete(r);
 assert.equal(status().code,'completed');assert.equal(view().decision.state,'committed');assert.equal(f.service.data.requests.length,1);
});
