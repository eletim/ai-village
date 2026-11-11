import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installInstructionsScript,verifyInstructionsScript,runMarker,markerContext,matchesRunInput} from '../server/input-envelope.mjs';
import {inputHash} from '../server/runtime-events.mjs';
import {DirectAgents} from '../server/direct.mjs';

test('startup instructions append to owned PurpleMux provider prompts and never write cwd or shell-evaluate content',async t=>{
 const home=await mkdtemp(join(tmpdir(),'envelope-install-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.purplemux/workspaces/ws-test'),cwd=join(home,'cwd');await mkdir(root,{recursive:true});await mkdir(cwd);
 const body='<ai-village-instructions version="1">\n日本語 $HOME `touch nope` "quote" \'quote\'\\n\n</ai-village-instructions>';
 for(const provider of ['claude','codex']){
  const path=join(root,provider+'-prompt.md');await writeFile(path,'# purplemux context\noriginal');
  const result=JSON.parse(execFileSync('python3',['-c',installInstructionsScript,'ws-test',provider,body],{cwd,env:{...process.env,HOME:home}}));
  assert.deepEqual(result,{installed:true,hash:inputHash(body)});
  assert.equal(await readFile(path,'utf8'),'# purplemux context\noriginal\n\n'+body);
  const verify=()=>JSON.parse(execFileSync('python3',['-c',verifyInstructionsScript,'ws-test',provider,inputHash(body)],{cwd,env:{...process.env,HOME:home}}));
  assert.equal(verify().verified,true);
  await writeFile(path,'# purplemux context\nrewritten');assert.equal(verify().verified,false);
  await writeFile(path,body.replace('日本語','changed'));assert.equal(verify().verified,false);
  await rm(path);assert.throws(verify);

 }
 assert.deepEqual(await readdir(cwd),[]);
 assert.throws(()=>execFileSync('python3',['-c',installInstructionsScript,'../elsewhere','codex',body],{env:{...process.env,HOME:home},stdio:'pipe'}));
});

test('unavailable startup integration falls back durably; only exact installation receipt enables short mode',async()=>{
 const d=new DirectAgents({dir:'/unused',notifier:{status:()=>({})}});d.save=async()=>{};
 const a={workspaceId:'ws-owned',provider:'claude'};
 d.execute=async()=>JSON.stringify({installed:true,hash:'wrong'});await d.installInstructions(a);assert.equal(a.inputEnvelope.mode,'legacy');
 d.execute=async()=>{throw Error('unsupported host');};await d.installInstructions(a);assert.equal(a.inputEnvelope.mode,'legacy');
 d.execute=async(_a,args)=>JSON.stringify({installed:true,hash:inputHash(args.at(-1))});await d.installInstructions(a);assert.equal(a.inputEnvelope.mode,'startup-v1');
});

test('marker is independent of presentation, cannot match a prefix, and never falls back to hash when present',()=>{
 const inputMarker=runMarker('some-run-id'),run={inputMarker,inputHash:'old'};
 assert(matchesRunInput(run,{text:'human'+markerContext('some-run-id')}));
 assert(!matchesRunInput(run,{hash:'old'}));
 assert(!matchesRunInput(run,{text:inputMarker+'-other',hash:'old'}));
 assert(matchesRunInput({inputHash:'old'},{hash:'old'}));
});
