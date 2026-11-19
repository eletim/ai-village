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
