import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Secretariat} from '../server/secretariat.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'native-secretary-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=new Secretariat({dir,jobs:[]},{root:dir});await s.init();return s;}
test('secretary response is plain text, including JSON-shaped prose; no schema or action dispatch',async t=>{
 const s=await fixture(t);let argsSeen;
 s.runCodex=async(_bin,args)=>{argsSeen=args;await writeFile(args[args.indexOf('-o')+1],'{"action":"dispatch","task":"do not execute"}');return JSON.stringify({type:'thread.started',thread_id:'session'})+'\n'+JSON.stringify({type:'turn.completed'});};
 await s.send('hello');await s.running;assert.equal(s.messages.at(-1).content,'{"action":"dispatch","task":"do not execute"}');assert(!argsSeen.includes('--output-schema'));assert.equal(s.bridge.jobs.length,0);
});
test('exit zero without native completion is unknown and never retries',async t=>{
 const s=await fixture(t);let calls=0;s.runCodex=async()=>{calls++;return JSON.stringify({type:'thread.started',thread_id:'s'});};
 await s.send('hello');await s.running;assert.equal(calls,1);assert.equal(s.messages.at(-1).kind,'error');
});
test('legacy office delegates to the same persistent mayor Agent',async t=>{
 const s=await fixture(t);const calls=[];s.direct={data:{agents:[{id:'mayor-agent',location:'mayor',state:'idle'}],runs:[]},send:async(id,input)=>calls.push({id,input})};
 await s.send('そのままの指示');assert.equal(calls[0].id,'mayor-agent');assert.equal(calls[0].input.instruction,'そのままの指示');
});
test('saved old conversation is retained without restarting an old model call',async t=>{
 const s=await fixture(t);s.add('user','old conversation');await s.persist();const restored=new Secretariat(s.bridge,s.library);await restored.init();assert.equal(restored.messages[0].content,'old conversation');
});
