import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inputHash} from './model-fixtures.mjs';
import {fixture} from './inbox-fixture.js';
const id=()=>randomUUID();
async function setup(t,{interrupted=true,contract3=false}={}){
 const f=await fixture(t),d=f.service;
 if(contract3)for(const a of f.agents.filter(a=>a.location==='mayor'))a.inputEnvelope={mode:'startup-v2',hash:inputHash(d.rules.startup3()),contract:3};
 const p=await d.putProject({requestId:id(),name:'Source'}),q=await d.putProject({requestId:id(),name:'Target'});
 f.agents[0].projectId=p.id;f.agents[1].projectId=q.id;f.agents[2].projectId=q.id;f.agents[3].projectId=p.id;
 await d.putProject({revision:q.revision,leaderAgentId:f.agents[2].id},q.id);
 const human=await d.send(f.agents[1].id,{mode:'conversation',requestId:id(),instruction:'この目的の作業を進めて'});await f.submit(human);
 const job=await d.conversations.job({conversationId:human.conversationId,actorRunId:human.id,operationId:id(),instruction:'既存目的の作業',authorization:{runId:human.id,quote:'進めて'}});
 await f.complete(human);await d.tick();const old=d.flow.run(job.runId);await f.submit(old);
 if(interrupted){await f.complete(old,'interrupted');const attention=d.data.runs.find(r=>r.conversationSource?.humanRequestId===job.humanRequestId);if(attention){await d.tick();await f.submit(attention);await f.complete(attention);}}
 const initial=await d.send(f.agents[0].id,{mode:'conversation',requestId:id(),instruction:'対象の復旧を進めて'});await f.submit(initial);
 const recovery=await d.conversations.job({conversationId:initial.conversationId,actorRunId:initial.id,operationId:id(),assigneeAgentId:f.agents[3].id,instruction:'対象 '+job.humanRequestId+' '+job.workId+' '+old.id+' '+q.id+' の復旧',authorization:{runId:initial.id,quote:'復旧を進めて'}});
 await f.complete(initial);await d.tick();const rr=d.flow.run(recovery.runId);await f.submit(rr);
 const report=await d.flow.report({humanRequestId:recovery.humanRequestId,workId:recovery.workId,actorRunId:rr.id,operationId:id(),kind:'question',text:'接続復旧済み。会話 '+human.conversationId+' の元目的へ正式再開を届けてください。'});
 await d.flow.respond({humanRequestId:recovery.humanRequestId,workId:recovery.workId,runId:rr.id,operationId:id(),inputs:d.flow.work(d.flow.root(recovery.humanRequestId),recovery.workId).inbox.map(i=>i.id),results:[]});await f.complete(rr);
 const c=d.conversations.record(initial.conversationId),event=c.deliveries.find(e=>e.id==='report:'+report.id);await d.tick();const review=d.flow.run(event.runId);await f.submit(review);await f.complete(review);
 const sender=await d.send(f.agents[0].id,{mode:'conversation',requestId:id(),instruction:'対象の秘書へ復旧連絡して元目的だけを再開して'});await f.submit(sender);
 const root=d.flow.root(job.humanRequestId),target={secretaryId:human.agentId,projectId:q.id,conversationId:human.conversationId,purposeId:root.id,requestId:root.id,workId:job.workId,currentRunId:old.id,revision:root.revision,mode:interrupted?'resume-interrupted':'followup'};
 const send={conversationId:sender.conversationId,actorRunId:sender.id,operationId:id(),authorization:{runId:sender.id,quote:'元目的だけを再開して'},evidenceDeliveryId:event.id,target,instruction:'接続復旧の資料。元の目的の範囲だけ。'};
 return {f,d,old,job,sender,send,recovery,event};
}
async function received(x){const receipt=await x.d.conversations.relay(x.send);await x.d.tick();const r=x.d.flow.run(receipt.runId);await x.f.submit(r);return {receipt,r,input:{conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId}};}

test('formal relay receives native input, resumes the same interrupted purpose once, and returns separately',async t=>{
 const x=await setup(t),{d,f,old,job,sender}=x;const before=structuredClone(old.runModel),w=d.flow.work(d.flow.root(job.humanRequestId),job.workId);
 const pending={id:id(),kind:'supplement',text:'未処理の追加要望',createdAt:new Date().toISOString(),attempts:[]};w.inbox.push(pending);await d.save();
 const {receipt,r,input}=await received(x);assert.equal(r.conversationSource.kind,'secretary');assert.equal(r.runModel.createdBy,'program');
 const material=await d.conversations.material(r.conversationId,r.id,{kind:'relay',id:receipt.deliveryId});assert.equal(material.content.humanText,sender.instruction);
 const result=await d.conversations.relayApply(input);assert.equal(result.humanRequestId,job.humanRequestId);const resumed=d.flow.run(result.runId);
 assert.equal(resumed.runModel.createdBy,'agent');assert.equal(resumed.instructionSource.actor,'agent');assert.equal(resumed.instructionSource.actorRunId,r.id);assert(d.flow.work(d.flow.root(job.humanRequestId),job.workId).inbox.find(i=>i.id===pending.id).attempts.includes(resumed.id));assert.deepEqual(old.runModel,before);
 assert.deepEqual(await d.conversations.relayApply({...input,operationId:id()}),result);
 assert.deepEqual(await d.conversations.relay(x.send),receipt);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);
 await f.complete(r);assert.deepEqual(await d.conversations.relayApply(input),result);
 const returned=d.data.runs.filter(r=>r.conversationSource?.relayReturnId===receipt.deliveryId);assert.equal(returned.length,1);assert.equal(returned[0].conversationId,sender.conversationId);
 await d.tick();await f.submit(resumed);await d.flow.finish({humanRequestId:job.humanRequestId,workId:job.workId,runId:resumed.id,operationId:id(),inputs:d.flow.work(d.flow.root(job.humanRequestId),job.workId).inbox.filter(i=>!i.handledBy).map(i=>i.id),results:[]});await f.complete(resumed);
 assert.equal(d.flow.root(job.humanRequestId).conversationId,r.conversationId);assert.equal(d.data.runs.filter(r=>r.conversationSource?.relayReturnId===receipt.deliveryId).length,1);
 await f.restart();assert.deepEqual(await f.service.conversations.relay(x.send),receipt);
});

test('relay cannot grant itself a target, forward a relay, or operate unrelated purposes',async t=>{
 const x=await setup(t),{d}=x;
 await assert.rejects(d.conversations.relay({...x.send,target:{...x.send.target,purposeId:id()}}),/一致/);
 await assert.rejects(d.conversations.relay({...x.send,evidenceDeliveryId:id()}),/復旧資料/);
 await assert.rejects(d.conversations.relay({...x.send,scopeId:id()}),/指定外/);
 const {r,input}=await received(x);
 await assert.rejects(d.conversations.job({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),instruction:'別業務'}),/relayApply/);
 await assert.rejects(d.conversations.followup({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),purposeId:id(),instruction:'別目的'}),/relayApply/);
 await assert.rejects(d.conversations.relay({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),authorization:x.send.authorization,evidenceDeliveryId:x.event.id,target:x.send.target,instruction:'転送'}),/再転送/);
 await assert.rejects(d.conversations.relayApply({...input,deliveryId:id()}),/今回/);
});

test('late human input and changed revision refuse relay application',async t=>{
 const x=await setup(t),{r,input}=await received(x);const q=x.d.flow.root(x.job.humanRequestId);q.revision++;
 await assert.rejects(x.d.conversations.relayApply(input),/revision/);q.revision--;
 await x.d.send(r.agentId,{mode:'conversation',conversationId:r.conversationId,requestId:id(),instruction:'まだ再開しないで'});
 await assert.rejects(x.d.conversations.relayApply(input),/後着|受付照合|今回/);
 assert.equal(x.d.data.runs.filter(r=>r.secretaryRecovery).length,0);
});

test('relay and resume ledger roll back atomically; commit uncertainty closes subsequent attempts',async t=>{
 const x=await setup(t),{input}=await received(x),d=x.d,before=JSON.stringify(d.data),write=d.store.write;
 d.store.write=()=>{throw Error('disk failed');};await assert.rejects(d.conversations.relayApply(input),/disk failed/);assert.equal(JSON.stringify(d.data),before);
 d.store.write=write;const receipt=await d.conversations.relayApply(input);assert(receipt.runId);
 const y=await setup(t),receivedY=await received(y);y.d.store.write=()=>{throw Object.assign(Error('commit unknown'),{persistenceUncertain:true});};
 await assert.rejects(y.d.conversations.relayApply(receivedY.input),/commit unknown/);await assert.rejects(y.d.conversations.relayApply(receivedY.input),/commit unknown/);
});

test('busy recipient queues relay without human steer; failed/unconfirmed outcomes are not resumable',async t=>{
 const x=await setup(t),{d,f}=x;
 const busy=await d.send(f.agents[1].id,{mode:'conversation',requestId:id(),instruction:'相談中'});await f.submit(busy);
 const send=x.send;
 const receipt=await d.conversations.relay(send);await d.tick();const r=d.flow.run(receipt.runId);assert.equal(r.runModel.state.kind,'queued');assert.equal(r.steerTarget,undefined);
 await f.complete(busy);await d.tick();await f.submit(r);
 for(const outcome of ['unconfirmed','failed']){const state=x.old.runModel.state;x.old.runModel.state={kind:'ended',outcome,reason:'native-terminal'};await assert.rejects(d.conversations.relayApply({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId}),/確認済み/);x.old.runModel.state=state;}
});

test('saved recovery evidence fixes target and permission; current message cannot manufacture it',async t=>{
 const x=await setup(t),d=x.d;
 for(const field of ['projectId','secretaryId','conversationId','purposeId','requestId','workId','currentRunId'])await assert.rejects(d.conversations.relay({...x.send,target:{...x.send.target,[field]:id()}}),/一致/);
 await assert.rejects(d.conversations.relay({...x.send,authorization:{runId:x.old.id,quote:'anything'}}),/人間発言/);
 const recovery=d.flow.root(x.recovery.humanRequestId),instruction=recovery.instruction;
 recovery.instruction='scope '+id();await assert.rejects(d.conversations.relay(x.send),/復旧依頼/);recovery.instruction=instruction;
 const bad={...x.send,instruction:'別Projectの新規開発も実行する。'+id()};const receipt=await d.conversations.relay(bad);await d.tick();const r=d.flow.run(receipt.runId);await x.f.submit(r);
 const result=await d.conversations.relayApply({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId});
 assert(!d.flow.run(result.runId).instruction.includes('別Projectの新規開発'));
 await assert.rejects(d.conversations.relay(x.send),/再利用/);
});

test('concurrent delivery/application is single-use and persisted restart retains both receipts',async t=>{
 const x=await setup(t),receipts=await Promise.all([x.d.conversations.relay(x.send),x.d.conversations.relay(x.send)]);assert.deepEqual(receipts[0],receipts[1]);
 await x.d.tick();const r=x.d.flow.run(receipts[0].runId);await x.f.submit(r);const input={conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipts[0].deliveryId};
 const results=await Promise.all([x.d.conversations.relayApply(input),x.d.conversations.relayApply(input)]);assert.deepEqual(results[0],results[1]);
 await x.f.restart();const d=x.f.service;assert.deepEqual(await d.conversations.relayApply(input),results[0]);assert.deepEqual(await d.conversations.relay(x.send),receipts[0]);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);
});

test('mismatched native terminal, withdrawal, and question waiting never resume',async t=>{
 const x=await setup(t),{input}=await received(x);const old=x.old.runModel.facts.findLast(f=>f.type==='terminal'),session=old.sessionId;old.sessionId='foreign';await assert.rejects(x.d.conversations.relayApply(input),/確認済み/);old.sessionId=session;
 const q=x.d.flow.root(x.job.humanRequestId),w=x.d.flow.work(q,x.job.workId),state=w.state;w.state={kind:'withdrawn',reason:'human'};await assert.rejects(x.d.conversations.relayApply(input),/停止中/);w.state=state;
 const c=x.d.conversations.record(input.conversationId);c.purposeDecisions=[{purposeId:q.id,humanRequestId:q.id,kind:'question',state:'committed',actorRunId:input.actorRunId,question:'選択してください'}];
 await assert.rejects(x.d.conversations.relayApply(input));assert.equal(x.d.data.runs.filter(r=>r.secretaryRecovery).length,0);
});

test('progressing purpose gets only a bounded supplement, never a new purpose or interrupted retry',async t=>{
 const x=await setup(t,{interrupted:false}),{input}=await received(x);const receipt=await x.d.conversations.relayApply(input);assert.equal(receipt.action,'amend');assert.equal(receipt.humanRequestId,x.job.humanRequestId);assert.equal(x.d.data.runs.filter(r=>r.secretaryRecovery).length,0);
 const w=x.d.flow.work(x.d.flow.root(x.job.humanRequestId),x.job.workId);assert(w.inbox.some(i=>i.id===receipt.inputId&&i.source.actor==='agent'));
});

test('report provenance, undelivered records, quoted other IDs, and two operation IDs fail closed',async t=>{
 const x=await setup(t),{d}=x,c=d.conversations.record(x.sender.conversationId),e=c.deliveries.find(e=>e.id===x.event.id),report=e.material;
 e.material={...report,text:report.text+' 改変'};await assert.rejects(d.conversations.relay(x.send),/一致/);e.material=report;
 const review=d.flow.run(e.runId),source=review.conversationSource;review.conversationSource={...source,humanRequestId:id()};await assert.rejects(d.conversations.relay(x.send),/復旧資料/);review.conversationSource=source;
 const facts=review.runModel.facts;review.runModel.facts=facts.filter(f=>f.type!=='input');await assert.rejects(d.conversations.relay(x.send),/復旧資料/);review.runModel.facts=facts;
 // A historically quoted, otherwise unrelated request is ambiguous even without its work/run IDs.
 const recovery=d.flow.root(x.recovery.humanRequestId),rw=d.flow.work(recovery,x.recovery.workId),original=rw.inbox.find(i=>i.kind==='request'),op=c.operations.find(o=>o.receipt.humanRequestId===recovery.id),prior=[recovery.instruction,original.text,op.payload];
 recovery.instruction+=' 引用: '+recovery.id;original.text=recovery.instruction;const payload=JSON.parse(op.payload);payload.input.instruction=recovery.instruction;op.payload=JSON.stringify(payload);
 await assert.rejects(d.conversations.relay(x.send),/一意/);[recovery.instruction,original.text,op.payload]=prior;
 await d.conversations.relay(x.send);await assert.rejects(d.conversations.relay({...x.send,operationId:id()}),/既に/);
});

test('source later-human stops apply, receipt return is finite on failed receiver, and foreign material is hidden',async t=>{
 const x=await setup(t),{r,input}=await received(x),{d,f}=x;
 await assert.rejects(d.conversations.material(x.sender.conversationId,x.sender.id,{kind:'relay',id:input.deliveryId}),/配送境界/);
 await d.send(x.sender.agentId,{mode:'conversation',requestId:id(),instruction:'復旧の連絡は中止'});
 await assert.rejects(d.conversations.relayApply(input),/後着/);
 await f.complete(r,'failed');await d.tick();await d.tick();assert.equal(d.data.runs.filter(r=>r.conversationSource?.relayReturnId===input.deliveryId).length,1);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,0);
});

 test('existing contract 3 secretaries use the same relay without runtime replacement',async t=>{const x=await setup(t,{contract3:true}),{r,input}=await received(x);assert(x.d.conversations.context(r).includes('<village run="'));assert(!x.d.conversations.context(r).includes('ai-village-request'));const result=await x.d.conversations.relayApply(input);assert.equal(result.humanRequestId,x.job.humanRequestId);await x.f.complete(r);assert.equal(x.d.data.runs.filter(r=>r.conversationSource?.relayReturnId===input.deliveryId).length,1);});
