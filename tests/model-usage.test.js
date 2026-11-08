import test from 'node:test';
import assert from 'node:assert/strict';
import {WeeklyUsage,normalizeWeekly} from '../server/weekly-usage.mjs';
import {sessionModel} from '../server/session-model.mjs';
import {modelFields} from '../src/model-usage.js';
import {runtimeScript} from '../server/runtime-events.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
test('weekly provider windows stay separate; unknown, stale and expired are not zero',async()=>{
 const now=1800000000000,cache={token:'SECRET',codex:{ts:now/1000,seven_day:{used_percentage:27.5,resets_at:now/1000+3600},secret:'SECRET'},claude:{ts:now/1000-1000,seven_day:{used_percentage:80,resets_at:now/1000-1}}};
 const v=normalizeWeekly(cache,now);assert.equal(v.codex.usedPercent,27.5);assert.equal(v.claude.usedPercent,80);assert.equal(v.claude.stale,true);assert.equal(v.codex.stale,false);assert(!JSON.stringify(v).includes('SECRET'));
 for(const bad of [null,{}, {codex:{...cache.codex,ts:now/1000+10000}}, {codex:{...cache.codex,seven_day:{used_percentage:-1,resets_at:1}}}])assert.equal(normalizeWeekly(bad,now).codex.available,false);
 let clock=now,reads=0,broken=false;const usage=new WeeklyUsage({clock:()=>clock,read:async()=>{reads++;if(broken)throw Error('private secret failure');return JSON.stringify(cache);}});
 const [a,b]=await Promise.all([usage.get(),usage.get()]);assert.deepEqual(a,b);assert.equal(reads,1);await usage.get();assert.equal(reads,1);clock+=61000;broken=true;const unknown=await usage.get();assert.equal(unknown.providers.codex.available,false);assert(!JSON.stringify(unknown).includes('secret'));assert.equal(reads,2);
});
test('session identity and availability gate model; credentials/unrelated fields never leak',()=>{
 const snapshot={available:true,sessionId:'s',modelInfo:{model:'gpt-fixture',serviceTier:'priority',recordedAt:'2026-11-08T10:00:00Z',token:'SECRET'}},status={alive:true,agentSessionId:'s'};
 const m=sessionModel(snapshot,status);assert.equal(m.model,'gpt-fixture');assert.equal(m.serviceTier,'priority');assert(!JSON.stringify(m).includes('SECRET'));
 for(const s of [{...snapshot,sessionId:'other'},{...snapshot,available:false},{...snapshot,incompleteTail:true}])assert.equal(sessionModel(s,status).available,false);
 assert.equal(sessionModel(snapshot,{...status,alive:false}).available,false);assert.equal(sessionModel({...snapshot,modelInfo:{}},status).available,false);
 assert.match(modelFields({modelInfo:{available:true,model:'gpt',serviceTier:null}})[1][1],/不明/);
});
test('native Codex context and Claude message record actual model and speed without config inference',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'model-native-'));t.after(()=>rm(dir,{recursive:true,force:true}));const sid='11111111-2222-3333-4444-555555555555';await mkdir(join(dir,'sessions'));await mkdir(join(dir,'.claude/projects/test'),{recursive:true});
 const file=join(dir,'sessions',sid+'.jsonl');await writeFile(file,[{type:'turn_context',timestamp:'2026-11-08T10:00:00Z',payload:{model:'gpt-test',service_tier:'priority',token:'SECRET'}},{type:'turn_context',timestamp:'2026-11-08T10:01:00Z',payload:{model:'gpt-other'}}].map(JSON.stringify).join('\n')+'\n');
 const read=provider=>JSON.parse(execFileSync('python3',['-c',runtimeScript,provider,sid],{env:{...process.env,CODEX_HOME:dir,HOME:dir}}));let s=read('codex');assert.equal(s.modelInfo.model,'gpt-other');assert.equal(s.modelInfo.serviceTier,null);assert(!JSON.stringify(s.modelInfo).includes('SECRET'));
 await writeFile(join(dir,'.claude/projects/test',sid+'.jsonl'),[{type:'user',uuid:'u',message:{content:'hello'}},{type:'assistant',uuid:'a',parentUuid:'u',timestamp:'2026-11-08T10:02:00Z',message:{model:'claude-test',usage:{speed:'fast'},content:[]}}].map(JSON.stringify).join('\n')+'\n');s=read('claude');assert.equal(s.modelInfo.model,'claude-test');assert.equal(s.modelInfo.serviceTier,'fast');
});
test('Direct model observation follows each registered local/SSH target and clears unavailable current session',async t=>{
 const {DirectAgents}=await import('../server/direct.mjs');const dir=await mkdtemp(join(tmpdir(),'model-routing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[];let mismatch=false,offline=false;
 const execute=(kind,args)=>{calls.push(kind);if(offline)throw Error('private error');return JSON.stringify(args[0]==='python3'?{available:true,sessionId:mismatch?'wrong':'s-'+kind,modelInfo:{model:'model-'+kind,serviceTier:kind==='remote'?'fast':null},turns:[],inputs:[],cursor:0}:{alive:true,cliState:'idle',agentSessionId:'s-'+kind});};
 const d=new DirectAgents({dir,localRun:(bin,args)=>execute('local',[bin,...args]),remote:(args,host)=>{assert.equal(host,'registered-ssh');return execute('remote',args);}});await d.init({watch:false});t.after(()=>d.close());
 const local={id:'local',state:'idle',provider:'codex',tabId:'tab-local',workspaceId:'ws-local',connection:{connectionType:'local'}},remote={id:'remote',state:'idle',provider:'claude',tabId:'tab-remote',workspaceId:'ws-remote',connection:{connectionType:'ssh',sshHost:'registered-ssh'}};d.data.agents=[local,remote];
 await d.observe(local);await d.observe(remote);assert.equal(local.modelInfo.model,'model-local');assert.equal(remote.modelInfo.model,'model-remote');assert.equal(remote.modelInfo.serviceTier,'fast');assert.deepEqual(calls,['local','local','remote','remote']);
 mismatch=true;await d.observe(remote);assert.equal(remote.modelInfo.available,false);assert.equal(local.modelInfo.available,true);offline=true;await d.observe(local);assert.equal(local.modelInfo.available,false);
});
