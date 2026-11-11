import {fixtureModels} from './model-fixtures.mjs';
import {testView} from './model-fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bindAgent} from '../server/agent-lifecycle.mjs';
import {DirectAgents} from '../server/direct.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'delete-project-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const present=new Set(['a','b']),closed=[],calls=[];let offline='';
 const remote=async(args,host,id)=>{
  calls.push([id,args[0],args[2]]);if(id===offline)throw Error('offline fixture');
  if(args[0]==='python3')return JSON.stringify(args[2].includes('root=pane')?[{pid:123,start:'1'}]:{remainingOwned:0});
  if(args[2]==='list')return JSON.stringify({tabs:present.has(id)?[{tabId:id,sessionName:'session-'+id}]:[]});
  if(args[2]==='close'){present.delete(id);closed.push(id);return 'ok';}throw Error('Unexpected remote call');
 };
 const opts={dir,remote,notifier:{status:()=>({}),enqueue:()=>{throw Error('No notification allowed');}}};const d=new DirectAgents(opts);await d.init({watch:false});
 const p=await d.putProject({name:'Project',requestId:'project-create'});
 d.data.agents=['a','b'].map(id=>({id,name:'Agent '+id,projectId:p.id,metadataRevision:0,connection:{connectionType:'ssh',sshHost:'fixture'},tabId:id,workspaceId:'workspace-'+id,sessionName:'session-'+id,cwd:'/tmp',state:'busy',canSend:true}));
 d.data.agents.forEach(bindAgent);
 d.data.runs=[{id:'history',agentId:'a',state:'completed',output:'保持する履歴',notificationPolicy:'legacy-untracked'}];fixtureModels(d.data);await d.save();
 const input=()=>{const plan=d.projectDeletePlan(p.id);return {operationId:'delete-operation',revision:plan.revision,members:plan.members};};
 return {d,p,opts,input,closed,calls,present,offline:id=>offline=id};
}
test('all member shutdown, durable tombstones, duplicate delete and historical references',async t=>{
 const f=await fixture(t),x=f.input();const [one,two]=await Promise.all([f.d.deleteProject(f.p.id,x),f.d.deleteProject(f.p.id,x)]);
 assert.equal(testView(one).status,'deleted');assert.deepEqual(two,one);assert.deepEqual(f.closed,['a','b']);assert.equal(f.d.snapshot().projects.length,0);assert.equal(f.d.discovery().agents.length,0);assert.equal(f.d.snapshot().runs[0].output,'保持する履歴');assert(f.d.snapshot().agents.every(a=>testView(a).state==='terminated'&&a.deletedAt));
 const restored=new DirectAgents(f.opts);await restored.init({watch:false});assert.equal(testView((await restored.deleteProject(f.p.id,x))).status,'deleted');assert.deepEqual(f.closed,['a','b']);assert.equal(restored.agent('a').id,'a');
});
test('partial/offline deletion persists, refuses new members/creates/sends and retries only unfinished members',async t=>{
 const f=await fixture(t),x=f.input();f.offline('b');const result=await f.d.deleteProject(f.p.id,x);assert.equal(testView(result).status,'partial');assert.deepEqual(result.remaining.map(m=>m.id),['b']);assert.equal(f.d.snapshot().projects.length,1);
 await assert.rejects(f.d.updateAgent('b',{revision:0,projectId:null}),/削除/);
 const outside={...f.d.agent('b'),id:'outside',projectId:null};f.d.data.agents.push(outside);
 await assert.rejects(f.d.updateAgent('outside',{revision:0,projectId:f.p.id}),/削除/);
 await assert.rejects(f.d.create({projectId:f.p.id,requestId:'new-agent',name:'new'}),/削除/);
 await assert.rejects(f.d.send('b',{instruction:'no send',requestId:'new-request'}),/削除/);
 await assert.rejects(f.d.putProject({name:'new name',revision:f.p.revision},f.p.id),/削除/);
 f.offline('');const restored=new DirectAgents(f.opts);await restored.init({watch:false});assert.equal(testView((await restored.deleteProject(f.p.id,x))).status,'deleted');assert.deepEqual(f.closed,['a','b']);
});
test('confirmation rejects renamed project, membership changes and reused operation payload',async t=>{
 const f=await fixture(t),x=f.input();await f.d.putProject({name:'Renamed',revision:0},f.p.id);await assert.rejects(f.d.deleteProject(f.p.id,x),/更新/);assert.equal(f.closed.length,0);
 const y=f.input();await f.d.updateAgent('b',{revision:0,projectId:null});await assert.rejects(f.d.deleteProject(f.p.id,y),/更新/);assert.equal(f.closed.length,0);
 const z=f.input();await f.d.deleteProject(f.p.id,z);await assert.rejects(f.d.deleteProject(f.p.id,{...z,operationId:'different-operation'}),/更新/);assert.deepEqual(f.closed,['a']);
});
test('absent tab without captured processes never proves cleanup; close response loss safely reconciles',async t=>{
 const f=await fixture(t);f.present.delete('a');let result=await f.d.deleteProject(f.p.id,f.input());assert.equal(testView(result).status,'partial');assert.match(result.remaining[0].error,/手動確認/);assert.equal(testView(f.d.agent('a')).state,'unknown');
 const g=await fixture(t),original=g.d.remote;let lost=false;g.d.remote=async(...args)=>{const result=await original(...args);if(args[0][2]==='close'&&!lost){lost=true;throw Error('response lost');}return result;};
 const x=g.input();result=await g.d.deleteProject(g.p.id,x);assert.equal(testView(result).status,'partial');assert.equal(testView(g.d.agent('a')).state,'unknown');result=await g.d.deleteProject(g.p.id,x);assert.equal(testView(result).status,'deleted');assert.deepEqual(g.closed,['a','b']);
});
test('deletion intent suppresses pending finish success and retains formal request graph',async t=>{
 const f=await fixture(t),q={id:'q',rootWorkId:'work',status:'finalizing',revision:0,ticket:{state:'available'},works:[{id:'work',agentId:'a',state:'active',currentRunId:'history',runIds:['history'],finish:{status:'pending',runId:'history'}}],inbox:[]};f.d.data.requests.push(q);f.d.data.runs[0].acceptance='accepted';f.d.data.runs[0].humanRequestId='q';
 fixtureModels(f.d.data,{refresh:true});f.offline('b');await f.d.deleteProject(f.p.id,f.input());await f.d.flow.settle();await f.d.flow.notifications();assert.equal(testView(q).needsReview,true);assert.notEqual(testView(q).status,'completed');assert.equal(q.requestModel.state.kind,'active');assert.equal(f.d.flow.get('q').runs[0].output,'保持する履歴');
});
test('intent blocks dispatch already waiting for observation and survives interrupted deletion restart',async t=>{
 const f=await fixture(t);let observed;const observing=new Promise(r=>observed=r);let release;const gate=new Promise(r=>release=r);
 f.d.observe=async a=>{observed();await gate;a.agentModel.observation={connected:true,process:'alive',activity:'idle',canSteer:false};return {sessionId:'s',cursor:0};};
 const r={id:'queued',agentId:'a',state:'queued',instruction:'must not send',attachments:[]};f.d.data.runs.push(r);fixtureModels(f.d.data);
 const sending=f.d.attemptRun(r);await observing;const deletion=f.d.deleteProject(f.p.id,f.input());
 await new Promise(r=>setImmediate(r));release();await sending;await deletion;assert(!f.calls.some(c=>c[2]==='send'));
 const g=await fixture(t);const p=g.d.project(g.p.id),plan=g.d.projectDeletePlan(g.p.id);p.deletion={operationId:'delete-operation',revision:p.revision,members:plan.members,status:'running',remaining:plan.members};await g.d.save();
 const restored=new DirectAgents(g.opts);await restored.init({watch:false});assert.equal(testView(restored.project(g.p.id).deletion).status,'partial');assert.equal(g.closed.length,0);assert.equal(testView((await restored.deleteProject(g.p.id,g.input()))).status,'deleted');
});
test('unconfirmed offline Agent does not become a confirmed terminated work or success',async t=>{
 const f=await fixture(t);const q={id:'q',rootWorkId:'work',status:'finalizing',revision:0,ticket:{state:'available'},works:[{id:'work',agentId:'a',state:'active',currentRunId:'history',runIds:['history'],finish:{status:'pending',runId:'history'}}],inbox:[]};f.d.data.requests.push(q);f.d.data.runs[0].acceptance='accepted';f.d.data.runs[0].humanRequestId='q';fixtureModels(f.d.data,{refresh:true});f.offline('a');
 await f.d.deleteProject(f.p.id,f.input());await f.d.flow.settle();assert.equal(testView(q).needsReview,true);assert.equal(testView(q).status,'active');assert.equal(q.requestModel.state.kind,'active');
 const calls=f.calls.length;await f.d.observe(f.d.agent('b'));assert.equal(testView(f.d.agent('b')).state,'terminated');assert.equal(f.calls.length,calls);
});
test('empty Project deletion is idempotent and failed process verification never deletes a Project',async t=>{
 const f=await fixture(t);const empty=await f.d.putProject({name:'Empty',requestId:'empty-project'}),plan=f.d.projectDeletePlan(empty.id);assert.equal(testView((await f.d.deleteProject(empty.id,{operationId:'delete-empty',revision:plan.revision,members:[]}))).status,'deleted');assert.equal(f.closed.length,0);
 const original=f.d.remote;f.d.remote=async(...args)=>args[0][0]==='python3'&&args[0][2].includes('remainingOwned')?JSON.stringify({remainingOwned:1}):original(...args);
 const result=await f.d.deleteProject(f.p.id,f.input());assert.equal(testView(result).status,'partial');assert.equal(result.remaining.length,2);assert.equal(f.d.project(f.p.id).deletedAt,undefined);
});
test('membership update and new input racing an in-progress deletion cannot bypass its intent',async t=>{
 const f=await fixture(t),original=f.d.remote;let entered;const ready=new Promise(r=>entered=r);let release;const gate=new Promise(r=>release=r);
 f.d.remote=async(...args)=>{if(args[0][2]==='list'&&args[2]==='a'){entered();await gate;}return original(...args);};
 const deletion=f.d.deleteProject(f.p.id,f.input());await ready;
 const mutation=f.d.updateAgent('a',{revision:0,projectId:null});const check=assert.rejects(mutation,/削除/);
 await assert.rejects(f.d.send('b',{instruction:'racing input',requestId:'racing-input'}),/削除/);release();assert.equal(testView((await deletion)).status,'deleted');await check;assert.equal(f.d.agent('a').projectId,f.p.id);
});
test('final persistence failure cannot return idempotent success until a retry saves it',async t=>{
 const f=await fixture(t),save=f.d.save.bind(f.d);let failed=false;
 f.d.save=async()=>{if(testView(f.d.project(f.p.id).deletion)?.status==='deleted'&&!failed){failed=true;throw Error('disk fixture');}return save();};
 const input=f.input();await assert.rejects(f.d.deleteProject(f.p.id,input),/disk/);assert.equal(f.d.project(f.p.id).deletedAt,undefined);assert.equal(testView(f.d.project(f.p.id).deletion).status,'partial');assert.equal(testView((await f.d.deleteProject(f.p.id,input))).status,'deleted');assert.deepEqual(f.closed,['a','b']);
});
