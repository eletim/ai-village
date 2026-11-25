// Startup-contract evidence when PurpleMux regenerates a workspace prompt file (2026-11-25 incident).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyInstructionsScript} from '../server/input-envelope.mjs';
import {fixture} from './inbox-fixture.js';

const block=(n=1)=>`<ai-village-instructions version="2">\n村の固定起動契約 ${n}\n</ai-village-instructions>`;
const hash=s=>createHash('sha256').update(s).digest('hex');
const base='# purplemux context\n\nYou are running inside a purplemux workspace tab.\n';
async function host(t,{file,process:arg,provider='codex',tmux=true}){
 const home=await mkdtemp(join(tmpdir(),'contract-evidence-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const ws='ws-Test_1',dir=join(home,'.purplemux','workspaces',ws);await mkdir(dir,{recursive:true});
 const prompt=join(dir,provider+'-prompt.md');await writeFile(prompt,file);
 // The pane process of the Agent's tab, launched as the Codex launcher does.
 const pane=spawn(process.execPath,['-e','setTimeout(()=>{},60000)',...(arg===undefined?[]:['developer_instructions='+JSON.stringify(arg)])],{stdio:'ignore'});
 t.after(()=>pane.kill());await new Promise(r=>setTimeout(r,100));
 const bin=join(home,'bin');await mkdir(bin);
 await writeFile(join(bin,'tmux'),tmux?`#!/bin/sh\necho ${pane.pid}\n`:'#!/bin/sh\nexit 1\n');await chmod(join(bin,'tmux'),0o700);
 const run=(expected,...extra)=>JSON.parse(execFileSync('python3',['-c',verifyInstructionsScript,ws,provider,expected,...extra],{env:{...process.env,HOME:home,PATH:bin+':'+process.env.PATH}}).toString());
 return {run,prompt,pane};
}

test('the workspace prompt file is still the primary evidence',async t=>{
 const {run}=await host(t,{file:base+'\n\n'+block()});
 assert.deepEqual(run(hash(block())),{verified:true,evidence:{kind:'workspace-prompt'}});
 assert.equal(run(hash(block(2))).verified,false);
});

test('a regenerated file is proven by the Codex process of the Agent tab, and repaired only with the proven bytes',async t=>{
 const {run,prompt,pane}=await host(t,{file:base,process:base+'\n\n'+block()});
 const checked=run(hash(block()),'pt-ws-Test_1-pane-a-tab-b');
 assert.equal(checked.verified,true);assert.equal(checked.evidence.kind,'running-codex-arguments');assert.deepEqual(checked.evidence.processes.map(p=>p.pid),[pane.pid]);assert.equal(checked.fileRestored,false);
 assert.equal(await readFile(prompt,'utf8'),base,'read-only without restore');
 const restored=run(hash(block()),'pt-ws-Test_1-pane-a-tab-b','restore');assert.equal(restored.fileRestored,true);
 assert.equal(await readFile(prompt,'utf8'),base+'\n\n'+block());
 assert.deepEqual(run(hash(block()),'pt-ws-Test_1-pane-a-tab-b'),{verified:true,evidence:{kind:'workspace-prompt'}});
});

test('no evidence, other evidence, Claude or an unreachable tab never verify and never write',async t=>{
 const other=await host(t,{file:base,process:base+'\n\n'+block(2)});
 assert.deepEqual(other.run(hash(block()),'pt-session','restore'),{verified:false,evidence:{kind:'process-conflict'}});assert.equal(await readFile(other.prompt,'utf8'),base);
 const none=await host(t,{file:base});
 assert.deepEqual(none.run(hash(block()),'pt-session','restore'),{verified:false,evidence:null});
 const claude=await host(t,{file:base,process:base+'\n\n'+block(),provider:'claude'});
 assert.deepEqual(claude.run(hash(block()),'pt-session','restore'),{verified:false,evidence:null});assert.equal(await readFile(claude.prompt,'utf8'),base);
 const gone=await host(t,{file:base,process:base+'\n\n'+block(),tmux:false});
 assert.deepEqual(gone.run(hash(block()),'pt-session','restore'),{verified:false,evidence:null});
 const unsessioned=await host(t,{file:base,process:base+'\n\n'+block()});
 assert.equal(unsessioned.run(hash(block())).verified,false);
 const bad=await host(t,{file:base,process:base});
 assert.throws(()=>bad.run(hash(block()),'bad session;rm'),/invalid session|Command failed/);
});

test('send-time verification keeps a process-proven Agent and records the file repair; a missing contract still downgrades',async t=>{
 const f=await fixture(t),d=f.service,a=f.agents[0];
 d.contractEvidence=async()=>({verified:true,evidence:{kind:'running-codex-arguments',processes:[{pid:1,start:'9'}]},fileRestored:true});
 await d.verifyInstructions(a);assert.equal(a.inputEnvelope.mode,'startup-v2');assert(a.inputEnvelope.promptFileRestoredAt);
 d.contractEvidence=async()=>({verified:false,evidence:null});
 await d.verifyInstructions(a);assert.equal(a.inputEnvelope.mode,'migration-required');assert.equal(a.inputEnvelope.reason,'startup-instructions-missing-or-changed');
});

test('a false downgrade is restored only on process evidence, keeping the downgrade as history',async t=>{
 const f=await fixture(t),d=f.service,[a,b]=f.agents;
 for(const x of [a,b]){x.inputEnvelope={...x.inputEnvelope,mode:'migration-required',reason:'startup-instructions-missing-or-changed',downgradedAt:'2026-11-25T11:55:09.773Z'};}
 b.provider='claude';
 let evidence={verified:true,evidence:{kind:'running-codex-arguments',processes:[{pid:1,start:'9'}]},fileRestored:true};
 d.contractEvidence=async()=>evidence;
 assert.deepEqual(await d.recoverInstructions(b.id),{agentId:b.id,recovered:false,reason:'no-process-evidence-for-provider'});assert.equal(b.inputEnvelope.mode,'migration-required');
 evidence={verified:true,evidence:{kind:'workspace-prompt'}};
 assert.equal((await d.recoverInstructions(a.id)).reason,'no-matching-process-evidence');assert.equal(a.inputEnvelope.mode,'migration-required');
 evidence={verified:true,evidence:{kind:'running-codex-arguments',processes:[{pid:1,start:'9'}]},fileRestored:true};
 const r=await d.recoverInstructions(a.id);assert.equal(r.recovered,true);
 assert.equal(a.inputEnvelope.mode,'startup-v2');assert.equal(a.inputEnvelope.reason,undefined);assert.deepEqual(a.inputEnvelope.restoredFrom.downgrade,{reason:'startup-instructions-missing-or-changed',downgradedAt:'2026-11-25T11:55:09.773Z'});assert(a.inputEnvelope.promptFileRestoredAt);
 assert.equal((await d.recoverInstructions(a.id)).reason,'not-a-missing-file-downgrade');
 // Any other downgrade (session change, contract upgrade) stays on the formal migration path.
 a.inputEnvelope={...a.inputEnvelope,mode:'migration-required',reason:'native-session-changed'};
 assert.equal((await d.recoverInstructions(a.id)).reason,'not-a-missing-file-downgrade');
 // The restored Agent accepts work again and sends.
 a.inputEnvelope={...a.inputEnvelope,mode:'migration-required',reason:'startup-instructions-missing-or-changed'};await d.recoverInstructions(a.id);
 d.contractEvidence=async()=>({verified:true,evidence:{kind:'running-codex-arguments',processes:[]}});
 const run=await d.send(a.id,{requestId:'contract-restored-1',instruction:'送れますか'});await f.submit(run);assert.notEqual(run.queuedReason,'startup-contract-migration-required');
});

test('startup repair writes back proven contracts without downgrading anyone, then restores false downgrades',async t=>{
 const f=await fixture(t),d=f.service,[a,b,c]=f.agents;
 for(const x of [a,b,c]){x.provider='codex';}
 c.inputEnvelope={...c.inputEnvelope,mode:'migration-required',reason:'startup-instructions-missing-or-changed',downgradedAt:'2026-11-25T11:55:09.773Z'};
 const calls=[];d.contractEvidence=async x=>{calls.push(x.id);return x.id===a.id?{verified:true,evidence:{kind:'running-codex-arguments',processes:[]},fileRestored:true}:x.id===b.id?{verified:false,evidence:null}:{verified:true,evidence:{kind:'running-codex-arguments',processes:[]},fileRestored:false};};
 await d.repairContracts();
 assert(a.inputEnvelope.promptFileRestoredAt);assert.equal(a.inputEnvelope.mode,'startup-v2');
 assert.equal(b.inputEnvelope.mode,'startup-v2','no downgrade at startup');assert.equal(b.inputEnvelope.promptFileRestoredAt,undefined);
 assert.equal(c.inputEnvelope.mode,'startup-v2');for(const x of [a,b,c])assert(calls.includes(x.id));
});
