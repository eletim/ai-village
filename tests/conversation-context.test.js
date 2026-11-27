import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationContext,conversationMaterial} from '../server/conversation-context.mjs';
function fixture(){
 const runs=Array.from({length:23},(_,i)=>({id:'run-'+i,conversationSequence:i+1,conversationSource:{kind:i===22?'leader':'human'},instruction:i===0?'古い制約: main変更不可。'+ '人間の詳細文脈'.repeat(220):'入力文脈'.repeat(220),humanAnswer:'返答全文'.repeat(200),state:i===22?'running':'completed'}));
 const jobs=Array.from({length:10},(_,i)=>({id:'job-'+i,instruction:'元の具体的な依頼'.repeat(200),authorization:{runId:'run-0',quote:'main変更不可'},purpose:{id:'job-0',currentRequestId:'job-9',requestIds:Array.from({length:10},(_,n)=>'job-'+n),decision:null},lifecycle:{code:'reviewing'},returnPending:false}));
 return {id:'conversation',agentId:'secretary',sequence:23,runs,jobs,deliveries:[{id:'delivery-old',runId:'run-3',humanRequestId:'job-1',material:{text:'過去の成果'.repeat(500)}},{id:'delivery-current',runId:'run-22',humanRequestId:'job-9',material:{text:'今回の成果'}}]};
}
test('23-turn compact projection retains exact current input and full indexes with substantial size reduction',()=>{
 const view=fixture(),before=JSON.stringify(view),out=conversationContext(view,'run-22');
 assert.deepEqual(out.current,view.runs[22]);assert.equal(out.humanInputs.length,22);assert.equal(out.history.length,22);
 assert.equal(out.purposes.length,1);assert.equal(out.purposes[0].authorization.quote,'main変更不可');
 assert.equal(out.currentDeliveries[0].material.text,'今回の成果');
 assert.ok(JSON.stringify(out).length<before.length/3);
 assert.equal(out.omittedContent.semanticSummary,false);assert.match(out.omittedContent.instruction,/全humanInputs/);
 assert.equal(JSON.stringify(view),before);
});
test('old constraints, complete old response and purpose lineage are explicitly retrievable',()=>{
 const view=fixture(),old=conversationMaterial(view,'run-22',{kind:'turn',id:'run-0'});
 assert.equal(old.complete,true);assert.match(old.content.instruction,/main変更不可/);assert.equal(old.content.humanAnswer,view.runs[0].humanAnswer);
 assert.equal(conversationMaterial(view,'run-22',{kind:'purpose',id:'job-0'}).content.jobs.length,10);
 assert.deepEqual(conversationMaterial(view,'run-22',{kind:'delivery',id:'delivery-old'}).content,view.deliveries[0]);
 old.content.instruction='mutated';assert.match(view.runs[0].instruction,/main変更不可/);
});
test('foreign and later actors/materials and unbounded views fail closed',()=>{
 const view=fixture();assert.throws(()=>conversationContext(view,'foreign'),{status:403});assert.throws(()=>conversationContext(view,'run-0'),{status:403});
 for(const kind of ['turn','purpose','delivery'])assert.throws(()=>conversationMaterial(view,'run-22',{kind,id:'later-or-foreign'}),{status:404});
 assert.throws(()=>conversationMaterial(view,'run-22',{kind:'raw',id:'run-0'}),{status:400});
 const bounded={...view,sequence:2,runs:view.runs.slice(0,2),jobs:[],deliveries:[]};
 assert.throws(()=>conversationMaterial(bounded,'run-1',{kind:'turn',id:'run-22'}),{status:404});
 assert.equal(conversationContext(bounded,'run-1').humanInputs.length,2);
});
test('ordinary consultation has no synthetic purpose or decision and all older constraints remain discoverable',()=>{
 const view=fixture();view.jobs=[];view.deliveries=[];view.runs[22].conversationSource={kind:'human'};
 const out=conversationContext(view,'run-22');assert.deepEqual(out.purposes,[]);assert.deepEqual(out.currentDeliveries,[]);assert.equal(out.humanInputs.length,23);
});
test('purpose material encodes exact duplicate bodies once; every session can reconstruct originals',()=>{
 const view=fixture();view.jobs[4].instruction='後から変更された原文';
 view.jobs[4].authorization={runId:'run-4',quote:'変更の許可'};
 const before=JSON.stringify(view),material=conversationMaterial(view,'run-22',{kind:'purpose',id:'job-0'}).content;
 for(let i=0;i<view.jobs.length;i++){
  const job=material.jobs[i],original=view.jobs[i];
  assert.equal(job.instructionRef?material[job.instructionRef]:job.instruction,original.instruction);
  assert.deepEqual(job.authorizationRef?material[job.authorizationRef]:job.authorization,original.authorization);
 }
 const old={id:'job-0',objective:view.jobs[0].instruction,authorization:view.jobs[0].authorization,jobs:view.jobs,decisions:[]};
 assert(Buffer.byteLength(JSON.stringify(material))<Buffer.byteLength(JSON.stringify(old))/2);
 assert.deepEqual(conversationMaterial(view,'run-22',{kind:'purpose',id:'job-0'}).content,material);
 assert.equal(JSON.stringify(view),before);
});
