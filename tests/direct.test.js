import {inputHash} from './model-fixtures.mjs';
import {receipt} from './model-fixtures.mjs';
import {testView} from './model-fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DirectAgents} from '../server/direct.mjs';
import {} from '../server/runtime-events.mjs';
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
 const service=new DirectAgents(options);await service.init({watch:false});await service.flow.configureReport(false);
 const w=await service.putWorkshop({name:'w',sshHost:'host',baseUrl:'http://host',workplaces:['/tmp']});
 const a=await service.create({workshopId:w.id,cwd:'/tmp',requestId:'create-001'});await service.tick();
 const input=(instruction,id='turn-'+(data.turns.length+1))=>{data.cursor+=10;data.inputs.push({id:'input-'+id,turnId:id,text:service.data.runs.findLast(r=>r.instruction===instruction)?.inputMarker||instruction,hash:service.data.runs.findLast(r=>r.instruction===instruction)?.inputHash||inputHash(instruction),offset:data.cursor});data.turns.push({id,state:'running',output:''});return data.turns.at(-1);};
 return {service,options,w,a,data,input,sends:()=>sends,notices:()=>notices,disconnect:v=>disconnected=v,lose:()=>loseSend=true};
}
test('raw instructions, native completion, additional input and restart never use reply formats',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'自由に答えて',requestId:'request-1'});
 assert.equal(r.marker,undefined);await f.service.tick();assert.equal(testView(r).state,'awaiting_input');
 const native=f.input('自由に答えて');await f.service.tick();assert.equal(testView(r).state,'running');assert.equal(r.turnId,native.id);
 Object.assign(native,{state:'completed',output:'{"action":"dispatch"} is just text',completionEvent:'event-1'});await f.service.tick();assert.equal(testView(r).state,'completed');assert.equal(f.notices(),1);
 const second=await f.service.send(f.a.id,{instruction:'続けて',requestId:'request-2'});await f.service.tick();assert.equal(testView(second).state,'awaiting_input');
 const restored=new DirectAgents(f.options);await restored.init({watch:false});
 Object.assign(f.input('続けて'),{state:'completed',output:'どんな返答でもよい',completionEvent:'event-2'});await restored.tick();await restored.tick();
 assert.equal(testView(restored.data.runs[1]).state,'completed');assert.equal(f.sends(),2);assert.equal(f.notices(),2);
});
test('unbound competing direct input is unknown; a bound native turn is not confused with a newer turn',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'ours',requestId:'request-1'});
 const own=f.input('ours');await f.service.tick();
 Object.assign(own,{state:'completed',output:'ours output'});Object.assign(f.input('PurpleMux input'),{state:'completed',output:'different output'});
 await f.service.tick();assert.equal(r.output,'ours output');
 const second=await f.service.send(f.a.id,{instruction:'next',requestId:'request-2'});
 f.input('next');f.input('direct interference');await f.service.tick();assert.equal(testView(second).state,'awaiting_input');assert.equal(f.notices(),1);
});
test('unknown send and disconnection never retransmit; interruption is distinct from completion',async t=>{
 const f=await fixture(t);f.lose();const input={instruction:'hello',requestId:'request-1'};
 const r=await f.service.send(f.a.id,input);assert.equal(testView(r).state,'awaiting_input');assert.equal((await f.service.send(f.a.id,input)).id,r.id);
 f.disconnect(true);await f.service.tick();assert.equal(testView(f.a).state,'unknown');assert.equal(f.notices(),0);
 f.disconnect(false);const turn=f.input('hello');turn.state='interrupted';await f.service.tick();assert.equal(testView(r).state,'interrupted');assert.equal(f.sends(),1);
});
test('same idempotency key has one send even with concurrent requests',async t=>{
 const f=await fixture(t);const input={instruction:'hello',requestId:'request-1'};const [a,b]=await Promise.all([f.service.send(f.a.id,input),f.service.send(f.a.id,input)]);assert.equal(a.id,b.id);assert.equal(f.sends(),1);
});
test('missing old checkpoint or changed native session never completes',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'hello',requestId:'request-1'});delete r.baselineRuntime;
 Object.assign(f.input('hello'),{state:'completed',output:'old'});await f.service.tick();assert.equal(testView(r).state,'awaiting_input');assert.equal(f.notices(),0);
});
test('local dispatch and exact owned-process cleanup never call SSH',async t=>{
 const f=await fixture(t);let local=0;f.service.localRun=async(cmd,args)=>{local++;return f.options.remote([cmd==='local-pmux'?'purplemux':cmd,...args]);};f.service.localBin='local-pmux';
 const w=await f.service.putWorkshop({name:'local',connectionType:'local',baseUrl:'http://local',workplaces:['/tmp']});
 const a=await f.service.create({workshopId:w.id,cwd:'/tmp',requestId:'create-local',provider:'claude',location:'mayor'});
 f.service.remote=()=>{throw Error('SSH forbidden');};await f.service.poll(a);await f.service.send(a.id,{instruction:'$(literal)',requestId:'request-local'});await f.service.stop(a.id);
 assert.equal(testView(a).state,'terminated');assert.equal(a.processVerification.remainingOwned,0);assert(local>5);
});
test('a new Claude session can receive its first instruction before a native transcript exists',async t=>{
 const f=await fixture(t),originalPmux=f.service.pmux.bind(f.service);
 f.a.provider='claude';
 f.service.pmux=async(a,...args)=>args[1]==='status'?{alive:true,cliState:'idle',agentSessionId:'session',lastEvent:{name:'session-start'},eventSeq:1}:originalPmux(a,...args);
 f.service.runtime=async()=>({available:false,unrecorded:true,sessionId:'session',turns:[],inputs:[],cursor:0});
 await f.service.poll(f.a);
 assert.equal(testView(f.a).state,'idle');assert.equal(testView(f.a).canSend,true);assert.equal(f.a.modelInfo.reason,'not-recorded');
 const r=await f.service.send(f.a.id,{instruction:'first instruction',requestId:'claude-first'});
 assert.equal(f.sends(),1);assert.equal(testView(r).state,'awaiting_input');assert.equal(testView(f.a).canSend,false);
 await f.service.tick();assert.equal(testView(f.a).state,'unknown');assert.equal(testView(f.a).canSend,false);
});
test('connection snapshots persist; only one monitoring process owns the state',async t=>{
 const f=await fixture(t);await f.service.putWorkshop({...f.w,sshHost:'other'},f.w.id);assert.equal(f.a.connection.sshHost,'host');
 const one=new DirectAgents(f.options),two=new DirectAgents(f.options);await one.init();t.after(()=>one.close());t.after(()=>two.close());await assert.rejects(two.init(),{code:'EADDRINUSE'});
});
test('native API failure is recorded without a completion notification',async t=>{
 const f=await fixture(t);const r=await f.service.send(f.a.id,{instruction:'hello',requestId:'request-1'});
 Object.assign(f.input('hello'),{state:'failed',output:'Login expired',error:'authentication_failed',completionEvent:'native-error'});
 await f.service.tick();assert.equal(testView(r).state,'failed');assert.equal(r.error,'authentication_failed');assert.equal(r.output,'Login expired');assert.equal(f.notices(),0);
});
test('fresh runtime observation overrides stale UI state; terminal results reopen the input gate',async t=>{
 const f=await fixture(t);f.a.agentModel.observation={connected:true,process:'alive',activity:'input-needed',canSteer:false};
 for(const end of ['completed','failed','interrupted']){
  const r=await f.service.send(f.a.id,{instruction:end,requestId:'request-'+end});assert.equal(testView(f.a).canSend,false);
  Object.assign(f.input(end),{state:end,output:'plain text'});await f.service.tick();assert.equal(testView(r).state,end);assert.equal(testView(f.a).canSend,true);assert.equal(testView(f.a).lifecycle,'alive');assert.equal(testView(f.a).activityState,'idle');
 }
 f.disconnect(true);await f.service.tick();assert.equal(testView(f.a).canSend,false);assert.notEqual(testView(f.a).lifecycle,'terminated');const queued=await f.service.send(f.a.id,{instruction:'offline',requestId:'request-offline'});assert.equal(testView(queued).state,'queued');await f.service.flow.cancel({humanRequestId:queued.humanRequestId,revision:0});
 f.disconnect(false);await f.service.tick();assert.equal(testView(f.a).canSend,true);assert.equal(f.sends(),3);
 const restored=new DirectAgents(f.options);await restored.init({watch:false});assert.equal(testView(restored.data.agents[0]).canSend,false);await restored.tick();assert.equal(testView(restored.data.agents[0]).canSend,true);assert.equal(f.sends(),3);
});
test('uncertain delivery retains uncertainty but a later native terminal boundary releases new input',async t=>{
 const f=await fixture(t);f.lose();const r=await f.service.send(f.a.id,{instruction:'unknown delivery',requestId:'request-uncertain'});await f.service.tick();assert.equal(testView(f.a).canSend,false);
 Object.assign(f.input('unknown delivery'),{state:'completed',output:'native result'});await f.service.tick();assert.equal(testView(r).state,'completed');assert.equal(receipt(r).blocksInput,false);assert.equal(testView(f.a).canSend,true);assert.equal(f.notices(),1);assert.equal(f.sends(),1);
 assert.equal((await f.service.send(f.a.id,{instruction:'unknown delivery',requestId:'request-uncertain'})).id,r.id);assert.equal(f.sends(),1);
});
test('a fileIdentity rotation within the same session is treated as continuation, not a different session',async t=>{
 // Mimics a host-side native-index identity rotation (e.g. around a log
 // rotation/compaction) that happens mid-run while the native sessionId never
 // changes: correlate() still refuses to attribute output to a different
 // fileIdentity, but the agent must not stay blocked forever once a terminal
 // native boundary is independently observed for that same session.
 const f=await fixture(t);f.data.fileIdentity='file-1';
 const r=await f.service.send(f.a.id,{instruction:'rotated',requestId:'request-rotated'});
 assert.equal(testView(r).state,'awaiting_input');assert.equal(testView(f.a).canSend,false);
 f.data.fileIdentity='file-2';
 Object.assign(f.input('rotated'),{state:'completed',output:'native result'});
 await f.service.tick();
 assert.equal(testView(r).state,'terminated');assert.equal(r.runModel.state.outcome,'unconfirmed');assert.equal(r.error,'runtime-file-replaced');
 assert.equal(receipt(r).blocksInput,false);assert.equal(testView(f.a).canSend,true);
});
test('a run stuck without native correlation times out instead of blocking the agent forever',async t=>{
 const f=await fixture(t);f.data.fileIdentity='file-1';
 const r=await f.service.send(f.a.id,{instruction:'stuck',requestId:'request-stuck'});assert.equal(f.sends(),1);
 f.data.fileIdentity='file-2';await f.service.tick();
 assert.equal(testView(r).state,'awaiting_input');assert.equal(testView(f.a).canSend,false);
 const stuck=f.service.data.runs.find(x=>x.id===r.id);assert(stuck.unknownSince);
 await f.service.tick();assert.equal(testView(stuck).state,'awaiting_input');assert.equal(testView(f.a).canSend,false);
 stuck.unknownSince=new Date(Date.now()-11*60*1000).toISOString();
 await f.service.tick();
 assert.equal(testView(stuck).state,'terminated');assert.equal(receipt(stuck).blocksInput,false);assert.equal(testView(f.a).canSend,true);
 const q=f.service.flow.root(r.humanRequestId);
 const retried=await f.service.flow.continue({humanRequestId:r.humanRequestId,workId:r.workId,revision:q.revision,operationId:'retry-after-timeout',instruction:'retry now'},true);
 assert.equal(testView(retried).state,'queued');await f.service.tick();
 assert.equal(testView(f.service.flow.run(retried.id)).state,'awaiting_input');assert.equal(f.sends(),2);
});
test('concurrent launch retries return one identity and terminated agents do not block new launch',async t=>{
 const f=await fixture(t),input={workshopId:f.w.id,cwd:'/tmp',requestId:'concurrent-create',provider:'claude'};
 const [a,b]=await Promise.all([f.service.create(input),f.service.create(input)]);assert.equal(a.id,b.id);await f.service.stop(a.id);
 const next=await f.service.create({...input,requestId:'after-stop-create'});assert.notEqual(next.id,a.id);assert.equal(next.provider,'claude');
});
test('an old terminal result cannot release uncertain input; stopping preserves uncertain outcome',async t=>{
 const f=await fixture(t);Object.assign(f.input('old'),{state:'completed',completedAt:'2099-01-01T00:00:00Z'});
 f.lose();const r=await f.service.send(f.a.id,{instruction:'new',requestId:'new-unknown'});await f.service.tick();assert.equal(testView(f.a).canSend,false);assert.equal(testView(r).state,'awaiting_input');await f.service.stop(f.a.id);assert.equal(testView(r).state,'terminated');assert.equal(receipt(r).blocksInput,false);assert.equal(testView(f.a).lifecycle,'terminated');
});
// Once the agent itself is terminated it is never observed again, so releaseStuckRuns()
// (the bounded-wait path for 'unknown'/'send_unknown') can never fire for its own runs either.
// stop() must resolve them itself or the owning work/request can never finish/retry/resume again.
test('stopping an Agent while its run is unknown resolves that run to terminated, unblocking retry',async t=>{
 const f=await fixture(t),r=await f.service.send(f.a.id,{instruction:'next',requestId:'request-unknown-1'});
 f.input('next');f.input('direct interference');await f.service.tick();assert.equal(testView(r).state,'awaiting_input');const originalError=r.error;assert(originalError);
 await f.service.stop(f.a.id);
 assert.equal(testView(r).state,'terminated');assert.equal(receipt(r).blocksInput,false);assert.equal(r.error,originalError);assert.equal(r.runModel.state.outcome,'unconfirmed');
 const q=f.service.flow.root(r.humanRequestId);
 const retried=await f.service.flow.continue({humanRequestId:r.humanRequestId,workId:r.workId,revision:q.revision,operationId:'retry-after-stop',instruction:'retry now'},true);
 assert.equal(retried.workId,r.workId);assert.equal(retried.origin,'retry');
});
test('stopping an Agent while its run is send_unknown resolves that run to terminated, preserving the original error',async t=>{
 const f=await fixture(t);f.lose();const r=await f.service.send(f.a.id,{instruction:'hello',requestId:'request-send-unknown-1'});
 assert.equal(testView(r).state,'awaiting_input');const originalError=r.error;assert(originalError);
 await f.service.stop(f.a.id);
 assert.equal(testView(r).state,'terminated');assert.equal(receipt(r).blocksInput,false);assert.equal(r.error,originalError);assert.equal(r.runModel.state.outcome,'unconfirmed');
 const q=f.service.flow.root(r.humanRequestId);
 const retried=await f.service.flow.continue({humanRequestId:r.humanRequestId,workId:r.workId,revision:q.revision,operationId:'retry-after-stop-2',instruction:'retry now'},true);
 assert.equal(retried.workId,r.workId);
});

test('discovery joins saved placement to exact PurpleMux identities, including legacy and terminated Agents',async t=>{
 const f=await fixture(t);
 delete f.a.location;
 f.a.workspaceId='ws-ofmWJg';f.a.tabId='tab-jPTCpo';f.a.name='村実装';
 await f.service.putWorkshop({...f.w,name:'renamed',sshHost:'elsewhere'},f.w.id);
 const secretary={...f.a,id:'secretary',agentModel:{...f.a.agentModel,id:'secretary'},name:'秘書',location:'mayor',workspaceId:'ws-UDCjmq',tabId:'secretary-tab'};
 f.service.data.agents.push(secretary,{...f.a,id:'ended',agentModel:{id:'ended',intent:'stop',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}},state:'terminated'});
 const rows=f.service.discovery().agents;
 assert.equal(rows[0].location,'workshop');assert.equal(rows[0].role,'worker');assert.equal(rows[0].placeName,'w');assert.equal(rows[0].sshHost,'host');
 assert.equal(rows[0].workspaceId,'ws-ofmWJg');assert.equal(rows[0].tabId,'tab-jPTCpo');
 assert.equal(rows[1].placeName,'村長の家（秘書）');assert.equal(rows[1].role,'secretary');assert.equal(testView(rows[2]).state,'terminated');
 assert(!JSON.stringify(rows).includes('nativeTurns'));assert(!JSON.stringify(rows).includes('instruction'));
 await f.service.save();const restored=new DirectAgents(f.options);await restored.init({watch:false});
 assert.equal(restored.discovery().agents[0].workspaceId,'ws-ofmWJg');
 const {VillageOperations}=await import('../server/operations.mjs');
 const ops=new VillageOperations({},null,{direct:restored});
 assert.deepEqual(await ops.resolve(['agents','list']).command.run([]),restored.discovery());
});

test('secretary receives discovery without losing native input correlation or resending retries',async t=>{
 const f=await fixture(t);f.a.location='mayor';let delivered;
 const remote=f.service.remote;f.service.remote=async args=>{if(args[2]==='send')delivered=args.at(-1);return remote(args);};
 const payload={instruction:'工房を確認して',requestId:'secretary-discovery'};
 const r=await f.service.send(f.a.id,payload);
 assert.equal(r.instruction,payload.instruction);assert(delivered.includes('最新名簿'));assert(delivered.includes('/api/direct/agents'));
 assert(delivered.includes(r.inputMarker));assert.equal(r.inputHash,undefined);
 Object.assign(f.input(delivered),{state:'completed',output:'confirmed'});await f.service.tick();assert.equal(testView(r).state,'completed');
 await f.service.send(f.a.id,payload);assert.equal(f.sends(),1);
});

test('new workspace labels expose placement while preserving Agent identity',async t=>{
 const f=await fixture(t);let label;
 const remote=f.service.remote;f.service.remote=async args=>{if(args[1]==='workspace'&&args[2]==='create')label=args.at(-1);return remote(args);};
 const a=await f.service.create({workshopId:f.w.id,cwd:'/tmp',name:'村実装',requestId:'label-workshop'});
 assert.equal(label,`AI村 工房（w） · 村実装 · ${a.id}`);
});

test('Agent view revision rejects stale completion acknowledgement and persists without sending',async t=>{
 const f=await fixture(t),s=f.service;
 Object.assign(f.input('native one'),{state:'completed',output:'first'});await s.tick();
 const first=s.snapshot().reviews[f.a.id].revision;
 Object.assign(f.input('native two'),{state:'completed',output:'second'});await s.tick();
 await assert.rejects(s.viewAgent(f.a.id,{revision:first}),{status:409});
 assert.equal(s.snapshot().reviews[f.a.id].unreviewed,true);
 const current=s.snapshot().reviews[f.a.id].revision;
 await s.viewAgent(f.a.id,{revision:current});await s.viewAgent(f.a.id,{revision:current});
 assert.equal(s.snapshot().reviews[f.a.id].unreviewed,false);
 const restored=new DirectAgents(f.options);await restored.init({watch:false});assert.equal(restored.snapshot().reviews[f.a.id].unreviewed,false);
 await assert.rejects(restored.viewAgent(f.a.id,{revision:'bad'}),{status:400});
 Object.assign(f.input('native three'),{state:'completed',output:'new'});await restored.tick();
 await assert.rejects(restored.viewAgent(f.a.id,{revision:current}),{status:409});
 assert.equal(restored.snapshot().reviews[f.a.id].unreviewed,true);
 assert.equal(f.sends(),0);assert.equal(f.notices(),0);
});
test('session replacement and legacy review migration retain Agent unread state',async t=>{
 const f=await fixture(t);const {completedEntries}=await import('../src/completions.js');
 Object.assign(f.input('first','same-turn'),{state:'completed',output:'old output'});await f.service.tick();
 f.service.data.reviewedCompletions=completedEntries(f.service.data).map(e=>e.key);
 assert.equal(f.service.snapshot().reviews[f.a.id].unreviewed,false);
 await f.service.viewAgent(f.a.id,{revision:f.service.snapshot().reviews[f.a.id].revision});
 f.data.sessionId='new-session';f.data.turns=[];f.data.inputs=[];Object.assign(f.input('second','same-turn'),{state:'completed',output:'new output'});await f.service.tick();
 assert.equal(f.a.nativeTurns.length,2);assert.equal(completedEntries(f.service.data).length,2);assert.equal(f.service.snapshot().reviews[f.a.id].unreviewed,true);
 assert.equal(f.a.nativeTurns[0].output,'old output');assert.equal(f.a.nativeTurns[0].sessionId,'session');
});
test('Project metadata persists independently of transport and concurrent edits reject stale revisions',async t=>{
 const f=await fixture(t),s=f.service;
 const [p,again]=await Promise.all([s.putProject({name:'Village',requestId:'project-create-1'}),s.putProject({name:'Village',requestId:'project-create-1'})]);
 assert.equal(p.id,again.id);
 const transport=JSON.stringify([f.a.connection,f.a.workspaceId,f.a.tabId,f.a.sessionName,f.a.cwd]);
 const results=await Promise.allSettled([s.updateAgent(f.a.id,{revision:0,name:'Secretary',projectId:p.id}),s.updateAgent(f.a.id,{revision:0,name:'Lost update'})]);
 assert.equal(results.filter(r=>testView(r).status==='fulfilled').length,1);assert.equal(testView(results[1].reason).status,409);
 assert.equal(JSON.stringify([f.a.connection,f.a.workspaceId,f.a.tabId,f.a.sessionName,f.a.cwd]),transport);
 assert.equal(s.discovery().agents[0].projectName,'Village');assert.equal(f.sends(),0);
 await assert.rejects(s.updateAgent(f.a.id,{revision:1,projectId:'missing'}),{status:404});
 await assert.rejects(s.updateAgent(f.a.id,{revision:1,cwd:'/other'}),{status:400});
 await s.putProject({revision:0,name:'Renamed'},p.id);
 await assert.rejects(s.putProject({revision:0,name:'Stale'},p.id),{status:409});
 const restored=new DirectAgents(f.options);await restored.init({watch:false});
 assert.equal(restored.discovery().agents[0].name,'Secretary');assert.equal(restored.discovery().agents[0].projectName,'Renamed');
 await restored.updateAgent(f.a.id,{revision:1,projectId:null});assert.equal(restored.discovery().agents[0].projectId,null);
 // Retrying creation after an unrelated rename is still the same operation.
 assert.equal((await restored.create({workshopId:f.w.id,cwd:'/tmp',requestId:'create-001'})).id,f.a.id);
 assert.equal(f.notices(),0);
});
test('village management CLI uses the same metadata revision and discovery',async t=>{
 const {VillageOperations}=await import('../server/operations.mjs');const f=await fixture(t);
 const ops=new VillageOperations({dir:f.options.dir},null,{direct:f.service});
 const help=await ops.execute(['help']);assert.ok(help.result.some(c=>c.name==='agents create'));assert.ok(help.result.some(c=>c.name==='agents stop'));
 const p=(await ops.execute(['projects','create','project-cli-1','Across PCs'])).result;
 assert.equal((await ops.execute(['agents','project',f.a.id,'0',p.id])).ok,true);
 assert.equal((await ops.execute(['agents','rename',f.a.id,'0','Stale'])).ok,false);
 assert.equal((await ops.execute(['agents','rename',f.a.id,'1','Display'])).ok,true);
 assert.equal((await ops.execute(['agents','list'])).result.agents[0].projectName,'Across PCs');
 assert.equal((await ops.execute(['projects','rename',p.id,'0','Team'])).ok,true);
 assert.equal((await ops.execute(['agents','project',f.a.id,'2','-'])).ok,true);
 assert.equal(f.sends(),0);
});
test('busy agent accepts queued additions and delivers each once in order',async t=>{
 const f=await fixture(t);
 await f.service.send(f.a.id,{instruction:'first',requestId:'queue-first'});
 const first=f.input('first');await f.service.tick();
 assert.equal(testView(f.a).canSend,false);assert.equal(testView(f.a).canQueue,true);
 const second=await f.service.send(f.a.id,{instruction:'second',requestId:'queue-second'});
 const third=await f.service.send(f.a.id,{instruction:'third',requestId:'queue-third'});
 assert.equal(testView(second).state,'queued');assert.equal(testView(third).state,'queued');assert.equal(f.sends(),1);
 Object.assign(first,{state:'completed',output:'done'});await f.service.tick();
 assert.equal(testView(second).state,'awaiting_input');assert.equal(testView(third).state,'queued');assert.equal(f.sends(),2);
 Object.assign(f.input('second'),{state:'completed',output:'done'});await f.service.tick();
 assert.equal(testView(third).state,'awaiting_input');assert.equal(f.sends(),3);
});

test('Project pin uses revision updates, persists across rename and keeps create retries idempotent',async t=>{
 const f=await fixture(t),s=f.service;
 const {VillageOperations}=await import('../server/operations.mjs');
 const ops=new VillageOperations({dir:f.options.dir},null,{direct:s});
 const input={name:'Arbitrary project',requestId:'pin-project-test'};
 const p=await s.putProject(input);
 assert.equal(p.pinned,undefined);
 assert.ok((await ops.execute(['help'])).result.some(c=>c.name==='projects pin'));
 assert.equal((await ops.execute(['projects','pin',p.id,'0','true'])).ok,true);
 assert.equal((await ops.execute(['projects','pin',p.id,'0','false'])).ok,false);
 await assert.rejects(s.putProject({revision:1,pinned:'true'},p.id),{status:400});
 assert.equal((await ops.execute(['projects','rename',p.id,'1','Renamed'])).ok,true);
 assert.equal((await s.putProject(input)).id,p.id);
 await assert.rejects(s.putProject({...input,name:'Different'}),{status:409});
 const restored=new DirectAgents(f.options);await restored.init({watch:false});
 assert.equal(restored.project(p.id).pinned,true);assert.equal(restored.project(p.id).name,'Renamed');
 assert.equal(restored.project(p.id).revision,2);
 const edits=await Promise.allSettled([restored.putProject({revision:2,pinned:false},p.id),restored.putProject({revision:2,name:'Stale'},p.id)]);
 assert.equal(testView(edits[0]).status,'fulfilled');assert.equal(testView(edits[1].reason).status,409);
 assert.equal(restored.project(p.id).pinned,false);assert.equal(f.sends(),0);
});

test('stale busy releases only matching native terminal without later input or new running turn',async t=>{
 const f=await fixture(t),remote=f.service.remote;
 f.service.remote=async args=>args[2]==='status'?JSON.stringify({alive:true,cliState:'busy',agentSessionId:'session'}):remote(args);
 // No terminal evidence: busy remains busy.
 await f.service.tick();assert.equal(testView(f.a).canSend,false);
 f.data.cursor=10;f.data.inputs=[{id:'input',turnId:'old',offset:1}];f.data.turns=[{id:'old',state:'failed',completionOffset:10,error:'capacity'}];
 await f.service.tick();assert.equal(testView(f.a).canSend,true);assert.equal(testView(f.a).state,'idle');
 f.data.inputs.push({id:'new-input',turnId:'old',offset:11});await f.service.tick();assert.equal(testView(f.a).canSend,false);assert.equal(testView(f.a).state,'unknown');
 f.data.turns.push({id:'new',state:'running',offset:12});await f.service.tick();assert.equal(testView(f.a).canSend,false);assert.equal(testView(f.a).state,'busy');
 f.data.turns[0].state='completed';await f.service.tick();assert.equal(testView(f.a).state,'busy');
 f.data.sessionId='other-session';f.data.turns=[{id:'other',state:'failed',completionOffset:20}];await f.service.tick();assert.equal(testView(f.a).canSend,false);
});

test('discovery prompt carries only recipient identity and stays fixed as the village grows',async t=>{
 const f=await fixture(t);f.a.location='mayor';f.a.projectId='project-one';
 const before=f.service.secretaryContext(f.a);
 const own=JSON.parse(before.split('<ai-village-discovery>')[1].split('</ai-village-discovery>')[0]);
 assert.equal(own.agentId,f.a.id);assert.equal(own.projectId,'project-one');assert.equal(own.role,'secretary');
 assert(!before.includes('nativeTurns'));assert(!before.includes('lastCheckedAt'));
 for(let i=0;i<100;i++)f.service.data.agents.push({...f.a,id:'other-'+i,name:'OTHER-PRIVATE-NAME-'+i,projectId:'different-project'});
 assert.equal(f.service.secretaryContext(f.a),before);assert(before.length<1000);
 assert.equal(f.service.discovery().agents.length,101);
 f.a.projectId='project-two';f.a.metadataRevision=2;
 assert(f.service.secretaryContext(f.a).includes('project-two'));assert(!f.service.secretaryContext(f.a).includes('project-one'));
 f.service.villageUrl='http://core.example:5173';
 assert(f.service.rules.work('q').includes('GET http://core.example:5173/api/direct/agents'));assert(!f.service.secretaryContext(f.a).includes('GET '));
});
test('Agent creation and stop intent save failures happen before external effects',async t=>{
 const f=await fixture(t),s=f.service,write=s.store.write,execute=s.remote;let creates=0,closes=0;
 s.remote=async(args,...rest)=>{if(args[1]==='workspace')creates++;if(args[2]==='close')closes++;return execute(args,...rest);};
 s.store.write=async value=>{if(JSON.parse(value).agents.length>1)throw Error('save failed');return write(value);};
 const input={workshopId:f.w.id,cwd:'/tmp',requestId:'failed-agent-create'};
 await assert.rejects(s.create(input),/save failed/);assert.equal(s.data.agents.length,1);assert.equal(creates,0);
 s.store.write=write;const a=await s.create(input);assert.equal((await s.create(input)).id,a.id);assert.equal(creates,1);
 s.store.write=async()=>{throw Error('save failed');};
 await assert.rejects(s.stop(f.a.id),/save failed/);assert.equal(closes,0);assert.notEqual(f.a.agentModel.intent,'stop');
 s.store.write=write;await s.stop(f.a.id);await s.stop(f.a.id);assert.equal(closes,1);
});
