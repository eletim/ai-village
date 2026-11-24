import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';import {verifyAbsentProcessesScript} from '../server/processes.mjs';
import {retirementIntact,retirementRunAllowed} from '../server/legacy-retirement.mjs';
async function setup(t){
 const f=await fixture(t),s=f.service,[a,b]=f.agents;
 a.cwd='/fixture';s.data.workshops.push({id:a.workshopId,...a.connection,workplaces:[a.cwd]});Object.assign(b,{workshopId:a.workshopId,location:a.location,projectId:a.projectId,cwd:a.cwd,connection:structuredClone(a.connection)});
 const r=await s.send(a.id,{instruction:'Old job; external result not known',requestId:randomUUID()});await f.submit(r);await s.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:[s.flow.inputs(r.humanRequestId,r.workId)[0].id],results:[]});await f.complete(r);
 // Synthetic legacy import: terminal ownership was not proven, keep uncertainty.
 r.runModel.state={kind:'ended',outcome:'unconfirmed',reason:'legacy-superseded'};const w=s.flow.work(s.flow.root(r.humanRequestId),r.workId);w.declarations=[];
 Object.assign(a,{terminatedAt:'2026-11-10T00:00:00Z',ownedProcesses:[{pid:2147483647,start:'1'}],processVerification:{remainingOwned:0,trackedProcesses:1}});a.agentModel={...a.agentModel,intent:'stop',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}};
 const oldWorkspace=a.workspaceId,pmux=s.pmux.bind(s);s.pmux=async(agent,...args)=>agent.workspaceId===oldWorkspace&&args[1]==='list'?{tabs:[]}:pmux(agent,...args);
 const execute=s.execute.bind(s);s.execute=async(agent,args)=>args[2]===verifyAbsentProcessesScript?JSON.stringify({absent:true,checked:1}):execute(agent,args);
 await s.prepareRuntime(a.id,{operationId:randomUUID(),revision:0});
 const x={operationId:randomUUID(),revision:1,replacementRevision:0,replacementAgentId:b.id,handover:'Unknown old effects; do not replay.',retireLegacyHistory:{version:1,mode:'new-work-only',acknowledgement:'Fixture-only: preserve unknown old results; new work only, no replay.'}};
 return {f,s,a,b,r,w,x};
}
test('explicit stopped retirement preserves uncertainty, receipt idempotency, multiple NEW jobs',async t=>{
 const {f,s,a,b,r,x}=await setup(t),before=structuredClone(r),m=await s.adoptRuntime(a.id,x,{human:true});assert(m.legacyRetirement);assert.deepEqual(r,before);assert.deepEqual(await s.adoptRuntime(a.id,x,{human:true}),m);
 for(let i=0;i<2;i++){const n=await s.send(a.id,{instruction:'new job '+i,requestId:randomUUID()});assert(n.dispatchAttemptedAt,JSON.stringify({n,identity:a.runtimeMigrations.at(-1).legacyRetirement.newIdentity,a}));await f.submit(n);await s.flow.finish({humanRequestId:n.humanRequestId,workId:n.workId,runId:n.id,operationId:randomUUID(),inputs:[s.flow.inputs(n.humanRequestId,n.workId)[0].id],results:[]});await f.complete(n);assert(retirementIntact(s.data,a));}
 assert.equal(f.sent.length,3);assert.deepEqual(r,before);assert.equal(b.runtimeRetiredTo,a.id);
});
for(const scenario of ['no-option','not-stopped','not-prepared','queued','running','unknown','pending-input','reservation','declaration','active','bad-option'])test('retirement refuses '+scenario,async t=>{
 const {s,a,r,w,x}=await setup(t);if(scenario==='no-option')delete x.retireLegacyHistory;if(scenario==='not-stopped')a.agentModel.intent=null;if(scenario==='not-prepared')delete a.runtimeUpgrade;if(scenario==='queued'||scenario==='running')r.runModel.state={kind:scenario};if(scenario==='unknown')r.unknownSince='2026-01-01';if(scenario==='pending-input')w.inbox.push({id:randomUUID()});if(scenario==='reservation')w.selfResume={current:{status:'scheduled'}};if(scenario==='declaration')w.declarations=[{runId:r.id}];if(scenario==='active')w.state={kind:'active'};if(scenario==='bad-option')x.retireLegacyHistory.extra=true;
 await assert.rejects(s.adoptRuntime(a.id,x,{human:true}));assert.equal(a.runtimeMigrations,undefined);
});
for(const scenario of ['edit','delete','old-retry','late-result'])test('new runtime holds '+scenario,async t=>{
 const {f,s,a,r,x}=await setup(t);await s.adoptRuntime(a.id,x,{human:true});
 if(scenario==='edit')r.output='tampered';if(scenario==='delete')s.data.runs=s.data.runs.filter(n=>n!==r);
 const n=await s.send(a.id,{instruction:'new input',requestId:randomUUID()});
 if(['edit','delete'].includes(scenario)){assert.equal(n.dispatchAttemptedAt,undefined);assert.equal(n.queuedReason,'legacy-retirement-held');}
 else {const candidate={...n,id:randomUUID(),humanRequestId:r.humanRequestId,workId:r.workId,...(scenario==='late-result'?{conversationId:'example',conversationSource:{kind:'leader',humanRequestId:r.humanRequestId}}:{})};assert.equal(retirementRunAllowed(s.data,a,candidate),false);}
});
test('save failure rollback, same operation recovery, immutable proof conflict',async t=>{
 const {s,a,b,x}=await setup(t),old=a.tabId,save=s.save.bind(s);s.save=async()=>{if(a.runtimeMigrations?.length)throw Error('disk-failure');return save();};await assert.rejects(s.adoptRuntime(a.id,x,{human:true}),/disk-failure/);assert.equal(a.tabId,old);assert.equal(a.runtimeMigrations,undefined);s.save=save;const m=await s.adoptRuntime(a.id,x,{human:true});assert.equal(a.tabId,m.newRuntime.tabId);await assert.rejects(s.adoptRuntime(a.id,{...x,retireLegacyHistory:{...x.retireLegacyHistory,acknowledgement:'different'}},{human:true}),/再利用/);assert.equal(b.runtimeRetiredTo,a.id);
});
test('history changes during final fresh verification refuse swap',async t=>{
 const {s,a,b,r,x}=await setup(t),observe=s.observe.bind(s);let count=0;s.observe=async agent=>{const result=await observe(agent);if(agent===b&&++count===2)r.output='late mutation';return result;};await assert.rejects(s.adoptRuntime(a.id,x,{human:true}),/変化/);assert.equal(a.runtimeMigrations,undefined);
});

test('Agent CLI and direct caller cannot claim human exception authority',async t=>{const {s,a,x}=await setup(t);await assert.rejects(s.adoptRuntime(a.id,x),e=>e.status===403);const {VillageOperations}=await import('../server/operations.mjs');const ops=new VillageOperations({dir:s.dir},null,{direct:s});const r=await ops.execute(['agents','adopt-runtime',a.id,JSON.stringify(x)]);assert.equal(r.ok,false);assert.match(r.error,/人間専用/);assert.equal(a.runtimeMigrations,undefined);});
for(const scenario of ['old-tab','pid-reuse','offline','new-run-race','native-input-race','delete-race','current-session-mixed'])test('strict evidence refuses '+scenario,async t=>{
 const {s,a,b,r,x}=await setup(t),old=a.tabId;
 if(scenario==='old-tab'){const pmux=s.pmux;s.pmux=async(agent,...args)=>agent===a?{tabs:[{tabId:a.tabId}]}:pmux(agent,...args);}
 if(scenario==='pid-reuse'||scenario==='offline'){const ex=s.execute;s.execute=async(agent,args)=>{if(args[2]===verifyAbsentProcessesScript)throw Error(scenario);return ex(agent,args);};}
 if(['new-run-race','delete-race','native-input-race'].includes(scenario)){let n=0;const obs=s.observe.bind(s);s.observe=async agent=>{const snap=await obs(agent);if(agent===b&&++n===2){if(scenario==='new-run-race')s.data.runs.push({...r,id:randomUUID(),runModel:{...r.runModel,state:{kind:'sent'}}});if(scenario==='delete-race')s.data.runs=s.data.runs.filter(v=>v!==r);if(scenario==='native-input-race')snap.inputs.push({id:'unexpected'});}return snap;};}
 if(scenario==='current-session-mixed'){await s.adoptRuntime(a.id,x,{human:true});s.data.runs.push({...structuredClone(r),id:randomUUID(),createdAt:new Date().toISOString()});assert.equal(retirementIntact(s.data,a),false);return;}
 await assert.rejects(s.adoptRuntime(a.id,x,{human:true}));assert.equal(a.tabId,old);assert.equal(a.runtimeMigrations,undefined);
});
test('receipt survives restart and old work diagnostic is retained',async t=>{const {f,s,a,r,x}=await setup(t),m=await s.adoptRuntime(a.id,x,{human:true});const re=await f.restart();assert.deepEqual(await re.adoptRuntime(a.id,x,{human:true}),m);assert.equal(re.instructionStatus(a.id).legacyRetirement.oldRuns[0].id,r.id);assert.equal(retirementIntact(re.data,re.agent(a.id)),false);await re.observe(re.agent(a.id));assert(retirementIntact(re.data,re.agent(a.id))); });
for(const scenario of ['ok','missing-profile','model-mismatch','restart-startup-lost','new-dispatch','new-identity'])test('Claude retired-history fresh gate '+scenario,async t=>{
 const {f,s,a,b,x}=await setup(t),p={version:1,provider:'claude',model:'claude-sonnet-5',effort:'high'},sid=randomUUID();a.provider=b.provider='claude';delete a.launchProfile;b.launchProfile=p;delete b.inputEnvelope.sessionId;delete b.observedSessionId;
 const fresh=f.runtimes.get(b.id);Object.assign(fresh,{sessionId:sid,available:false,unrecorded:true});delete fresh.fileIdentity;delete fresh.cursor;
 const status={alive:true,cliState:'idle',agentProviderId:'claude',agentSessionId:sid,lastEvent:{name:'session-start',at:1,seq:1},launchEvidence:{receipt:{profile:p,workspaceId:b.workspaceId,tabId:b.tabId,sessionName:b.sessionName,sessionId:sid,appliedAt:'2026-01-01T00:00:00Z'},startup:{sessionId:sid,model:p.model,source:'startup',observedAt:'2026-01-01T00:00:00Z'}}};b.runtime=structuredClone(status);b.inputEnvelope.sessionId=sid;delete b.modelInfo;
 const obs=s.observationPmux.bind(s);s.observationPmux=async(agent,...args)=>agent.workspaceId===status.launchEvidence.receipt.workspaceId?structuredClone(status):obs(agent,...args);
 s.runtime=async agent=>structuredClone(f.runtimes.get(agent.workspaceId.replace(/^ws-/,'')));
 if(scenario==='missing-profile')delete b.launchProfile;if(scenario==='model-mismatch')status.launchEvidence.startup.model='claude-opus-5';
 if(['missing-profile','model-mismatch'].includes(scenario)){await assert.rejects(s.adoptRuntime(a.id,x,{human:true}));return;}
 await s.adoptRuntime(a.id,x,{human:true});
 if(scenario==='restart-startup-lost')delete status.lastEvent;if(scenario==='new-identity')status.agentSessionId=randomUUID();if(scenario==='new-dispatch')s.data.runs.push({id:randomUUID(),agentId:a.id,createdAt:new Date().toISOString(),dispatchAttemptedAt:new Date().toISOString(),runModel:{state:{kind:'ended',outcome:'unconfirmed'}}});
 const n=await s.send(a.id,{instruction:'new Claude input',requestId:randomUUID()});assert.equal(!!n.dispatchAttemptedAt,scenario==='ok');assert.equal(a.launchProfile.model,p.model);
});

test('ended but missing transport acknowledgement cannot be retired',async t=>{const {s,a,r,x}=await setup(t);r.runModel.facts=r.runModel.facts.filter(f=>!['transport-ack','input'].includes(f.type));await assert.rejects(s.adoptRuntime(a.id,x,{human:true}),/通信受付不明/);});
test('late old delivery is visible and does not starve second new job',async t=>{
 const {s,a,r,x,f}=await setup(t);await s.adoptRuntime(a.id,x,{human:true});
 const c={id:randomUUID(),agentId:a.id,projectId:null,sequence:0,operations:[],deliveries:[]};s.data.conversations.push(c);const late=s.conversations.enqueue(c,{requestId:randomUUID(),instruction:'delayed historical material',source:{kind:'leader',humanRequestId:r.humanRequestId}});await s.save();
 const fresh=await s.send(a.id,{instruction:'new work after retirement',requestId:randomUUID()});await s.flow.dispatchReady([late,fresh],true);assert.equal(late.dispatchAttemptedAt,undefined);assert.equal(late.queuedReason,'legacy-retirement-held');assert(fresh.dispatchAttemptedAt);assert.equal(f.sent.length,2);assert.equal(s.instructionStatus(a.id).retirementHolds[0].runId,late.id);
});
test('cannot erase retirement hold through another ordinary adoption',async t=>{const {s,a,f,x}=await setup(t);await s.adoptRuntime(a.id,x,{human:true});const b=f.agents[2];await assert.rejects(s.adoptRuntime(a.id,{operationId:randomUUID(),revision:a.metadataRevision,replacementRevision:b.metadataRevision||0,replacementAgentId:b.id,handover:'again'}),/限定退役/);});

test('current runtime must also match the authoritative adopted newRuntime receipt',async t=>{const {s,a,x}=await setup(t);await s.adoptRuntime(a.id,x,{human:true});a.runtimeMigrations[0].newRuntime.tabId='tampered';assert.equal(retirementIntact(s.data,a),false);});
