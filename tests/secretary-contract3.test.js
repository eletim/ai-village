// Stage 3 of secretary-minimal-prompt.md: startup contract 3 and the single tag (4.1, 4.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DirectAgents} from '../server/direct.mjs';
import {AgentRules} from '../server/agent-rules.mjs';
import {installInstructionsScript,verifyInstructionsScript,startupContract} from '../server/input-envelope.mjs';
import {inputHash} from './model-fixtures.mjs';
import {purposeFixture} from './purpose-fixture.js';

test('new secretaries are installed on contract 3; leaders and workshops stay on contract 2',async()=>{
 const d=new DirectAgents({dir:'/unused',notifier:{status:()=>({})}});d.save=async()=>{};
 const bodies=[];d.execute=async(_a,args)=>{bodies.push(args.at(-1));return JSON.stringify({installed:true,hash:inputHash(args.at(-1))});};
 const secretary={workspaceId:'ws-s',provider:'claude',location:'mayor'},leader={workspaceId:'ws-l',provider:'codex',location:'workshop'};
 await d.installInstructions(secretary);await d.installInstructions(leader);
 assert.match(bodies[0],/^<ai-village-instructions version="3">/);assert.equal(secretary.inputEnvelope.contract,3);assert.equal(secretary.inputEnvelope.mode,'startup-v2');assert.equal(startupContract(secretary),3);
 assert.match(bodies[1],/^<ai-village-instructions version="2">/);assert.equal(leader.inputEnvelope.contract,undefined);assert.equal(startupContract(leader),2);
 // The role is explained once, without procedures, in a few hundred characters.
 const v3=new AgentRules('http://127.0.0.1:5173').startup3();
 assert(v3.length<700,String(v3.length));assert.match(v3,/秘書です/);assert.match(v3,/village help/);assert.match(v3,/--run/);
 for(const procedure of ['rulesRevision','operationId','authorization','rules get','conversations get'])assert(!v3.includes(procedure),procedure);
});

test('the contract 3 block installs and verifies with the real scripts for both providers',async t=>{
 const home=await mkdtemp(join(tmpdir(),'contract3-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.purplemux/workspaces/ws-test');await mkdir(root,{recursive:true});const body=new AgentRules('http://127.0.0.1:5394').startup3();
 for(const provider of ['claude','codex']){
  await writeFile(join(root,provider+'-prompt.md'),'# purplemux context\n');
  execFileSync('python3',['-c',installInstructionsScript,'ws-test',provider,body],{env:{...process.env,HOME:home}});
  assert.equal(JSON.parse(execFileSync('python3',['-c',verifyInstructionsScript,'ws-test',provider,inputHash(body)],{env:{...process.env,HOME:home}})).verified,true);
 }
});

async function contract3(t){
 const x=await purposeFixture(t),d=x.f.service,secretary=d.agent(x.human.agentId);
 await x.f.complete(x.human);
 secretary.inputEnvelope={...secretary.inputEnvelope,hash:inputHash(d.rules.startup3()),contract:3};await d.save();
 const say=async instruction=>{const r=await d.send(secretary.id,{mode:'conversation',requestId:randomUUID(),instruction});await x.f.submit(r);const sent=x.f.sent.at(-1);await x.f.complete(r);return {r,text:sent.text};};
 return {...x,d,secretary,say};
}
test('a contract 3 turn carries only the tag; the Project policy is mentioned once, and again only after it changes',async t=>{
 const {d,secretary,say}=await contract3(t);
 const first=await say('こんにちは');
 assert.match(first.text,/^Projectの方針が更新されました（projects guide [0-9a-f-]+ secretary で読めます）。\n\nこんにちは\n<village run="[0-9a-f-]{36}"\/>$/);
 assert(first.text.endsWith('<village run="'+first.r.id+'"/>'));
 for(const old of ['<ai-village-discovery','<ai-village-request','rulesRevision','historyRead'])assert(!first.text.includes(old),old);
 const second=await say('次の話');
 assert.equal(second.text,'次の話\n<village run="'+second.r.id+'"/>');
 const tag=second.text.slice('次の話'.length);t.diagnostic('per-turn addition: '+tag.length+' characters');assert.equal(tag.length,54);assert.equal(tag.trim().length,53);
 const guide=await d.projectGuides.get(secretary.projectId);
 await d.putProjectGuide(secretary.projectId,{revision:guide.revision,content:guide.content});
 assert(!(await say('同じ本文の再保存')).text.includes('Projectの方針'));
 guide.revision=(await d.projectGuides.get(secretary.projectId)).revision;
 await d.putProjectGuide(secretary.projectId,{revision:guide.revision,content:guide.content+'\n- 追記：テストの方針'});
 const third=await say('方針を変えたよ');assert.match(third.text,/^Projectの方針が更新されました/);
 const fourth=await say('ありがとう');assert(!fourth.text.includes('Projectの方針'));
});
test('a delivered result to a contract 3 secretary is plain text plus the tag',async t=>{
 const {f,d,first,completeJob}=await contract3(t);
 const one=await completeJob(first),text=f.sent.at(-1).text;
 // The first contract 3 turn also mentions the Project policy once.
 assert.match(text,/^(Projectの方針が更新されました[^\n]*\n\n)?担当（Worker 2）から報告が届きました/);assert(text.endsWith('<village run="'+one.delivery.id+'"/>'));assert(!text.includes('<ai-village-'));
});
test('contract 3 survives a restart; a contract 2 secretary keeps its envelope',async t=>{
 const {f,secretary}=await contract3(t);
 await f.restart();const after=f.service.agent(secretary.id);assert.equal(after.inputEnvelope.mode,'startup-v2');assert.equal(startupContract(after),3);
 const v2=await purposeFixture(t),r=await v2.f.service.send(v2.human.agentId,{mode:'conversation',requestId:randomUUID(),instruction:'v2の会話'});
 await v2.f.complete(v2.human);await v2.f.service.tick();const text=v2.f.sent.at(-1).text;
 assert.match(text,/<ai-village-discovery>/);assert.match(text,/<ai-village-request>/);assert(!text.includes('<village run='));
});

// Migration (6): a contract 2 secretary adopts a newly created contract 3 session and becomes contract 3.
import {fixture} from './inbox-fixture.js';
test('a contract 2 secretary that adopts a contract 3 session runs on contract 3 afterwards',async t=>{
 const f=await fixture(t),s=f.service,[a,b]=f.agents;a.cwd='/fixture/work';s.data.workshops.push({id:a.workshopId,...a.connection,workplaces:[a.cwd]});
 Object.assign(b,{workshopId:a.workshopId,location:a.location,projectId:a.projectId,cwd:a.cwd,connection:structuredClone(a.connection)});
 assert.equal(a.location,'mayor');assert.equal(startupContract(a),2);
 b.inputEnvelope={mode:'startup-v2',hash:inputHash(s.rules.startup3()),contract:3};
 await s.adoptRuntime(a.id,{operationId:randomUUID(),revision:a.metadataRevision||0,replacementRevision:b.metadataRevision||0,replacementAgentId:b.id,handover:'版3への移行'});
 assert.equal(startupContract(a),3);assert.equal(a.inputEnvelope.hash,inputHash(s.rules.startup3()));
 const restarted=await f.restart();assert.equal(startupContract(restarted.agent(a.id)),3);assert.equal(restarted.agent(a.id).inputEnvelope.mode,'startup-v2');
});

import {changeRun} from '../server/run-lifecycle.mjs';
import {observeRequest} from '../server/request-lifecycle.mjs';
test('contract 3 reconciliation keeps the installed version even when delivery is gated',async t=>{
 const f=await fixture(t),d=f.service,a=f.agents[0];
 a.inputEnvelope={...a.inputEnvelope,contract:3,hash:inputHash(d.rules.startup3())};
 const r=await d.send(a.id,{requestId:randomUUID(),instruction:'isolated root work'});await f.submit(r);
 changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'session-changed'});r.error='runtime-file-replaced';observeRequest(d.data,d.flow.root(r.humanRequestId));
 a.inputEnvelope={...a.inputEnvelope,mode:'migration-required',reason:'native-session-changed'};await d.save();
 assert.equal(d.startupInstructions(a),d.rules.startup3());
 const result=await d.flow.reconcileObservation({humanRequestId:r.humanRequestId,workId:r.workId,actorRunId:r.id,operationId:randomUUID()});
 assert.equal(result.sent,false);assert.equal(result.state,'running');assert.equal(startupContract(a),3);
 assert.equal(d.instructionStatus(a.id).requiredContract,3);
 assert.equal(d.instructionStatus(f.agents[2].id).requiredContract,2);
});

test('a newly adopted contract 3 runtime gets the policy once; the old runtime retains its history',async t=>{
 const {f,d,secretary:a,say}=await contract3(t);await say('最初の会話');const seen=a.secretaryGuideSeen,b=f.agents[1];
 a.cwd='/fixture/work';d.data.workshops.push({id:a.workshopId,...a.connection,workplaces:[a.cwd]});
 Object.assign(b,{workshopId:a.workshopId,location:a.location,projectId:a.projectId,cwd:a.cwd,connection:structuredClone(a.connection)});
 b.inputEnvelope={mode:'startup-v2',hash:inputHash(d.rules.startup3()),contract:3};
 await d.prepareRuntime(a.id,{operationId:randomUUID(),revision:a.metadataRevision||0});
 await d.adoptRuntime(a.id,{operationId:randomUUID(),revision:a.metadataRevision,replacementRevision:b.metadataRevision||0,replacementAgentId:b.id,handover:'新セッションへ移行'});
 assert.equal(b.secretaryGuideSeen,seen);assert.equal(a.secretaryGuideSeen,undefined);
 assert.match((await say('移行後の会話')).text,/^Projectの方針が更新されました/);
 assert.doesNotMatch((await say('次の会話')).text,/Projectの方針/);
});
