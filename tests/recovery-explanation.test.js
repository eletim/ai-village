import test from 'node:test';
import assert from 'node:assert/strict';
import {continuationStatus} from '../server/purpose-continuation.mjs';
import {conversationTurn} from '../server/conversation-status.mjs';
import {recoveryExplanationHTML} from '../src/conversation-status.js';
const input={type:'input',at:1,sessionId:'s',turnId:'t',inputId:'i'};
const ended=(phase='work',outcome='interrupted')=>({id:'r',runModel:{id:'r',phase,state:{kind:'ended',outcome,reason:'native-terminal'},facts:[input,{type:'terminal',at:2,sessionId:'s',turnId:'t',outcome}]}});
test('saved terminal evidence is shared across work and conversation without promising a fresh continuation',()=>{
 for(const phase of ['work','conversation']){
  const r=ended(phase),before=structuredClone(r),e=continuationStatus(r,{agent:{id:'a'}});assert.match(e.known,/終端を確認済み/);assert.equal(e.available,false);assert.match(e.unresolved,/所有境界/);assert.equal(e.next.operation,phase==='work'?'status':'agents instructions');assert.deepEqual(r,before);
  if(phase==='conversation')assert.deepEqual(conversationTurn(r,{id:'a'}).explanation,e);
 }
});
test('unknown timeout and mismatched terminal never establish stopped or no external effect',()=>{
 const r=ended();r.runModel.state={kind:'ended',outcome:'unconfirmed',reason:'timeout'};const e=continuationStatus(r);assert.match(e.known,/入力受付/);assert.match(e.unresolved,/終端を確認できません/);assert.equal(e.available,false);assert.ok(e.unknown.length);
 const wrong=ended();wrong.runModel.facts[1].turnId='different';assert.doesNotMatch(continuationStatus(wrong).known,/終端を確認済み/);
});
test('accepted input is not work evidence; disconnected state has an actionable observer instead of waiting',()=>{
 const r=ended();r.runModel.state={kind:'running',sessionId:'s',turnId:'t',inputId:'i'};r.runModel.facts=[input];assert.match(continuationStatus(r).known,/着手.*別/);
 const e=continuationStatus(r,{agent:{agentModel:{observation:{connected:false}}}});assert.match(e.unresolved,/接続/);assert.equal(e.next.operation,'status');assert.match(e.next.instruction,/権限/);
 const html=recoveryExplanationHTML({...e,cause:'<script>bad</script>'});assert.ok(!html.includes('<script>'));assert.match(html,/確認済み/);assert.match(html,/次の対応/);
});
test('pre-dispatch is known not sent, repair offered only to retained initial workspace',()=>{
 const r=ended();r.runModel.facts=[{type:'dispatch-blocked',at:1}];r.runModel.state={kind:'ended',outcome:'unconfirmed',reason:'startup-contract-rejected'};
 const agent={id:'a',initialInput:{shellTabId:'tab'},inputEnvelope:{mode:'blocked'}};
 const e=continuationStatus(r,{agent,agentId:'a'});assert.match(e.known,/送信前/);assert.equal(e.next.operation,'agents prepare-runtime');assert.deepEqual(e.unknown,[]);
 assert.equal(continuationStatus(r,{agent:{...agent,deletedAt:1}}).next.operation,'status');
});

test('queued and secretary diagnostics never promise status will observe them',()=>{
 for(const phase of ['work','conversation']){const r=ended(phase);if(phase==='work')r.runModel.state={kind:'queued'};const e=continuationStatus(r,{agent:{id:'a',agentModel:{observation:{connected:false}}}});assert.equal(e.next.operation,'agents instructions');assert.match(e.next.instruction,/保存記録/);assert.equal(e.available,false);}
});

test('missing registered assignee is diagnosed before any status observation suggestion',()=>{const e=continuationStatus(ended());assert.equal(e.next.operation,'agents list');assert.equal(e.available,false);});

test('normal density, plain abnormal guidance, and queued label are separated from technical instructions',async()=>{
 const normal=ended();normal.runModel.state={kind:'running'};normal.runModel.facts=[input];
 const e=continuationStatus(normal,{agent:{id:'a'}}),html=recoveryExplanationHTML(e);
 assert.match(html,/<details[^>]*><summary>受付の確認内容/);assert.doesNotMatch(html,/role="status"|継続:/);assert.equal(e.human.continuation,'応答中です。再開操作は不要です');
 const repair=ended();repair.runModel.state={kind:'ended',outcome:'unconfirmed',reason:'startup-contract-rejected'};repair.runModel.facts=[{type:'dispatch-blocked',at:1}];
 const rejected=continuationStatus(repair,{agent:{id:'a',initialInput:{},inputEnvelope:{mode:'blocked'}}});assert.equal(rejected.next.operation,'agents prepare-runtime');assert.match(recoveryExplanationHTML(rejected),/設定の修復が必要/);
 for(const v of [rejected,continuationStatus(ended(),{agent:{id:'a'}}),continuationStatus(normal,{agent:{id:'a',agentModel:{observation:{connected:false}}}})]){
  assert.doesNotMatch(recoveryExplanationHTML(v),/statusで|agents instructions|prepare-runtime|所有境界|権限ある環境担当/);
  assert.match(recoveryExplanationHTML(v),/確認済み:.*未確認・必要な確認:.*継続:.*次の対応:/);
 }
 const {answerJobsHTML}=await import('../src/conversation-status.js');assert.match(answerJobsHTML({answerJobs:[{id:'q',code:'queued'}]}),/保存済み・送信待ち/);assert.doesNotMatch(answerJobsHTML({answerJobs:[{id:'q',code:'queued'}]}),/受付済み/);
});
