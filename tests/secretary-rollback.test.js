import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {inputHash} from './model-fixtures.mjs';
import {VillageOperations} from '../server/operations.mjs';
for(const fault of [false,true,true,true])test(`order rollback/retry persists finish and never resurrects or resends work (${fault?'fault':'control'})`,async t=>{
 const f=await fixture(t);t.after(()=>f.service.close());
 const p=await f.service.putProject({requestId:randomUUID(),name:'Rollback'});for(const a of f.agents)a.projectId=p.id;
 await f.service.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 f.agents[0].inputEnvelope.contract=3;f.agents[0].inputEnvelope.hash=inputHash(f.service.startupInstructions(f.agents[0]));await f.service.save();
 const h=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'作成してください'});await f.submit(h);
 const order=()=>new VillageOperations({dir:f.options.dir},null,{direct:f.service}).execute(['order','--run',h.id,'成果作成']);
 if(fault){const write=f.service.store.write;f.service.store.write=()=>{throw Object.assign(Error('fixture ENOSPC'),{code:'ENOSPC'});};assert.equal((await order()).ok,false);f.service.store.write=write;assert.equal(f.service.data.requests.length,0);}
 const job=await order();assert.equal(job.ok,true,job.error);assert.deepEqual((await order()).result,job.result);await f.complete(h);
 const r=f.service.flow.run(job.result.runId);await f.submit(r);
 await f.service.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:f.service.flow.inputs(r.humanRequestId,r.workId).map(i=>i.id),results:[]});await f.complete(r);
 const records=kind=>f.service.store.db.prepare('SELECT body FROM records WHERE kind=?').all(kind).map(x=>JSON.parse(x.body));
 assert.equal(records('requests').length,1);assert.equal(records('requests')[0].requestGraph.nodes[0].declarations.length,1);assert.equal(records('requests')[0].requestGraph.nodes[0].state.kind,'completed');assert.equal(records('runs').find(x=>x.id===r.id).runModel.state.outcome,'normal');
 const delivery=f.service.data.conversations[0].deliveries.find(e=>e.kind==='result');assert(delivery);const d=f.service.flow.run(delivery.runId);await f.submit(d);await f.complete(d);
 const sent=f.sent.length;await f.restart();for(let i=0;i<3;i++)await f.service.tick();
 assert.equal(f.sent.length,sent);assert.equal(records('requests').length,1);assert.equal(f.service.data.requests.length,1);assert.equal(f.service.flow.run(r.id).runModel.state.outcome,'normal');assert.equal(f.service.data.conversations[0].deliveries.filter(e=>e.kind==='result').length,1);assert.equal(records('requests')[0].requestGraph.nodes[0].declarations.length,1);
});
