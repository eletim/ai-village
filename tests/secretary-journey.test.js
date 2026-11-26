import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {VillageOperations} from '../server/operations.mjs';
import {inputHash} from './model-fixtures.mjs';
import {purposeView} from '../server/conversation-purpose.mjs';
// Composite exploration scenarios retained as regression coverage. Native/notifications are fixtures.
const log=()=>{};
async function setup(t,name){
 const f=await fixture(t);t.after(()=>f.service.close());const p=await f.service.putProject({requestId:randomUUID(),name});for(const a of f.agents)a.projectId=p.id;await f.service.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);f.agents[0].inputEnvelope.contract=3;f.agents[0].inputEnvelope.hash=inputHash(f.service.startupInstructions(f.agents[0]));await f.service.save();
 const cmd=async(action,r,...args)=>{const out=await new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute([action,'--run',r.id,...args]);log(name,action,{run:r.id,args,...out});return out;};
 const ok=async(...args)=>{const out=await cmd(...args);assert.equal(out.ok,true,out.error);return out.result;};
 const human=async(text,submit=true)=>{const r=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:text});if(submit)await f.submit(r);log(name,'human',{id:r.id,text,state:r.state});return r;};
 const work=job=>f.service.flow.work(f.service.flow.root(job.humanRequestId),job.workId);
 const leader=async(job)=>{await f.service.tick();const r=f.service.flow.run(work(job).currentRunId);if(!r.acceptedAt)await f.submit(r);return r;};
 const inputs=r=>f.service.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&i.attempts.includes(r.id)).map(i=>i.id);
 const respond=async(r)=>f.service.flow.respond({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:inputs(r),results:[]});
 const result=async(job)=>{const r=await leader(job);await f.service.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:inputs(r),results:[]});await f.complete(r);return delivery(job,'result');};
 const delivery=async(job,kind)=>{const c=f.service.data.conversations[0],e=c.deliveries.findLast(e=>e.humanRequestId===job.humanRequestId&&e.kind===kind);if(!e)log(name,'missing-delivery',{runs:f.service.data.runs,requests:f.service.data.requests,conversations:f.service.data.conversations});assert(e,`missing ${kind}`);const r=f.service.flow.run(e.runId);await f.submit(r);log(name,'delivery',{kind,id:r.id,text:r.instruction});return r;};
 const snapshot=(event)=>log(name,event,{jobs:f.service.snapshot().agents.find(a=>a.id===f.agents[0].id).conversationWork.jobs,notifications:f.notifications.map(n=>n.id),requests:f.service.data.requests.length,sent:f.sent.length});
 return {f,cmd,ok,human,leader,respond,result,delivery,work,snapshot};
}
test('A: consultation -> two purposes -> running amendment -> correction -> missed judgment -> accept -> withdraw',async t=>{
 const x=await setup(t,'A'),{f,cmd,ok,human,leader,respond,result,work,snapshot}=x;
 let h=await human('まず設計を相談');assert.equal((await ok('status',h)).purposes.length,0);await f.complete(h);assert.equal(f.service.data.requests.length,0);
 h=await human('Aの画面とBの資料を作って');const a=await ok('order',h,'A:画面を作る'),b=await ok('order',h,'B:資料を作る');assert.deepEqual(await ok('order',h,'A:画面を作る'),a);await f.complete(h);const ar=await leader(a);
 h=await human('Aは色を青に、Bは中止');assert.equal((await cmd('followup',h,'青にする')).ok,false);const add=await ok('followup',h,a.purposeId.slice(0,8),'色は青');assert.equal(add.action,'amend');assert.deepEqual(await ok('followup',h,a.purposeId,'色は青'),add);await ok('withdraw',h,b.purposeId,'資料は不要');await ok('status',h);await f.complete(h);
 await respond(ar);await f.complete(ar);const first=await result(a);const next=await ok('followup',first,'余白も修正');await f.complete(first);await f.restart();
 const second=await result(next);await f.complete(second);snapshot('missed-decision');
 h=await human('Aを確認して採用');await ok('status',h);const accept=await ok('accept',h,a.purposeId,'色と余白を確認');assert.deepEqual(await ok('accept',h,a.purposeId,'色と余白を確認'),accept);await f.complete(h);snapshot('accepted');
 h=await human('Bを再開できる？');assert.equal((await cmd('followup',h,b.purposeId,'再開')).ok,false);await ok('status',h);await f.complete(h);snapshot('end');
});
test('B: question -> answer -> result -> ask -> response -> continuation -> accepted; restart and replay',async t=>{
 const {f,ok,cmd,human,leader,respond,result,delivery,snapshot}=await setup(t,'B');let h=await human('公開物を作る');const a=await ok('order',h,'公開物の準備');await f.complete(h);const r=await leader(a);
 await f.service.flow.report({humanRequestId:r.humanRequestId,workId:r.workId,actorRunId:r.id,operationId:randomUUID(),kind:'question',text:'公開日は？'});await respond(r);await f.complete(r);const q=await delivery(a,'question');assert.equal((await cmd('accept',q,'採用')).ok,false);await ok('ask',q,'公開日はいつにしますか');await f.complete(q);snapshot('human-question');await f.restart();
 h=await human('12月1日');await ok('status',h);await ok('followup',h,'12月1日に進めて');await f.complete(h);const one=await result(a);await ok('ask',one,'成果を公開してよいですか');await f.complete(one);
 h=await human('はい、公開してください');await ok('status',h);const next=await ok('followup',h,'許可された公開を進めて');await f.complete(h);const two=await result(next);await ok('accept',two,'公開結果確認');await f.complete(two);await f.restart();snapshot('end');
});
test('C: accept -> late human -> stale -> retry accept fails run -> later recovery + transport lost observation',async t=>{
 const {f,ok,cmd,human,result,snapshot}=await setup(t,'C');let h=await human('レポート作成');const a=await ok('order',h,'レポート作成');await f.complete(h);const r=await result(a);await ok('accept',r,'内容確認');const late=await human('追加条件も確認して',false);await f.submit(late);snapshot('stale');await ok('status',late);await ok('accept',late,'追加条件も満たす');await f.complete(late,'failed');await f.restart();
 h=await human('保存済み成果で確認し直して');await ok('status',h);await ok('accept',h,'保存結果を確認');await f.complete(h);snapshot('recovered');
 f.lose(true);const unknown=await human('次の件',false);const sent=f.sent.length;const out=await cmd('order',unknown,'新しい件');assert.equal(out.ok,false);await cmd('status',unknown);assert.equal(f.sent.length,sent);f.lose(false);await f.submit(unknown);await ok('status',unknown);const b=await ok('order',unknown,'新しい件');await ok('withdraw',unknown,b.purposeId,'誤依頼のため取消');await f.complete(unknown);snapshot('end');
});
test('D: failures around delivery and disk save; same operation retry and later rejection',async t=>{
 const {f,ok,cmd,human,leader,result,snapshot}=await setup(t,'D');let h=await human('依頼を作成');const write=f.service.store.write;f.service.store.write=async()=>{throw Error('fixture disk failure');};assert.equal((await cmd('order',h,'原稿作成')).ok,false);f.service.store.write=write;assert.equal(f.service.data.requests.length,0);const a=await ok('order',h,'原稿作成');await f.complete(h);log('D','index-after-order-retry',{dataRequests:f.service.data.requests.map(q=>q.id),indexedRequests:[...f.service.units.maps.requests.keys()]});await f.restart();let r=await result(a);
 const write2=f.service.store.write;f.service.store.write=async()=>{throw Error('fixture disk failure');};assert.equal((await cmd('accept',r,'確認')).ok,false);f.service.store.write=write2;assert.equal(purposeView(f.service.data,f.service.flow.root(a.humanRequestId)).version,0);await ok('accept',r,'確認');await f.complete(r,'failed');await f.restart();h=await human('失敗後の確認');await ok('status',h);await ok('accept',h,a.purposeId,'保存済み成果で達成確認');await f.complete(h);snapshot('delivery-failure-recovered');
 h=await human('別の作業');const b=await ok('order',h,'別作業');await f.complete(h);r=await leader(b);await f.complete(r,'failed');const c=f.service.data.conversations[0],e=c.deliveries.findLast(e=>e.kind==='attention'),att=f.service.flow.run(e.runId);await f.submit(att);await ok('status',att);assert.equal((await cmd('accept',att,'失敗報告の確認')).ok,false);assert.equal((await cmd('followup',att,'残りを進めて')).ok,false);await f.complete(att);h=await human('状況を確認');await ok('status',h);assert.equal((await cmd('followup',h,b.purposeId,'保存記録を見て続けて')).ok,false);await ok('withdraw',h,b.purposeId,'これ以上進めない');await f.complete(h);snapshot('failed-work-withdrawn');
});
test('E: order and withdraw during late instruction; capture all outcomes',async t=>{
 const {f,ok,cmd,human,snapshot}=await setup(t,'E');let h=await human('Aを作成');const a=await ok('order',h,'A');await f.complete(h);
 h=await human('Bを依頼しAを取り下げて');const late=await human('訂正、Bは依頼しないで。Aは継続して',false);
 await cmd('order',h,'B');await cmd('followup',h,a.purposeId,'Aの補足');await cmd('withdraw',h,a.purposeId,'Aを取り下げ');snapshot('late-input-operations');await f.submit(late);await ok('status',late);await f.complete(late);
});
test('F: two purposes, acceptance and question in one reply, then continuation',async t=>{
 const {f,ok,cmd,human,result,snapshot}=await setup(t,'F');let h=await human('AとBを作成');const a=await ok('order',h,'A'),b=await ok('order',h,'B');await f.complete(h);
 let r=await result(a);await f.complete(r);r=await result(b);await f.complete(r);h=await human('両方の結果を確認');await ok('accept',h,a.purposeId,'A採用');await ok('ask',h,b.purposeId,'B公開してよいですか');await f.complete(h);snapshot('mixed-decisions');h=await human('Bも公開して');const next=await ok('followup',h,b.purposeId,'Bの公開');await f.complete(h);r=await result(next);await ok('accept',r,'B公開確認');await f.complete(r);snapshot('both-done');
});
