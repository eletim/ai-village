import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {responseText} from '../src/response-text.js';
import {humanProjection} from '../server/report-view.mjs';
import {historyPage} from '../server/conversation-pages.mjs';
import {VillageOperations} from '../server/operations.mjs';
async function setup(t){
 const f=await fixture(t),p=await f.service.putProject({requestId:randomUUID(),name:'Display fixture'});f.agents[0].projectId=p.id;
 const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'相談'});await f.submit(r);
 const x={conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),expectedVersion:0,mode:'progress'};
 return {f,r,x};
}
test('optional progress has explicit text and durable suppression, next question defaults reply; CLI and restart',async t=>{
 const {f,r,x}=await setup(t);const ops=new VillageOperations({dir:f.service.dir},null,{direct:f.service});
 const before=structuredClone(r.runModel);const receipt=await ops.commands.find(o=>o.name==='conversations display').run([JSON.stringify(x)]);assert.deepEqual(r.runModel,before);assert.equal(f.service.data.requests.length,0);
 assert.deepEqual(await f.service.conversations.display(x),receipt);
 await f.complete(r);let shown=f.service.conversations.get(r.conversationId).runs[0];
 assert.equal(shown.humanAnswer,null);assert.equal(shown.progressText,'Final '+r.id);assert.equal(shown.displayMode,'progress');assert.equal(f.notifications.length,0);assert.equal(shown.notificationSuppressed.reason,'explicit-conversation-progress');
 assert.equal(historyPage(humanProjection(f.service.data),r.agentId).entries[0].displayMode,'progress');
 await f.restart();await f.service.tick();assert.deepEqual(await f.service.conversations.display(x),receipt);assert.equal(f.notifications.length,0);
 const q=await f.service.send(r.agentId,{mode:'conversation',conversationId:r.conversationId,requestId:randomUUID(),instruction:'何を選べますか？'});await f.submit(q);q.createdAt=new Date(Date.now()-10*60*1000).toISOString();await f.complete(q);
 shown=f.service.conversations.get(r.conversationId).runs.at(-1);assert.equal(shown.displayMode,'reply');assert.equal(shown.progressText,null);assert.equal(shown.humanAnswer,'Final '+q.id);assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].content,'秘書からの返答\nFinal '+q.id);
 assert(ops.commands.some(o=>o.name==='conversations display'));
});
test('version concurrency, operation payload conflict, current accepted conversation only, terminal immutable',async t=>{
 const {f,r,x}=await setup(t);
 await assert.rejects(f.service.conversations.display({...x,actorRunId:'foreign'}),/実行中/);
 await assert.rejects(f.service.conversations.display({...x,mode:'guess'}),/mode/);
 const results=await Promise.allSettled([f.service.conversations.display(x),f.service.conversations.display({...x,operationId:randomUUID(),mode:'reply'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(f.service.conversations.display({...x,mode:'reply'}),/再利用/);
 await f.service.conversations.display({...x,operationId:randomUUID(),expectedVersion:1,mode:'reply'});
 await f.complete(r);await assert.rejects(f.service.conversations.display({...x,operationId:randomUUID(),expectedVersion:2}),/実行中/);assert.equal(f.notifications.length,1);
});
test('save failure rollback, suppression save failure retry, late notification states untouched',async t=>{
 const {f,r,x}=await setup(t),write=f.service.store.write;
 f.service.store.write=()=>{throw Error('disk full');};await assert.rejects(f.service.conversations.display(x),/disk full/);assert.equal(r.conversationDisplay,undefined);
 f.service.store.write=write;await f.service.conversations.display(x);
 const native=f.runtimes.get(r.agentId);Object.assign(native.turns.find(t=>t.id===r.turnId),{state:'completed',output:'raw',finalOutput:'final'});await f.service.poll(f.service.agent(r.agentId));
 f.service.store.write=()=>{throw Error('disk full');};await assert.rejects(f.service.conversations.notifications(),/disk full/);assert.equal(r.notificationSuppressed,undefined);assert.equal(f.notifications.length,0);
 f.service.store.write=write;await f.service.conversations.notifications();await f.restart();await f.service.conversations.notifications();assert.equal(f.notifications.length,0);
 const saved=f.service.flow.run(r.id);delete saved.notificationSuppressed;
 for(const status of ['sent','attempting','delivery_unknown']){saved.notification={status,id:'old'};await f.service.conversations.notifications();assert.equal(saved.notificationSuppressed,undefined);assert.equal(saved.notification.status,status);assert.equal(f.notifications.length,0);}
});
test('failed or unaccepted turns do not gain a public progress answer or suppression',async t=>{
 const {f,r,x}=await setup(t);await f.service.conversations.display(x);await f.complete(r,'failed');
 const shown=f.service.conversations.get(r.conversationId).runs[0];assert.equal(shown.humanAnswer,null);assert.equal(shown.progressText,null);assert.equal(shown.notificationSuppressed,undefined);assert.equal(f.notifications.length,0);
});
test('native text selection preserves legacy, repeated text, non-suffix and whitespace final',()=>{
 assert.equal(responseText({output:'legacy'}).answer,'legacy');assert.equal(responseText({output:'legacy',finalOutput:'  '}).answer,'legacy');
 assert.deepEqual(responseText({output:'same\n\nsame',finalOutput:'same'}),{answer:'same',record:'same',recordLabel:'途中経過'});
 assert.equal(responseText({output:'raw tail',finalOutput:'answer'}).record,'raw tail');assert.equal(responseText({output:'raw tail',finalOutput:'answer'}).answer,'answer');
});
test('display versus normal terminal is serialized; no retroactive changes or effect duplication',async t=>{
 const {f,r,x}=await setup(t);
 await Promise.all([f.service.conversations.display(x),f.complete(r)]);
 const saved=f.service.flow.run(r.id);assert.equal(saved.conversationDisplay.mode,'progress');assert.equal(f.notifications.length,0);
 assert.equal(saved.notificationSuppressed.reason,'explicit-conversation-progress');
 await assert.rejects(f.service.conversations.display({...x,operationId:randomUUID(),expectedVersion:1,mode:'reply'}),/実行中/);
 // Pending was never attempted; suppression leaves a reason instead of perpetual pending.
 delete saved.notificationSuppressed;saved.notification={status:'pending',id:'conversation-answer:'+r.id};await f.service.conversations.notifications();assert.equal(saved.notification,undefined);assert.equal(saved.notificationSuppressed.reason,'explicit-conversation-progress');
});
test('work and queued conversation runs cannot declare display; failed execution is not a normal reply',async t=>{
 const {f,r,x}=await setup(t);
 const queued=await f.service.send(r.agentId,{mode:'conversation',conversationId:r.conversationId,requestId:randomUUID(),instruction:'later'});
 await assert.rejects(f.service.conversations.display({...x,actorRunId:queued.id}),/実行中/);
 const work=await f.service.send(f.agents[2].id,{requestId:randomUUID(),instruction:'work'});await f.submit(work);
 await assert.rejects(f.service.conversations.display({...x,actorRunId:work.id}),/実行中/);
 assert.equal(f.service.conversations.record(r.conversationId).operations.length,0);
});
