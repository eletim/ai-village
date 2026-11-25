import {compatibilityDTO} from '../server/request-compatibility.mjs';
import {changeRun} from '../server/run-lifecycle.mjs';
import {inputHash} from './model-fixtures.mjs';
import {resultEntries} from '../server/request-lifecycle.mjs';
import {receipt} from './model-fixtures.mjs';
import {testView} from './model-fixtures.mjs';
import {verifyInstructionsScript} from '../server/input-envelope.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DirectAgents} from '../server/direct.mjs';
import {} from '../server/runtime-events.mjs';
import {VillageOperations} from '../server/operations.mjs';
export async function fixture(t,{reportMode=false,protocol=1,commonRequests=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'request-flow-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtimes=new Map(),sent=[],notifications=[];let offline=false,lose=false,promptState='intact',promptChecks=0,cliStopped=false;
 const execute=async(args,host,id)=>{
  if(offline)throw Error('offline');
  const agent=service?.data.agents.find(a=>args.includes(a.workspaceId)||args.includes('session-'+a.workspaceId?.replace(/^ws-/,'')))?.id||id;
  const owner=service?.data.agents.find(a=>a.id===agent),runtimeId=owner?.workspaceId?.replace(/^ws-/, '')||agent;
  const native=runtimes.get(runtimeId);
  if(args[0]==='python3'&&args[2]===verifyInstructionsScript){promptChecks++;if(promptState==='error')throw Error('read failed');return JSON.stringify({verified:promptState==='intact'});}
  if(args[0]==='python3')return JSON.stringify(native);
  if(args[2]==='status')return JSON.stringify({alive:!cliStopped,cliState:testView(native.turns.at(-1))?.state==='running'?'busy':'idle',agentSessionId:'session-'+runtimeId});
  if(args[2]==='send'){sent.push({agentId:agent,text:args.at(-1),transport:host?'ssh':'local'});if(lose)throw Error('response lost');return '{"status":"sent"}';}
  throw Error('unexpected '+args.slice(0,4));
 };
 const options={dir,remote:execute,localRun:(cmd,args)=>execute([cmd,...args]),notifier:{status:()=>({}),enqueue:async message=>{notifications.push(message);return {status:'sent'};}}};
 let service=new DirectAgents(options);await service.init({watch:false});service.flow.protocol=protocol;service.flow.commonRequests=commonRequests;await service.flow.configureReport(reportMode);
 const agents=Array.from({length:4},(_,i)=>({id:randomUUID(),name:i<2?'Secretary '+i:'Worker '+i,location:i<2?'mayor':'workshop',workshopId:'w'+i,connection:{connectionType:i===3?'ssh':'local',sshHost:i===3?'remote':null,name:'PC'+i},workspaceId:'',tabId:'tab'+i,sessionName:'pane'+i,provider:'codex',state:'idle'}));
 for(const a of agents){a.inputEnvelope={mode:'startup-v2',hash:inputHash(service.startupInstructions())};a.workspaceId='ws-'+a.id;service.data.agents.push(a);runtimes.set(a.id,{available:true,sessionId:'session-'+a.id,fileIdentity:'file-'+a.id,cursor:0,inputs:[],turns:[]});}
 await service.save();await service.tick();
 const submit=async(r,transform=x=>x)=>{
  const native=runtimes.get(service.agent(r.agentId).workspaceId.replace(/^ws-/,'')),text=sent.findLast(s=>s.agentId===r.agentId)?.text;
  assert(text.includes(r.id));assert.equal(r.inputMarker,undefined);const tid=randomUUID();native.cursor+=10;
  native.inputs.push({id:'input-'+tid,turnId:tid,hash:inputHash(transform(text)),offset:native.cursor,source:service.agent(r.agentId).provider==='claude'?'claude-user':'response',text:transform(text)});
  native.turns.push({id:tid,state:'running',output:''});await service.tick();assert.equal(receipt(r).acceptance,'accepted');return tid;
 };
 const complete=async(r,outcome='completed')=>{const native=runtimes.get(service.agent(r.agentId).workspaceId.replace(/^ws-/,''));Object.assign(native.turns.find(t=>t.id===r.turnId),{state:outcome,output:'Output '+r.id,finalOutput:'Final '+r.id,completionEvent:'event-'+r.id});await service.tick();};
 const finish=async(r,op=randomUUID())=>service.flow.finish({results:JSON.parse(service.flow.root(r.humanRequestId).requestGraph.operations.find(o=>o.id===op)?.payload||'null')?.results||service.flow.results(r.humanRequestId,r.workId).filter(e=>!e.handled&&!e.superseded&&e.outcome==='completed'&&!e.claims.some(c=>c.actorRunId===r.id&&!c.invalidated)).map(e=>({requestId:e.requestId,resultId:e.id,version:e.version,decision:'accept'})),humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,revision:service.flow.root(r.humanRequestId).revision,operationId:op});
 const delegate=async(r,target,op=randomUUID())=>service.flow.delegate({humanRequestId:r.humanRequestId,parentWorkId:r.workId,actorRunId:r.id,agentId:target.id,instruction:'Child work '+op,operationId:op});
 const restart=async()=>{service.close();service=new DirectAgents(options);await service.init({watch:false});service.flow.protocol=protocol;service.flow.commonRequests=commonRequests;return service;};
 return {get service(){return service;},options,agents,runtimes,sent,notifications,promptState:v=>promptState=v,cliStopped:v=>cliStopped=v,promptChecks:()=>promptChecks,submit,complete,finish,delegate,restart,offline:v=>offline=v,lose:v=>lose=v};
}
