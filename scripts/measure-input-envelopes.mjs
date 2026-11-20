// Offline, fixed synthetic inputs. No service, filesystem state or native session access.
import {execFileSync} from 'node:child_process';
import {AgentRules} from '../server/agent-rules.mjs';
import {RequestFlow} from '../server/requests.mjs';
const source=file=>execFileSync('git',['show','9aa66f2:'+file],{encoding:'utf8'});
const {AgentRules:OldRules}=await import('data:text/javascript;base64,'+Buffer.from(source('server/agent-rules.mjs')).toString('base64'));
// Execute the actual one-line historical context builder, not a hand-counted estimate.
const oldMethod=source('server/requests.mjs').split('\n').find(s=>s.startsWith(' context(r){'));
const oldContext=new Function('return ({'+oldMethod+'})')().context;
const url='http://127.0.0.1:15179',oldRules=new OldRules(url),rules=new AgentRules(url);
const count=text=>({characters:[...text].length,utf8Bytes:Buffer.byteLength(text)});
const rows=[];
for(const length of [80,8000])for(const origin of ['human','delegation','result','steering','report']){
 const text='依頼本文を確認してください。'.repeat(1000).slice(0,length),id='11111111-2222-4333-8444-555555555555';
 const r={id,humanRequestId:id,workId:id,instruction:text,origin,phase:origin==='report'?'report':'work'};
 const q={id,inputProtocol:1},w={id,inbox:[],metadata:{reporting:{version:1,completionAt:null,reportAt:'2026-11-20T06:26:23.133Z',reports:[]}}};
 const identity={agentId:id,role:'worker',location:'workshop',projectId:id};
 const inputs=[{id,kind:origin==='result'?'result':origin==='steering'?'supplement':'request',text,attempts:[id]}];
 const context=(rule,mode)=>({root:()=>q,work:()=>w,inputs:()=>inputs,d:{rules:rule,agent:()=>({inputEnvelope:{mode}})}});
 const old=mode=>text+oldRules.discovery(identity)+oldContext.call(context(oldRules,mode),r);
 const modern=text+rules.discovery(identity)+RequestFlow.prototype.context.call(context(rules,'startup-v2'),r);
 rows.push({origin,bodyCharacters:length,oldLegacy:count(old('legacy')),oldStartupV1:count(old('startup-v1')),newStartupV2:count(modern),newFixedCharacters:count(modern).characters-length});
}
console.log(JSON.stringify({baseline:'9aa66f2',unit:'Unicode characters and UTF-8 bytes, not token estimates',startup:{old:count(oldRules.startup()),new:count(rules.startup())},specificationRead:{work:count(JSON.stringify(rules.specification())),report:count(JSON.stringify(rules.specification('report')))},rows},null,2));
