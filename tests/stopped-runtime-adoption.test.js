import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fixture} from './inbox-fixture.js';
import {verifyAbsentProcessesScript} from '../server/processes.mjs';
import {stoppedRuntimeEvidence} from '../src/stopped-runtime.js';
async function setup(t){
 const f=await fixture(t),s=f.service,[a,b]=f.agents;
 a.cwd='/fixture';s.data.workshops.push({id:a.workshopId,...a.connection,workplaces:[a.cwd]});
 Object.assign(b,{workshopId:a.workshopId,location:a.location,projectId:a.projectId,cwd:a.cwd,connection:structuredClone(a.connection)});
 a.inputEnvelope={mode:'legacy'};
 const queued=await s.send(a.id,{instruction:'Keep this work',requestId:randomUUID()});
 Object.assign(a,{terminatedAt:'2026-11-10T00:00:00Z',ownedProcesses:[{pid:2147483647,start:'1'}],processVerification:{remainingOwned:0,trackedProcesses:1}});
 a.nativeTurns=[{id:'archived',sessionId:'old-session',state:'interrupted',output:'Keep partial work'}];
 a.agentModel={...a.agentModel,intent:'stop',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}};
 const execute=s.execute.bind(s),calls=[];
 const pmux=s.pmux.bind(s);s.pmux=async(agent,...args)=>agent===a?{tabs:[]}:pmux(agent,...args);
 s.execute=async(agent,args)=>{if(args[2]===verifyAbsentProcessesScript){calls.push(args);return JSON.stringify({absent:true,checked:1});}return execute(agent,args);};
 const x={operationId:randomUUID(),revision:a.metadataRevision||0,replacementRevision:b.metadataRevision||0,replacementAgentId:b.id,handover:'Preserve finished operations and queued work. Unknown effects require inspection.'};
 return {...f,s,a,b,x,queued,calls};
}
test('stopped adoption preserves queued/history and evidence, adopts fresh idle, retries receipt after restart',async t=>{
 const {s,a,b,x,queued,calls,restart}=await setup(t),oldTab=a.tabId,newTab=b.tabId,history=JSON.stringify(s.data.requests);
 const receipt=await s.adoptRuntime(a.id,x);
 assert.equal(a.tabId,newTab);assert.equal(a.agentModel.intent,null);assert.equal(a.agentModel.observation.activity,'idle');assert.equal(a.terminatedAt,undefined);
 assert.equal(b.tabId,oldTab);assert.equal(b.agentModel.intent,'stop');assert.equal(b.agentModel.observation.process,'absent');assert.equal(b.processVerification.remainingOwned,0);
 assert.equal(a.nativeTurns.find(t=>t.id==='archived').output,'Keep partial work');assert.equal(JSON.stringify(s.data.requests),history);assert.equal(s.flow.run(queued.id).runModel.state.kind,'queued');assert.equal(receipt.stoppedVerification.checked,1);assert.equal(calls.length,1);
 const re=await restart();assert.deepEqual(await re.adoptRuntime(a.id,x),receipt);
});
for(const failure of ['intent','timestamp','records','start','remaining','count','extra count','unknown observation','tab','tab response','transport','process','pid reused','invalid response','unconfirmed','sent','running','donor busy','donor used','donor contract'])test('refuse stopped adoption: '+failure,async t=>{
 const {s,a,b,x,queued}=await setup(t),old=a.tabId;
 if(failure==='intent')a.agentModel.intent=null;
 if(failure==='timestamp')delete a.terminatedAt;
 if(failure==='records')a.ownedProcesses=[];
 if(failure==='start')delete a.ownedProcesses[0].start;
 if(failure==='remaining')a.processVerification.remainingOwned=1;
 if(failure==='count')delete a.processVerification.trackedProcesses;
 if(failure==='extra count')a.processVerification.trackedProcesses=2;
 if(failure==='unknown observation')a.agentModel.observation.connected=false;
 if(failure==='tab'){const pmux=s.pmux;s.pmux=async(agent,...args)=>agent===a?{tabs:[{tabId:a.tabId}]}:pmux(agent,...args);}
 if(failure==='tab response'){const pmux=s.pmux;s.pmux=async(agent,...args)=>agent===a?{}:pmux(agent,...args);}
 if(failure==='transport'){const pmux=s.pmux;s.pmux=async(agent,...args)=>{if(agent===a)throw Error('offline');return pmux(agent,...args);};}
 if(['process','pid reused','invalid response'].includes(failure)){const execute=s.execute.bind(s);s.execute=async(agent,args)=>{if(args[2]===verifyAbsentProcessesScript){if(failure==='invalid response')return '{}';throw Error(failure);}return execute(agent,args);};}
 if(failure==='unconfirmed')queued.runModel={...queued.runModel,state:{kind:'ended',outcome:'unconfirmed',reason:'timeout'}};
 if(failure==='sent'||failure==='running')queued.runModel={...queued.runModel,state:{kind:failure}};
 if(failure==='donor busy'){const observe=s.observe.bind(s);s.observe=async agent=>{const snap=await observe(agent);if(agent===b)b.agentModel.observation.activity='running';return snap;};}
 if(failure==='donor used')s.data.runs.push({...queued,id:randomUUID(),agentId:b.id});
 if(failure==='donor contract')b.inputEnvelope={mode:'legacy'};
 await assert.rejects(s.adoptRuntime(a.id,x));assert.equal(a.tabId,old);assert.equal(a.runtimeMigrations,undefined);
});
test('stop evidence mutation during fresh check rejects, save failure rolls back and same operation succeeds',async t=>{
 const f=await setup(t),{s,a,b,x}=f,pmux=s.pmux;
 s.pmux=async(agent,...args)=>{if(agent===a){a.processVerification.remainingOwned=1;return {tabs:[]};}return pmux(agent,...args);};await assert.rejects(s.adoptRuntime(a.id,x),/変更/);a.processVerification.remainingOwned=0;s.pmux=pmux;
 const old=a.tabId,newTab=b.tabId,save=s.save.bind(s);s.save=async()=>{if(a.runtimeMigrations?.length)throw Error('disk-failure');return save();};
 await assert.rejects(s.adoptRuntime(a.id,x),/disk-failure/);assert.equal(a.tabId,old);assert.equal(b.tabId,newTab);assert.equal(a.agentModel.intent,'stop');assert.equal(b.agentModel.intent,null);
 s.save=save;await s.adoptRuntime(a.id,x);assert.equal(a.tabId,newTab);
});
test('read-only process checker refuses real existing PID even with reused start; absent PID succeeds',()=>{
 const run=records=>execFileSync('python3',['-c',verifyAbsentProcessesScript,JSON.stringify(records)],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const stat=readFileSync('/proc/'+process.pid+'/stat','utf8'),start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
 assert.throws(()=>run([{pid:process.pid,start}]));assert.throws(()=>run([{pid:process.pid,start:'0'}]));
 assert.throws(()=>execFileSync('python3',['-c',"import builtins\ndef denied(*a,**k):raise PermissionError('denied')\nbuiltins.open=denied\n"+verifyAbsentProcessesScript,JSON.stringify([{pid:123,start:'1'}])],{stdio:'pipe'}));assert.equal(JSON.parse(run([{pid:2147483647,start:'1'}])).absent,true);
 assert.throws(()=>run([{pid:process.pid}]));assert.equal(stoppedRuntimeEvidence({}),false);
});

test('SSH stopped target uses read-only checks and rejects tab recreated during process observation',async t=>{
 const {s,a,b,x}=await setup(t),w=s.data.workshops[0];
 for(const c of [a.connection,b.connection,w])Object.assign(c,{connectionType:'ssh',sshHost:'fixture@remote'});
 const execute=s.execute.bind(s);let recreated=false;
 const pmux=s.pmux;s.pmux=async(agent,...args)=>agent===a?{tabs:recreated?[{tabId:a.tabId}]:[]}:pmux(agent,...args);
 s.execute=async(agent,args)=>{const result=await execute(agent,args);if(args[2]===verifyAbsentProcessesScript)recreated=true;return result;};
 await assert.rejects(s.adoptRuntime(a.id,x),/旧tab/);assert.equal(a.runtimeMigrations,undefined);
 recreated=false;s.execute=execute;await s.adoptRuntime(a.id,x);assert.equal(a.agentModel.observation.activity,'idle');
});
