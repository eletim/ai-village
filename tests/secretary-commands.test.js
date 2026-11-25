// Stage 1 of secretary-minimal-prompt.md: simple secretary operations (4.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {purposeFixture} from './purpose-fixture.js';
import {VillageOperations} from '../server/operations.mjs';
import {purposeView} from '../server/conversation-purpose.mjs';

const cli=(f)=>async(...argv)=>new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute(argv);
async function turn(f,instruction){const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction});await f.submit(r);return r;}

test('order: the run is enough; permission is this human utterance; a rerun is the same operation',async t=>{
 const {f,human}=await purposeFixture(t),d=f.service,village=cli(f);
 const now=await turn(f,'ログイン画面の不具合を直して進めてください');
 const first=await village('order','--run',now.id,'ログイン画面の不具合を直す');
 assert.equal(first.ok,true,first.error);const q=d.flow.root(first.result.humanRequestId);
 assert.deepEqual(q.requestedBy.authorization,{runId:now.id,quote:now.instruction});assert.equal(q.conversationId,human.conversationId);
 const again=await village('order',`--run=${now.id}`,'ログイン画面の不具合を直す');
 assert.deepEqual(again.result,first.result);assert.equal(d.data.requests.filter(x=>x.instruction==='ログイン画面の不具合を直す').length,1);
 const other=await village('order','--run',now.id,'別の不具合も直す');assert.notEqual(other.result.humanRequestId,first.result.humanRequestId);
});

test('accept and ask are bound to the result delivered in this run; elsewhere the village explains',async t=>{
 const {f,first,completeJob,view}=await purposeFixture(t),village=cli(f);
 const one=await completeJob(first);
 const accepted=await village('accept','--run',one.delivery.id,'テストとPRを確認し、目的を満たしている');
 assert.equal(accepted.ok,true,accepted.error);assert.equal(accepted.result.kind,'accept');assert.equal(view().decision.kind,'accept');
 await f.complete(one.delivery);const human=await turn(f,'どうなった？');
 const wrong=await village('accept','--run',human.id,'達成');
 assert.equal(wrong.ok,false);assert.match(wrong.error,/案内: accept\/ask は、リーダーの結果が届いた回で使います/);
});

test('ask records a concrete question for the human on the delivered result',async t=>{
 const {f,first,completeJob,view}=await purposeFixture(t),village=cli(f);
 const one=await completeJob(first);
 const asked=await village('ask','--run',one.delivery.id,'AとBのどちらを本番に使いますか？');
 assert.equal(asked.ok,true,asked.error);assert.equal(view().decision.kind,'question');assert.equal(view().decision.question,'AとBのどちらを本番に使いますか？');
});

test('followup: the delivered purpose or the only purpose is implied; otherwise PURPOSE (a prefix) is required',async t=>{
 const {f,first,completeJob}=await purposeFixture(t),d=f.service,village=cli(f);
 const one=await completeJob(first);
 // On the delivered result the purpose is implied: this is a send-back to the leader.
 const back=await village('followup','--run',one.delivery.id,'テストが足りないので追加してください');
 assert.equal(back.ok,true,back.error);assert.equal(back.result.purposeId,first.humanRequestId);
 await f.complete(one.delivery);const human=await turn(f,'もう一つ別の作業も進めてください');
 const only=await village('followup','--run',human.id,'READMEも直してください');assert.equal(only.ok,true,only.error);
 await village('order','--run',human.id,'別の作業');await f.complete(human);
 const later=await turn(f,'最初の件に追加で');
 const ambiguous=await village('followup','--run',later.id,'追加');assert.equal(ambiguous.ok,false);assert.match(ambiguous.error,/目的が2つあります/);
 const prefixed=await village('followup','--run',later.id,first.humanRequestId.slice(0,8),'追加');assert.equal(prefixed.ok,true,prefixed.error);
 const unknown=await village('followup','--run',later.id,'deadbeef','追加');assert.equal(unknown.ok,false);assert.match(unknown.error,/この会話にありません/);
 assert(d.data.requests.length>=2);
});

test('withdraw uses the purpose and the automatic permission; status shows the purposes',async t=>{
 const {f,first}=await purposeFixture(t),d=f.service,village=cli(f);
 const human=await turn(f,'やっぱり取り下げてください');
 const status=await village('status','--run',human.id);
 assert.equal(status.ok,true,status.error);assert.equal(status.result.purposes.length,1);assert.equal(status.result.purposes[0].id,first.humanRequestId);
 const withdrawn=await village('withdraw','--run',human.id,first.humanRequestId,'人間の指示で取り下げ');
 assert.equal(withdrawn.ok,true,withdrawn.error);assert.equal(withdrawn.result.action,'withdraw');
 assert.equal(d.flow.root(first.humanRequestId).requestGraph.nodes[0].state.kind,'withdrawn');
});

test('a delivery run inherits the original permission of its purpose',async t=>{
 const {f,first,completeJob,auth}=await purposeFixture(t),d=f.service,village=cli(f);
 const one=await completeJob(first);
 const ordered=await village('order','--run',one.delivery.id,'関連する別の修正');
 assert.equal(ordered.ok,true,ordered.error);assert.deepEqual(d.flow.root(ordered.result.humanRequestId).requestedBy.authorization,auth);
});

test('the CLI explains a missing or foreign run, wrong arguments, and accepts long text',async t=>{
 const {f,human}=await purposeFixture(t),village=cli(f);
 assert.match((await village('order','指示')).error,/--run に発言の末尾/);
 assert.match((await village('order','--run','not-a-run','指示')).error,/--run に発言末尾/);
 assert.match((await village('order','--run',randomUUID(),'指示')).error,/秘書の会話の回ではありません/);
 assert.match((await village('order','--run',human.id,'a','b')).error,/引数の数が違います/);
 // A finished run cannot act; the village says which run to use.
 const old=await village('order','--run',human.id,'終わった回から');assert.equal(old.ok,false);assert.match(old.error,/案内: --run には、今答えている回/);
 const now=await turn(f,'長い指示を送ります');const long='あ'.repeat(15000);
 const ordered=await village('order','--run',now.id,long);assert.equal(ordered.ok,true,ordered.error);
 const help=(await village('help')).result;assert.deepEqual(help.slice(0,6).map(c=>c.name),['order','followup','accept','ask','withdraw','status']);
});

test('status identifies every visible purpose and bounds long authorization quotes',async t=>{
 const {f,first}=await purposeFixture(t),village=cli(f);
 const human=await turn(f,'進めてください。'+'詳しい資料'.repeat(150));
 const second=await village('order','--run',human.id,'別の目的の成果を作る');
 assert.equal(second.ok,true,second.error);
 assert.equal(f.service.flow.root(second.result.humanRequestId).requestedBy.authorization.quote.length,500);
 const status=await village('status','--run',human.id);
 assert.deepEqual(status.result.purposes.map(p=>p.objective),['目的の成果を作る','別の目的の成果を作る']);
 assert.equal(status.result.purposes[0].id,first.humanRequestId);
});

test('accept rejects a consultation with actionable guidance; pending followup explains the wait',async t=>{
 const {f,first,completeJob}=await purposeFixture(t),village=cli(f);
 const one=await completeJob(first);
 const kind=one.event.kind;one.event.kind='question';
 const wrong=await village('accept','--run',one.delivery.id,'採用');
 assert.equal(wrong.ok,false);assert.match(wrong.error,/相談への回答はfollowup.*質問はask/);
 one.event.kind=kind;
 assert.equal((await village('accept','--run',one.delivery.id,'達成')).ok,true);
 const pending=await village('followup','--run',one.delivery.id,'修正');
 assert.equal(pending.ok,false);assert.match(pending.error,/案内: 前の判断がまだ確定/);
});

test('a first command observes an already delivered input without requiring status first',async t=>{
 const {f}=await purposeFixture(t),village=cli(f);
 const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'進めてください'});
 assert.equal(r.runModel.state.kind,'sent');
 const native=f.runtimes.get(r.agentId),text=f.sent.findLast(s=>s.agentId===r.agentId).text,tid=randomUUID();
 const {inputHash}=await import('./model-fixtures.mjs');
 native.cursor+=10;native.inputs.push({id:'input-'+tid,turnId:tid,hash:inputHash(text),offset:native.cursor,source:'response',text});
 native.turns.push({id:tid,state:'running',output:''});
 const ordered=await village('order','--run',r.id,'受付確認直後の作業');
 assert.equal(ordered.ok,true,ordered.error);assert.equal(r.runModel.state.kind,'running');
});
