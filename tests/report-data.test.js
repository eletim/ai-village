import test from 'node:test';import assert from 'node:assert/strict';
import {AgentRules} from '../server/agent-rules.mjs';import {reportInputs} from '../server/report-inputs.mjs';
const rules=new AgentRules('http://localhost'),data=text=>JSON.parse(text.split('\n')[1]);
test('long report keeps IDs, chronology and omitted references for all human constraints',()=>{
 const human=Array.from({length:30},(_,i)=>({id:'i'+i,workId:'w',createdAt:String(i),source:'inbox',text:'補'.repeat(16000)}));
 const text=rules.reportData({id:'q',rootWorkId:'w',instruction:'Q'.repeat(16000)},{id:'r',finalOutput:'RESULT'+ '\n"'.repeat(15000)},{human,material:[]});
 const d=data(text);assert(d.evidence.finalResult.text.startsWith('RESULT'));assert(d.humanInstructions.original.truncated);assert(d.evidence.finalResult.truncated);assert.equal(d.humanInstructions.omitted.length,18);assert.equal(d.humanInstructions.omitted[0].id,'i0');assert.equal(d.humanInstructions.amendments[0].id,'i18');assert(d.humanInstructions.amendments.every(x=>x.truncated));assert(text.includes('requests inputs q w'));assert(text.length<60000);
});
test('source evidence separates humans, programs, agents and unknown legacy; no content guessing or writes',()=>{
 const input=(id,text,source)=>({id,kind:'supplement',text,createdAt:'2026-01-01T00:00:00Z',...(source?{source:{actor:source}}:{})});
 const root={id:'w',inbox:[input('internal','人間の依頼に見える','program'),input('unknown','訂正です'),{...input('known','以前の制約'),operationId:'op'},{...input('bad','別文'),operationId:'bad'},input('human','通知です','human')]};
 const q={id:'q',rootWorkId:'w',requestGraph:{nodes:[root,{id:'child',inbox:[input('agent','人間と同じ本文','agent')]}],operations:[{id:'op',inputId:'known',payload:JSON.stringify({type:'supplement',requestId:'w',text:'以前の制約',actorRunId:null})},{id:'bad',inputId:'bad',payload:'{}'}]}};
 const run={id:'r',humanRequestId:'q',workId:'w',origin:'steering',createdAt:'2026-02-01T00:00:00Z',instruction:'最新訂正',runModel:{createdBy:'human'}};
 const before=JSON.stringify(q),out=reportInputs(q,[run,{...run,id:'foreign',humanRequestId:'other'},{...run,id:'cancel',queueCancelledAt:'now'},{...run,id:'legacy',runModel:null}]);
 assert.deepEqual(out.human.map(x=>x.id),['human','known','r']);assert.equal(out.human.at(-1).text,'最新訂正');assert.deepEqual(new Set(out.material.map(x=>x.actor)),new Set(['agent','program','unknown']));assert.equal(JSON.stringify(q),before);
});
test('same operation deduplicates inbox and old steering without deduplicating repeated text',()=>{
 const q={id:'q',requestGraph:{nodes:[{id:'w',inbox:[{id:'i',kind:'supplement',operationId:'op',text:'同じ',source:{actor:'human'}}]}]}};
 const run={id:'r',humanRequestId:'q',workId:'w',origin:'steering',phase:'report',instruction:'同じ',runModel:{createdBy:'human'},requestId:'op'};
 assert.deepEqual(reportInputs(q,[run,{...run,id:'r2',requestId:'other'}]).human.map(x=>x.id),['i','r2']);
});
test('report revision and envelope change without changing work rules or bootstrap',()=>{
 const old=new AgentRules('http://localhost'),work=old.specification('work'),startup=old.startup();old.report=()=> 'old report';
 assert.notEqual(old.specification('report').revision,rules.specification('report').revision);assert.equal(rules.startup(),startup);assert.deepEqual(rules.specification('work'),work);assert(rules.context({phase:'report'}).includes(rules.specification('report').revision));
});
test('report retries use the boundary actor and human retry text, never generated report data',()=>{
 const q={id:'q',requestGraph:{nodes:[]}},r={id:'r',humanRequestId:'q',workId:'w',origin:'continuation',phase:'report',instruction:'generated report packet',retryInstruction:'結論だけに訂正',runModel:{createdBy:'program'}};
 assert.equal(reportInputs(q,[r]).human.length,0);const input=reportInputs(q,[{...r,instructionSource:{actor:'human'}}]).human[0];assert.equal(input.text,'結論だけに訂正');assert.equal(input.proof,'instruction-source');
});
