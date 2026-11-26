import {AgentRules} from '../server/agent-rules.mjs';
import {inputHash} from './model-fixtures.mjs';
import {serverReady} from './helpers/server-ready.mjs';
import {receipt} from './model-fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';

test('secretary relay HTTP/native/SQLite restart: existing permission to interrupted purpose and return',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'requests-http-')),capture=join(dir,'sent.jsonl'),notices=join(dir,'notify-calls.jsonl');let child;
 const fixtureProcess=spawn('bash',['-c','exec -a codex sleep 120']);
 const bin=join(dir,'bin');await mkdir(bin);await writeFile(join(bin,'tmux'),'#!/bin/sh\necho '+fixtureProcess.pid+'\n',{mode:0o700});
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port;
 const agents=[0,1,2,3].map(i=>({id:randomUUID(),name:'Fixture '+i,location:i>=2?'workshop':'mayor',connection:{connectionType:'local',name:'Fixture'},workspaceId:'ws-'+i,tabId:'tab-'+i,sessionName:'pane-'+i,provider:'codex',state:'idle',nativeSession:randomUUID()}));
 const startup=new AgentRules(base).startup();for(const a of agents){a.inputEnvelope={mode:'startup-v2',hash:inputHash(startup)};const root=join(dir,'.purplemux/workspaces',a.workspaceId);await mkdir(root,{recursive:true});await writeFile(join(root,'codex-prompt.md'),'# purplemux context\n'+startup);}
 const nativeDir=join(dir,'sessions');await mkdir(nativeDir);
 for(const a of agents)await writeFile(join(nativeDir,a.nativeSession+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:a.nativeSession}})+'\n');
 await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],agents,runs:[{id:'legacy',agentId:agents[0].id,state:'completed',output:'old without receipt'}]}));
 await writeFile(join(dir,'agents-fixture.json'),JSON.stringify(agents));
 const pmux=join(dir,'fake-pmux.cjs'),notify=join(dir,'fake-notify.cjs');
 await writeFile(pmux,"#!/usr/bin/env node\nconst fs=require('fs');const agents=JSON.parse(fs.readFileSync(process.env.FIXTURE_AGENTS,'utf8'));const args=process.argv.slice(2),a=agents.find(a=>args.includes(a.workspaceId));if(args[1]==='status')console.log(JSON.stringify({alive:true,cliState:fs.existsSync(process.env.FIXTURE_CAPTURE+'.busy')?'busy':'idle',agentSessionId:a.nativeSession}));else if(args[1]==='send'){fs.appendFileSync(process.env.FIXTURE_CAPTURE,JSON.stringify({agentId:a.id,text:args.at(-1)})+'\\n');console.log('{\"status\":\"sent\"}');}else process.exit(3);\n",{mode:0o700});
 await writeFile(notify,"#!/usr/bin/env node\nrequire('fs').appendFileSync(process.env.FIXTURE_NOTICES,JSON.stringify(process.argv.slice(2))+'\\n');\n",{mode:0o700});
 const start=async()=>{child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,HOME:dir,PATH:bin+':'+process.env.PATH,VILLAGE_STATE_DIR:dir,VILLAGE_VPN_ADDRESS:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:'',VILLAGE_PMUX_BIN:pmux,VILLAGE_NOTIFY_BIN:notify,VILLAGE_OFFICE_URL:base+'/agents',VILLAGE_NOTIFICATIONS:'false',CODEX_HOME:dir,FIXTURE_AGENTS:join(dir,'agents-fixture.json'),FIXTURE_CAPTURE:capture,FIXTURE_NOTICES:notices},stdio:['ignore','pipe','pipe']});await serverReady(child);await until(async()=>(await get()).agents.every(a=>a.agentModel?.observation?.connected));};
 const stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
 const post=async(path,body)=>{const ui=path.startsWith('/human/')?{'Origin':base,'X-Village-Human-UI':'1',Cookie:(await fetch(base+'/agents')).headers.get('set-cookie').split(';')[0]}:{};const r=await fetch(base+'/api/direct'+path,{method:'POST',headers:{'Content-Type':'application/json',...ui},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const get=async()=>{const r=await fetch(base+'/api/direct');return r.json();};
 const lines=async file=>{try{return (await readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
 const until=async fn=>{for(let i=0;i<160;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('condition timeout');};
 const request=async id=>(await post('/requests/get',{humanRequestId:id})).body;
 const run=async id=>{const r=(await get()).runs.find(r=>r.id===id);return r?.humanRequestId?(await request(r.humanRequestId)).runs.find(r=>r.id===id):r;};
 const native=async(a,rows)=>appendFile(join(nativeDir,a.nativeSession+'.jsonl'),rows.map(row=>JSON.stringify({timestamp:new Date().toISOString(),...row})).join('\n')+'\n');
 const submit=async r=>{const a=agents.find(a=>a.id===r.agentId),text=(await until(async()=>(await lines(capture)).findLast(e=>e.agentId===a.id&&e.text.includes('"runId":"'+r.id+'"')))).text,turnId=randomUUID();await native(a,[{type:'event_msg',payload:{type:'task_started',turn_id:turnId}},{type:'event_msg',payload:{type:'user_message',turn_id:turnId,message:text}}]);return until(async()=>{const current=await run(r.id);return receipt(current).acceptance==='accepted'&&current;});};
 const complete=async(r,text)=>{await native(agents.find(a=>a.id===r.agentId),[{type:'event_msg',payload:{type:'task_complete',turn_id:r.turnId,last_agent_message:text}}]);return until(async()=>{const current=await run(r.id);return current.state==='completed'&&current;});};
 const finish=async(r,op)=>{const q=await request(r.humanRequestId);const body={humanRequestId:q.id,workId:r.workId,runId:r.id,revision:q.revision,operationId:op,inputs:q.requestGraph.nodes.find(n=>n.id===r.workId).inbox.filter(i=>!i.handledBy&&!i.retiredBy&&i.attempts.includes(r.id)).map(i=>i.id),results:[]};const receipt=await post('/requests/finish',body);assert.equal(receipt.status,200);return body;};

 const ok=async(path,x)=>{const r=await post(path,x);assert([200,201].includes(r.status),JSON.stringify(r.body));return r.body;};
 const conv=async id=>ok('/conversations/get',{conversationId:id});
 const talk=async(a,text)=>submit(await ok('/agents/'+a.id+'/runs',{mode:'conversation',requestId:randomUUID(),instruction:text}));
 const job=async(r,a,instruction)=>ok('/conversations/job',{conversationId:r.conversationId,actorRunId:r.id,operationId:randomUUID(),assigneeAgentId:a.id,instruction,authorization:{runId:r.id,quote:r.instruction}});
 try{
  await start();
  const projects=[];for(const name of ['Source','Target'])projects.push(await ok('/projects',{requestId:randomUUID(),name}));
  for(let i=0;i<agents.length;i++){const res=await fetch(base+'/api/direct/agents/'+agents[i].id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:0,projectId:projects[i===0||i===3?0:1].id})});assert.equal(res.status,200);}
  const human=await talk(agents[1],'元目的の許可された作業を進めて'),original=await job(human,agents[2],'元目的の範囲だけの作業');await complete(human,'担当へ依頼しました');
  const old=await submit(await run(original.runId));await native(agents[2],[{type:'event_msg',payload:{type:'turn_aborted',turn_id:old.turnId}}]);await until(async()=>(await run(old.id)).state==='interrupted');
  const attention=await until(async()=>{const c=await conv(human.conversationId);return c.deliveries.length&&c.runs.find(r=>r.id===c.deliveries.at(-1).runId);});await complete(await submit(attention),'作業が中断しています');
  const initial=await talk(agents[0],'対象の復旧を進めて');
  const recovery=await job(initial,agents[3],`対象 ${original.humanRequestId} ${original.workId} ${old.id} ${projects[1].id} の復旧`);await complete(initial,'復旧を依頼しました');
  const worker=await submit(await run(recovery.runId)),report=await ok('/requests/report',{humanRequestId:recovery.humanRequestId,workId:recovery.workId,actorRunId:worker.id,operationId:randomUUID(),kind:'question',text:'復旧確認済み。会話 '+human.conversationId+' に正式再開を届けてください。'});
  const rq=await request(recovery.humanRequestId);await ok('/requests/respond',{humanRequestId:rq.id,workId:recovery.workId,runId:worker.id,operationId:randomUUID(),inputs:rq.requestGraph.nodes[0].inbox.map(i=>i.id),results:[]});await complete(worker,'復旧資料を提出');
  const event=await until(async()=>(await conv(initial.conversationId)).deliveries.find(e=>e.id==='report:'+report.id));await complete(await submit(await run(event.runId)),'元の仕事への正式な連絡を行います');
  const sender=await talk(agents[0],'その元目的を正式経路で再開して'),q=await request(original.humanRequestId);
  const input={conversationId:sender.conversationId,actorRunId:sender.id,operationId:randomUUID(),authorization:{runId:sender.id,quote:sender.instruction},evidenceDeliveryId:event.id,target:{secretaryId:agents[1].id,projectId:projects[1].id,conversationId:human.conversationId,purposeId:q.id,requestId:q.id,workId:original.workId,currentRunId:old.id,revision:q.revision,mode:'resume-interrupted'},instruction:'復旧済み。元目的と未処理事項だけ再開をお願いします。'};
  assert.equal((await post('/conversations/relay',{...input,target:{...input.target,purposeId:randomUUID()}})).status,403);
  const receipt=await ok('/conversations/relay',input);assert.deepEqual(await ok('/conversations/relay',input),receipt);
  const receiver=await submit(await run(receipt.runId));assert.equal(receiver.conversationSource.kind,'secretary');
  const material=await ok('/conversations/read',{conversationId:receiver.conversationId,actorRunId:receiver.id,selector:{kind:'relay',id:receipt.deliveryId}});assert.equal(material.content.humanText,sender.instruction);
  const apply={conversationId:receiver.conversationId,actorRunId:receiver.id,operationId:randomUUID(),deliveryId:receipt.deliveryId};
  const result=await ok('/conversations/relayApply',apply);assert.equal(result.previousRunId,old.id);assert.equal(result.humanRequestId,q.id);
  const cli=await fetch(base+'/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:['conversations','relayApply',JSON.stringify(apply)]})});assert.deepEqual((await cli.json()).result,result);
  await complete(receiver,'元仕事の再開を受付しました。仕事完了とは異なります。');await complete(sender,'連絡を届けました');
  const returned=await until(async()=>(await get()).runs.find(r=>r.conversationSource?.relayReturnId===receipt.deliveryId));assert.equal(returned.conversationId,sender.conversationId);
  const resumed=await submit(await run(result.runId));assert.equal(resumed.runModel.createdBy,'agent');await finish(resumed,'relay-http-work-finish');await complete(resumed,'元目的の成果を提出しました');
  await complete(await submit(returned),'担当秘書が元の仕事を再開しました');
  const outcome=await until(async()=>{const c=await conv(human.conversationId);const e=c.deliveries.find(e=>e.kind==='result'&&e.humanRequestId===q.id);return e&&c.runs.find(r=>r.id===e.runId);});
  assert.equal(outcome.agentId,agents[1].id);await complete(await submit(outcome),'元目的の成果を確認しました');
  await stop();await start();assert.deepEqual(await ok('/conversations/relay',input),receipt);assert.deepEqual(await ok('/conversations/relayApply',apply),result);
  const stored=await request(q.id);assert.equal(stored.runs.find(r=>r.id===old.id).state,'interrupted');
  assert.equal((await lines(capture)).filter(e=>e.agentId===agents[2].id&&e.text.includes('"runId":"'+result.runId+'"')).length,1);assert.equal((await lines(notices)).length,0);
  assert.equal((await get()).runs.filter(r=>r.conversationSource?.relayReturnId===receipt.deliveryId).length,1);
  if(process.env.VILLAGE_RELAY_EVIDENCE)await writeFile(process.env.VILLAGE_RELAY_EVIDENCE,JSON.stringify({isolatedPort:port,fakeNative:true,notifications:false,receipt,result,sourceHuman:sender.id,recovery:recovery.humanRequestId,material:material.content,oldState:stored.runs.find(r=>r.id===old.id).runModel.state,sendCount:(await lines(capture)).filter(e=>e.agentId===agents[2].id&&e.text.includes(result.runId)).length,returnCount:1,restartVerified:true},null,2));
 }finally{await stop();fixtureProcess.kill();await rm(dir,{recursive:true,force:true});}
});
