import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DirectStore,writeSnapshot} from '../server/direct-store.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('concurrent saves coalesce but mutations during an in-flight write need a second durable barrier',async()=>{
 const data={agents:[{id:'a',state:'idle'}],runs:[]},writes=[],gates=[];
 const store=new DirectStore({capture:()=>data,write:value=>{writes.push(JSON.parse(value));return new Promise(resolve=>gates.push(resolve));}});
 const first=store.save();data.runs.push({id:'one',state:'sending'});const second=store.save();
 await new Promise(setImmediate);assert.equal(writes.length,1);assert.equal(writes[0].runs.length,1);
 data.runs[0].state='running';let complete=false;const third=store.save().then(()=>{complete=true;});
 gates.shift()();await Promise.all([first,second]);assert.equal(complete,false);assert.equal(writes.length,2);assert.equal(writes[1].runs[0].state,'running');
 gates.shift()();await third;assert.equal(complete,true);
 data.agents[0].lastCheckedAt='later';data.agents[0].runtime={cliState:'idle'};await store.save();assert.equal(writes.length,2);
});
test('failed writes reject callers and retry rather than treating state as persisted',async()=>{
 const data={agents:[],requests:[{status:'active'}]};let attempts=0;
 const store=new DirectStore({capture:()=>data,write:async()=>{if(++attempts===1)throw Error('disk failure');}});
 await assert.rejects(store.save(),/disk failure/);await store.save();assert.equal(attempts,2);
 data.requests[0].status='completed';await store.save();assert.equal(attempts,3);
});
test('snapshot replacement is restart readable and later instances persist their own initial state',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'direct-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const data={agents:[{id:'a',state:'unknown'}],requests:[]};const store=new DirectStore({capture:()=>data,write:value=>writeSnapshot(dir,value)});
 await store.save();assert.deepEqual(JSON.parse(await readFile(join(dir,'direct.json'),'utf8')),data);
 data.requests.push({id:'q'});await store.save();assert.deepEqual(JSON.parse(await readFile(join(dir,'direct.json'),'utf8')),data);
});
