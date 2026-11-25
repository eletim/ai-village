// Disposable fixture measurement. Does not contact a running village or send notifications.
import {randomUUID} from 'node:crypto';
import {purposeFixture} from '../../tests/purpose-fixture.js';
import {inputHash} from '../../tests/model-fixtures.mjs';
const samples=[];
for(const contract of [2,3]){
 const cleanup=[];const {f,human}=await purposeFixture({after:fn=>cleanup.push(fn)});
 try{
  const d=f.service,a=f.agents[0];
  if(contract===3)a.inputEnvelope={...a.inputEnvelope,contract:3,hash:inputHash(d.rules.startup3())};
  for(let index=0;index<2;index++){
   const instruction='比較のための会話';
   const r=await d.send(a.id,{mode:'conversation',requestId:randomUUID(),instruction});await f.submit(r);
   const text=f.sent.findLast(s=>s.agentId===a.id).text;
   samples.push({source:'isolated fixture, not live provider',contract,first:index===0,input:text,instructionCharacters:instruction.length,addedCharacters:text.length-instruction.length,tagCharacters:contract===3?text.slice(text.lastIndexOf('<village run=')).length:null});
   await f.complete(r);
  }
 }finally{f.service.close();for(const fn of cleanup)await fn();}
}
console.log(JSON.stringify(samples,null,2));
