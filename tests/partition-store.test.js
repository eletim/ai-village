import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PartitionStore} from '../server/partition-store.mjs';

test('scoped commits leave unrelated records untouched; reservations survive restart and stale acknowledgment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-partitions-'));
 const data={requests:[{id:'a',value:0},{id:'b',value:0}]};let selection=null;
 let store=new PartitionStore({dir,capture:()=>data,selection:()=>selection,affected:changes=>changes.filter(c=>c.kind==='requests').map(c=>c.id)});
 try{
  store.open();await store.save();store.acknowledge('a',1);store.acknowledge('b',1);
  selection={requests:[data.requests[0]]};data.requests[0].value=1;
  data.requests[1].toJSON=()=>{throw Error('unrelated request serialized');};
  await store.save();const version=store.jobs.get('a');
  assert.deepEqual(store.lastChanges.map(c=>c.id),['a']);
  data.requests[0].value=2;await store.save();store.acknowledge('a',version);
  assert.equal(store.jobs.get('a'),version+1);
  store.close();store=new PartitionStore({dir});const restored=store.open();
  assert.equal(restored.requests.find(q=>q.id==='a').value,2);
  assert.equal(restored.requests.find(q=>q.id==='b').value,0);
  assert.equal(store.jobs.get('a'),version+1);
  store.acknowledge('a',version+1);assert.equal(store.jobs.size,0);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('record writes and wakeups roll back together when reservation storage fails',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-atomic-'));
 const data={requests:[{id:'a',value:0}]};
 const store=new PartitionStore({dir,capture:()=>data,selection:()=>null,affected:()=>['a']});
 try{
  store.open();await store.save();store.acknowledge('a',1);
  store.db.exec("CREATE TRIGGER fail_wakeup BEFORE INSERT ON wakeups BEGIN SELECT RAISE(ABORT,'reservation failed'); END");
  data.requests[0].value=1;await assert.rejects(store.save(),/reservation failed/);
  assert.equal(JSON.parse(store.db.prepare("SELECT body FROM records WHERE kind='requests'").get().body).value,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM wakeups').get().n,0);
  store.db.exec('DROP TRIGGER fail_wakeup');await store.save();assert.equal(store.jobs.get('a'),1);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('time-only wakeup persists without record changes and survives restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-time-wakeup-'));
 const data={requests:[{id:'a',value:0}]};let store=new PartitionStore({dir,capture:()=>data,selection:()=>null,affected:()=>[]});
 try{
  store.open();await store.save();
  await store.save({wakeups:['a']});assert.deepEqual(store.lastChanges,[]);
  assert.equal(store.jobs.get('a'),1);
  store.close();store=new PartitionStore({dir});store.open();assert.equal(store.jobs.get('a'),1);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('recovery timer wakes only its request even when no data changes',async()=>{
 const {DirectAgents}=await import('../server/direct.mjs');
 const {EventMonitor}=await import('../server/event-monitor.mjs');
 const dir=await mkdtemp(join(tmpdir(),'village-recovery-wakeup-'));
 const r={id:'run-a',humanRequestId:'a',agentId:'agent',runModel:{state:{kind:'ended',outcome:'failed'}},recovery:{status:'scheduled',nextAt:Date.now()+40}};
 const data={requests:[{id:'a'},{id:'b'}],runs:[r],agents:[]},pumped=[];
 const store=new PartitionStore({dir,capture:()=>data,selection:()=>null,affected:()=>[]});store.open();await store.save();
 const d={data,store,units:{agent:(id,fn)=>fn(),run:(id,fn)=>fn()},persist:fn=>fn(),releaseStuckRuns(){},save:options=>store.save(options),flow:{pump:async(wait,qs)=>{pumped.push(...qs.map(q=>q.id));r.recovery.status='enqueued';},notifications:async()=>{},dispatchReady:async()=>{}}};
 d.progress=DirectAgents.prototype.progress.bind(d);const monitor=new EventMonitor(d);
 try{monitor.reserveRecovery();await new Promise(resolve=>setTimeout(resolve,120));assert.deepEqual(pumped,['a']);assert.equal(store.jobs.size,0);assert.equal(r.recovery.status,'enqueued');}
 finally{monitor.close();store.close();await rm(dir,{recursive:true,force:true});}
});

test('failed timer persistence does not consume the timer event',async()=>{
 const {EventMonitor}=await import('../server/event-monitor.mjs');
 const r={id:'r',agentId:'agent',humanRequestId:'a',recovery:{status:'scheduled',nextAt:Date.now()+10}};
 let attempts=0,progress=0;
 const d={data:{runs:[r]},units:{agent:(id,fn)=>fn()},persist:fn=>fn(),releaseStuckRuns(){},save:async options=>{assert.deepEqual(options,{wakeups:['a']});if(++attempts===1)throw Error('temporary write failure');},progress:async()=>{progress++;}};
 const monitor=new EventMonitor(d);
 try{
  monitor.reserveRecovery();await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(attempts,1);assert.equal(monitor.fired.size,0);assert.equal(progress,0);
  // Retry the failed event immediately rather than waiting for production backoff.
  monitor.reserveRecovery();await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(attempts,2);assert.equal(progress,1);assert.equal(monitor.fired.size,1);
 }finally{monitor.close();}
});
