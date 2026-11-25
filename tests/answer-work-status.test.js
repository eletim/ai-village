import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerJobs} from '../server/conversation-status.mjs';
import {answerJobsHTML,conversationWorkHTML} from '../src/conversation-status.js';
test('answer association follows actor, delivery and amendment, not newest work or authorization',()=>{
 const root={id:'w',assignee:'l',state:{kind:'active'}};
 const q=(id,actorRunId)=>({id,conversationId:'c',requestedBy:{actorRunId,authorization:{runId:'old'}},instruction:id,requestGraph:{rootId:'w',nodes:[root]}});
 const data={agents:[],runs:[],projects:[],requests:[q('a','old'),q('b','new')],conversations:[{id:'c',deliveries:[{runId:'result',humanRequestId:'a',kind:'result'},{runId:'question',humanRequestId:'a',kind:'question',material:{text:'公開日はいつですか？'}}],operations:[{payload:JSON.stringify({action:'amend',input:{actorRunId:'amend'}}),receipt:{humanRequestId:'a'}}]}]};
 for(const [run,ids] of [['old',['a']],['new',['b']],['result',['a']],['amend',['a']],['chat',[]]]){
  assert.deepEqual(answerJobs(data,{id:run,conversationId:'c'}).map(j=>j.id),ids);
 }
 assert.deepEqual(answerJobs(data,{id:'old',conversationId:'other'}),[]);
 assert.equal(answerJobs(data,{id:'question',conversationId:'c'})[0].leaderQuestionText,'公開日はいつですか？');
});
test('plain advice has no work prompt; completion has no fabricated approval; failure remains visible',()=>{
 assert.equal(answerJobsHTML({answerJobs:[]}), '');
 assert.equal(conversationWorkHTML({conversationWork:{leader:{code:'ready'},jobs:[]}}),'');
 const html=answerJobsHTML({answerJobs:[{id:'a',code:'completed',instruction:'成果A'},{id:'b',code:'attention',instruction:'成果B',reason:'受付不明',next:'秘書へ確認してください'}]});
 assert.match(html,/完了/);assert.match(html,/停止中/);assert.match(html,/受付不明/);
 assert.doesNotMatch(html,/成果確認待ち|人間の了承|仕事の状況/);
});
test('human closure never becomes successful completion because an older result delivery exists',async()=>{
 const {conversationJob}=await import('../server/conversation-status.mjs');
 const q={id:'q',conversationId:'c',requestGraph:{rootId:'w',nodes:[{id:'w',state:{kind:'completed',by:'human'}}]}};
 const data={agents:[],runs:[],conversations:[{id:'c',deliveries:[{humanRequestId:'q',kind:'result',runId:'old'}]}]};
 assert.equal(conversationJob(data,q).code,'human-closed');
});

test('internal instructions stay in profile details, never in answer cards or tooltips',()=>{
 for(const code of ['working','evaluating','completed']){
  const jobs=[{id:'a',code,label:'確認中',instruction:'内部指示A追加指示を保存できます。'},{id:'b',code,instruction:'内部指示B'}];
  const html=answerJobsHTML({answerJobs:jobs});
  assert.doesNotMatch(html,/内部指示|追加指示|title=/);
  assert.match(html,/data-answer-job="a"/);assert.match(html,/data-answer-job="b"/);
  assert.match(conversationWorkHTML({conversationWork:{leader:{code:'ready'},jobs}}),/内部指示A/);
 }
});
