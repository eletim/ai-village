import {test} from 'node:test';
import {requestProgress} from '../src/request-progress.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {runState} from '../server/run-lifecycle.mjs';
import {validateGraph} from '../server/unified-requests.mjs';
async function setup(t){
 const f=await fixture(t);const p=await f.service.putProject({requestId:randomUUID(),name:'Conversation project'});
 for(const a of f.agents)a.projectId=p.id;
 await f.service.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'相談です。明示依頼としてテスト成果を作ってください。'});
 await f.submit(r);
 const args={conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),instruction:'テスト成果を作る。権限は隔離テストのみ。',authorization:{runId:r.id,quote:'明示依頼としてテスト成果を作ってください。'}};
 return {f,r,args,p};
}
async function claim(f,r,finish=false){return f.service.flow[finish?'finish':'respond']({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:f.service.flow.inputs(r.humanRequestId,r.workId).filter(i=>i.attempts.includes(r.id)&&!i.handledBy&&!i.retiredBy).map(i=>i.id),results:f.service.flow.results(r.humanRequestId,r.workId).filter(e=>!e.handled&&!e.superseded).map(e=>({requestId:e.requestId,resultId:e.id,version:e.version,decision:'accept'}))});}
test('conversation ends naturally, no graph/claims; one reply notification; survives restart',async t=>{
 const {f,r}=await setup(t);assert.equal(r.humanRequestId,undefined);assert.match(f.sent[0].text,/"mode":"conversation"/);
 await f.complete(r);assert.equal(f.service.data.requests.length,0);assert.equal(f.service.data.runs.length,1);assert.equal(f.notifications.length,1);
 await f.restart();await f.service.tick();assert.equal(f.service.data.runs.length,1);assert.ok(f.service.conversations.get(r.conversationId).runs[0].humanAnswer);
});
test('job idempotency, agent provenance, child review and exactly once return during live conversation',async t=>{
 const {f,r,args}=await setup(t);await f.service.conversations.display({conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),expectedVersion:0,mode:'progress'});const receipt=await f.service.conversations.job(args);
 assert.deepEqual(await f.service.conversations.job(args),receipt);
 await assert.rejects(f.service.conversations.job({...args,instruction:'different'}),/再利用/);
 const q=f.service.flow.root(receipt.humanRequestId),w=q.requestGraph.nodes[0];assert.equal(w.createdBy,'agent');assert.equal(w.recipient.kind,'conversation');assert.equal(w.inbox[0].source.actor,'agent');validateGraph(f.service.data,q);
 await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);
 const child=await f.delegate(leader,f.agents[3]);await claim(f,leader);await f.complete(leader);
 const cr=f.service.flow.run(child.currentRunId);await f.submit(cr);await claim(f,cr);await f.complete(cr);
 const resumed=f.service.flow.run(w.currentRunId);await f.submit(resumed);await claim(f,resumed,true);
 assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,0);
 await f.complete(resumed);
 const c=f.service.conversations.record(r.conversationId);assert.equal(c.deliveries.length,1);assert.equal(w.state.kind,'completed');validateGraph(f.service.data,q);
 const delivery=f.service.flow.run(c.deliveries[0].runId);assert.equal(runState(delivery),'queued');assert.equal(runState(r),'running');assert.equal(f.notifications.length,0);
 await f.complete(r);assert.equal(f.notifications.length,0);assert.equal(c.deliveries[0].material.output,'Output '+resumed.id);await f.submit(delivery);await f.complete(delivery);await f.restart();await f.service.tick();
 assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].content,'秘書からの返答\nFinal '+delivery.id);assert.equal(f.service.conversations.get(c.id).runs.find(r=>r.id===delivery.id).humanAnswer,'Final '+delivery.id);
 assert.equal(f.service.conversations.record(c.id).deliveries.length,1);assert.equal(f.sent.filter(s=>s.text.includes(delivery.id)).length,1);
});
test('reject unreceived/foreign actors, missing leader, and invented authorization',async t=>{
 const {f,r,args,p}=await setup(t);
 await assert.rejects(f.service.conversations.job({...args,actorRunId:'foreign'}),/実行中/);
 await assert.rejects(f.service.conversations.job({...args,authorization:{runId:r.id,quote:'invented'}}),/引用/);
 const project=f.service.project(p.id);await f.service.putProject({revision:project.revision,leaderAgentId:null},p.id);
 await assert.rejects(f.service.conversations.job(args),/未設定/);assert.equal(f.service.data.requests.length,0);
});
test('question returns, progress does not; amendments and withdrawal keep agent authority',async t=>{
 const {f,r,args}=await setup(t);const receipt=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);
 const report={humanRequestId:receipt.humanRequestId,workId:receipt.workId,actorRunId:leader.id,operationId:randomUUID(),kind:'progress',text:'内部進捗'};
 await f.service.flow.report(report);await f.service.tick();assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,0);
 await f.service.flow.report({...report,operationId:randomUUID(),kind:'question',text:'制約を確認したい'});await f.service.tick();assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,1);
 await f.service.conversations.amend({...args,humanRequestId:receipt.humanRequestId,operationId:randomUUID(),instruction:'目的を訂正'});
 const q=f.service.flow.root(receipt.humanRequestId);assert.equal(q.requestGraph.nodes[0].inbox.at(-1).source.actor,'agent');
 await f.service.conversations.withdraw({...args,humanRequestId:q.id,operationId:randomUUID(),instruction:'取り下げ'});assert.equal(q.requestGraph.nodes[0].decisions.at(-1).actor,'agent');
 await f.complete(leader);assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,1);validateGraph(f.service.data,q);
});
test('save failure rolls back job and return reservation; same operation retry after confirmed failure',async t=>{
 const {f,r,args}=await setup(t);const write=f.service.store.write;f.service.store.write=()=>{throw Error('disk full');};
 await assert.rejects(f.service.conversations.job(args),/disk full/);assert.equal(f.service.data.requests.length,0);assert.equal(f.service.data.runs.length,1);assert.equal(f.service.conversations.record(r.conversationId).operations.length,0);
 f.service.store.write=write;const receipt=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await claim(f,leader);
 // Native termination is observed first; fail the subsequent atomic result delivery.
 const native=f.runtimes.get(leader.agentId);Object.assign(native.turns.find(t=>t.id===leader.turnId),{state:'completed',output:'result'});await f.service.poll(f.service.agent(leader.agentId));
 f.service.store.write=()=>{throw Error('delivery disk full');};
 await assert.rejects(f.service.flow.settle(),/delivery disk full/);assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,0);assert.equal(f.service.data.runs.filter(r=>r.conversationSource?.kind==='leader').length,0);
 f.service.store.write=write;await f.service.flow.settle();await f.service.tick();assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,1);
});
test('leader changes affect only new jobs; queued withdrawal prevents dispatch; old direct work remains',async t=>{
 const {f,r,args,p}=await setup(t);const first=await f.service.conversations.job(args);
 const project=f.service.project(p.id);await f.service.putProject({revision:project.revision,leaderAgentId:f.agents[3].id},p.id);
 const second=await f.service.conversations.job({...args,operationId:randomUUID()});assert.equal(first.leaderAgentId,f.agents[2].id);assert.equal(second.leaderAgentId,f.agents[3].id);
 await f.service.conversations.withdraw({...args,operationId:randomUUID(),humanRequestId:second.humanRequestId,instruction:'取り下げ'});
 assert.equal(runState(f.service.flow.run(second.runId)),'terminated');await f.service.tick();assert(!f.sent.some(s=>s.text.includes(second.runId)));
 await f.complete(r);const direct=await f.service.send(f.agents[0].id,{requestId:randomUUID(),instruction:'従来の直接依頼'});await f.submit(direct);await claim(f,direct);await f.complete(direct);assert.equal(f.service.flow.get(direct.humanRequestId).status,'completed');
});
test('failed return is not human delivery and never automatically retried; restart preserves queued order',async t=>{
 const {f,r,args}=await setup(t);const receipt=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await claim(f,leader);await f.complete(leader);
 const c=f.service.conversations.record(r.conversationId),deliveryId=c.deliveries[0].runId;
 const next=await f.service.send(r.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'先ほどの件について'});assert(next.conversationSequence>f.service.flow.run(deliveryId).conversationSequence);
 await f.restart();await f.service.tick();assert.equal(runState(f.service.flow.run(deliveryId)),'queued');
 const original=f.service.flow.run(r.id);await f.complete(original);const delivery=f.service.flow.run(deliveryId);await f.submit(delivery);await f.complete(delivery,'failed');
 await f.service.tick();assert.equal(f.sent.filter(s=>s.text.includes(delivery.id)).length,1);assert.equal(f.service.conversations.get(c.id).runs.find(r=>r.id===delivery.id).humanAnswer,null);assert.equal(f.service.flow.get(receipt.humanRequestId).returnDelivery.state,'failed');
 assert.equal(f.service.data.runs.filter(r=>r.conversationSource?.kind==='leader').length,1);
});
test('failed leader sends one attention, never a successful result; secretary cannot move while job remains',async t=>{
 const {f,r,args}=await setup(t);const receipt=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await f.complete(leader,'failed');
 const c=f.service.conversations.record(r.conversationId);assert.equal(c.deliveries.length,1);assert.equal(c.deliveries[0].kind,'attention');assert.equal(f.service.flow.get(receipt.humanRequestId).status,'active');
 await assert.rejects(f.service.updateAgent(r.agentId,{revision:0,projectId:null}),/未完了/);
 await f.service.tick();assert.equal(c.deliveries.length,1);
});
test('scoped event settlement save failure restores graph, conversation and queue, including after restart',async t=>{
 const {f,r,args}=await setup(t);const receipt=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await claim(f,leader);
 const native=f.runtimes.get(leader.agentId);Object.assign(native.turns.find(t=>t.id===leader.turnId),{state:'completed',output:'result'});await f.service.poll(f.service.agent(leader.agentId));
 const write=f.service.store.write;f.service.store.write=()=>{throw Error('scoped disk failure');};
 await assert.rejects(f.service.units.run(receipt.humanRequestId,()=>f.service.flow.settle([f.service.flow.root(receipt.humanRequestId)])),/scoped disk failure/);
 assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,0);assert.equal(f.service.data.runs.filter(r=>r.conversationSource?.kind==='leader').length,0);
 f.service.store.write=write;await f.restart();await f.service.tick();assert.equal(f.service.conversations.record(r.conversationId).deliveries.length,1);assert.equal(f.service.data.runs.filter(r=>r.conversationSource?.kind==='leader').length,1);
});
test('turn-scoped history excludes future human input and arriving material, without hiding admin evidence',async t=>{
 const {f,r,args}=await setup(t);const receipt=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(receipt.runId);await f.submit(leader);await claim(f,leader);await f.complete(leader);
 await f.service.send(r.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'未来の補足'});
 const before=f.service.conversations.get(r.conversationId,r.id);assert.equal(before.deliveries.length,0);assert.equal(before.runs.length,1);assert.equal(before.jobs[0].returnPending,true);assert.equal(before.jobs[0].runs,undefined);
 const all=f.service.conversations.get(r.conversationId);assert.equal(all.deliveries.length,1);assert.equal(all.runs.length,3);
 await f.complete(r);const delivery=f.service.flow.run(all.deliveries[0].runId);await f.submit(delivery);
 const visible=f.service.conversations.get(r.conversationId,delivery.id);assert.equal(visible.deliveries.length,1);assert.equal(visible.runs.length,2);assert.equal(visible.jobs[0].availableDeliveries.length,1);assert.equal(visible.jobs[0].runs,undefined);
});
test('reply notification has one stable key; unknown external receipt is never resent',async t=>{
 const {f,r}=await setup(t);let calls=0;f.service.notifier.enqueue=async message=>{calls++;assert.equal(message.id,'conversation-answer:'+r.id);throw Error('receipt lost');};
 await f.complete(r);assert.equal(calls,1);assert.equal(r.notification.status,'delivery_unknown');await f.service.tick();assert.equal(calls,1);
 await f.restart();await f.service.tick();assert.equal(f.notifications.length,0);assert.equal(f.service.flow.run(r.id).notification.status,'delivery_unknown');
});
test('secretary can request correction using the original human authorization after result delivery',async t=>{
 const {f,r,args}=await setup(t);const first=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(first.runId);await f.submit(leader);await claim(f,leader);await f.complete(leader);await f.complete(r);
 const delivery=f.service.flow.run(f.service.conversations.record(r.conversationId).deliveries[0].runId);await f.submit(delivery);
 const correction=await f.service.conversations.job({...args,actorRunId:delivery.id,operationId:randomUUID(),instruction:'元の許可範囲で不足を修正する'});assert.notEqual(correction.humanRequestId,first.humanRequestId);assert.equal(f.service.flow.root(correction.humanRequestId).requestedBy.authorization.runId,r.id);
});
for(const mode of ['migration-required','legacy','startup-v1',undefined])test('new job rejects leader startup mode '+mode+' before creating graph or receipt',async t=>{
 const {f,r,args}=await setup(t),a=f.service.agent(f.agents[2].id);
 a.inputEnvelope=mode?{mode}:undefined;
 // Legacy compatibility for old requests must not admit this new conversation job.
 a.legacyContract={version:1};await f.service.save();
 assert.equal(f.service.instructionStatus(a.id).requiresFreshSession,true);
 await assert.rejects(f.service.conversations.job(args),/起動契約の移行/);
 assert.equal(f.service.data.requests.length,0);assert.equal(f.service.data.runs.length,1);
 assert.equal(f.service.conversations.record(r.conversationId).operations.length,0);
});
test('verified instruction downgrade rejects new job before graph creation',async t=>{
 const {f,args}=await setup(t),a=f.service.agent(f.agents[2].id);
 f.promptState('changed');await f.service.verifyInstructions(a);
 assert.equal(a.inputEnvelope.mode,'migration-required');
 await assert.rejects(f.service.conversations.job(args),/起動契約の移行/);
 assert.equal(f.service.data.requests.length,0);assert.equal(f.service.data.runs.length,1);
});
test('prepared leader preserves admitted job across restart and adoption; new jobs require adopted startup-v2',async t=>{
 const {f,r,args}=await setup(t),leaderId=f.agents[2].id,donorId=f.agents[3].id;
 const first=await f.service.conversations.job(args);
 const a=f.service.agent(leaderId),b=f.service.agent(donorId);
 a.cwd='/fixture/work';f.service.data.workshops.push({id:a.workshopId,...a.connection,workplaces:[a.cwd]});
 Object.assign(b,{provider:a.provider,location:a.location,projectId:a.projectId,workshopId:a.workshopId,cwd:a.cwd,connection:structuredClone(a.connection)});
 await f.service.prepareRuntime(a.id,{operationId:randomUUID(),revision:a.metadataRevision||0});
 assert.equal(a.runtimeUpgrade.state,'prepared');
 const next={...args,operationId:randomUUID()};
 await assert.rejects(f.service.conversations.job(next),/リーダーを利用できません/);
 assert.deepEqual(await f.service.conversations.job(args),first);
 await f.service.tick();assert.equal(runState(f.service.flow.run(first.runId)),'queued');
 assert.equal(f.sent.filter(s=>s.agentId===leaderId).length,0);
 await f.restart();assert.equal(f.service.agent(leaderId).runtimeUpgrade.state,'prepared');
 await assert.rejects(f.service.conversations.job(next),/リーダーを利用できません/);
 assert.deepEqual(await f.service.conversations.job(args),first);
 assert.equal(f.service.data.requests.length,1);assert.equal(f.service.data.runs.length,2);
 await f.service.adoptRuntime(leaderId,{operationId:randomUUID(),revision:f.service.agent(leaderId).metadataRevision,replacementRevision:f.service.agent(donorId).metadataRevision||0,replacementAgentId:donorId});
 assert.equal(f.service.agent(leaderId).runtimeUpgrade.state,'adopted');
 assert.equal(f.service.instructionStatus(leaderId).requiresFreshSession,false);
 const second=await f.service.conversations.job(next);assert.notEqual(second.humanRequestId,first.humanRequestId);
 await f.service.tick();assert.equal(f.sent.filter(s=>s.agentId===leaderId).length,1);
 assert.equal(f.service.flow.run(first.runId).id,first.runId);assert.equal(runState(f.service.flow.run(first.runId)),'awaiting_input');
 assert.equal(runState(f.service.flow.run(second.runId)),'queued');
 assert.equal(f.service.conversations.record(r.conversationId).operations.length,2);
});
test('startup hash migration on restart blocks new jobs while retaining already admitted job',async t=>{
 const {f,r,args}=await setup(t),first=await f.service.conversations.job(args);
 f.service.agent(first.leaderAgentId).inputEnvelope.hash='obsolete-contract-hash';await f.service.save();
 await f.restart();const a=f.service.agent(first.leaderAgentId);
 assert.equal(a.inputEnvelope.mode,'migration-required');
 await assert.rejects(f.service.conversations.job({...args,operationId:randomUUID()}),/起動契約の移行/);
 assert.deepEqual(await f.service.conversations.job(args),first);
 await f.service.tick();assert.equal(runState(f.service.flow.run(first.runId)),'queued');
 assert.equal(f.service.data.requests.length,1);assert.equal(f.service.data.runs.length,2);
 assert.equal(f.service.conversations.record(r.conversationId).operations.length,1);
 assert.equal(f.sent.filter(s=>s.agentId===a.id).length,0);
});
for(const kind of ['question','extension'])test(kind+' waits for secretary amendment across restart, then resumes and submits once',async t=>{
 const {f,r,args}=await setup(t),job=await f.service.conversations.job(args);await f.complete(r);
 const leader=f.service.flow.run(job.runId);await f.submit(leader);
 const report={humanRequestId:job.humanRequestId,workId:job.workId,actorRunId:leader.id,operationId:randomUUID(),kind,text:'秘書の判断を待つ'};
 await f.service.flow.report(report);await claim(f,leader);await f.complete(leader);await f.restart();await f.service.tick();
 assert.equal(f.service.flow.get(job.humanRequestId).status,'active');
 assert.equal(requestProgress(f.service.flow.get(job.humanRequestId),job.workId).label,'秘書回答待ち');
 assert.deepEqual(f.service.conversations.get(r.conversationId).deliveries.map(e=>e.kind),[kind]);
 assert.equal(f.service.data.runs.filter(x=>x.humanRequestId===job.humanRequestId).length,1);
 assert.deepEqual(await f.service.flow.report(report),f.service.flow.root(job.humanRequestId).requestGraph.nodes[0].metadata.reporting.reports[0]);
 const delivery=f.service.flow.run(f.service.conversations.get(r.conversationId).deliveries[0].runId);await f.submit(delivery);
 const amend={...args,actorRunId:delivery.id,operationId:randomUUID(),humanRequestId:job.humanRequestId,instruction:'許可範囲でこの文言を使ってください'};
 const receipt=await f.service.conversations.amend(amend);assert.deepEqual(await f.service.conversations.amend(amend),receipt);
 await f.service.tick();const resumed=f.service.flow.run(f.service.flow.root(job.humanRequestId).requestGraph.nodes[0].currentRunId);
 assert.notEqual(resumed.id,leader.id);await f.submit(resumed);await claim(f,resumed);await f.complete(resumed);
 assert.equal(f.service.flow.get(job.humanRequestId).status,'completed');
 await f.restart();await f.service.tick();assert.deepEqual(f.service.conversations.get(r.conversationId).deliveries.map(e=>e.kind),[kind,'result']);
});
test('explicit normal finish can resolve consultation; withdrawal never produces a final result',async t=>{
 for(const end of ['finish','withdraw']){
 const {f,r,args}=await setup(t),job=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(job.runId);await f.submit(leader);
 await f.service.flow.report({humanRequestId:job.humanRequestId,workId:job.workId,actorRunId:leader.id,operationId:randomUUID(),kind:'question',text:'確認'});
 if(end==='finish')await claim(f,leader,true);else await f.service.conversations.withdraw({...args,operationId:randomUUID(),humanRequestId:job.humanRequestId,instruction:'取り下げ'});
 await f.complete(leader);await f.restart();await f.service.tick();
 assert.equal(f.service.flow.get(job.humanRequestId).status,end==='finish'?'completed':'cancelled');
 assert.equal(f.service.conversations.get(r.conversationId).deliveries.filter(e=>e.kind==='result').length,end==='finish'?1:0);
 }
});
test('failed finish cannot resolve consultation and ordinary human leaf reports keep legacy completion',async t=>{
 const {f,r,args}=await setup(t),job=await f.service.conversations.job(args);await f.service.tick();const leader=f.service.flow.run(job.runId);await f.submit(leader);
 await f.service.flow.report({humanRequestId:job.humanRequestId,workId:job.workId,actorRunId:leader.id,operationId:randomUUID(),kind:'question',text:'確認'});
 await claim(f,leader,true);await f.complete(leader,'failed');await f.restart();await f.service.tick();
 assert.equal(f.service.flow.get(job.humanRequestId).status,'active');assert(!f.service.conversations.get(r.conversationId).deliveries.some(e=>e.kind==='result'));
 const direct=await f.service.send(f.agents[3].id,{requestId:randomUUID(),instruction:'従来のleaf'});await f.submit(direct);
 await f.service.flow.report({humanRequestId:direct.humanRequestId,workId:direct.workId,actorRunId:direct.id,operationId:randomUUID(),kind:'question',text:'従来仕様'});
 await claim(f,direct);await f.complete(direct);assert.equal(f.service.flow.get(direct.humanRequestId).status,'completed');
});

test('waiting leader job releases execution for another job, survives restart and resumes original',async t=>{
 const {f,r,args}=await setup(t);
 const a=await f.service.conversations.job(args);await f.service.tick();
 const ar=f.service.flow.run(a.runId);await f.submit(ar);
 await f.service.flow.report({humanRequestId:a.humanRequestId,workId:a.workId,actorRunId:ar.id,operationId:randomUUID(),kind:'question',text:'Need a decision'});
 await claim(f,ar);await f.complete(ar);
 const b=await f.service.conversations.job({...args,operationId:randomUUID(),instruction:'Independent B'});
 await f.service.tick();const br=f.service.flow.run(b.runId);
 assert(f.sent.some(x=>x.text.includes(br.id)),'unfinished A must not block B');
 await f.submit(br);
 await f.service.conversations.amend({...args,operationId:randomUUID(),humanRequestId:a.humanRequestId,instruction:'Resume A'});
 await f.service.tick();
 const aw=f.service.flow.work(f.service.flow.root(a.humanRequestId),a.workId);
 assert.equal(f.sent.filter(x=>x.agentId===ar.agentId).length,2,'no simultaneous native dispatch');
 await claim(f,br,true);await f.complete(br);
 const resume=f.service.flow.run(aw.currentRunId);assert.notEqual(resume.id,ar.id);
 assert(f.sent.some(x=>x.text.includes(resume.id)));
 await f.submit(resume);await claim(f,resume,true);await f.complete(resume);
 await f.restart();await f.service.tick();
 for(const job of [a,b])assert.equal(f.service.flow.work(f.service.flow.root(job.humanRequestId),job.workId).state.kind,'completed');
 assert.equal(f.sent.filter(x=>x.text.includes(br.id)).length,1);
 assert.equal(f.sent.filter(x=>x.text.includes(resume.id)).length,1);
});

test('leader can start next job while prior job awaits secretary answer',async t=>{
 const {f,r,args}=await setup(t),a=await f.service.conversations.job(args);
 await f.service.tick();const ar=f.service.flow.run(a.runId);await f.submit(ar);
 await f.service.flow.report({humanRequestId:a.humanRequestId,workId:a.workId,actorRunId:ar.id,operationId:randomUUID(),kind:'question',text:'Need a decision'});
 await claim(f,ar);await f.complete(ar);
 const b=await f.service.conversations.job({...args,operationId:randomUUID()});
 await f.restart();await f.service.tick();
 assert(f.sent.some(x=>x.text.includes(b.runId)));
 assert.equal(f.service.flow.work(f.service.flow.root(a.humanRequestId),a.workId).state.kind,'active');
});
