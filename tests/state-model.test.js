import {checkProgress,stalledRequests,nextSteps} from '../server/state/progress.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {newRun,transitionRun,retryRun} from '../server/state/run.ts';
import {newRequest,transitionRequest,reconcile} from '../server/state/request.ts';
import {deriveAgent,transitionAgent,sendControls} from '../server/state/agent.ts';
import {migrateDirect} from '../server/state/migrate.ts';
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const no=r=>assert.equal(r.ok,false,JSON.stringify(r));
const queued=()=>ok(newRun('r','q','human'));
const dispatch={type:'dispatch',actor:'program',at:1,sessionId:'s',agentIdle:true};
const input={type:'input',actor:'program',at:2,sessionId:'s',turnId:'t',inputId:'i',text:'human\n<ai-village-input>ai-village-run-r</ai-village-input>',competing:false};
const terminal={type:'terminal',actor:'program',at:3,sessionId:'s',turnId:'t',outcome:'normal'};
const sent=()=>ok(transitionRun(queued(),dispatch));
const running=()=>ok(transitionRun(sent(),input));
const failure=()=>ok(transitionRun(running(),{...terminal,outcome:'failed',errorCode:'server_overloaded'}));
const active=()=>ok(newRequest('q','r','human'));
const event=(q,runId,e)=>ok(transitionRequest(q,{type:'run-event',actor:'program',runId,event:e}));
const runRoot=q=>event(event(q,'r',dispatch),'r',input);
const deepFreeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))deepFreeze(v);}return x;};

test('Node 22 executes unconnected erasable TS modules, transitions are immutable',()=>{
 const r=deepFreeze(queued()),before=structuredClone(r);ok(transitionRun(r,dispatch));assert.deepEqual(r,before);
 const q=deepFreeze(active());runRoot(q);assert.equal(q.runs[0].state.kind,'queued');
});
test('run creation actor restrictions and complete native transition sequence',()=>{
 no(newRun('r','q','program'));no(newRun('r','q','agent'));ok(newRun('child','q','agent','r'));
 assert.equal(sent().state.kind,'sent');assert.equal(running().state.kind,'running');
 for(const outcome of ['normal','failed','interrupted'])assert.equal(ok(transitionRun(running(),{...terminal,outcome})).state.outcome,outcome);
 no(transitionRun(queued(),{...dispatch,agentIdle:false}));no(transitionRun(running(),dispatch));
 no(transitionRun(sent(),{...input,text:'assistant says success'}));no(transitionRun(sent(),{...input,text:'ai-village-run-r-extra'}));
 no(transitionRun(sent(),{...input,competing:true}));no(transitionRun(sent(),{...input,sessionId:'other'}));
 no(transitionRun(sent(),terminal));no(transitionRun(running(),{...terminal,turnId:'other'}));no(transitionRun(running(),{...terminal,sessionId:'other'}));
 for(const reason of ['session-changed','turn-ended-without-marker','timeout']){
  for(const r of [sent(),running()])assert.equal(ok(transitionRun(r,{type:'lost',actor:'program',at:10,reason})).state.outcome,'unconfirmed');
 }
 no(transitionRun(queued(),{type:'lost',actor:'program',at:10,reason:'timeout'}));
});
test('all run event types reject every wrong authority, including forged JS callers',()=>{
 const cases=[[queued(),dispatch],[sent(),input],[running(),terminal],[sent(),{type:'lost',actor:'program',at:4,reason:'timeout'}],[queued(),{type:'cancel',actor:'human'}],[sent(),{type:'close-tracking',actor:'human',reason:'operator decision'}]];
 for(const [r,e] of cases)for(const actor of ['program','agent','human'].filter(a=>a!==e.actor))assert.equal(transitionRun(r,{...e,actor}).reason,'actor-forbidden');
});
test('every nonterminal run has a human exit without fabricating native success; terminal facts cannot be rewritten',()=>{
 const cancelled=ok(transitionRun(queued(),{type:'cancel',actor:'human'}));assert.equal(cancelled.state.kind,'cancelled');
 for(const r of [sent(),running()]){
  no(transitionRun(r,{type:'cancel',actor:'human'}));
  const end=ok(transitionRun(r,{type:'close-tracking',actor:'human',reason:'stop waiting'}));
  assert.equal(end.state.outcome,'unconfirmed');assert.deepEqual(end.facts,r.facts);assert.equal(end.decisions[0].actor,'human');
  no(transitionRun(end,terminal));
 }
 no(transitionRun(cancelled,dispatch));no(transitionRun(ok(transitionRun(running(),terminal)),terminal));
});
test('retry creates new attempts only; automatic retry is bounded to verified server_overloaded',()=>{
 const e={type:'retry',actor:'program',id:'retry1',at:4,boundaryConfirmed:true,agentIdle:true,leafRoot:true};
 const failed=deepFreeze(failure()),next=ok(retryRun(failed,e));assert.equal(next.id,'retry1');assert.equal(next.retryOf,'r');assert.equal(next.retryBudget.count,1);assert.equal(failed.state.outcome,'failed');
 no(retryRun(failed,{...e,actor:'agent'}));no(retryRun(failed,{...e,id:'r'}));
 for(const field of ['boundaryConfirmed','agentIdle','leafRoot'])no(retryRun(failed,{...e,[field]:false}));
 for(const at of [2,600003,NaN])no(retryRun(failed,{...e,at}));
 no(retryRun({...failed,retryBudget:{count:2,firstFailureAt:3}},e));
 ok(retryRun({...failed,retryBudget:{count:1,firstFailureAt:3}},e));
 for(const outcome of ['interrupted','unconfirmed','normal'])no(retryRun({...failed,state:{kind:'ended',outcome,reason:'test'}},e));
 no(retryRun({...failed,state:{...failed.state,errorCode:'other'}},e));
 no(retryRun({...failed,parentRunId:'parent'},e));no(retryRun({...failed,phase:'report'},e));
 for(const outcome of ['failed','interrupted','unconfirmed'])ok(retryRun({...failed,state:{kind:'ended',outcome,reason:'test'}},{type:'retry',actor:'human',id:'new',at:4}));
});
test('Agent facts alone determine controls; observations and human stop have separate authority',()=>{
 const empty={id:'a',intent:null,observation:null};assert.equal(deriveAgent(empty).kind,'unreachable');
 let a=ok(transitionAgent(empty,{type:'start',actor:'human'}));assert.equal(deriveAgent(a).kind,'starting');
 for(const activity of ['idle','running','input-needed','unknown']){
  const observation={connected:true,process:'alive',activity,canSteer:true};
  const value=ok(transitionAgent(a,{type:'observe',actor:'program',observation}));
  assert.equal(deriveAgent(value).kind,activity==='unknown'?'unreachable':activity);
  assert.equal(sendControls(value).send,activity==='idle');assert.equal(sendControls(value).steer,activity==='running');
  const stopping=ok(transitionAgent(value,{type:'stop',actor:'human'}));assert.equal(deriveAgent(stopping).kind,'stopping');
  const ended=ok(transitionAgent(stopping,{type:'observe',actor:'program',observation:{...observation,process:'absent'}}));assert.equal(deriveAgent(ended).kind,'ended');
  ok(transitionAgent(ended,{type:'start',actor:'human'}));
 }
 a=ok(transitionAgent(a,{type:'observe',actor:'program',observation:{connected:false,process:'unknown',activity:'unknown',canSteer:false}}));
 assert.equal(deriveAgent(ok(transitionAgent(a,{type:'stop',actor:'human'}))).kind,'unreachable'); // no fake process exit
 assert.deepEqual(sendControls(a),{send:false,queue:false,steer:false});
 for(const e of [{type:'start',actor:'human'},{type:'stop',actor:'human'},{type:'observe',actor:'program',observation:a.observation}])for(const actor of ['program','agent','human'].filter(x=>x!==e.actor))no(transitionAgent(empty,{...e,actor}));
});
test('no-delegation request completes on normal native return without declaration or prose',()=>{
 no(newRequest('q','r','agent'));no(newRequest('q','r','program'));
 const q=event(runRoot(active()),'r',terminal);assert.equal(q.state.kind,'completed');assert.equal(q.declarations.length,0);
 no(transitionRequest(q,{type:'retry',actor:'human',runId:'r',retry:{type:'retry',actor:'human',id:'new',at:10}}));
 no(transitionRequest(q,{type:'delegate',actor:'agent',parentRunId:'r',id:'child'}));
});
test('delegated completion records early claims, needs claimant normal return, has no acknowledge operation',()=>{
 let q=runRoot(active());q=ok(transitionRequest(q,{type:'delegate',actor:'agent',parentRunId:'r',id:'child'}));
 q=event(q,'child',dispatch);q=event(q,'child',{...input,text:'ai-village-run-child',turnId:'ct'});q=event(q,'child',{...terminal,turnId:'ct'});
 q=ok(transitionRequest(q,{type:'deliver-result',actor:'program',id:'delivery',childRunId:'child'}));
 q=event(q,'r',terminal);q=event(q,'delivery',dispatch);q=event(q,'delivery',{...input,text:'ai-village-run-delivery'});
 q=ok(transitionRequest(q,{type:'declare-complete',actor:'agent',id:'claim',runId:'delivery',at:2}));assert.equal(q.declarations.length,1);assert.equal(q.state.kind,'active');
 q=event(q,'delivery',terminal);assert.equal(q.state.kind,'completed');
 const late=ok(transitionRequest(q,{type:'declare-complete',actor:'agent',id:'late',runId:'missing',at:8}));assert.equal(late.state.kind,'completed');assert.equal(late.declarations.length,2);
});
test('unverified declarations are recorded; contradictory facts require human review',()=>{
 let q=ok(transitionRequest(active(),{type:'declare-complete',actor:'agent',id:'early',runId:'r',at:0}));assert.equal(q.declarations.length,1);
 q=event(q,'r',dispatch);q=event(q,'r',{type:'lost',actor:'program',at:10,reason:'timeout'});
 assert.equal(q.state.kind,'active');assert(q.state.review.includes('declaration-conflict:early'));
 const facts=structuredClone(q.runs);
 for(const type of ['complete-as-human','withdraw']){const ended=ok(transitionRequest(q,{type,actor:'human',reason:'reviewed'}));assert.notEqual(ended.state.kind,'active');assert.deepEqual(ended.runs,facts);}
 q=ok(transitionRequest(q,{type:'retry',actor:'human',runId:'r',retry:{type:'retry',actor:'human',id:'r2',at:11}}));assert.equal(q.rootRunId,'r2');assert.equal(q.state.review.length,0);
 q=event(q,'r2',dispatch);q=event(q,'r2',{...input,text:'ai-village-run-r2'});q=event(q,'r2',terminal);assert.equal(q.state.kind,'completed');
});
test('ordinary report normal completion needs no claim; human can end all active request variants',()=>{
 let q=ok(newRequest('q','r','human',true));q=event(runRoot(q),'r',terminal);assert.equal(q.state.kind,'active');
 q=ok(transitionRequest(q,{type:'prepare-report',actor:'program',id:'report'}));
 no(transitionRequest(q,{type:'delegate',actor:'agent',parentRunId:'r',id:'child'}));
 q=event(q,'report',dispatch);q=event(q,'report',{...input,text:'ai-village-run-report'});q=event(q,'report',terminal);
 assert.equal(q.state.kind,'completed');assert.equal(q.declarations.length,0);
 for(const candidate of [active(),runRoot(active()),event(event(active(),'r',dispatch),'r',{type:'lost',actor:'program',at:9,reason:'timeout'})]){
  assert.equal(ok(transitionRequest(candidate,{type:'withdraw',actor:'human',reason:'withdraw'})).state.kind,'withdrawn');
 }
});
test('request authority matrix rejects wrong actors and nested authority spoofing',()=>{
 const events=[{type:'delegate',actor:'agent',parentRunId:'r',id:'c'},{type:'declare-complete',actor:'agent',id:'d',runId:'r',at:0},{type:'run-event',actor:'program',runId:'r',event:dispatch},{type:'run-action',actor:'human',runId:'r',event:{type:'cancel',actor:'human'}},{type:'prepare-report',actor:'program',id:'report'},{type:'complete-as-human',actor:'human',reason:'x'},{type:'withdraw',actor:'human',reason:'x'}];
 for(const e of events)for(const actor of ['program','agent','human'].filter(x=>x!==e.actor))assert.equal(transitionRequest(active(),{...e,actor}).reason,'actor-forbidden');
 no(transitionRequest(active(),{type:'run-event',actor:'program',runId:'r',event:{type:'cancel',actor:'human'}}));
 no(transitionRequest(active(),{type:'retry',actor:'agent',runId:'r',retry:{type:'retry',actor:'human',id:'x',at:1}}));
});
test('migration terminates stalled unknown/send_unknown/awaiting_input regardless of blocksInput',()=>{
 for(const state of ['unknown','send_unknown','awaiting_input'])for(const blocksInput of [true,false]){
  const source={agents:[{id:'a',state:'idle',canSend:true}],runs:[{id:'r',humanRequestId:'q',workId:'w',state,blocksInput}],requests:[{id:'q',status:'active',rootWorkId:'w',reportMode:true,works:[{id:'w',currentRunId:'r',runIds:['r'],state:'active'}]}]};
  deepFreeze(source);const before=JSON.stringify(source),result=migrateDirect(source);
  assert.equal(result.runs[0].state.outcome,'unconfirmed');assert.equal(result.requests[0].state.kind,'active');assert(result.requests[0].state.review.length);assert.equal(deriveAgent(result.agents[0]).kind,'unreachable');assert.equal(JSON.stringify(source),before);assert.deepEqual(result.legacy,source);
 }
});
test('migration covers old states, cancelled queues, orphan data and terminal request decisions',()=>{
 const states=['queued','sending','awaiting_input','running','waiting_input','unknown','send_unknown','completed','failed','interrupted','superseded','terminated','future'];
 const result=migrateDirect({agents:[{id:'a',state:'terminated'}],runs:states.map(state=>({id:state,state,acceptance:'accepted',completionEvent:'native'})),requests:[{id:'done',status:'completed'},{id:'cancel',status:'cancelled'}]});
 assert.equal(result.runs.find(r=>r.id==='completed').state.outcome,'normal');assert.equal(result.runs.find(r=>r.id==='queued').state.kind,'queued');
 assert.equal(result.requests[0].state.kind,'completed');assert.equal(result.requests[1].state.kind,'withdrawn');assert(result.issues.includes('unrecognized-run-state:future'));
 const cancelled=migrateDirect({runs:[{id:'r',state:'terminated',queueCancelledAt:'date'}]});assert.equal(cancelled.runs[0].state.kind,'cancelled');
 assert.equal(migrateDirect({runs:[{id:'r',state:'completed'}]}).runs[0].state.outcome,'unconfirmed');
 assert(migrateDirect({runs:[{id:'r'},{id:'r'},{}]}).issues.includes('missing-or-duplicate-run-id:r'));
});

test('late native facts and repeated claims are retained after human withdrawal without reopening',()=>{
 let q=runRoot(active());q=ok(transitionRequest(q,{type:'withdraw',actor:'human',reason:'not needed'}));
 q=event(q,'r',terminal);assert.equal(q.state.kind,'withdrawn');assert.equal(q.runs[0].state.outcome,'normal');
 const claim={type:'declare-complete',actor:'agent',id:'same',runId:'r',at:4};q=ok(transitionRequest(q,claim));q=ok(transitionRequest(q,claim));assert.equal(q.declarations.length,2);assert.equal(q.state.kind,'withdrawn');
});
test('delegated request with unfinished children cannot silently finalize on a contradictory claim',()=>{
 let q=runRoot(active());q=ok(transitionRequest(q,{type:'delegate',actor:'agent',parentRunId:'r',id:'child'}));
 q=ok(transitionRequest(q,{type:'declare-complete',actor:'agent',id:'d',runId:'r',at:2}));q=event(q,'r',terminal);
 assert.equal(q.state.kind,'active');assert(q.state.review.includes('declaration-conflict:unfinished-child'));
});
test('migration keeps parent graph and claim history, does not let superseded unknown block the latest run',()=>{
 const source={runs:[{id:'r1',humanRequestId:'q',workId:'root',state:'unknown',blocksInput:false},{id:'c',humanRequestId:'q',workId:'child',state:'completed',acceptance:'accepted',completionEvent:'c-end'},{id:'r2',humanRequestId:'q',workId:'root',state:'running'}],requests:[{id:'q',status:'finalizing',rootWorkId:'root',works:[{id:'root',runIds:['r1','r2'],currentRunId:'r2',finish:{runId:'r2',status:'pending'}},{id:'child',parentWorkId:'root',runIds:['c'],currentRunId:'c',finish:{runId:'c',status:'completed'}}]}]};
 const m=migrateDirect(source);assert.equal(m.runs[1].parentRunId,'r1');assert.equal(m.runs[2].retryOf,'r1');assert.equal(m.requests[0].declarations.length,1);assert.equal(m.requests[0].state.kind,'active');assert(m.requests[0].state.review.includes('run-needs-review:r2'));assert(!m.requests[0].state.review.includes('run-needs-review:r1'));
 assert.deepEqual(migrateDirect(source),m);
});

test('request rejects illegal sources, delegates need a live parent and automatic retries cannot impersonate human choices',()=>{
 let q=active();
 no(transitionRequest(q,{type:'delegate',actor:'agent',parentRunId:'r',id:'child'}));
 no(transitionRequest(q,{type:'prepare-report',actor:'program',id:'report'}));
 no(transitionRequest(q,{type:'run-event',actor:'program',runId:'missing',event:dispatch}));
 q=event(runRoot(q),'r',{...terminal,outcome:'failed',errorCode:'server_overloaded'});
 const retry={type:'retry',actor:'program',id:'r2',at:4,boundaryConfirmed:true,agentIdle:true,leafRoot:true};
 no(transitionRequest(q,{type:'retry',actor:'human',runId:'r',retry}));
 q=ok(transitionRequest(q,{type:'retry',actor:'program',runId:'r',retry}));assert.equal(q.state.review.length,0);
 no(transitionRequest(q,{type:'retry',actor:'program',runId:'r',retry:{...retry,id:'r3'}}));
 q=event(q,'r2',dispatch);q=event(q,'r2',{...input,text:'ai-village-run-r2'});q=event(q,'r2',terminal);assert.equal(q.state.kind,'completed');
});
test('delegated normal termination without coordinator claim remains active, then a late backed claim completes',()=>{
 let q=runRoot(active());q=ok(transitionRequest(q,{type:'delegate',actor:'agent',parentRunId:'r',id:'child'}));
 no(transitionRequest(q,{type:'delegate',actor:'agent',parentRunId:'r',id:'child'}));
 q=event(q,'child',dispatch);q=event(q,'child',{...input,text:'ai-village-run-child',turnId:'child-turn'});q=event(q,'child',{...terminal,turnId:'child-turn'});q=event(q,'r',terminal);
 assert.equal(q.state.kind,'active');assert.equal(q.state.review.length,0);
 q=ok(transitionRequest(q,{type:'deliver-result',actor:'program',id:'delivery',childRunId:'child'}));
 q=event(q,'delivery',dispatch);q=event(q,'delivery',{...input,text:'ai-village-run-delivery'});q=event(q,'delivery',terminal);
 assert(q.state.review.includes('needs-decision'));
 q=ok(transitionRequest(q,{type:'declare-complete',actor:'agent',id:'late',runId:'delivery',at:5}));assert.equal(q.state.kind,'completed');
});
test('each nonterminal Agent state has a stop path, ending only on observed absence',()=>{
 const samples=[{id:'a',intent:'start',observation:null},...['idle','running','input-needed','unknown'].map(activity=>({id:'a',intent:null,observation:{connected:true,process:'alive',activity,canSteer:false}})),{id:'a',intent:'stop',observation:{connected:true,process:'alive',activity:'running',canSteer:false}},{id:'a',intent:null,observation:{connected:false,process:'unknown',activity:'unknown',canSteer:false}}];
 for(const a of samples){const stop=ok(transitionAgent(a,{type:'stop',actor:'human'}));const end=ok(transitionAgent(stop,{type:'observe',actor:'program',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}}));assert.equal(deriveAgent(end).kind,'ended');}
});
test('migration diagnoses broken parent links and cycles rather than silently treating them as new roots',()=>{
 const migrated=migrateDirect({runs:[{id:'a',humanRequestId:'q',workId:'wa',state:'unknown'},{id:'b',humanRequestId:'q',workId:'wb',state:'unknown'}],requests:[{id:'q',status:'active',works:[{id:'wa',parentWorkId:'wb',runIds:['a'],currentRunId:'a'},{id:'wb',parentWorkId:'wa',runIds:['b'],currentRunId:'b'}]}]});
 assert(migrated.issues.includes('parent-cycle:a'));assert(migrated.issues.includes('parent-cycle:b'));
});

test('program creation is limited to report and result; humans/agents cannot impersonate system delivery',()=>{
 ok(newRun('report','q','program',null,{phase:'report'}));
 const kind={phase:'result',resultOf:'child',recipientRunId:'parent'};
 ok(newRun('result','q','program',null,kind));no(newRun('work','q','program'));
 for(const actor of ['human','agent'])for(const options of [{phase:'report'},kind])no(newRun('system','q',actor,'parent',options));
 no(newRun('result','q','program',null,{...kind,resultOf:''}));
});
test('progress invariant detects stalled roots and import preserves decisions without silently completing or sending',()=>{
 const done=ok(transitionRun(running(),terminal));
 const stalled={...active(),runs:[done]};assert.equal(checkProgress(stalled).ok,false);assert.deepEqual(stalledRequests([stalled]),['q']);
 for(const reportMode of [false,true]){
  const migrated=migrateDirect({runs:[{id:'r',humanRequestId:'q',workId:'w',state:'completed',acceptance:'accepted',completionEvent:'native'}],requests:[{id:'q',status:'active',reportMode,rootWorkId:'w',works:[{id:'w',currentRunId:'r',runIds:['r']}]}]}).requests[0];
  assert.equal(migrated.state.kind,'active');assert.equal(migrated.runs.length,1);assert(checkProgress(migrated).ok);
  if(reportMode){assert.deepEqual(nextSteps(migrated),[{type:'prepare-report'}]);const report=ok(transitionRequest(migrated,{type:'prepare-report',actor:'program',id:'report'}));assert.equal(report.runs.at(-1).phase,'report');}
  else assert(migrated.state.review.includes('legacy-needs-decision'));
 }
 let q=active();q=ok(transitionRequest(q,{type:'run-action',actor:'human',runId:'r',event:{type:'cancel',actor:'human'}}));assert(q.state.review.includes('needs-decision'));assert(checkProgress(q).ok);
});
for(const outcome of ['normal','failed','interrupted','unconfirmed','cancelled'])test('deliver each terminal child result once: '+outcome,()=>{
 let q=runRoot(active());q=ok(transitionRequest(q,{type:'delegate',actor:'agent',id:'child',parentRunId:'r'}));
 const deliver={type:'deliver-result',actor:'program',id:'delivery',childRunId:'child'};
 no(transitionRequest(q,deliver));
 if(outcome==='cancelled')q=ok(transitionRequest(q,{type:'run-action',actor:'human',runId:'child',event:{type:'cancel',actor:'human'}}));
 else{
  q=event(q,'child',dispatch);
  if(outcome==='unconfirmed')q=event(q,'child',{type:'lost',actor:'program',at:4,reason:'timeout'});
  else{q=event(q,'child',{...input,text:'ai-village-run-child',turnId:'ct'});q=event(q,'child',{...terminal,turnId:'ct',outcome});}
 }
 assert(nextSteps(q).some(s=>s.type==='deliver-result'&&s.childRunId==='child'));
 for(const actor of ['human','agent'])no(transitionRequest(q,{...deliver,actor}));
 q=ok(transitionRequest(q,deliver));const delivered=q.runs.at(-1);
 assert.equal(delivered.phase,'result');assert.equal(delivered.resultOf,'child');assert.equal(delivered.recipientRunId,'r');assert.equal(delivered.parentRunId,null);assert.equal(q.rootRunId,'delivery');
 no(transitionRequest(q,deliver));no(transitionRequest(q,{...deliver,id:'duplicate'}));
 q=event(q,'delivery',dispatch);q=event(q,'delivery',{type:'lost',actor:'program',at:8,reason:'timeout'});
 assert(q.state.review.includes('run-needs-review:delivery'));assert(checkProgress(q).ok);
});
test('nested delivery targets the parent conversation, then its result can reach the root',()=>{
 let q=runRoot(active());q=ok(transitionRequest(q,{type:'delegate',actor:'agent',id:'child',parentRunId:'r'}));
 q=event(q,'child',dispatch);q=event(q,'child',{...input,text:'ai-village-run-child',turnId:'ct'});
 q=ok(transitionRequest(q,{type:'delegate',actor:'agent',id:'grandchild',parentRunId:'child'}));
 q=ok(transitionRequest(q,{type:'run-action',actor:'human',runId:'grandchild',event:{type:'cancel',actor:'human'}}));
 q=ok(transitionRequest(q,{type:'deliver-result',actor:'program',id:'nested-delivery',childRunId:'grandchild'}));
 assert.equal(q.rootRunId,'r');assert.equal(q.runs.at(-1).recipientRunId,'child');assert.equal(q.runs.at(-1).parentRunId,'r');
 q=event(q,'nested-delivery',dispatch);q=event(q,'nested-delivery',{...input,text:'ai-village-run-nested-delivery'});q=event(q,'nested-delivery',terminal);
 q=ok(transitionRequest(q,{type:'deliver-result',actor:'program',id:'root-delivery',childRunId:'nested-delivery'}));assert.equal(q.rootRunId,'root-delivery');
});
test('migration maps result kind and source identity so already delivered child results are not delivered again',()=>{
 const source={runs:[{id:'r',humanRequestId:'q',workId:'root',state:'completed',acceptance:'accepted',completionEvent:'t'},{id:'child',humanRequestId:'q',workId:'child-work',state:'completed',acceptance:'accepted',completionEvent:'ct'},{id:'delivery',humanRequestId:'q',workId:'root',origin:'result',resultId:'inbox',state:'unknown'}],requests:[{id:'q',status:'active',rootWorkId:'root',works:[{id:'root',currentRunId:'delivery',runIds:['r','delivery']},{id:'child-work',parentWorkId:'root',currentRunId:'child',runIds:['child']}],inbox:[{id:'inbox',resultRunId:'child',deliveryRunId:'delivery'}]}]};
 const migrated=migrateDirect(source),q=migrated.requests[0],delivery=q.runs.at(-1);
 assert.equal(delivery.phase,'result');assert.equal(delivery.resultOf,'child');assert.equal(delivery.recipientRunId,'r');assert.equal(nextSteps(q).some(s=>s.type==='deliver-result'),false);assert(checkProgress(q).ok);
 no(transitionRequest(q,{type:'deliver-result',actor:'program',id:'duplicate',childRunId:'child'}));
});
test('seeded random transition sequences preserve progress after every accepted transition',()=>{
 let seed=12345;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let sample=0;sample<100;sample++){
  let q=ok(newRequest('q','r','human',!!random(2)));
  for(let i=0;i<100;i++){
   const r=q.runs[random(q.runs.length)],id='new-'+i;
   const programEvent={type:'run-event',actor:'program',runId:r.id,event:r.state.kind==='queued'?dispatch:r.state.kind==='sent'?{...input,text:'ai-village-run-'+r.id}:{...terminal,outcome:['normal','failed','interrupted'][random(3)]}};
   const events=[programEvent,{type:'delegate',actor:'agent',id,parentRunId:r.id},{type:'declare-complete',actor:'agent',id,runId:r.id,at:i},{type:'deliver-result',actor:'program',id,childRunId:r.id},{type:'prepare-report',actor:'program',id},{type:'run-action',actor:'human',runId:r.id,event:{type:'cancel',actor:'human'}},{type:'run-event',actor:'program',runId:r.id,event:{type:'lost',actor:'program',at:i,reason:'timeout'}},{type:'retry',actor:'human',runId:r.id,retry:{type:'retry',actor:'human',id,at:i}}];
   const next=transitionRequest(q,events[random(events.length)]);if(next.ok){q=next.value;assert(checkProgress(q).ok,JSON.stringify({sample,i,q}));for(const step of nextSteps(q))ok(transitionRequest(q,{...step,actor:'program',id:'probe-'+sample+'-'+i}));}
  }
 }
});

test('ambiguous delivery recipient is not advertised as an executable next step',()=>{
 const root=ok(transitionRun(running(),terminal));
 const child={...root,id:'child',parentRunId:'r'};
 const q={...active(),delegated:true,runs:[root,child,{...root,id:'next1',retryOf:'r'},{...root,id:'next2',retryOf:'r'}]};
 assert.deepEqual(nextSteps(q),[]);assert.equal(checkProgress(q).ok,false);
 const checked=reconcile(q);assert(checked.state.review.includes('needs-decision'));
 no(transitionRequest(checked,{type:'deliver-result',actor:'program',id:'delivery',childRunId:'child'}));
});
