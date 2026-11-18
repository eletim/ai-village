import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newRun} from '../server/state/run.ts';
import {transitionGraph,reconcileGraph,graphSteps,waitingReason} from '../server/state/requests.ts';
import {unifiedData,migrateUnifiedStore} from '../server/unified-request-migration.mjs';
import {validateGraph} from '../server/unified-requests.mjs';
const run=(id,owner,kind='running',outcome='normal')=>({ownerId:owner,agentId:owner,run:{...newRun(id,'tree','human').value,state:kind==='running'?{kind,sessionId:'s',turnId:id,inputId:'i'}:kind==='ended'?{kind,outcome,reason:'native-terminal'}:{kind},facts:[{type:'input',at:1}]}});
const request=(id,parentId,currentRunId)=>({metadata:{},id,parentId,requester:parentId?{kind:'agent',requestId:parentId,agentId:parentId}:{kind:'human'},assignee:id,runAgents:{[currentRunId]:id},runIds:[currentRunId],currentRunId,reportRunId:null,reportMode:false,state:{kind:'active',review:[]},submissions:[],claims:[],replacements:[],invalidatedRuns:[],handling:[],declarations:[],decisions:[]});
const fixture=()=>({version:3,rootId:'parent',nodes:[request('parent',null,'p'),request('child','parent','c')],operations:[]});
test('pure identical lifecycle, actor enforcement, exact result versions and operation idempotence',()=>{
 const input=fixture(),runs=[run('p','parent'),run('c','child','ended')],g=reconcileGraph(input,runs);assert.equal(input.nodes[1].state.kind,'active');assert.equal(g.nodes[1].state.kind,'submitted');
 const event={type:'respond',actor:'agent',requestId:'parent',runId:'p',operationId:'response',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]};
 for(const actor of ['program','human'])assert.equal(transitionGraph(g,{...event,actor},runs).ok,false);
 for(const changes of [{resultId:'p'},{version:2},{requestId:'parent'}])assert.equal(transitionGraph(g,{...event,results:[{...event.results[0],...changes}]},runs).ok,false);
 const changed=transitionGraph(g,event,runs);assert(changed.ok);assert.deepEqual(transitionGraph(changed.value,event,runs).value,changed.value);
 assert.equal(transitionGraph(changed.value,{...event,results:[]},runs).ok,false);assert.equal(graphSteps(changed.value,runs).length,1);
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
 const original=JSON.stringify(source),a=unifiedData(source);const inconsistent=structuredClone(a);inconsistent.requests[0].requestGraph.version=2;assert.throws(()=>unifiedData(inconsistent),/Inconsistent/);assert.equal(JSON.stringify(source),original);assert.equal(JSON.stringify(unifiedData(source)),JSON.stringify(a));assert.equal(JSON.stringify(unifiedData(a)),JSON.stringify(a));assert.deepEqual(a.runs,source.runs);assert.deepEqual(a.requests[0].notification,source.requests[0].notification);assert(!JSON.stringify(a).includes('requestModel'));assert.equal(a.requests[0].requestGraph.nodes[0].state.kind,'active');
 const dir=await mkdtemp(join(tmpdir(),'unified-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'direct.json'),original);
 await migrateUnifiedStore(dir,source);assert.equal(await readFile(join(dir,'direct.pre-unified-requests-v3.json'),'utf8'),original);
 const saved=JSON.parse(await readFile(join(dir,'direct.json'),'utf8'));assert.equal(JSON.stringify(await migrateUnifiedStore(dir,saved)),JSON.stringify(a));
 for(const corrupt of [g=>g.nodes[1].parentId='child',g=>g.nodes[0].handling.push({requestId:'child',resultId:'c',version:999,actorRunId:'p'}),g=>g.nodes[1].runIds.push('p')]){const bad=unifiedData(source);corrupt(bad.requests[0].requestGraph);assert.throws(()=>validateGraph(bad,bad.requests[0]));}
});
test('manual closure cannot hide an executing dependency; terminal failure is preserved under a human decision',()=>{
 const g=fixture(),event={type:'complete',actor:'human',requestId:'parent',reason:'human reviewed outcomes'};
 assert.equal(transitionGraph(g,event,[run('p','parent','ended'),run('c','child')]).ok,false);
 const evidence=[run('p','parent','ended'),run('c','child','ended','failed')];const result=transitionGraph(reconcileGraph(g,evidence),event,evidence);assert(result.ok);assert.equal(result.value.nodes[1].state.by,'human');assert.equal(result.value.nodes[1].submissions[0].outcome,'failed');assert.equal(evidence[1].run.state.outcome,'failed');
});

for(const action of ['respond','finish'])for(const decision of ['accept','rework'])for(const outcome of ['normal','failed','interrupted','unconfirmed'])test(`${action} ${decision} commits only on its own normal end: ${outcome}`,()=>{
 const runs=[run('p','parent'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const event={type:action,actor:'agent',requestId:'parent',runId:'p',operationId:'claim',at:1,results:[{requestId:'child',resultId:'c',version:1,decision}]};
 g=transitionGraph(g,event,runs).value;
 assert.equal(g.nodes[0].claims.length,1);assert.equal(g.nodes[0].handling.length,0);assert.equal(g.nodes[1].state.kind,'submitted');assert.equal(graphSteps(g,runs).length,1);
 const ended=[run('p','parent','ended',outcome),runs[1]];g=reconcileGraph(g,ended);
 assert.equal(g.nodes[0].handling.length,outcome==='normal'?1:0);assert.equal(g.nodes[1].state.kind,outcome==='normal'&&decision==='accept'?'completed':'submitted');
 assert.equal(graphSteps(g,ended).length,outcome==='normal'?0:1);
 assert.deepEqual(reconcileGraph(g,ended),g);
});
test('partial claims remain uncommitted after failure; a later valid run can make a different decision',()=>{
 const runs=[run('p','parent'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const claim={type:'respond',actor:'agent',requestId:'parent',runId:'p',operationId:'old',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'rework'}]};
 g=transitionGraph(g,claim,runs).value;runs[0]=run('p','parent','ended','failed');g=reconcileGraph(g,runs);
 const next=run('next','parent','queued');next.run.retryOf='p';runs.push(next);
 g=transitionGraph(g,{type:'attempt',actor:'human',requestId:'parent',runId:'next',report:false},runs).value;
 runs[2]=run('next','parent');runs[2].run.retryOf='p';
 g=transitionGraph(g,{...claim,runId:'next',operationId:'new',results:[{...claim.results[0],decision:'accept'}]},runs).value;
 assert.equal(g.nodes[0].handling.length,0);runs[2]=run('next','parent','ended');g=reconcileGraph(g,runs);
 assert.equal(g.nodes[0].handling.length,1);assert.equal(g.nodes[0].handling[0].actorRunId,'next');assert.equal(g.nodes[1].state.kind,'completed');
});
test('replacement reservation is not dependency resolution until the declaring run succeeds',()=>{
 for(const outcome of ['normal','failed','interrupted','unconfirmed']){
  const runs=[run('p','parent'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
  g=transitionGraph(g,{type:'respond',actor:'agent',requestId:'parent',runId:'p',operationId:'rework',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'rework'}]},runs).value;
  const replacement=request('newchild','parent','nc');g=transitionGraph(g,{type:'add',actor:'agent',request:replacement},runs).value;runs.push(run('nc','newchild'));
  g=transitionGraph(g,{type:'replace',actor:'agent',requestId:'parent',childId:'child',replacementId:'newchild'},runs).value;
  assert.equal(g.nodes[1].replacementId,undefined);assert.equal(g.nodes[1].state.kind,'submitted');
  runs[0]=run('p','parent','ended',outcome);g=reconcileGraph(g,runs);
  assert.equal(g.nodes[1].replacementId,outcome==='normal'?'newchild':undefined);assert.equal(g.nodes[1].replacements.length,1);
 }
});
test('supplement cancellation cannot revive old claims or finish declarations; fresh declaration can proceed',()=>{
 const runs=[run('p','parent'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const event={type:'finish',actor:'agent',requestId:'parent',runId:'p',operationId:'old',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]};g=transitionGraph(g,event,runs).value;
 const supplement=run('s','parent','queued');supplement.run.retryOf='p';runs.push(supplement);
 g=transitionGraph(g,{type:'attempt',actor:'human',requestId:'parent',runId:'s',report:false},runs).value;
 runs[2].run.state={kind:'cancelled',reason:'human'};g.nodes[0].currentRunId='p';runs[0]=run('p','parent','ended');g=reconcileGraph(g,runs);
 assert.equal(g.nodes[0].handling.length,0);assert.equal(g.nodes[1].state.kind,'submitted');assert.equal(g.nodes[0].state.kind,'active');
 g=transitionGraph(g,{...event,operationId:'fresh'},runs).value;assert.equal(g.nodes[0].state.kind,'completed');assert.equal(g.nodes[0].handling.length,1);
});
test('unrelated result receipt does not erase prior failure review; nested failure remains visible',()=>{
 const runs=[run('p','parent','ended','failed'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const delivery=run('d','parent','queued');Object.assign(delivery.run,{phase:'result',createdBy:'program',retryOf:'p',resultOf:'c'});runs.push(delivery);
 g=transitionGraph(g,{type:'attempt',actor:'program',requestId:'parent',runId:'d',report:false},runs).value;
 runs[2].run.state={kind:'ended',outcome:'normal',reason:'native'};g=reconcileGraph(g,runs);
 assert(g.nodes[0].state.review.includes('run-needs-review:p'));assert.equal(g.nodes[1].state.kind,'completed');
 const grand=request('grand','child','gc'),nested=fixture();nested.nodes.push(grand);const failure=reconcileGraph(nested,[run('p','parent'),run('c','child'),run('gc','grand','ended','failed')]);
 assert(failure.nodes[0].state.review.includes('child-needs-review'));assert(failure.nodes[1].state.review.includes('child-needs-review'));
});

function persisted(g,runs){return {unifiedRequestVersion:3,runs:runs.map(e=>({id:e.run.id,agentId:e.agentId,humanRequestId:'tree',workId:e.ownerId,runModel:e.run})),requests:[{id:'tree',rootWorkId:g.rootId,...(g.version<3?{works:g.nodes.map(n=>({id:n.id,parentWorkId:n.parentId,agentId:n.assignee,runIds:n.runIds,currentRunId:n.currentRunId}))}:{}),requestGraph:g,notification:{status:'sent',messageId:'existing-effect'}}]};}
test('persisted claims and handling validate operation, native outcome, owner and supersession evidence',()=>{
 const runs=[run('p','parent'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const event={type:'finish',actor:'agent',requestId:'parent',runId:'p',operationId:'claim',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]};
 g=transitionGraph(g,event,runs).value;const pending=persisted(g,runs);validateGraph(pending,pending.requests[0]);assert.deepEqual(JSON.parse(JSON.stringify(unifiedData(pending))),pending);
 runs[0]=run('p','parent','ended');g=reconcileGraph(g,runs);const confirmed=persisted(g,runs);validateGraph(confirmed,confirmed.requests[0]);
 for(const corrupt of [d=>d.runs[0].runModel.state.outcome='failed',d=>d.runs[0].runModel.supersededBy='new',d=>d.requests[0].requestGraph.nodes[0].claims[0].invalidated='superseded',d=>d.requests[0].requestGraph.nodes[0].handling[0].actorRunId='c',d=>d.requests[0].requestGraph.operations[0].payload='{}',d=>d.requests[0].requestGraph.nodes[0].handling[0].actor='program']){
  const bad=structuredClone(confirmed);corrupt(bad);assert.throws(()=>validateGraph(bad,bad.requests[0]));
 }
});
test('v1 premature handling becomes unconfirmed audit data, preserving sent effects with deterministic v2 upgrade',async t=>{
 const runs=[run('p','parent'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const event={type:'finish',actor:'agent',requestId:'parent',runId:'p',operationId:'claim',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]};
 g=transitionGraph(g,event,runs).value;
 g.nodes[0].handling=g.nodes[0].claims.map(({legacy,...h})=>h);g.nodes[1].state={kind:'completed',by:'agent',reason:'result-accepted:c'};
 for(const n of g.nodes){delete n.claims;delete n.replacements;delete n.invalidatedRuns;}g.version=1;
 const v1=persisted(g,runs);v1.unifiedRequestVersion=1;const copy=JSON.stringify(v1),v2=unifiedData(v1);
 assert.equal(JSON.stringify(v1),copy);assert.equal(v2.unifiedRequestVersion,3);assert.equal(v2.requests[0].requestGraph.nodes[0].handling.length,0);assert.equal(v2.requests[0].requestGraph.nodes[0].claims.length,1);assert.equal(v2.requests[0].requestGraph.nodes[1].state.kind,'active');assert.deepEqual(v2.requests[0].notification,v1.requests[0].notification);assert.equal(JSON.stringify(unifiedData(v2)),JSON.stringify(v2));
 const dir=await mkdtemp(join(tmpdir(),'unified-v2-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'direct.json'),copy);await migrateUnifiedStore(dir,v1);assert.equal(await readFile(join(dir,'direct.pre-unified-requests-v3.json'),'utf8'),copy);
});

test('ordinary human supplement does not clear an unrelated failure review',()=>{
 const runs=[run('p','parent','ended','failed'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 const delivery=run('d','parent','queued');Object.assign(delivery.run,{phase:'result',createdBy:'program',retryOf:'p',resultOf:'c'});runs.push(delivery);g=transitionGraph(g,{type:'attempt',actor:'program',requestId:'parent',runId:'d',report:false},runs).value;
 runs[2].run.state={kind:'running',sessionId:'s',turnId:'d',inputId:'d'};
 const supplement=run('supplement','parent','queued');supplement.run.retryOf='d';runs.push(supplement);
 g=transitionGraph(g,{type:'attempt',actor:'human',requestId:'parent',runId:'supplement',report:false},runs).value;
 assert(g.nodes[0].state.review.includes('run-needs-review:p'));
 runs[3]=run('supplement','parent','ended');g=reconcileGraph(g,runs);assert(g.nodes[0].state.review.includes('run-needs-review:p'));
});

test('withdrawal remains terminal even if a pending declaring run later ends normally',()=>{
 const runs=[run('p','parent'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 g=transitionGraph(g,{type:'finish',actor:'agent',requestId:'parent',runId:'p',operationId:'pending',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]},runs).value;
 g=transitionGraph(g,{type:'withdraw',actor:'human',requestId:'parent',reason:'cancel'},runs).value;runs[0]=run('p','parent','ended');g=reconcileGraph(g,runs);
 assert.equal(g.nodes[0].handling.length,0);assert.equal(g.nodes[0].state.kind,'withdrawn');assert.equal(g.nodes[1].state.kind,'withdrawn');
});

test('automatic receipt of failure records review, never implicit acceptance',()=>{
 const runs=[run('p','parent','ended'),run('c','child','ended','failed')];let g=reconcileGraph(fixture(),runs);
 const delivery=run('d','parent','queued');Object.assign(delivery.run,{phase:'result',createdBy:'program',retryOf:'p',resultOf:'c'});runs.push(delivery);
 g=transitionGraph(g,{type:'attempt',actor:'program',requestId:'parent',runId:'d',report:false},runs).value;
 runs[2].run.state={kind:'ended',outcome:'normal',reason:'native'};g=reconcileGraph(g,runs);
 assert.equal(g.nodes[0].handling[0].decision,'review');assert.equal(g.nodes[1].state.kind,'active');assert.equal(graphSteps(g,runs).length,0);
 const data=persisted(g,runs);validateGraph(data,data.requests[0]);
});

test('a migrated receipt-only claim does not prevent an explicit decision in the same still-running run',()=>{
 const runs=[run('p','parent'),run('c','child','ended','failed')];let g=reconcileGraph(fixture(),runs);
 const event={type:'finish',actor:'agent',requestId:'parent',runId:'p',operationId:'old',at:1,results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}]};
 g=transitionGraph(g,event,runs).value;g.nodes[0].claims[0].legacy=true;g.version=2;
 const source=persisted(g,runs);source.unifiedRequestVersion=2;g=unifiedData(source).requests[0].requestGraph;
 assert.equal(g.nodes[0].claims[0].decision,'review');
 const result=transitionGraph(g,{...event,operationId:'explicit'},runs);assert(result.ok);g=result.value;assert.equal(g.nodes[0].claims.length,2);assert.equal(g.nodes[1].state.kind,'active');
 runs[0]=run('p','parent','ended');g=reconcileGraph(g,runs);assert.equal(g.nodes[1].state.kind,'completed');assert.equal(g.nodes[0].handling.at(-1).decision,'accept');
});

test('previous quarantine cannot hide a conflicting v2 owner during boot inspection',async()=>{
 const {inspectRequests}=await import('../server/request-integrity.mjs');
 const runs=[run('p','parent'),run('c','child','ended')],g=reconcileGraph(fixture(),runs);g.version=2;
 const source=persisted(g,runs);source.unifiedRequestVersion=2;source.agents=[{id:'parent'},{id:'child'}];
 assert.deepEqual(inspectRequests(source)[0].reasons,[]);
 source.requests[0].integrity={version:1,reasons:['previous rejection']};g.nodes[1].assignee='other';
 assert(inspectRequests(source)[0].reasons.includes('Conflicting legacy ownership'));
});


test('normal dependency waits are shared across depth and partial results, while actionable stops retain review',()=>{
 for(const kind of ['queued','sent','running']){
  const runs=[run('p','parent','ended'),run('c','child',kind)],g=reconcileGraph(fixture(),runs);
  assert.deepEqual(g.nodes[0].state,{kind:'active',review:[]});assert.equal(waitingReason(g,g.nodes[0],runs),'dependencies');
 }
 const source=fixture();source.nodes.push(request('grandchild','child','gc'),request('sibling','parent','s'));
 const runs=[run('p','parent','ended'),run('c','child','ended'),run('gc','grandchild'),run('s','sibling','ended')];
 const g=reconcileGraph(source,runs);assert.deepEqual(g.nodes[0].state.review,[]);assert.deepEqual(g.nodes[1].state.review,[]);
 assert.equal(waitingReason(g,g.nodes[0],runs),'result-delivery');assert.equal(waitingReason(g,g.nodes[1],runs),'dependencies');
 for(const outcome of ['failed','interrupted','unconfirmed']){
  const bad=reconcileGraph(source,[...runs.slice(0,2),run('gc','grandchild','ended',outcome),runs[3]]);
  assert(bad.nodes[0].state.review.includes('child-needs-review'));assert(bad.nodes[1].state.review.includes('child-needs-review'));
 }
});
test('delivery reservations and execution are normal waits; consumed result without finish has no next step',()=>{
 const runs=[run('p','parent','ended'),run('c','child','ended')];let g=reconcileGraph(fixture(),runs);
 assert.deepEqual(g.nodes[0].state.review,[]);assert.equal(waitingReason(g,g.nodes[0],runs),'result-delivery');
 for(const kind of ['queued','sent','running']){
  const d=run('d','parent','queued');Object.assign(d.run,{phase:'result',createdBy:'program',resultOf:'c',retryOf:'p'});
  const next=transitionGraph(g,{type:'attempt',actor:'program',requestId:'parent',runId:'d',report:false},[...runs,d]).value;
  d.run.state=run('d','parent',kind).run.state;
  assert.deepEqual(reconcileGraph(next,[...runs,d]).nodes[0].state.review,[]);assert.equal(waitingReason(next,next.nodes[0],[...runs,d]),'result-processing');
 }
 const accepted=transitionGraph(g,{type:'respond',actor:'agent',requestId:'parent',runId:'p',operationId:'consume',results:[{requestId:'child',resultId:'c',version:1,decision:'accept'}],at:1},runs).value;
 assert(accepted.nodes[0].state.review.includes('progress-stalled'));assert.equal(waitingReason(accepted,accepted.nodes[0],runs),null);
 const unavailable=structuredClone(g);unavailable.nodes[0].state.review.push('next-step-agent-unavailable');assert(reconcileGraph(unavailable,runs).nodes[0].state.review.includes('next-step-agent-unavailable'));
});
test('v2 and v3 reevaluate erroneous waiting labels without erasing failure history or native facts',()=>{
 for(const version of [2,3]){
  const g=fixture();g.version=version;g.nodes[0].state.review=['dependencies-unresolved','run-needs-review:old'];
  const data=persisted(g,[run('p','parent','ended'),run('c','child')]);if(version===2)data.unifiedRequestVersion=2;
  const migrated=unifiedData(data);assert.deepEqual(migrated.requests[0].requestGraph.nodes[0].state.review,['run-needs-review:old']);assert.deepEqual(migrated.runs,data.runs);assert.deepEqual(unifiedData(migrated),migrated);
 }
});
