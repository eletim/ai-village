import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {VillageOperations} from '../server/operations.mjs';
import {inspectRequests} from '../server/request-integrity.mjs';
import {reportInputs} from '../server/report-inputs.mjs';

const handle=(s,r,results=[],finish=true)=>s.flow[finish?'finish':'respond']({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id),results});
async function setup(t,outcome='interrupted'){
 const f=await fixture(t),s=f.service;
 const p=await s.send(f.agents[0].id,{instruction:'Finish goal',requestId:randomUUID()});await f.submit(p);
 const c=await f.delegate(p,f.agents[2]),r=s.flow.run(c.currentRunId);await s.tick();await f.submit(r);
 if(outcome==='completed')await handle(s,r);
 if(outcome){await f.complete(r,outcome);f.runtimes.get(r.agentId).turns.at(-1).completionOffset=f.runtimes.get(r.agentId).cursor+1;}
 const args=()=>({humanRequestId:p.humanRequestId,workId:c.id,actorRunId:p.id,targetRunId:r.id,revision:s.flow.root(p.humanRequestId).revision,operationId:randomUUID(),instruction:'Inspect saved changes and external effects; continue only unfinished work'});
 return {...f,s,p,c,r,args};
}
for(const outcome of ['interrupted','failed','completed'])test('parent continues known '+outcome+' same worker; preserves history/source and delivers new result',async t=>{
 const f=await setup(t,outcome),{s,p,r,args}=f,q=s.flow.root(p.humanRequestId),oldFacts=structuredClone(r.runModel.facts);
 const input=args(),created=await s.flow.continueChild(input),next=s.flow.run(created.id);
 assert.equal(next.agentId,r.agentId);assert.equal(next.workId,r.workId);assert.equal(next.runModel.retryOf,r.id);assert.equal(next.runModel.parentRunId,p.id);assert.equal(next.runModel.createdBy,'agent');
 assert.deepEqual(next.travelContexts,r.travelContexts);assert.deepEqual(next.attachments,r.attachments);assert.deepEqual(r.runModel.facts,oldFacts);
 assert.equal(next.instructionSource.actor,'agent');assert(!reportInputs(q,s.data.runs).human.some(i=>i.id===next.id));
 assert.equal((await s.flow.continueChild(input)).id,next.id);
 await assert.rejects(s.flow.continueChild({...input,instruction:'another command'}),/operationId/);
 await handle(s,p,[],false);await f.complete(p);await f.submit(next);await handle(s,next);await f.complete(next);
 const parent=s.flow.run(s.flow.work(q,p.workId).currentRunId);assert.notEqual(parent.id,p.id);await f.submit(parent);
 const entries=s.flow.results(q.id,p.workId),latest=entries.find(e=>e.id===next.id);assert(latest&&!latest.superseded);
 assert(entries.filter(e=>e.id===r.id).every(e=>e.superseded));
 await handle(s,parent,[{requestId:r.workId,resultId:next.id,version:latest.version,decision:'accept'}]);await f.complete(parent);
 assert.deepEqual(inspectRequests(s.data).flatMap(q=>q.reasons),[]);
 assert.equal(s.flow.work(q,r.workId).state.kind,'completed');assert.equal(s.flow.work(q,p.workId).state.kind,'completed');
});
test('reject foreign parent, root, stale revision/run, reassignment and unconfirmed/running',async t=>{
 const {s,p,r,c,args}=await setup(t,null);
 await assert.rejects(s.flow.continueChild(args()),/終了/);
 await assert.rejects(s.flow.continueChild({...args(),actorRunId:r.id}),/現在/);
 await assert.rejects(s.flow.continueChild({...args(),workId:p.workId}),/直接/);
 await assert.rejects(s.flow.continueChild({...args(),revision:-1}),/revision/);
 await assert.rejects(s.flow.continueChild({...args(),targetRunId:randomUUID()}),/最新/);
 await assert.rejects(s.flow.continueChild({...args(),agentId:r.agentId}),/担当変更/);
 r.runModel={...r.runModel,state:{kind:'ended',outcome:'unconfirmed',reason:'lost'}};
 await assert.rejects(s.flow.continueChild(args()),/終了/);
});
for(const decision of ['accept','rework'])test('provisional '+decision+' prevents conflicting continuation',async t=>{
 const {s,p,r,args}=await setup(t,'completed');const e=s.flow.results(p.humanRequestId,p.workId).find(e=>e.id===r.id);
 if(decision==='rework')s.flow.work(s.flow.root(p.humanRequestId),p.workId).claims.push({requestId:r.workId,resultId:r.id,version:e.version,decision,actor:'agent',actorRunId:p.id,operationId:'historical-claim'});else await handle(s,p,[{requestId:r.workId,resultId:r.id,version:e.version,decision}],false);
 const count=s.data.runs.length;await assert.rejects(s.flow.continueChild(args()),/対応申告/);assert.equal(s.data.runs.length,count);
});
test('revision concurrency, save rollback and restart replay create one run',async t=>{
 const f=await setup(t),{s,args}=f,input=args(),count=s.data.runs.length,save=s.save.bind(s);
 let reject=true;s.save=async(...a)=>{if(reject&&s.data.runs.length>count){reject=false;throw Error('injected save failure');}return save(...a);};
 await assert.rejects(s.flow.continueChild(input),/injected/);assert.equal(s.data.runs.length,count);
 const replies=await Promise.all([s.flow.continueChild(input),s.flow.continueChild(input)]);assert.equal(replies[0].id,replies[1].id);assert.equal(s.data.runs.length,count+1);
 await assert.rejects(s.flow.continueChild({...input,operationId:randomUUID()}),/revision/);
 const restarted=await f.restart();assert.equal((await restarted.flow.continueChild(input)).id,replies[0].id);
});
test('native boundary changed/offline rejects and late old completion cannot replace new owner',async t=>{
 const f=await setup(t),{s,p,r,args}=f,native=f.runtimes.get(r.agentId);
 const last=native.turns.at(-1);last.state='running';await assert.rejects(s.flow.continueChild(args()),/idle/);last.state='interrupted';
 const created=await s.flow.continueChild(args());await s.tick();
 Object.assign(last,{state:'completed',finalOutput:'late obsolete output'});await s.tick();
 assert.equal(s.flow.work(s.flow.root(p.humanRequestId),r.workId).currentRunId,created.id);
 assert.equal(r.runModel.state.outcome,'interrupted');
});
test('CLI action is exposed through the shared Agent schema, human retry is not',async t=>{
 const {s,args,options}=await setup(t),ops=new VillageOperations({dir:options.dir},null,{direct:s});
 assert((await ops.execute(['help'])).result.some(c=>c.name==='requests continueChild')); 
 const response=await ops.execute(['requests','continueChild',JSON.stringify(args())]);assert.equal(response.ok,true,JSON.stringify(response));
});
test('queued continuation rechecks native boundary before dispatch; no new send after change',async t=>{
 const f=await setup(t),{s,r,args}=f,created=await s.flow.continueChild(args()),count=f.sent.length;
 f.runtimes.get(r.agentId).turns.at(-1).state='running';await s.tick();
 assert.equal(f.sent.length,count);assert.equal(s.flow.run(created.id).runModel.state.reason,'dispatch-boundary-changed');
});
test('unrelated request actor and completed parent cannot initiate a continuation',async t=>{
 const f=await setup(t),{s,p,args}=f;
 const other=await s.send(f.agents[1].id,{instruction:'Other goal',requestId:randomUUID()});await f.submit(other);
 await assert.rejects(s.flow.continueChild({...args(),actorRunId:other.id}),/現在/);
 await handle(s,p,[],false);await f.complete(p);
 await assert.rejects(s.flow.continueChild(args()),/現在/);
});
test('failed child declarations stay unconfirmed and are invalidated by new attempt',async t=>{
 const f=await setup(t,null),{s,p,r,args}=f;await handle(s,r);await f.complete(r,'failed');f.runtimes.get(r.agentId).turns.at(-1).completionOffset=f.runtimes.get(r.agentId).cursor+1;
 await s.flow.continueChild(args());const node=s.flow.work(s.flow.root(p.humanRequestId),r.workId);
 assert(node.declarations.find(d=>d.runId===r.id).invalidated);assert(node.invalidatedRuns.includes(r.id));
 assert(s.flow.inputs(p.humanRequestId,r.workId).some(i=>!i.handledBy));
});
test('new parent after failed acceptance claim can continue; stale parent cannot',async t=>{
 const f=await setup(t,'completed'),{s,p,r}=f,q=s.flow.root(p.humanRequestId),e=s.flow.results(q.id,p.workId).find(e=>e.id===r.id);
 await handle(s,p,[{requestId:r.workId,resultId:r.id,version:e.version,decision:'accept'}],false);await f.complete(p,'failed');
 // Existing human recovery is used only to set up the next authorized parent turn.
 const raw=await s.flow.continue({humanRequestId:q.id,workId:p.workId,revision:q.revision,operationId:randomUUID(),instruction:'Review remaining child work'},true);
 await s.tick();const parent=s.flow.run(raw.id);await f.submit(parent);
 const x={...f.args(),actorRunId:parent.id};await s.flow.continueChild(x);
 await assert.rejects(s.flow.continueChild({...x,actorRunId:p.id}),/現在/);
});
test('context references and assignee runtime/workspace are preserved without recreation',async t=>{
 const {s,r,args}=await setup(t);const a=s.agent(r.agentId),workspace=a.workspaceId;
 r.contextTravelContexts=[{name:'Referenced place',sshHost:'fixture-only',cwd:'/tmp/disposable-work',notes:'Reference data'}];r.contextAttachments=[{id:'existing-evidence-id',name:'evidence.txt'}];
 const next=await s.flow.continueChild(args());assert.deepEqual(next.travelContexts,r.contextTravelContexts);assert.deepEqual(next.attachments,r.contextAttachments);assert.equal(s.agent(next.agentId).workspaceId,workspace);
});
test('missing completion position, changed session and offline worker reject without new runs',async t=>{
 const f=await setup(t),{s,r,args}=f,native=f.runtimes.get(r.agentId),count=s.data.runs.length,offset=native.turns.at(-1).completionOffset;
 delete native.turns.at(-1).completionOffset;await assert.rejects(s.flow.continueChild(args()),/境界/);native.turns.at(-1).completionOffset=offset;
 const session=native.sessionId;native.sessionId='new-session';await assert.rejects(s.flow.continueChild(args()),/境界/);native.sessionId=session;
 f.offline(true);await assert.rejects(s.flow.continueChild(args()),/境界/);f.offline(false);
 assert.equal(s.data.runs.length,count);
});
test('nested child uses only its own current direct parent, not the root ancestor',async t=>{
 const f=await setup(t,null),{s,p,r}=f,grand=await f.delegate(r,f.agents[3]);await s.tick();const child=s.flow.run(grand.currentRunId);await f.submit(child);await f.complete(child,'interrupted');
 f.runtimes.get(child.agentId).turns.at(-1).completionOffset=f.runtimes.get(child.agentId).cursor+1;
 const x={...f.args(),workId:child.workId,targetRunId:child.id,actorRunId:r.id};
 await assert.rejects(s.flow.continueChild({...x,actorRunId:p.id}),/現在/);assert.equal((await s.flow.continueChild(x)).workId,child.workId);
});
test('replacement launched by a failed parent still prevents duplicate continuation of original',async t=>{
 const f=await setup(t,'completed'),{s,p,r}=f,q=s.flow.root(p.humanRequestId),e=s.flow.results(q.id,p.workId).find(e=>e.id===r.id);
 // Imported pre-upgrade claim, retained for history and duplicate prevention.
 s.flow.work(q,p.workId).claims.push({requestId:r.workId,resultId:r.id,version:e.version,decision:'rework',actor:'agent',actorRunId:p.id,operationId:'historical-rework'});
 // Saved pre-upgrade reservation; the old creation endpoint is no longer available.
 const historical=await f.delegate(p,f.agents[3]);s.flow.work(q,r.workId).replacements.push({replacementId:historical.id,actorRunId:p.id,resultId:r.id,version:e.version});
 await f.complete(p,'failed');
 const raw=await s.flow.continue({humanRequestId:q.id,workId:p.workId,revision:q.revision,operationId:randomUUID(),instruction:'Review existing replacement'},true);await s.tick();const parent=s.flow.run(raw.id);await f.submit(parent);
 await assert.rejects(s.flow.continueChild({...f.args(),actorRunId:parent.id}),/置換予約/);
});
test('already reserved work on the same worker prevents another continuation',async t=>{
 const f=await setup(t),{s,r,args}=f;
 await s.send(r.agentId,{instruction:'Unrelated queued work',requestId:randomUUID()});
 await assert.rejects(s.flow.continueChild(args()),/未終了run|idle/);
});
test('transport response loss keeps one sent continuation and never replays after restart',async t=>{
 const f=await setup(t),{s,args}=f,payload=args(),created=await s.flow.continueChild(payload);f.lose(true);await s.tick();f.lose(false);
 assert.equal(s.flow.run(created.id).runModel.state.kind,'sent');const count=f.sent.length;
 assert.equal((await s.flow.continueChild(payload)).id,created.id);await s.tick();assert.equal(f.sent.length,count);
 const restarted=await f.restart();await restarted.tick();assert.equal((await restarted.flow.continueChild(payload)).id,created.id);assert.equal(f.sent.length,count);
});

for(const outcome of ['interrupted','completed'])test('common followup resolves child execution and retries its recorded operation: '+outcome,async t=>{
 const {s,p,c}=await setup(t,outcome);
 const next=await s.secretaryCommands.followup(p.id,undefined,'残りだけ進める');
 assert.equal(next.workId,c.id);
 assert.equal((await s.secretaryCommands.followup(p.id,undefined,'残りだけ進める')).id,next.id);
 assert.equal(s.flow.work(s.flow.root(p.humanRequestId),c.id).runIds.length,2);
});
test('common supplement retry after terminal does not create a continuation',async t=>{
 const {s,p,r,f,...rest}=await setup(t,null);
 const first=await s.secretaryCommands.followup(p.id,undefined,'補足');
 await rest.complete(r,'interrupted');
 const again=await s.secretaryCommands.followup(p.id,undefined,'補足');
 assert.equal(again.id,first.id);assert.equal(s.flow.work(s.flow.root(p.humanRequestId),r.workId).runIds.length,1);
});
test('common accept reuses its saved payload after the parent ends',async t=>{
 const f=await setup(t,'completed'),{s,p,r}=f;
 await handle(s,p,[],false);await f.complete(p);
 const parent=s.flow.run(s.flow.work(s.flow.root(p.humanRequestId),p.workId).currentRunId);await f.submit(parent);
 const before=await s.secretaryCommands.accept(parent.id,'成果を確認');await f.complete(parent);
 const again=await s.secretaryCommands.accept(parent.id,'成果を確認');assert.equal(again.id,before.id);
});
test('human continuation shares native ownership checks and preserves the work',async t=>{
 const f=await setup(t,'interrupted'),{s,p,r}=f;
 const q=s.flow.root(p.humanRequestId),args={humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:randomUUID(),instruction:'残りだけ継続'};
 f.offline(true);await assert.rejects(s.flow.continue(args,true));f.offline(false);
 const next=await s.flow.continue(args,true);assert.equal(next.workId,r.workId);assert.equal(next.runModel.createdBy,'human');assert.equal((await s.flow.continue(args,true)).id,next.id);
});
test('unknown cannot be continued by the human path and time does not schedule old auto recovery',async t=>{
 const f=await setup(t,'failed'),{s,r,p}=f,q=s.flow.root(p.humanRequestId);
 r.runModel.state={kind:'ended',outcome:'unconfirmed',reason:'tracking-closed'};
 const count=s.data.runs.length;await assert.rejects(s.flow.continue({humanRequestId:q.id,workId:r.workId,revision:q.revision,operationId:randomUUID(),instruction:'再送'},true),/確認/);
 await s.tick();assert.equal(s.data.runs.length,count);
});
test('new authorized parent execution can continue its accepted child as the same work',async t=>{
 const f=await setup(t,'completed'),{s,p,r}=f,q=s.flow.root(p.humanRequestId);
 await handle(s,p,[],false);await f.complete(p);
 const receiver=s.flow.run(s.flow.work(q,p.workId).currentRunId);await f.submit(receiver);
 const e=s.flow.results(q.id,p.workId).find(e=>e.id===r.id);
 await handle(s,receiver,[{requestId:r.workId,resultId:r.id,version:e.version,decision:'accept'}]);await f.complete(receiver);
 const parent=await s.flow.continue({humanRequestId:q.id,workId:p.workId,revision:q.revision,operationId:randomUUID(),instruction:'同じ担当へ追加修正を依頼'},false);await s.tick();await f.submit(parent);
 const next=await s.secretaryCommands.followup(parent.id,undefined,'保存成果を追加修正');
 assert.equal(next.workId,r.workId);assert.equal(q.requestGraph.nodes.length,2);
});

test('common withdraw targets only a directly owned work and preserves execution facts',async t=>{
 const {s,p,r}=await setup(t,'interrupted'),q=s.flow.root(p.humanRequestId),facts=JSON.stringify(r.runModel.facts);
 const first=await s.secretaryCommands.withdraw(p.id,undefined,'この子仕事は不要になった');assert.equal(first.workId,r.workId);assert.equal(s.flow.work(q,r.workId).state.kind,'withdrawn');assert.equal(s.flow.work(q,p.workId).state.kind,'active');assert.equal(JSON.stringify(r.runModel.facts),facts);
 assert.deepEqual(await s.secretaryCommands.withdraw(p.id,undefined,'この子仕事は不要になった'),first);
 await assert.rejects(s.secretaryCommands.withdraw(p.id,p.workId,'自分や別の仕事へ拡大'),/担当の仕事/);
});

test('worker status uses the common bounded facts projection for its interrupted child',async t=>{
 const f=await setup(t,'interrupted'),{s,p,r}=f;
 const status=await s.secretaryCommands.status(p.id),child=status.works.find(w=>w.id===r.workId);
 assert.equal(child.observation,'observed');assert.equal(child.continuation.available,'followup-after-observation');assert.equal(child.execution.outcome,'interrupted');
 f.offline(true);const offline=await s.secretaryCommands.status(p.id);assert.equal(offline.works[0].observation,'unavailable');assert.equal(offline.works[0].continuation.available,false);
});

test('rework rejection leaves the same actor free to use normal followup',async t=>{
 const f=await setup(t,'completed'),{s,p,r}=f,e=s.flow.results(p.humanRequestId,p.workId).find(e=>e.id===r.id),count=s.data.runs.length;
 await assert.rejects(handle(s,p,[{requestId:r.workId,resultId:r.id,version:e.version,decision:'rework'}],false),/followup/);assert.equal(s.data.runs.length,count);
 const next=await s.secretaryCommands.followup(p.id,undefined,'成果を修正');assert.equal(next.workId,r.workId);
});
