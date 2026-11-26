import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProfile,launchProfileReady,launchReceiptMatches} from '../server/launch-profile.mjs';
const p={version:1,provider:'claude',model:'claude-opus-5',effort:'high'};
const sid='11111111-1111-4111-8111-111111111111';
const agent=()=>({launchProfile:p,workspaceId:'ws',tabId:'tab',sessionName:'tmux',runtime:{alive:true,agentProviderId:'claude',agentSessionId:sid,launchEvidence:{receipt:{workspaceId:'ws',tabId:'tab',sessionName:'tmux',sessionId:sid,profile:p,appliedAt:new Date().toISOString()},startup:{sessionId:sid,model:p.model,source:'startup',observedAt:new Date().toISOString()}}}});
test('strict profile schema rejects unsupported provider, keys, versions and shell input',()=>{
 assert.equal(launchProfile(undefined,'codex'),undefined);assert.deepEqual(launchProfile(p,'claude'),p);
 for(const bad of [null,{...p,version:2},{...p,extra:1},{...p,model:'opus'},{...p,model:'claude-opus-5;bad'},{...p,effort:'unknown'},{...p,provider:'codex'}])assert.throws(()=>launchProfile(bad,'claude'));
 assert.throws(()=>launchProfile(p,'codex'));
});
test('startup and applied evidence are separate; wrong, absent, old runtime evidence holds',()=>{
 assert.equal(launchProfileReady({}),true);assert.equal(launchProfileReady(agent()),true);
 for(const mutate of [a=>a.modelInfo={available:true,model:'claude-other'},a=>a.modelInfo={available:true,model:p.model,effort:'low'},a=>delete a.runtime.launchEvidence.startup,a=>a.runtime.launchEvidence.startup.model='claude-sonnet-5',a=>a.runtime.launchEvidence.startup.sessionId='other',a=>a.runtime.agentSessionId='other',a=>a.runtime.launchEvidence.receipt.tabId='other',a=>a.runtime.launchEvidence.receipt.appliedAt=null,a=>a.runtime.alive=false,a=>a.runtime.launchEvidence.startup.source='resume']){const a=agent();mutate(a);assert.equal(launchProfileReady(a),false);}
 const a=agent();delete a.runtime.launchEvidence.startup;assert.equal(launchReceiptMatches(a,a.runtime.launchEvidence),true);
 a.runtime.launchEvidence.startup={sessionId:sid,model:p.model,source:'startup',observedAt:new Date().toISOString()};assert.equal(launchProfileReady(a),true);
});
import {DirectAgents} from '../server/direct.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installInstructionsScript} from '../server/input-envelope.mjs';
import {createHash} from 'node:crypto';
test('create payload idempotency, lost reply, old launcher and restart never duplicate profile launch',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'profile-create-'));t.after(()=>rm(dir,{recursive:true,force:true}));let creates=0,workspaces=0,lose=false,cap=true;
 const remote=async args=>{
  if(args[0]==='env')return JSON.stringify({ok:true,clientConnectionVersion:1,result:s.rules.specification('work')});
  if(args[0]==='python3'&&args[2]===installInstructionsScript)return JSON.stringify({installed:true,hash:createHash('sha256').update(args.at(-1)).digest('hex')});
  if(args[1]==='tab'&&args[2]==='capabilities')return JSON.stringify({launchProfile:cap?{version:1,provider:'claude',arguments:true,sessionStart:true}:null});
  if(args[1]==='workspace'){workspaces++;return JSON.stringify({id:'ws',initialTab:{tabId:'initial'}});}
  if(args[1]==='tab'&&args[2]==='create'){creates++;assert.deepEqual(JSON.parse(args.at(-1)),p);if(lose)throw Error('lost response');return JSON.stringify({tabId:'tab',sessionName:'tmux',launchEvidence:agent().runtime.launchEvidence});}
  throw Error('unexpected operation');
 };
 const options={dir,remote};let s=new DirectAgents(options);await s.init({watch:false});t.after(()=>s.close());const w=await s.putWorkshop({name:'fixture',villageConnection:{url:'http://100.64.0.2:15680',cliPath:'/fixture/scripts/village.mjs'},sshHost:'test',baseUrl:'http://test',workplaces:['/tmp']});
 const input={workshopId:w.id,cwd:'/tmp',requestId:'profile-create-test',provider:'claude',launchProfile:p};
 cap=false;await assert.rejects(s.create(input),/サポート/);assert.equal(workspaces,0);cap=true;
 const [a,b]=await Promise.all([s.create(input),s.create(input)]);assert.equal(a.id,b.id);assert.equal(creates,1);assert.equal(launchReceiptMatches(a,a.launchEvidence),true);
 await assert.rejects(s.create({...input,launchProfile:{...p,effort:'low'}}),/再利用/);
 s.close();s=new DirectAgents(options);await s.init({watch:false});assert.equal((await s.create(input)).id,a.id);assert.equal(creates,1);
 lose=true;const unknown=await s.create({...input,requestId:'profile-lost-reply'});assert.match(unknown.error,/不明/);await s.create({...input,requestId:'profile-lost-reply'});assert.equal(creates,2);
});
import {fixture} from './inbox-fixture.js';
import {randomUUID} from 'node:crypto';
test('adoption keeps queued/history and profile; mismatch refuses; save rollback and receipt retry preserve identity',async t=>{
 const f=await fixture(t),s=f.service,[a,b]=f.agents;
 a.cwd='/fixture';s.data.workshops.push({id:a.workshopId,...a.connection,workplaces:[a.cwd]});Object.assign(b,{workshopId:a.workshopId,location:a.location,projectId:a.projectId,cwd:a.cwd,connection:structuredClone(a.connection),provider:a.provider='claude',launchProfile:p});
 const real=s.observe.bind(s);let valid=false;
 s.observe=async x=>{const snapshot=await real(x);if(x.id===b.id){const receipt={profile:p,workspaceId:b.workspaceId,tabId:b.tabId,sessionName:b.sessionName,sessionId:sid,appliedAt:new Date().toISOString()};x.runtime={...x.runtime,alive:true,agentProviderId:'claude',agentSessionId:sid,launchEvidence:{receipt,startup:valid?{model:p.model,sessionId:sid,source:'startup',observedAt:new Date().toISOString()}:null}};}return snapshot;};
 a.runtimeUpgrade={state:'prepared'};
 const r=await s.send(a.id,{instruction:'queued unchanged',requestId:randomUUID()});const x={operationId:randomUUID(),revision:0,replacementRevision:0,replacementAgentId:b.id};
 await assert.rejects(s.adoptRuntime(a.id,x),/launchProfile/);valid=true;
 const save=s.save.bind(s);s.save=async()=>{if(a.runtimeMigrations?.length)throw Error('profile save failure');await save();};
 await assert.rejects(s.adoptRuntime(a.id,x),/profile save failure/);assert.equal(a.launchProfile,undefined);assert.deepEqual(b.launchProfile,p);s.save=save;
 const receipt=await s.adoptRuntime(a.id,x);assert.deepEqual(a.launchProfile,p);assert.equal(s.flow.run(r.id).agentId,a.id);assert.equal(f.sent.length,0);assert.deepEqual(await s.adoptRuntime(a.id,x),receipt);
});
test('dispatch holds missing profile observation and releases only a fresh matching observation',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0],observe=s.observe.bind(s);a.launchProfile=p;let valid=false;
 s.observe=async x=>{const snap=await observe(x);if(valid&&x.id===a.id)x.runtime={...x.runtime,alive:true,agentProviderId:'claude',agentSessionId:sid,launchEvidence:{receipt:{profile:p,workspaceId:a.workspaceId,tabId:a.tabId,sessionName:a.sessionName,sessionId:sid,appliedAt:new Date().toISOString()},startup:{sessionId:sid,model:p.model,source:'startup',observedAt:new Date().toISOString()}}};return snap;};
 const r=await s.send(a.id,{instruction:'send once only',requestId:randomUUID()});await s.attemptRun(r);assert.equal(f.sent.length,0);assert.equal(r.queuedReason,'launch-profile-unverified');valid=true;await s.attemptRun(r);assert.equal(f.sent.length,1);await s.attemptRun(r);assert.equal(f.sent.length,1);
});
