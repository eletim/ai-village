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

test('selfResume HTTP and CLI: normal end waits, timer delivers one native-correlated continuation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'requests-http-')),capture=join(dir,'sent.jsonl'),notices=join(dir,'notify-calls.jsonl');let child;
 const fixtureProcess=spawn('bash',['-c','exec -a codex sleep 120']);
 const bin=join(dir,'bin');await mkdir(bin);await writeFile(join(bin,'tmux'),'#!/bin/sh\necho '+fixtureProcess.pid+'\n',{mode:0o700});
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port;
 const agents=[0,1,2].map(i=>({id:randomUUID(),name:'Fixture '+i,location:i===1?'workshop':'mayor',connection:{connectionType:'local',name:'Fixture'},workspaceId:'ws-'+i,tabId:'tab-'+i,sessionName:'pane-'+i,provider:'codex',state:'idle',nativeSession:randomUUID()}));
 const startup=new AgentRules(base).startup();for(const a of agents){a.inputEnvelope={mode:'startup-v2',hash:inputHash(startup)};const root=join(dir,'.purplemux/workspaces',a.workspaceId);await mkdir(root,{recursive:true});await writeFile(join(root,'codex-prompt.md'),'# purplemux context\n'+startup);}
 const nativeDir=join(dir,'sessions');await mkdir(nativeDir);
 for(const a of agents)await writeFile(join(nativeDir,a.nativeSession+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:a.nativeSession}})+'\n');
 await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],agents,runs:[{id:'legacy',agentId:agents[0].id,state:'completed',output:'old without receipt'}]}));
 await writeFile(join(dir,'agents-fixture.json'),JSON.stringify(agents));
 const pmux=join(dir,'fake-pmux.cjs'),notify=join(dir,'fake-notify.cjs');
 await writeFile(pmux,"#!/usr/bin/env node\nconst fs=require('fs');const agents=JSON.parse(fs.readFileSync(process.env.FIXTURE_AGENTS,'utf8'));const args=process.argv.slice(2),a=agents.find(a=>args.includes(a.workspaceId));if(args[1]==='status')console.log(JSON.stringify({alive:true,cliState:fs.existsSync(process.env.FIXTURE_CAPTURE+'.busy')?'busy':'idle',agentSessionId:a.nativeSession}));else if(args[1]==='send'){fs.appendFileSync(process.env.FIXTURE_CAPTURE,JSON.stringify({agentId:a.id,text:args.at(-1)})+'\\n');console.log('{\"status\":\"sent\"}');}else process.exit(3);\n",{mode:0o700});
 await writeFile(notify,"#!/usr/bin/env node\nrequire('fs').appendFileSync(process.env.FIXTURE_NOTICES,JSON.stringify(process.argv.slice(2))+'\\n');\n",{mode:0o700});
 const start=async()=>{child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,HOME:dir,PATH:bin+':'+process.env.PATH,VILLAGE_STATE_DIR:dir,VILLAGE_VPN_ADDRESS:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:'',VILLAGE_PMUX_BIN:pmux,VILLAGE_NOTIFY_BIN:notify,VILLAGE_OFFICE_URL:base+'/agents',VILLAGE_NOTIFICATIONS:'true',CODEX_HOME:dir,FIXTURE_AGENTS:join(dir,'agents-fixture.json'),FIXTURE_CAPTURE:capture,FIXTURE_NOTICES:notices},stdio:['ignore','pipe','pipe']});await serverReady(child);await until(async()=>(await get()).agents.every(a=>a.agentModel?.observation?.connected));};
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
 try{
  await start();
  const first=await submit((await post('/agents/'+agents[0].id+'/runs',{instruction:'Check disposable file later',requestId:'http-self-resume'})).body);
  const payload={humanRequestId:first.humanRequestId,workId:first.workId,actorRunId:first.id,operationId:'http-self-resume-book',expectedVersion:0,at:new Date(Date.now()+4000).toISOString(),text:'Check disposable file; report only observed change'};
  const reserved=await post('/requests/selfResume',payload);assert.equal(reserved.status,200,JSON.stringify(reserved.body));
  const cli=await fetch(base+'/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:['requests','selfResume',JSON.stringify(payload)]})});const replay=await cli.json();assert.equal(replay.ok,true);assert.deepEqual(replay.result,reserved.body);
  assert.equal((await post('/requests/selfResume',{...payload,text:'different'})).status,409);
  const q=await request(first.humanRequestId),w=q.requestGraph.nodes.find(n=>n.id===first.workId);
  assert.equal((await post('/requests/respond',{humanRequestId:q.id,workId:w.id,runId:first.id,operationId:'http-self-resume-wait',inputs:w.inbox.map(i=>i.id),results:[]})).status,200);
  await complete(first,'Waiting for scheduled check');
  const next=await until(async()=>{const q=await request(first.humanRequestId),w=q.requestGraph.nodes.find(n=>n.id===first.workId);return w.currentRunId!==first.id&&q.runs.find(r=>r.id===w.currentRunId);});
  const resumed=await submit(next);await finish(resumed,'http-self-resume-finish');await complete(resumed,'Checked file');
  const after=await request(first.humanRequestId),node=after.requestGraph.nodes.find(n=>n.id===first.workId);
  assert.equal(node.inbox.filter(i=>i.id===reserved.body.current.id).length,1);assert.equal(node.inbox.find(i=>i.id===reserved.body.current.id).source.actor,'program');
  assert.equal(node.selfResume.current.status,'consumed');
  assert.equal((await lines(capture)).filter(e=>e.text.includes(next.id)).length,1);
  assert.equal((await lines(notices)).length,0);
 }finally{await stop();fixtureProcess.kill();await rm(dir,{recursive:true,force:true});}
});
