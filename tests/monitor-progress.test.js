import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './inbox-fixture.js';
import {DirectAgents} from '../server/direct.mjs';
test('unchanged observations do not save or replace presentation; real change invalidates it',async t=>{
 const f=await fixture(t),s=f.service;let writes=0;const save=s.save.bind(s);s.save=async()=>{writes++;return save();};
 s.presentation();const cache=s.presentationCache;
 await s.tick();await s.tick();assert.equal(writes,0);assert.equal(s.presentationCache,cache);
 f.agents[0].name='renamed';await s.save();assert.equal(s.presentationCache,null);assert.equal(s.presentation().agents[0].name,'renamed');
});
test('unchanged and skipped Agents coalesce progress; a slow monitor never blocks another cycle',async t=>{
 const f=await fixture(t),s=f.service;let release;const gate=new Promise(r=>release=r),calls=new Map();let pumps=0;const pump=s.flow.pump.bind(s.flow);s.flow.pump=async(...x)=>{pumps++;return pump(...x);};
 const poll=s.poll.bind(s);s.poll=async a=>{calls.set(a.id,(calls.get(a.id)||0)+1);if(a.id===f.agents[0].id)await gate;return poll(a);};
 const first=s.tick();await s.monitors.get(f.agents[1].id);await s.tick();assert.equal(calls.get(f.agents[0].id),1);await s.tick();assert(calls.get(f.agents[1].id)>=2);assert(pumps<=3);release();await first;
});
test('scoped observation rollback preserves unrelated requests and existing object identity',async t=>{
 const f=await fixture(t),s=f.service,a=f.agents[0];const before=structuredClone(a),original=s.store.write;
 s.store.write=async()=>{throw Error('disk failure');};
 await assert.rejects(s.persist(async()=>{a.name='bad';await s.save();},{agent:a}),/disk failure/);
 assert.deepEqual(a,before);s.store.write=original;
});
