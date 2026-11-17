import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newRun} from '../server/state/run.ts';
import {transitionGraph,reconcileGraph,graphSteps} from '../server/state/requests.ts';
import {unifiedData,migrateUnifiedStore,validateGraph} from '../server/unified-requests.mjs';
const run=(id,owner,kind='running',outcome='normal')=>({ownerId:owner,agentId:owner,run:{...newRun(id,'tree','human').value,state:kind==='running'?{kind,sessionId:'s',turnId:id,inputId:'i'}:kind==='ended'?{kind,outcome,reason:'native-terminal'}:{kind},facts:[{type:'input',at:1}]}});
const request=(id,parentId,currentRunId)=>({id,parentId,requester:parentId?{kind:'agent',requestId:parentId,agentId:parentId}:{kind:'human'},assignee:id,runAgents:{[currentRunId]:id},runIds:[currentRunId],currentRunId,reportRunId:null,reportMode:false,state:{kind:'active',review:[]},submissions:[],handling:[],declarations:[],decisions:[]});
const fixture=()=>({version:1,rootId:'parent',nodes:[request('parent',null,'p'),request('child','parent','c')],operations:[]});
test('pure identical lifecycle, actor enforcement, exact result versions and operation idempotence',()=>{
 const input=fixture(),runs=[run('p','parent'),run('c','child','ended')],g=reconcileGraph(input,runs);assert.equal(input.nodes[1].state.kind,'active');assert.equal(g.nodes[1].state.kind,'submitted');
 const event={type:'respond',actor:'agent',requestId:'parent',runId:'p',operationId:'response',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]};
 for(const actor of ['program','human'])assert.equal(transitionGraph(g,{...event,actor},runs).ok,false);
 for(const changes of [{resultId:'p'},{version:2},{requestId:'parent'}])assert.equal(transitionGraph(g,{...event,results:[{...event.results[0],...changes}]},runs).ok,false);
 const changed=transitionGraph(g,event,runs);assert(changed.ok);assert.deepEqual(transitionGraph(changed.value,event,runs).value,changed.value);
 assert.equal(transitionGraph(changed.value,{...event,results:[]},runs).ok,false);assert.equal(graphSteps(changed.value,runs).length,0);
 const declaration=transitionGraph(changed.value,{...event,type:'finish',operationId:'finish',results:[]},runs).value;assert.equal(declaration.nodes[0].state.kind,'active');
 assert.equal(reconcileGraph(declaration,[run('p','parent','ended'),runs[1]]).nodes[0].state.kind,'completed');
});
test('queued delivery reservation retracts but sent/unconfirmed delivery is never consumed by an old actor',()=>{
 const runs=[run('p','parent','ended'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const delivery={...run('d','parent','queued'),run:{...run('d','parent','queued').run,phase:'result',createdBy:'program',resultOf:'c',recipientRunId:'p',retryOf:'p'}};runs.push(delivery);
 g=transitionGraph(g,{type:'attempt',actor:'program',requestId:'parent',runId:'d',report:false},runs).value;
 const event={type:'respond',actor:'agent',requestId:'parent',runId:'p',operationId:'handle',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]};
 assert.equal(transitionGraph(g,event,runs).value.nodes[0].currentRunId,'p');
 for(const state of [{kind:'sent',sessionId:'s',sentAt:1},{kind:'ended',outcome:'unconfirmed',reason:'lost'}])assert.equal(transitionGraph(g,event,[...runs.slice(0,2),{...delivery,run:{...delivery.run,state}}]).ok,false);
});
test('migration is deterministic, idempotent, backs up exact bytes and preserves running evidence and notification history',async t=>{
 const runs=[run('p','parent'),run('c','child','ended')].map(e=>({id:e.run.id,agentId:e.agentId,humanRequestId:'tree',workId:e.ownerId,runModel:e.run,inputCorrelation:{version:1,hash:'exact-input'},baselineRuntime:{sessionId:'s',cursor:7,fileIdentity:'f'}}));
 const source={runs,agents:[{id:'parent'},{id:'child'}],requests:[{id:'tree',rootWorkId:'parent',works:[{id:'parent',parentWorkId:null,agentId:'parent',runIds:['p'],currentRunId:'p'},{id:'child',parentWorkId:'parent',agentId:'child',runIds:['c'],currentRunId:'c'}],notification:{status:'sent',messageId:'request:tree'},requestModel:{state:{kind:'active',review:[]},declarations:[],decisions:[]}}]};
 const original=JSON.stringify(source),a=unifiedData(source);assert.equal(JSON.stringify(source),original);assert.equal(JSON.stringify(unifiedData(source)),JSON.stringify(a));assert.equal(JSON.stringify(unifiedData(a)),JSON.stringify(a));assert.deepEqual(a.runs,source.runs);assert.deepEqual(a.requests[0].notification,source.requests[0].notification);assert(!JSON.stringify(a).includes('requestModel'));assert.equal(a.requests[0].requestModel.state.kind,'active');
 const dir=await mkdtemp(join(tmpdir(),'unified-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'direct.json'),original);
 await migrateUnifiedStore(dir,source);assert.equal(await readFile(join(dir,'direct.pre-unified-requests-v1.json'),'utf8'),original);
 const saved=JSON.parse(await readFile(join(dir,'direct.json'),'utf8'));assert.equal(JSON.stringify(await migrateUnifiedStore(dir,saved)),JSON.stringify(a));
 for(const corrupt of [g=>g.nodes[1].parentId='child',g=>g.nodes[0].handling.push({requestId:'child',resultId:'c',version:999,actorRunId:'p'}),g=>g.nodes[1].runIds.push('p')]){const bad=unifiedData(source);corrupt(bad.requests[0].requestGraph);assert.throws(()=>validateGraph(bad,bad.requests[0]));}
});
test('manual closure cannot hide an executing dependency; terminal failure is preserved under a human decision',()=>{
 const g=fixture(),event={type:'complete',actor:'human',requestId:'parent',reason:'human reviewed outcomes'};
 assert.equal(transitionGraph(g,event,[run('p','parent','ended'),run('c','child')]).ok,false);
 const evidence=[run('p','parent','ended'),run('c','child','ended','failed')];const result=transitionGraph(reconcileGraph(g,evidence),event,evidence);assert(result.ok);assert.equal(result.value.nodes[1].state.by,'human');assert.equal(result.value.nodes[1].submissions[0].outcome,'failed');assert.equal(evidence[1].run.state.outcome,'failed');
});
