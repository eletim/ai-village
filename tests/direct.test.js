import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DirectAgents} from '../server/direct.mjs';
import {inputHash} from '../server/runtime-events.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'direct-native-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const data={available:true,sessionId:'session',cursor:0,inputs:[],turns:[]};let sends=0,notices=0,disconnected=false,loseSend=false,present=true;
 const remote=async(args)=>{
  if(disconnected)throw Error('offline');
  if(args[0]==='python3'){
   if(args[2].includes('def digest'))return JSON.stringify(data);
   return JSON.stringify(args[2].includes('root=pane')?[{pid:123,start:'1'}]:{remainingOwned:0});
  }
  if(args[1]==='workspace')return '{"id":"ws","initialTab":{"tabId":"initial"}}';
  if(args[2]==='create')return '{"tabId":"tab","sessionName":"owned"}';
  if(args[2]==='status')return JSON.stringify({alive:true,cliState:'idle',agentSessionId:'session'});
  if(args[2]==='send'){sends++;if(loseSend)throw Error('lost');return '{"status":"sent"}';}
  if(args[2]==='list')return JSON.stringify({tabs:present?[{tabId:'tab',sessionName:'owned'}]:[]});
  if(args[2]==='close'){present=false;return 'ok';}
  throw Error('Unexpected operation '+args.slice(0,3));
 };
 const options={dir,remote,notifier:{status:()=>({}),enqueue:async()=>{notices++;return {status:'sent'};}}};
 const service=new DirectAgents(options);await service.init({watch:false});
 const w=await service.putWorkshop({name:'w',sshHost:'host',baseUrl:'http://host',workplaces:['/tmp']});
 const a=await service.create({workshopId:w.id,cwd:'/tmp',requestId:'create-001'});await service.tick();
 const input=(instruction,id='turn-'+(data.turns.length+1))=>{data.cursor+=10;data.inputs.push({id:'input-'+id,turnId:id,hash:inputHash(instruction),offset:data.cursor});data.turns.push({id,state:'running',output:''});return data.turns.at(-1);};
 return {service,options,w,a,data,input,sends:()=>sends,notices:()=>notices,disconnect:v=>disconnected=v,lose:()=>loseSend=true};
}
test('raw instructions, native completion, additional input and restart never use reply formats',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'自由に答えて',requestId:'request-1'});
 assert.equal(r.marker,undefined);await f.service.tick();assert.equal(r.state,'unknown');
 const native=f.input('自由に答えて');await f.service.tick();assert.equal(r.state,'running');assert.equal(r.turnId,native.id);
 Object.assign(native,{state:'completed',output:'{"action":"dispatch"} is just text',completionEvent:'event-1'});await f.service.tick();assert.equal(r.state,'completed');assert.equal(f.notices(),1);
 const second=await f.service.send(f.a.id,{instruction:'続けて',requestId:'request-2'});await f.service.tick();assert.equal(second.state,'unknown');
 const restored=new DirectAgents(f.options);await restored.init({watch:false});
 Object.assign(f.input('続けて'),{state:'completed',output:'どんな返答でもよい',completionEvent:'event-2'});await restored.tick();await restored.tick();
 assert.equal(restored.data.runs[1].state,'completed');assert.equal(f.sends(),2);assert.equal(f.notices(),2);
});
test('unbound competing direct input is unknown; a bound native turn is not confused with a newer turn',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'ours',requestId:'request-1'});
 const own=f.input('ours');await f.service.tick();
 Object.assign(own,{state:'completed',output:'ours output'});Object.assign(f.input('PurpleMux input'),{state:'completed',output:'different output'});
 await f.service.tick();assert.equal(r.output,'ours output');
 const second=await f.service.send(f.a.id,{instruction:'next',requestId:'request-2'});
 f.input('next');f.input('direct interference');await f.service.tick();assert.equal(second.state,'unknown');assert.equal(f.notices(),1);
});
test('unknown send and disconnection never retransmit; interruption is distinct from completion',async t=>{
 const f=await fixture(t);f.lose();const input={instruction:'hello',requestId:'request-1'};
 const r=await f.service.send(f.a.id,input);assert.equal(r.state,'send_unknown');assert.equal((await f.service.send(f.a.id,input)).id,r.id);
 f.disconnect(true);await f.service.tick();assert.equal(f.a.state,'unknown');assert.equal(f.notices(),0);
 f.disconnect(false);const turn=f.input('hello');turn.state='interrupted';await f.service.tick();assert.equal(r.state,'unknown');assert.equal(f.sends(),1);
});
test('same idempotency key has one send even with concurrent requests',async t=>{
 const f=await fixture(t);const input={instruction:'hello',requestId:'request-1'};const [a,b]=await Promise.all([f.service.send(f.a.id,input),f.service.send(f.a.id,input)]);assert.equal(a.id,b.id);assert.equal(f.sends(),1);
});
test('missing old checkpoint or changed native session never completes',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'hello',requestId:'request-1'});delete r.baselineRuntime;
 Object.assign(f.input('hello'),{state:'completed',output:'old'});await f.service.tick();assert.equal(r.state,'unknown');assert.equal(f.notices(),0);
});
test('local dispatch and exact owned-process cleanup never call SSH',async t=>{
 const f=await fixture(t);let local=0;f.service.localRun=async(cmd,args)=>{local++;return f.options.remote([cmd==='local-pmux'?'purplemux':cmd,...args]);};f.service.localBin='local-pmux';
 const w=await f.service.putWorkshop({name:'local',connectionType:'local',baseUrl:'http://local',workplaces:['/tmp']});
 const a=await f.service.create({workshopId:w.id,cwd:'/tmp',requestId:'create-local',provider:'claude',location:'mayor'});
 f.service.remote=()=>{throw Error('SSH forbidden');};await f.service.poll(a);await f.service.send(a.id,{instruction:'$(literal)',requestId:'request-local'});await f.service.stop(a.id);
 assert.equal(a.state,'terminated');assert.equal(a.processVerification.remainingOwned,0);assert(local>5);
});
test('connection snapshots persist; only one monitoring process owns the state',async t=>{
 const f=await fixture(t);await f.service.putWorkshop({...f.w,sshHost:'other'},f.w.id);assert.equal(f.a.connection.sshHost,'host');
 const one=new DirectAgents(f.options),two=new DirectAgents(f.options);await one.init();t.after(()=>one.close());t.after(()=>two.close());await assert.rejects(two.init(),{code:'EADDRINUSE'});
});
test('native API failure is recorded without a completion notification',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'hello',requestId:'request-1'});
 Object.assign(f.input('hello'),{state:'failed',output:'Login expired',error:'authentication_failed',completionEvent:'native-error'});
 await f.service.tick();assert.equal(r.state,'failed');assert.equal(r.error,'authentication_failed');assert.equal(r.output,'Login expired');assert.equal(f.notices(),0);
});
