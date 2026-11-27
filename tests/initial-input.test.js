import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runState} from '../server/run-lifecycle.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('same ordinary purpose path: initial rejection, followup, receipt bind and native acceptance without composer replay',async t=>{
 const f=await fixture(t),d=f.service,p=await d.putProject({requestId:randomUUID(),name:'initial fixture'});
 for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 const human=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'元目的の未完了部分を継続してください'});await f.submit(human);
 const worker=f.agents[2];worker.initialInput={shellTabId:worker.tabId,sessionName:worker.sessionName};
 const pmux=d.pmux.bind(d),launches=[],evidence=new Map();let reject=true;
 d.pmux=async(a,...args)=>{
  if(a.id!==worker.id)return pmux(a,...args);
  if(args[1]==='list')return {tabs:[{tabId:worker.initialInput?.shellTabId||'tab2',sessionName:'pane2'}]};
  if(args[1]==='initial-launch'){
   const x=JSON.parse(args[2]);launches.push(x);
   evidence.set(x.operationId,{...x,bodyHash:hash(x.body),state:reject?'failed-before-launch':'started',receipt:reject?null:{workspaceId:a.workspaceId,tabId:x.tabId,sessionName:'initial-pane'},processMatches:!reject,stages:reject?{rejected:{stage:'contract'}}:{}});
   return evidence.get(x.operationId);
  }
  if(args[1]==='initial-status')return evidence.get(args[2]);
  return pmux(a,...args);
 };
 const q=await d.conversations.job({conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),instruction:'local artifact',authorization:{runId:human.id,quote:human.instruction}});
 await d.tick();await d.tick();const old=d.flow.run(q.runId);
 assert.equal(runState(old),'failed');assert.equal(old.runModel.state.reason,'prelaunch-rejected');assert.equal(launches.length,1);assert.equal(worker.tabId,'tab2');
 reject=false;
 const next=await d.conversations.followup({conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),purposeId:q.humanRequestId,instruction:'契約修正後、未完了分を継続'});
 await d.tick();await d.tick();const r=d.flow.run(next.runId),launch=launches[1];
 assert.equal(launches.length,2);assert.equal(launch.owner.previousOperationId,old.id);assert.equal(worker.tabId,launch.tabId);assert.equal(worker.initialInput,undefined);
 assert.equal(f.sent.filter(x=>x.agentId===worker.id).length,0);
 const native=f.runtimes.get(worker.id),turnId=randomUUID();native.cursor=10;native.inputs.push({id:'native-one',turnId,hash:hash(launch.body),text:launch.body,offset:10,explicitTurn:true,source:'response'});native.turns.push({id:turnId,state:'running',output:''});
 await d.tick();assert.equal(runState(r),'running');assert.equal(r.runModel.facts.filter(f=>f.type==='input').length,1);
 await f.complete(r);assert.equal(runState(r),'completed');assert.equal(old.runModel.state.reason,'prelaunch-rejected');
 await d.tick();assert.equal(launches.length,2);
});
test('ordinary pre-dispatch contract refusal repairs only an unused owned shell, then follows up',async t=>{
 const f=await fixture(t),d=f.service,p=await d.putProject({requestId:randomUUID(),name:'contract repair fixture'});
 for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 const human=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'元目的を進めて'});await f.submit(human);
 const a=f.agents[2];a.initialInput={shellTabId:a.tabId,sessionName:a.sessionName};
 const pmux=d.pmux.bind(d);d.pmux=async(agent,...args)=>agent.id===a.id&&args[1]==='list'?{tabs:[{tabId:a.tabId,sessionName:a.sessionName}]}:pmux(agent,...args);
 f.promptState('changed');
 const job=await d.conversations.job({conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),instruction:'無害な成果',authorization:{runId:human.id,quote:human.instruction}});
 await d.tick();const old=d.flow.run(job.runId);
 assert.equal(runState(old),'terminated');assert.equal(old.runModel.facts.at(-1).type,'dispatch-blocked');assert.equal(f.sent.filter(x=>x.agentId===a.id).length,0);
 const execute=d.execute.bind(d);
 const {installInstructionsScript}=await import('../server/input-envelope.mjs');
 const home=await mkdtemp(join(tmpdir(),'initial-repair-real-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.purplemux/workspaces',a.workspaceId);await mkdir(root,{recursive:true});const prompt=join(root,'codex-prompt.md');
 await writeFile(prompt,'# purplemux context\n<ai-village-instructions version="2">damaged</ai-village-instructions>');
 d.execute=async(agent,args)=>agent.id===a.id&&args[2]===installInstructionsScript?execFileSync(args[0],args.slice(1),{env:{...process.env,HOME:home},encoding:'utf8'}):execute(agent,args);
 const input={operationId:randomUUID(),revision:a.metadataRevision||0};
 const {continuationStatus}=await import('../server/purpose-continuation.mjs');
 assert.equal(continuationStatus(old,{agent:a,agentId:a.id}).next.operation,'agents prepare-runtime');
 const normalPmux=d.pmux;
 d.pmux=async(agent,...args)=>agent.id===a.id&&args[1]==='list'?{tabs:[{tabId:a.tabId,sessionName:a.sessionName},{tabId:'foreign',panelType:'codex-cli'}]}:normalPmux(agent,...args);
 let installed=0;const installer=d.execute;d.execute=(...args)=>{installed++;return installer(...args);};
 await assert.rejects(d.prepareRuntime(a.id,input),/未実施/);assert.equal(installed,0);
 d.pmux=normalPmux;d.execute=installer;
 const repaired=await d.prepareRuntime(a.id,input);assert.equal(repaired.state,'initial-ready');assert(!(await readFile(prompt,'utf8')).includes('damaged'));
 assert.deepEqual(await d.prepareRuntime(a.id,input),repaired);f.promptState('intact');
 const next=await d.conversations.followup({conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),purposeId:job.humanRequestId,instruction:'契約修復済み、元の未完了分だけ継続'});
 assert.equal(next.previousRunId,old.id);assert.equal(f.sent.filter(x=>x.agentId===a.id).length,0);
 // A receipt-less attempted launch cannot use the repair path.
 const r=d.flow.run(next.runId);a.initialInput.runId=r.id;r.initialLaunch={operationId:r.id,workspaceId:a.workspaceId,tabId:'tab-relay-'+r.id,runId:r.id,contractHash:a.inputEnvelope.hash};r.inputCorrelation={digest:'fixture'};
 const prior=d.pmux;d.pmux=async(agent,...args)=>args[1]==='initial-status'?{...r.initialLaunch,bodyHash:'fixture',state:'unknown',receipt:null,stages:{'runtime-intent':{}}}:prior(agent,...args);
 await assert.rejects(d.prepareRuntime(a.id,{operationId:randomUUID(),revision:a.metadataRevision}),/未実施/);
});

test('create resolves initial shell from actual CLI list DTO, never from workspace receipt',async t=>{
 const f=await fixture(t),d=f.service,w={id:randomUUID(),name:'local',connectionType:'local',workplaces:['/tmp'],baseUrl:'http://localhost:8022'};d.data.workshops.push(w);
 let creates=0;d.installInstructions=async a=>{a.inputEnvelope={mode:'startup-v2',hash:'fixture'};};
 d.pmux=async(a,...args)=>{
  if(args[0]==='workspace'){creates++;return {id:'ws-live',initialTab:{tabId:'tab-shell'}};}
  if(args[1]==='capabilities')return {initialCodexLaunch:{ownedInput:1,client:1}};
  if(args[1]==='list')return {tabs:[{tabId:'tab-shell',workspaceId:'ws-live',sessionName:'pt-live-shell',agentProviderId:null,agentSessionId:null}]};
  throw Error('unexpected model spawn');
 };
 const a=await d.create({requestId:randomUUID(),workshopId:w.id,cwd:w.workplaces[0],name:'real DTO',provider:'codex',location:'workshop'});
 assert.equal(creates,1);assert.equal(a.error,undefined);assert.equal(a.tabId,'tab-shell');assert.deepEqual(a.initialInput,{shellTabId:'tab-shell',sessionName:'pt-live-shell'});
 const {initialInputObservation}=await import('../server/initial-input.mjs');
 d.pmux=async()=>({tabs:[{tabId:'tab-shell',sessionName:'pt-live-shell'},{tabId:'model',agentProviderId:'codex'}]});
 assert.equal((await initialInputObservation(d,a)).snapshot.initialInputReady,false);
});
