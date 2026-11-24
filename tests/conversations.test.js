import {test} from 'node:test';
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
test('conversation ends naturally, no graph/claims/notification; survives restart',async t=>{
 const {f,r}=await setup(t);assert.equal(r.humanRequestId,undefined);assert.match(f.sent[0].text,/"mode":"conversation"/);
 await f.complete(r);assert.equal(f.service.data.requests.length,0);assert.equal(f.service.data.runs.length,1);assert.equal(f.notifications.length,0);
 await f.restart();await f.service.tick();assert.equal(f.service.data.runs.length,1);assert.ok(f.service.conversations.get(r.conversationId).runs[0].humanAnswer);
});
test('job idempotency, agent provenance, child review and exactly once return during live conversation',async t=>{
 const {f,r,args}=await setup(t);const receipt=await f.service.conversations.job(args);
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
 await f.complete(r);await f.submit(delivery);await f.complete(delivery);await f.restart();await f.service.tick();
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
 await f.service.tick();assert.equal(f.sent.filter(s=>s.text.includes(delivery.id)).length,1);assert.equal(f.service.conversations.get(c.id).runs.find(r=>r.id===delivery.id).humanAnswer,null);
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
