import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {laterHumanReferences} from '../server/secretary-relay-recheck.mjs';
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

async function contaminated(t){
 const x=await setup(t),receipt=await x.d.conversations.relay(x.send);await x.d.tick();const r=x.d.flow.run(receipt.runId),native=x.f.runtimes.get(r.agentId),tid=id(),text='未送信の旧連絡\n'+x.f.sent.findLast(s=>s.agentId===r.agentId).text;
 native.inputs.push({id:'mixed-'+tid,turnId:tid,offset:++native.cursor,explicitTurn:true,source:'response',text});native.turns.push({id:tid,state:'completed',output:'API拒否',completionOffset:++native.cursor});await x.d.tick();
 assert.equal(r.runModel.state.outcome,'unconfirmed');assert.equal(r.error,'competing-or-unmatched-input');
 const pmux=x.d.pmux.bind(x.d);x.d.pmux=(a,...args)=>args[1]==='capabilities'?Promise.resolve({guardedCodexInput:{version:1,client:1}}):pmux(a,...args);
 return {...x,receipt,r,native,recover:{conversationId:x.sender.conversationId,actorRunId:x.sender.id,operationId:id(),deliveryId:receipt.deliveryId,nativeInputHash:inputHash(text),nativeTurnId:tid}};
}

test('contaminated relay recovery preserves unknown/history, receives exactly, applies once and survives restart',async t=>{
 const x=await contaminated(t),{d,f,r,native}=x,before=structuredClone(r),original=d.conversations.record(r.conversationId).relayInbox[0];
 const legacyReceipt=structuredClone(original),receipt=await d.conversations.relayRecover(x.recover);
 assert.deepEqual(r,before);assert.equal(original.runId,r.id);assert.equal(original.returnRunId,legacyReceipt.returnRunId);
 assert.deepEqual(await d.conversations.relayRecover(x.recover),receipt);
 await assert.rejects(d.conversations.relayRecover({...x.recover,operationId:id()}),/一度/);
 const pmux=d.pmux.bind(d);d.pmux=(a,...args)=>args[1]==='capabilities'?Promise.resolve({guardedCodexInput:{version:1,client:1}}):pmux(a,...args);
 await d.tick();const rr=d.flow.run(receipt.runId);await f.submit(rr);
 const apply={conversationId:r.conversationId,actorRunId:rr.id,operationId:id(),deliveryId:receipt.deliveryId};
 const result=await d.conversations.relayApply(apply);assert.equal(result.previousRunId,x.old.id);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);assert.deepEqual(r,before);
 await f.complete(rr);assert(original.recovery.returnRunId);assert.notEqual(original.recovery.returnRunId,original.returnRunId);
 await f.restart();assert.deepEqual(await f.service.conversations.relayRecover(x.recover),receipt);assert.deepEqual(await f.service.conversations.relayApply(apply),result);
});

test('recovery rejects changed proof, foreign source, later native, later human, changed target and applied delivery',async t=>{
 for(const variant of ['hash','turn','source','native','source-human','target-human','revision','applied','unclosed','session']){
  const x=await contaminated(t),{d,r,native}=x;const input={...x.recover};
  if(variant==='hash')input.nativeInputHash='0'.repeat(64);
  if(variant==='turn')input.nativeTurnId=id();
  if(variant==='source')input.conversationId=r.conversationId;
  if(variant==='native')native.inputs.push({...native.inputs.at(-1),id:id(),offset:++native.cursor});
  if(variant==='source-human')await d.send(x.sender.agentId,{mode:'conversation',requestId:id(),instruction:'中止'});
  if(variant==='target-human')await d.send(r.agentId,{mode:'conversation',requestId:id(),instruction:'中止'});
  if(variant==='revision')d.flow.root(x.job.humanRequestId).revision++;
  if(variant==='connection')d.agent(r.agentId).connection={connectionType:'local',name:'changed'};
  if(variant==='applied')d.conversations.record(r.conversationId).relayInbox[0].actionReceipt={action:'amend'};
  if(variant==='unclosed')native.turns.at(-1).state='running';
  if(variant==='session')native.sessionId=id();
  await assert.rejects(d.conversations.relayRecover(input),undefined,variant);assert.equal(d.data.runs.filter(r=>r.relayRecoveryOf).length,0);
 }
});

test('recovery concurrent calls, save rollback and commit uncertainty cannot duplicate',async t=>{
 const x=await contaminated(t),d=x.d,write=d.store.write,before=JSON.stringify(d.data);
 d.store.write=()=>{throw Error('rollback proof');};await assert.rejects(d.conversations.relayRecover(x.recover),/rollback proof/);assert.equal(JSON.stringify(d.data),before);d.store.write=write;
 const [a,b]=await Promise.all([d.conversations.relayRecover(x.recover),d.conversations.relayRecover(x.recover)]);assert.deepEqual(a,b);assert.equal(d.data.runs.filter(r=>r.relayRecoveryOf).length,1);
 const y=await contaminated(t);y.d.store.write=()=>{throw Object.assign(Error('commit uncertain'),{persistenceUncertain:true});};await assert.rejects(y.d.conversations.relayRecover(y.recover),/commit uncertain/);await assert.rejects(y.d.conversations.relayRecover(y.recover),/commit uncertain/);
});

test('recovery dispatch rejects unavailable guarded transport and changed native without sending',async t=>{
 for(const variant of ['capability','native']){
  const x=await contaminated(t),receipt=await x.d.conversations.relayRecover(x.recover),before=x.f.sent.length;
  if(variant==='native')x.native.cursor++;
  if(variant==='capability'){const pmux=x.d.pmux.bind(x.d);x.d.pmux=(a,...args)=>args[1]==='capabilities'?Promise.resolve({}):pmux(a,...args);}
  await x.d.tick();assert.equal(x.f.sent.length,before);assert.equal(x.d.flow.run(receipt.runId).runModel.state.kind,'ended');
 }
});

test('native arriving between evidence read and save refuses recovery',async t=>{
 const x=await contaminated(t),runtime=x.d.runtime.bind(x.d);let reads=0;
 x.d.runtime=async(a,s)=>{const snapshot=structuredClone(await runtime(a,s));if(++reads===1)x.native.inputs.push({...x.native.inputs.at(-1),id:id(),offset:++x.native.cursor});return snapshot;};
 await assert.rejects(x.d.conversations.relayRecover(x.recover),/native/);assert.equal(x.d.data.runs.filter(r=>r.relayRecoveryOf).length,0);
});

test('human input racing recovery is serialized and prevents apply when it arrives after creation',async t=>{
 const x=await contaminated(t),runtime=x.d.runtime.bind(x.d);let human;
 x.d.runtime=async(a,s)=>{const snapshot=await runtime(a,s);human ||= x.d.send(x.sender.agentId,{mode:'conversation',requestId:id(),instruction:'復旧を保留して'});return snapshot;};
 const recovered=await x.d.conversations.relayRecover(x.recover);await human;
 const before=x.f.sent.length;await x.d.tick();assert.equal(x.f.sent.length,before);assert.equal(x.d.data.runs.filter(r=>r.secretaryRecovery).length,0);
});

async function rechecked(t){
 const x=await contaminated(t),{d,f}=x;await f.complete(x.sender);
 // Drain the saved return before the new human (no production sends).
 await d.tick();for(const r of d.data.runs.filter(r=>r.agentId===x.sender.agentId&&r.runModel.state.kind==='sent')){await f.submit(r);await f.complete(r);}
 const human=await d.send(x.sender.agentId,{mode:'conversation',requestId:id(),instruction:'別件の表示を改善して'});await f.submit(human);
 const source=d.conversations.record(human.conversationId),entry=d.conversations.record(x.r.conversationId).relayInbox[0];
 const recheck={decision:'within-original-scope',reason:'後着の全文を確認し、元の対象と復旧範囲を変更しないと判断した（fixtureの秘書判断）。',inputs:laterHumanReferences(d,source,entry)};
 return {...x,human,entry,source,recover:{...x.recover,actorRunId:human.id,recheck}};
}
test('recheck binds every later human without rewriting original permission; recovery and apply once',async t=>{
 const x=await rechecked(t),{d,f}=x,auth=structuredClone(x.entry.authorization),old=structuredClone(x.r);
 const receipt=await d.conversations.relayRecover(x.recover);assert.deepEqual(x.entry.authorization,auth);assert.deepEqual(x.r,old);
 assert.deepEqual(x.entry.recovery.recheck,x.recover.recheck);
 await d.tick();const r=d.flow.run(receipt.runId);await f.submit(r);
 const result=await d.conversations.relayApply({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId});
 assert.equal(result.previousRunId,x.old.id);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);
 await assert.rejects(d.conversations.relayRecover({...x.recover,operationId:id()}),/一度/);
 await f.restart();assert.deepEqual(await f.service.conversations.relayRecover(x.recover),receipt);
});
test('recheck rejects omission, tamper, missing decision, changed permission and unread human',async t=>{
 for(const variant of ['omit','digest','decision','reason','unread','authority']){
  const x=await rechecked(t),arg=structuredClone(x.recover);
  if(variant==='omit')arg.recheck.inputs=[];
  if(variant==='digest')arg.recheck.inputs[0].digest='0'.repeat(64);
  if(variant==='decision')arg.recheck.decision='withdrawn';
  if(variant==='reason')arg.recheck.reason='';
  if(variant==='unread')arg.actorRunId=x.sender.id;
  if(variant==='authority')x.entry.authorization.quote='架空の許可';
  await assert.rejects(x.d.conversations.relayRecover(arg));assert.equal(x.d.data.runs.filter(r=>r.relayRecoveryOf).length,0);
 }
});
test('recheck blocks later changes before save, dispatch and apply and rolls back uncertainty',async t=>{
 for(const stage of ['save','dispatch','apply','rollback','uncertain']){
  const x=await rechecked(t),{d,f}=x;
  if(stage==='save'){const runtime=d.runtime.bind(d);let n=0;d.runtime=async(a,s)=>{const v=await runtime(a,s);if(++n===1)x.human.instruction+='変更';return v;};await assert.rejects(d.conversations.relayRecover(x.recover),/再照合/);continue;}
  if(stage==='rollback'||stage==='uncertain'){
   const before=JSON.stringify(d.data);d.store.write=()=>{throw Object.assign(Error(stage),stage==='uncertain'?{persistenceUncertain:true}:{});};
   await assert.rejects(d.conversations.relayRecover(x.recover),new RegExp(stage));
   if(stage==='rollback')assert.equal(JSON.stringify(d.data),before);
   else await assert.rejects(d.conversations.relayRecover(x.recover),/uncertain/);
   continue;
  }
  const receipt=await d.conversations.relayRecover(x.recover),r=d.flow.run(receipt.runId);
  if(stage==='apply'){await d.tick();await f.submit(r);}
  await d.send(x.sender.agentId,{mode:'conversation',requestId:id(),instruction:'復旧を中止して'});
  if(stage==='dispatch'){const before=f.sent.length;await d.tick();assert.equal(f.sent.length,before);}
  else await assert.rejects(d.conversations.relayApply({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId}),/再照合/);
  assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,0);
 }
});


test('recovery pins resolved same-turn reviewer while original payload remains idempotent',async t=>{
 const x=await rechecked(t),{d,f}=x;
 const successor=await d.send(x.human.agentId,{mode:'conversation',requestId:id(),instruction:'元範囲のまま進めて'});await f.submit(successor);
 assert.equal(d.conversations.currentActor(x.human).id,successor.id);
 x.recover.recheck.inputs=laterHumanReferences(d,x.source,x.entry);
 const receipt=await d.conversations.relayRecover(x.recover);
 assert.equal(x.entry.recovery.actorRunId,successor.id);
 assert.equal(JSON.parse(x.entry.recovery.payload).actorRunId,x.human.id);
 assert.deepEqual(await d.conversations.relayRecover(x.recover),receipt);
 await d.tick();const receiver=d.flow.run(receipt.runId);await f.submit(receiver);
 const result=await d.conversations.relayApply({conversationId:receiver.conversationId,actorRunId:receiver.id,operationId:id(),deliveryId:receipt.deliveryId});
 assert.equal(result.previousRunId,x.old.id);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);
});
test('pinned reviewer never follows a later human and rejects unaccepted or foreign-session successors',async t=>{
 for(const variant of ['later','unaccepted','session']){
  const x=await rechecked(t),{d,f}=x;
  const successor=await d.send(x.human.agentId,{mode:'conversation',requestId:id(),instruction:'元範囲を確認'});
  if(variant!=='unaccepted')await f.submit(successor);
  if(variant==='session')successor.sessionId='foreign-session';
  x.recover.recheck.inputs=laterHumanReferences(d,x.source,x.entry);
  if(variant!=='later'){
   await assert.rejects(d.conversations.relayRecover(x.recover));assert.equal(d.data.runs.filter(r=>r.relayRecoveryOf).length,0);continue;
  }
  const receipt=await d.conversations.relayRecover(x.recover),reviewer=x.entry.recovery.actorRunId;
  await d.send(x.human.agentId,{mode:'conversation',requestId:id(),instruction:'復旧を中止'});
  const before=f.sent.length;await d.tick();assert.equal(f.sent.length,before);assert.equal(x.entry.recovery.actorRunId,reviewer);
  assert.equal(d.flow.run(receipt.runId).runModel.state.kind,'ended');assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,0);
 }
});

async function initialFixture(t,{unknown=false}={}){
 const x=await contaminated(t),{d,f}=x,a=d.agent(x.r.agentId),oldTab=a.tabId,oldNative=structuredClone(x.native),oldStatus={alive:true,cliState:'idle',agentSessionId:oldNative.sessionId};
 const pmux=d.pmux.bind(d),runtime=d.runtime.bind(d);let launches=0,launch,transport;
 d.pmux=async(agent,...args)=>{
  if(args[1]==='capabilities')return {initialCodexLaunch:{version:1,client:1}};
  if(args[1]==='initial-launch'){
   launches++;launch=JSON.parse(args[2]);assert(d.store);assert(d.flow.run(launch.runId).relayInitial.attemptedAt);
   if(unknown)throw Error('unknown launch');
   transport={state:'started',...launch,bodyHash:inputHash(launch.body),processMatches:true,receipt:{workspaceId:launch.workspaceId,tabId:launch.tabId,sessionName:'fresh-pane',pid:123,startTicks:'42'}};
   const n=f.runtimes.get(a.id);Object.assign(n,{sessionId:'fresh-session',fileIdentity:'fresh-file',cursor:0,inputs:[],turns:[]});
   f.sent.push({agentId:a.id,text:launch.body});return transport;
  }
  if(args[1]==='initial-status')return transport||{state:'unknown'};
  if(args[1]==='status'&&args.at(-1)===oldTab)return oldStatus;
  if(args[1]==='status'&&agent.id===a.id&&launch)return {alive:true,cliState:'busy',agentSessionId:'fresh-session'};
  return pmux(agent,...args);
 };
 d.observationPmux=(agent,...args)=>d.pmux(agent,...args);
 d.runtime=(agent,status)=>agent.tabId===oldTab?Promise.resolve(oldNative):agent.id===a.id?Promise.resolve(f.runtimes.get(a.id)):runtime(agent,status);
 x.recover.freshTui={handover:'旧TUI/draftはそのまま保管。fixtureの未適用を確認。'};
 return {...x,oldTab,oldNative,oldStatus,launches:()=>launches,transport:()=>transport};
}
test('fresh initial recovery persists intent, uses normal receipt/actor, applies once and retains old runtime',async t=>{
 const x=await initialFixture(t),{d,f}=x,before=structuredClone(x.r),receipt=await d.conversations.relayRecover(x.recover),r=d.flow.run(receipt.runId);
 assert.equal(x.launches(),1);assert.equal(d.agent(r.agentId).retainedRelayRuntimes[0].runtime.tabId,x.oldTab);assert.deepEqual(x.r,before);
 await f.submit(r);assert.equal(r.sessionId,'fresh-session');assert.equal(r.relayInitial.receipt.pid,123);
 const result=await d.conversations.relayApply({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId});
 assert.equal(result.previousRunId,x.old.id);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);
 assert.deepEqual(await d.conversations.relayRecover(x.recover),receipt);assert.equal(x.launches(),1);
 await assert.rejects(d.conversations.relayRecover({...x.recover,operationId:id()}),/一度/);
 const reboot=await f.restart();assert.deepEqual(await reboot.conversations.relayRecover(x.recover),receipt);assert.equal(reboot.flow.run(x.r.id).runModel.state.outcome,'unconfirmed');
});
test('fresh initial unknown launch is never repeated; uncertain save never launches',async t=>{
 const x=await initialFixture(t,{unknown:true}),receipt=await x.d.conversations.relayRecover(x.recover);
 await x.d.conversations.relayRecover(x.recover);await x.d.tick();assert.equal(x.launches(),1);assert.equal(x.d.flow.run(receipt.runId).turnId,undefined);
 for(const uncertain of [false,true]){
  const y=await initialFixture(t);y.d.store.write=()=>{throw Object.assign(Error('save failure'),{persistenceUncertain:uncertain});};
  await assert.rejects(y.d.conversations.relayRecover(y.recover),/save failure/);assert.equal(y.launches(),0);
 }
});
test('fresh receipt rejects changed process, old native, later human and target revision before apply',async t=>{
 for(const variant of ['process','old-native','human','revision','connection']){
  const x=await initialFixture(t),{d,f}=x,receipt=await d.conversations.relayRecover(x.recover),r=d.flow.run(receipt.runId);
  await f.submit(r);
  if(variant==='process')x.transport().receipt.startTicks='other';
  if(variant==='old-native')x.oldNative.cursor++;
  if(variant==='human')await d.send(x.sender.agentId,{mode:'conversation',requestId:id(),instruction:'再開を撤回'});
  if(variant==='revision')d.flow.root(x.job.humanRequestId).revision++;
  if(variant==='connection')d.agent(r.agentId).connection={connectionType:'local',name:'changed'};
  await assert.rejects(d.conversations.relayApply({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId}));
  assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,0);
 }
});
test('fresh initial attempt persistence failure and late input before launch never create a process',async t=>{
 for(const kind of ['rollback','uncertain','late-human']){
  const x=await initialFixture(t),{d}=x,save=d.save.bind(d);let reserved=false;
  d.save=async(...args)=>{
   const r=d.data.runs.find(r=>r.relayInitial);
   if(r?.relayInitial.attemptedAt&&kind!=='late-human')throw Object.assign(Error('attempt save failed'),{persistenceUncertain:kind==='uncertain',persistenceFailure:true});
   const result=await save(...args);
   if(r&&!reserved){reserved=true;if(kind==='late-human'){const h=structuredClone(x.sender);h.id=id();h.conversationSequence++;h.instruction='範囲を撤回';d.data.runs.push(h);}}
   return result;
  };
  await assert.rejects(d.conversations.relayRecover(x.recover));assert.equal(x.launches(),0);
  assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,0);
 }
});


test('fresh recovery ready-for-review follows idle contract, rejects other states without saving, and applies once',async t=>{
 const x=await initialFixture(t),{d,f}=x,entry=d.conversations.record(x.r.conversationId).relayInbox[0],before=structuredClone(x.r),runs=d.data.runs.length,agentBefore=structuredClone(d.agent(x.r.agentId));
 for(const cliState of ['busy','unknown','needs-input','waiting-for-input','waiting-for-permission','permission','inactive',undefined]){
  x.oldStatus.cliState=cliState;
  await assert.rejects(d.conversations.relayRecover(x.recover),/証拠が不足/);
  assert.equal(entry.recovery,undefined);assert.equal(d.data.runs.length,runs);assert.equal(x.launches(),0);assert.deepEqual(d.agent(x.r.agentId),agentBefore);assert.deepEqual(x.r,before);
 }
 for(const cliState of ['idle','ready-for-review']){
  Object.assign(x.oldStatus,{cliState,permissionRequest:{kind:'permission'}});
  await assert.rejects(d.conversations.relayRecover(x.recover),/証拠が不足/);
  assert.equal(entry.recovery,undefined);assert.equal(x.launches(),0);
 }
 Object.assign(x.oldStatus,{cliState:'ready-for-review',permissionRequest:null});
 for(const invalid of ['dead','running-native','wrong-body']){
  const state=x.oldNative.turns.at(-1).state;
  if(invalid==='dead')x.oldStatus.alive=false;
  if(invalid==='running-native')x.oldNative.turns.at(-1).state='running';
  await assert.rejects(d.conversations.relayRecover({...x.recover,...(invalid==='wrong-body'?{nativeInputHash:'0'.repeat(64)}:{})}),/証拠が不足/);
  x.oldStatus.alive=true;x.oldNative.turns.at(-1).state=state;
  assert.equal(entry.recovery,undefined);assert.equal(d.data.runs.length,runs);assert.equal(x.launches(),0);
 }
 const receipt=await d.conversations.relayRecover(x.recover),r=d.flow.run(receipt.runId);
 assert.equal(x.launches(),1);await f.submit(r);
 const apply={conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId};
 const result=await d.conversations.relayApply(apply);assert.equal(result.previousRunId,x.old.id);
 assert.deepEqual(await d.conversations.relayApply(apply),result);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);assert.deepEqual(x.r,before);
});

async function successorFixture(t){
 const x=await initialFixture(t,{unknown:true}),{d}=x;
 const first=await d.conversations.relayRecover(x.recover),failed=d.flow.run(first.runId);
 const {changeRun}=await import('../server/run-lifecycle.mjs');changeRun(failed,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});await d.save();
 const pmux=d.pmux.bind(d);let launch,transport,starts=0;
 d.pmux=async(a,...args)=>{
  if(args[1]==='initial-status'&&args[2]===failed.relayInitial.launch.operationId)return {state:'unknown',...failed.relayInitial.launch,bodyHash:failed.inputCorrelation.digest,receipt:null,processMatches:false};
  if(args[1]==='initial-launch'){
   starts++;launch=JSON.parse(args[2]);transport={state:'started',...launch,bodyHash:inputHash(launch.body),processMatches:true,receipt:{workspaceId:launch.workspaceId,tabId:launch.tabId,sessionName:'successor-pane',pid:456,startTicks:'73'}};
   Object.assign(x.f.runtimes.get(a.id),{sessionId:'successor-session',fileIdentity:'successor-file',cursor:0,inputs:[],turns:[]});x.f.sent.push({agentId:a.id,text:launch.body});return transport;
  }
  if(args[1]==='initial-status'&&transport)return transport;
  if(args[1]==='status'&&launch&&a.tabId===launch.tabId)return {alive:true,cliState:'busy',agentSessionId:'successor-session'};
  return pmux(a,...args);
 };
 const input={conversationId:x.recover.conversationId,actorRunId:x.recover.actorRunId,operationId:id(),deliveryId:first.deliveryId,previousRunId:failed.id,previousOperationId:failed.relayInitial.launch.operationId,assessment:{summary:'Fixture ledger and repo inspected',potentialDuplicates:'Do not restart an existing web server or regenerate games',uncertainties:'Unknown may have external effects'},handover:'Retain both old runtimes without input; draft persistence not guaranteed'};
 return {...x,failed,input,get entry(){return d.conversations.record(failed.conversationId).relayInbox.find(e=>e.id===input.deliveryId);},starts:()=>starts};
}
test('explicit unknown successor retains old facts, fences late actor, requires inspection and applies once',async t=>{
 const x=await successorFixture(t),{d,f,failed,input}=x,old=structuredClone(failed.runModel),prior=structuredClone(x.entry.recovery);
 const receipt=await d.conversations.relaySucceed(input),r=d.flow.run(receipt.runId);
 assert.deepEqual(failed.runModel,old);assert.deepEqual(x.entry.recoveryHistory,[prior]);assert.equal(failed.relaySuperseded.successorRunId,r.id);assert.equal(x.starts(),1);
 assert.throws(()=>d.conversations.actor(d.conversations.record(r.conversationId),failed.id),/失効/);
 assert.throws(()=>d.conversations.relayService.dispatchBoundary(failed),/境界/);
 assert.deepEqual(await d.conversations.relaySucceed(input),receipt);
 await assert.rejects(d.conversations.relaySucceed({...input,operationId:id()}),/一度/);
 await f.submit(r);const apply={conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:receipt.deliveryId};
 await assert.rejects(d.conversations.relayApply(apply),/引数|判断/);
 const result=await d.conversations.relayApply({...apply,reconciliation:{decision:'continue-unfinished-only',summary:'Inspected existing artifacts and running server; resume only missing UI work'}});
 assert.equal(result.previousRunId,x.old.id);assert.equal(d.data.runs.filter(r=>r.secretaryRecovery).length,1);assert.equal(x.starts(),1);
 const reboot=await f.restart();assert.deepEqual(await reboot.conversations.relaySucceed(input),receipt);
 assert.throws(()=>reboot.conversations.actor(reboot.conversations.record(r.conversationId),failed.id),/失効/);
});
test('successor rejects permission, revision, changed old receipt and duplicate reservation; rollback launches nothing',async t=>{
 const x=await successorFixture(t),{d,input}=x,q=d.flow.root(x.job.humanRequestId);
 q.revision++;await assert.rejects(d.conversations.relaySucceed(input),/revision/);q.revision--;
 x.oldStatus.permissionRequest={type:'approval'};await assert.rejects(d.conversations.relaySucceed(input));delete x.oldStatus.permissionRequest;
 await assert.rejects(d.conversations.relaySucceed({...input,previousOperationId:id()}),/一致/);
 const pmux=d.pmux.bind(d);d.pmux=async(a,...args)=>args[1]==='initial-status'?{state:'started',receipt:{}}:pmux(a,...args);
 await assert.rejects(d.conversations.relaySucceed(input),/unknown/);d.pmux=pmux;
 const [a,b]=await Promise.all([d.conversations.relaySucceed(input),d.conversations.relaySucceed(input)]);assert.deepEqual(a,b);assert.equal(x.starts(),1);
 for(const uncertain of [false,true]){
  const y=await successorFixture(t);y.d.store.write=()=>{throw Object.assign(Error('save failure'),{persistenceUncertain:uncertain});};
  await assert.rejects(y.d.conversations.relaySucceed(y.input),/save failure/);assert.equal(y.starts(),0);
 }
});
test('successor source later human and save-to-launch change refuse without reinterpretation',async t=>{
 const x=await successorFixture(t),{d}=x;
 await d.send(x.sender.agentId,{mode:'conversation',requestId:id(),instruction:'停止してください'});
 await assert.rejects(d.conversations.relaySucceed(x.input),/人間|human|受付|許可/);assert.equal(x.starts(),0);
 const y=await successorFixture(t),save=y.d.save.bind(y.d);let reserved=false;
 y.d.save=async()=>{await save();if(!reserved&&y.entry.recovery.supersedes){reserved=true;y.d.flow.root(y.job.humanRequestId).revision++;}};
 await assert.rejects(y.d.conversations.relaySucceed(y.input),/revision|一致/);assert.equal(y.starts(),0);
});
test('successor uncertain launch is query-only and post-reservation target human blocks apply',async t=>{
 const x=await successorFixture(t),{d}=x,pmux=d.pmux.bind(d);let attempts=0;
 d.pmux=async(a,...args)=>{if(args[1]==='initial-launch'){attempts++;throw Error('transport unknown');}return pmux(a,...args);};
 const receipt=await d.conversations.relaySucceed(x.input);assert.equal(attempts,1);
 assert.deepEqual(await d.conversations.relaySucceed(x.input),receipt);await d.tick();assert.equal(attempts,1);
 await assert.rejects(d.conversations.relaySucceed({...x.input,operationId:id()}),/一度/);
 const y=await successorFixture(t),rr=await y.d.conversations.relaySucceed(y.input),r=y.d.flow.run(rr.runId);await y.f.submit(r);
 await y.d.send(r.agentId,{mode:'conversation',requestId:id(),instruction:'再開を停止'});
 await assert.rejects(y.d.conversations.relayApply({conversationId:r.conversationId,actorRunId:r.id,operationId:id(),deliveryId:rr.deliveryId,reconciliation:{decision:'continue-unfinished-only',summary:'stale'}}));
 assert.equal(y.d.data.runs.filter(r=>r.secretaryRecovery).length,0);
});
