import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DirectAgents} from '../server/direct.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'village-direct-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let result={status:'not-ready'}, disconnected=false, sendFailure=false, sends=0, notifications=0;
 const remote=async args=>{
  if(disconnected)throw Error('network');
  if(args[1]==='workspace')return JSON.stringify({id:'ws-test',initialTab:{tabId:'initial'}});
  if(args[2]==='create')return JSON.stringify({tabId:'tab-test',sessionName:'owned'});
  if(args[2]==='status')return JSON.stringify({alive:true,cliState:'idle',agentSessionId:'session'});
  if(args[2]==='result')return JSON.stringify(result);
  if(args[2]==='send'){sends++;if(sendFailure)throw Error('lost acknowledgement');return '{"status":"sent"}';}
  throw Error('unexpected command');
 };
 const notifier={status:()=>({}),enqueue:async()=>{notifications++;return {status:'sent'};}};
 const options={dir,remote,notifier};const service=new DirectAgents(options);await service.init({watch:false});
 const w=await service.putWorkshop({name:'工房',sshHost:'E-frontier',baseUrl:'http://localhost:8022',workplaces:['/tmp/work']});
 const a=await service.create({workshopId:w.id,cwd:'/tmp/work',requestId:'create-001'});await service.tick();
 return {service,options,a,w,setResult:r=>result=r,disconnect:v=>disconnected=v,failSend:()=>sendFailure=true,sends:()=>sends,notifications:()=>notifications};
}
test('successive runs reject stale completion, survive restart and notify once',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'one',requestId:'request-001'});
 f.setResult({status:'completed',text:'old response',timestamp:'1'});await f.service.tick();assert.equal(r.state,'running');
 f.setResult({status:'completed',text:'one '+r.marker,timestamp:'2',agentSessionId:'session'});await f.service.tick();assert.equal(r.state,'completed');assert.equal(r.achievement,'unverified');
 const second=await f.service.send(f.a.id,{instruction:'two',requestId:'request-002'});await f.service.tick();assert.equal(second.state,'running');
 const restarted=new DirectAgents(f.options);await restarted.init({watch:false});await restarted.tick();assert.equal(restarted.data.runs[1].state,'running');assert.equal(f.sends(),2);
 f.setResult({status:'completed',text:'two '+second.marker,timestamp:'3',agentSessionId:'session'});await restarted.tick();await restarted.tick();assert.equal(restarted.data.runs[1].state,'completed');assert.equal(f.notifications(),2);
});
test('unknown send is never repeated; duplicate API request returns original run',async t=>{
 const f=await fixture(t);f.failSend();const input={instruction:'hello',requestId:'request-001'};
 const r=await f.service.send(f.a.id,input);assert.equal(r.state,'send_unknown');
 assert.equal((await f.service.send(f.a.id,input)).id,r.id);
 const restarted=new DirectAgents(f.options);await restarted.init({watch:false});await restarted.tick();assert.equal(f.sends(),1);
 f.disconnect(true);await restarted.tick();assert.equal(restarted.agent(f.a.id).state,'unknown');assert.equal(restarted.data.runs[0].state,'send_unknown');assert.equal(f.notifications(),0);
 f.disconnect(false);f.setResult({status:'completed',text:r.marker,timestamp:'2'});await restarted.tick();assert.equal(restarted.data.runs[0].state,'completed');
});
test('different session and interrupted response cannot complete; workshops are frozen per agent',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'test',requestId:'request-001'});
 f.setResult({status:'completed',text:r.marker,agentSessionId:'other'});await f.service.tick();assert.equal(r.state,'running');
 f.setResult({status:'completed',text:r.marker,agentSessionId:'session',interrupted:true});await f.service.tick();assert.equal(r.state,'running');
 await f.service.putWorkshop({...f.w,sshHost:'Other'},f.w.id);assert.equal(f.a.connection.sshHost,'E-frontier');
 await assert.rejects(f.service.putWorkshop({...f.w,sshHost:'-oProxyCommand=bad'}));
});
test('multiple workshops and agents can hold independent active runs',async t=>{
 const f=await fixture(t);const w=await f.service.putWorkshop({...f.w,name:'second',sshHost:'Other'});
 const a=await f.service.create({workshopId:w.id,cwd:'/tmp/work',requestId:'create-002'});
 const rs=await Promise.all([f.service.send(f.a.id,{instruction:'a',requestId:'request-001'}),f.service.send(a.id,{instruction:'b',requestId:'request-002'})]);
 assert.equal(rs.length,2);assert.equal(f.sends(),2);
 assert.equal((await f.service.create({workshopId:w.id,cwd:'/tmp/work',requestId:'create-002'})).id,a.id);
});
test('concurrent identical sends have one external side effect',async t=>{
 const f=await fixture(t);const input={instruction:'one',requestId:'request-001'};
 const [a,b]=await Promise.all([f.service.send(f.a.id,input),f.service.send(f.a.id,input)]);
 assert.equal(a.id,b.id);assert.equal(f.sends(),1);
});
test('an interrupted launch is not retried on recovery',async t=>{
 const f=await fixture(t);let calls=0;
 const service=new DirectAgents({...f.options,remote:async()=>{calls++;throw Error('lost response');}});
 await service.init({watch:false});
 const a=await service.create({workshopId:f.w.id,cwd:'/tmp/work',requestId:'create-lost'});
 assert.equal(a.state,'creation_unknown');assert.equal(calls,1);
 const restarted=new DirectAgents({...f.options,remote:async()=>{calls++;throw Error('must not recreate');}});await restarted.init({watch:false});
 assert.equal((await restarted.create({workshopId:f.w.id,cwd:'/tmp/work',requestId:'create-lost'})).id,a.id);assert.equal(calls,1);
});
test('only one monitoring backend can own a state directory',async t=>{
 const f=await fixture(t);const a=new DirectAgents(f.options), b=new DirectAgents(f.options);
 await a.init();t.after(()=>a.close());t.after(()=>b.close());
 await assert.rejects(b.init(),{code:'EADDRINUSE'});
});
test('ready-for-review is an available agent and valid completion state',async t=>{
 const f=await fixture(t);const remote=f.options.remote;
 f.service.remote=async args=>args[2]==='status'?JSON.stringify({alive:true,cliState:'ready-for-review',agentSessionId:'session'}):remote(args);
 const r=await f.service.send(f.a.id,{instruction:'one',requestId:'request-001'});
 f.setResult({status:'completed',text:r.marker,agentSessionId:'session'});await f.service.tick();assert.equal(r.state,'completed');assert.equal(f.a.state,'idle');
});
test('trust dialog blocks sending before a durable run or input is created',async t=>{
 const f=await fixture(t);const remote=f.options.remote;
 f.service.remote=async args=>args[2]==='status'?JSON.stringify({alive:true,cliState:'idle'}):args[2]==='capture'?JSON.stringify({content:'Do you trust the contents of this directory?'}):remote(args);
 await assert.rejects(f.service.send(f.a.id,{instruction:'one',requestId:'request-001'}),/信頼確認/);
 assert.equal(f.sends(),0);assert.equal(f.service.data.runs.length,0);
});
test('stop verifies exact identity, preserves unrelated tabs, and can reconcile a lost close acknowledgement',async t=>{
 const f=await fixture(t);let present=true,failClose=true;const calls=[];
 f.service.remote=async args=>{
  calls.push(args);
  if(args[0]==='python3')return JSON.stringify(args[2].includes('root=pane')?[{pid:123,start:'456'}]:{remainingOwned:0});
  if(args[2]==='list')return JSON.stringify({tabs:[{tabId:'unrelated',sessionName:'other'},...(present?[{tabId:f.a.tabId,sessionName:f.a.sessionName}]:[])]});
  if(args[2]==='close'){assert.equal(args.at(-1),f.a.tabId);present=false;if(failClose){failClose=false;throw Error('lost acknowledgement');}return 'ok';}
  throw Error('unexpected command');
 };
 await f.service.stop(f.a.id);assert.equal(f.a.state,'stop_unknown');
 await f.service.stop(f.a.id);assert.equal(f.a.state,'terminated');assert.equal(f.a.processVerification.remainingOwned,0);
 assert.equal(calls.filter(a=>a[2]==='close').length,1);
});
test('a slow workshop does not block another agents completion notification',async t=>{
 const f=await fixture(t);const other=await f.service.create({workshopId:f.w.id,cwd:'/tmp/work',requestId:'create-002'});
 const r=await f.service.send(other.id,{instruction:'second',requestId:'request-002'});
 const remote=f.service.remote;let release;const blocked=new Promise(resolve=>release=resolve);
 f.service.remote=async(args,host,id)=>{if(id===f.a.id)await blocked;return remote(args,host,id);};
 f.setResult({status:'completed',text:r.marker,agentSessionId:'session'});
 const polling=f.service.tick();
 for(let i=0;i<30&&!r.notification;i++)await new Promise(resolve=>setTimeout(resolve,5));
 try{assert.equal(r.state,'completed');assert.equal(f.notifications(),1);}finally{release();await polling;}
});
test('local workshop routes every operation including process cleanup locally and freezes connection type',async t=>{
 const f=await fixture(t);const calls=[];let present=true;
 f.service.localBin='/local/purplemux';
 f.service.localRun=async(command,args)=>{
  calls.push({command,args});
  if(command==='python3')return JSON.stringify(args[1].includes('root=pane')?[{pid:123,start:'456'}]:{remainingOwned:0});
  assert.equal(command,'/local/purplemux');
  if(args[0]==='workspace')return JSON.stringify({id:'local-ws',initialTab:{tabId:'initial'}});
  if(args[1]==='create')return JSON.stringify({tabId:'local-tab',sessionName:'local-session'});
  if(args[1]==='status')return JSON.stringify({alive:true,cliState:'idle',agentSessionId:'local-agent-session'});
  if(args[1]==='result')return JSON.stringify({status:'not-ready'});
  if(args[1]==='send')return '{"status":"sent"}';
  if(args[1]==='list')return JSON.stringify({tabs:present?[{tabId:'local-tab',sessionName:'local-session'}]:[]});
  if(args[1]==='close'){present=false;return 'ok';}
  throw Error('Unexpected local operation');
 };
 const w=await f.service.putWorkshop({name:'Local',connectionType:'local',baseUrl:'http://local:8022',workplaces:['/tmp/work']});
 assert.equal(w.sshHost,null);
 const a=await f.service.create({workshopId:w.id,cwd:'/tmp/work',requestId:'local-create'});
 await f.service.putWorkshop({...w,connectionType:'ssh',sshHost:'Other'},w.id);
 f.service.remote=async()=>{throw Error('Must not use SSH');};
 await f.service.poll(a);
 await f.service.send(a.id,{instruction:'literal $(false) text',requestId:'local-send'});
 await f.service.stop(a.id);
 assert.equal(a.state,'terminated');assert.equal(a.processVerification.remainingOwned,0);
 assert(calls.some(c=>c.args[1]==='send'&&c.args.at(-1).startsWith('literal $(false) text')));
 assert.equal(calls.filter(c=>c.command==='python3').length,2);
});
test('legacy workshops and Agent snapshots migrate to SSH; invalid connection types are rejected',async t=>{
 const f=await fixture(t);delete f.w.connectionType;delete f.a.connection.connectionType;await f.service.save();
 const restored=new DirectAgents(f.options);await restored.init({watch:false});
 assert.equal(restored.data.workshops[0].connectionType,'ssh');assert.equal(restored.agent(f.a.id).connection.connectionType,'ssh');
 await assert.rejects(restored.putWorkshop({...f.w,connectionType:'unknown'}));
});
