import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fixture} from './inbox-fixture.js';
import {verifyAbsentProcessesScript} from '../server/processes.mjs';
import {installInstructionsScript} from '../server/input-envelope.mjs';
import {stoppedRuntimeEvidence} from '../src/stopped-runtime.js';
async function setup(t,terminal){
 const f=await fixture(t),s=f.service,a=f.agents[0];
 a.cwd='/fixture';s.data.workshops.push({id:a.workshopId,...a.connection,baseUrl:'http://localhost:9999',workplaces:[a.cwd]});
 if(!terminal)a.inputEnvelope={mode:'legacy'};
 const queued=await s.send(a.id,{instruction:'Keep this work',requestId:randomUUID()});
 if(terminal){await f.submit(queued);if(terminal==='completed')await s.flow.finish({humanRequestId:queued.humanRequestId,workId:queued.workId,runId:queued.id,operationId:randomUUID(),inputs:s.flow.inputs(queued.humanRequestId,queued.workId).filter(i=>!i.handledBy&&i.attempts.includes(queued.id)).map(i=>i.id),results:[]});await f.complete(queued,terminal);}
 Object.assign(a,{terminatedAt:'2026-11-10T00:00:00Z',ownedProcesses:[{pid:2147483647,start:'1'}],processVerification:{remainingOwned:0,trackedProcesses:1}});
 a.nativeTurns=[{id:'archived',sessionId:'old-session',state:'interrupted',output:'Keep partial work'}];
 a.agentModel={...a.agentModel,intent:'stop',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}};
 const dir=mkdtempSync(join(tmpdir(),'same-agent-installer-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const promptDir=join(dir,'.purplemux/workspaces/ws-candidate');mkdirSync(promptDir,{recursive:true});writeFileSync(join(promptDir,'codex-prompt.md'),'# purplemux context\nDedicated shell\n');
 const calls=[];
 s.pmux=async(agent,...args)=>{
  calls.push(args);
  if(args[1]==='capabilities')return {initialCodexLaunch:{ownedInput:1,client:1}};
  if(args[1]==='create')return {id:'ws-candidate',initialTab:{tabId:'shell-candidate'}};
  if(args[1]==='list')return {tabs:agent.workspaceId==='ws-candidate'?[{workspaceId:'ws-candidate',tabId:'shell-candidate',sessionName:'candidate-shell'}]:[]};
  throw Error('unexpected pmux');
 };
 s.execute=async(agent,args)=>{
  if(args[2]===verifyAbsentProcessesScript)return execFileSync('python3',args.slice(1),{encoding:'utf8'});
  if(args[2]===installInstructionsScript)return execFileSync('python3',['-c','from pathlib import Path\nPath.home=classmethod(lambda cls: Path('+JSON.stringify(dir)+'))\n'+args[2],...args.slice(3)],{encoding:'utf8'});
  throw Error('unexpected execute');
 };
 return {...f,s,a,queued,calls,dir,x:{operationId:randomUUID(),revision:a.metadataRevision||0,handover:'Keep existing Web and completed work. Inspect effects before continuing.'}};
}
test('same Agent replacement uses real installer, archives old runtime and preserves work; retry creates nothing',async t=>{
 const {s,a,x,queued,calls,dir,restart}=await setup(t),history=JSON.stringify(s.data.requests),count=s.data.agents.length;
 const receipt=await s.adoptRuntime(a.id,x);
 assert.equal(receipt.agentId,a.id);assert.equal(a.workspaceId,'ws-candidate');assert.equal(a.initialInput.shellTabId,'shell-candidate');assert.equal(a.inputEnvelope.mode,'startup-v2');
 assert.equal(a.agentModel.intent,'start');assert.equal(a.terminatedAt,undefined);assert.equal(receipt.oldRuntime.nativeTurns[0].output,'Keep partial work');
 assert.equal(JSON.stringify(s.data.requests),history);assert.equal(s.data.agents.length,count);assert.equal(queued.runModel.state.kind,'queued');
 assert.match(readFileSync(join(dir,'.purplemux/workspaces/ws-candidate/codex-prompt.md'),'utf8'),/ai-village-instructions/);
 const re=await restart();assert.deepEqual(await re.adoptRuntime(a.id,x),receipt);assert.equal(calls.filter(c=>c[1]==='create').length,1);
});
for(const failure of ['intent','records','remaining','unconfirmed','running','remote','tab','changed proof'])test('same Agent preparation refuses '+failure+' before creation',async t=>{
 const {s,a,x,queued,calls}=await setup(t),old=a.workspaceId;
 if(failure==='intent')a.agentModel.intent=null;
 if(failure==='records')a.ownedProcesses=[];
 if(failure==='remaining')a.processVerification.remainingOwned=1;
 if(failure==='unconfirmed')queued.runModel={...queued.runModel,state:{kind:'ended',outcome:'unconfirmed',reason:'timeout'}};
 if(failure==='running')queued.runModel={...queued.runModel,state:{kind:'running'}};
 if(failure==='remote')a.connection.connectionType='ssh';
 const pmux=s.pmux;s.pmux=async(agent,...args)=>{const r=await pmux(agent,...args);if(args[1]==='list'){if(failure==='tab')r.tabs=[{tabId:a.tabId}];if(failure==='changed proof')a.processVerification.remainingOwned=1;}return r;};
 await assert.rejects(s.adoptRuntime(a.id,x));assert.equal(a.workspaceId,old);assert.equal(calls.filter(c=>c[1]==='create').length,0);
});
for(const failure of ['lost create response','contract failure','provider shell','late old tab'])test('unknown candidate does not re-create: '+failure,async t=>{
 const {s,a,x,calls}=await setup(t),old=a.workspaceId,pmux=s.pmux;let oldReads=0;
 s.pmux=async(agent,...args)=>{const r=await pmux(agent,...args);if(args[1]==='create'&&failure==='lost create response')throw Error('response lost');if(args[1]==='list'&&agent.workspaceId==='ws-candidate'&&failure==='provider shell')r.tabs[0].agentProviderId='codex';if(args[1]==='list'&&agent===a&&++oldReads===4&&failure==='late old tab')r.tabs=[{tabId:a.tabId}];return r;};
 if(failure==='contract failure'){const execute=s.execute;s.execute=async(agent,args)=>args[2]===installInstructionsScript?'{}':execute(agent,args);}
 const result=await s.adoptRuntime(a.id,x);assert.equal(result.state,'unknown');assert.equal(a.workspaceId,old);assert.deepEqual(await s.adoptRuntime(a.id,x),result);assert.equal(calls.filter(c=>c[1]==='create').length,1);
 await assert.rejects(s.adoptRuntime(a.id,{...x,operationId:randomUUID()}));
});
test('read-only process checker refuses real existing PID even with reused start; absent PID succeeds',()=>{
 const run=records=>execFileSync('python3',['-c',verifyAbsentProcessesScript,JSON.stringify(records)],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const stat=readFileSync('/proc/'+process.pid+'/stat','utf8'),start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
 assert.throws(()=>run([{pid:process.pid,start}]));assert.throws(()=>run([{pid:process.pid,start:'0'}]));
 assert.throws(()=>execFileSync('python3',['-c',"import builtins\ndef denied(*a,**k):raise PermissionError('denied')\nbuiltins.open=denied\n"+verifyAbsentProcessesScript,JSON.stringify([{pid:123,start:'1'}])],{stdio:'pipe'}));assert.equal(JSON.parse(run([{pid:2147483647,start:'1'}])).absent,true);
 assert.throws(()=>run([{pid:process.pid}]));assert.equal(stoppedRuntimeEvidence({}),false);
});


for(const outcome of ['completed','interrupted','failed'])test('replacement then ordinary continuation preserves the work: '+outcome,async t=>{
 const {s,a,x,queued}=await setup(t,outcome),q=s.flow.root(queued.humanRequestId);
 const before=await s.adoptRuntime(a.id,x);assert.equal(before.agentId,a.id);assert.equal(before.closedExecutions.length,1);
 const next=await s.flow.continue({humanRequestId:q.id,workId:queued.workId,revision:q.revision,operationId:randomUUID(),instruction:'Inspect existing effects and continue only the remaining work'},outcome!=='completed');
 assert.equal(next.workId,queued.workId);assert.equal(next.agentId,a.id);assert.equal(next.runModel.retryOf,queued.id);
});
