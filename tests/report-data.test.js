import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentRules} from '../server/agent-rules.mjs';
const rules=new AgentRules('http://localhost');
const data=text=>JSON.parse(text.split('\n')[1]);
test('long report fields remain valid JSON with result and explicit omissions',()=>{
 const text=rules.reportData({id:'q',rootWorkId:'w',instruction:'Q'.repeat(16000)},{id:'r',finalOutput:'RESULT'+ '\n"'.repeat(15000)},Array.from({length:30},(_,i)=>String(i)+ '補'.repeat(16000)));
 const d=data(text);assert(d.finalResult.startsWith('RESULT'));assert(d.truncation.question);assert(d.truncation.finalResult);assert.equal(d.truncation.omittedSupplements,18);assert(d.truncation.supplements.every(Boolean));assert.equal(d.supplements.length,12);assert(text.includes('requests inputs q w'));assert(text.length<50000);
});
test('short report remains complete, including empty result',()=>{
 const d=data(rules.reportData({id:'q',rootWorkId:'w',instruction:'question'},{id:'r',output:''},['supplement']));assert.equal(d.question,'question');assert.deepEqual(d.supplements,['supplement']);assert.equal(d.finalResult,'');assert.deepEqual(d.truncation,{question:false,finalResult:false,supplements:[false],omittedSupplements:0});
});
