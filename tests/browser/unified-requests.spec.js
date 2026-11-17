import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {once} from 'node:events';
test('isolated real API and browser preserve nested requests, result handling and root-only attention',async({page})=>{
 const dir=await mkdtemp(join(tmpdir(),'unified-browser-'));let child;
 try{
  const qid=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()],runIds=[randomUUID(),randomUUID(),randomUUID()],agentIds=[randomUUID(),randomUUID(),randomUUID()];
  const agents=agentIds.map((id,i)=>({id,name:['親','子','孫'][i],provider:'codex',location:i?'workshop':'mayor',connection:{connectionType:'local'},workspaceId:'fixture',tabId:'fixture',cwd:dir,state:'busy'}));
  const runs=runIds.map((id,i)=>({id,agentId:agentIds[i],humanRequestId:qid,workId:ids[i],origin:i?'delegation':'human',instruction:'依頼',createdAt:new Date().toISOString(),state:'completed',acceptance:'accepted',sessionId:'fixture',inputId:'input-'+id,turnId:'turn-'+id,completionEvent:'event-'+id,output:['親の結果','子の結果','孫の結果'][i]}));
  const q={id:qid,rootWorkId:ids[0],initialRunId:runIds[0],originAgentId:agentIds[0],finalAgentId:agentIds[0],instruction:'ネストした依頼',revision:0,status:'active',reportMode:false,works:ids.map((id,i)=>({id,parentWorkId:i?ids[i-1]:null,agentId:agentIds[i],runIds:[runIds[i]],currentRunId:runIds[i]}))};
  await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],agents,runs,requests:[q]}));await mkdir(join(dir,'sessions'));
  const bin=join(dir,'pmux');await writeFile(bin,'#!/bin/sh\nprintf \'%s\\n\' \'{"alive":true,"cliState":"busy"}\'\n',{mode:0o700});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_PMUX_BIN:bin,VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',CODEX_HOME:dir,VILLAGE_NATIVE_CACHE_DIR:join(dir,'cache')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);resolve();}});});
  const post=(path,data)=>page.request.post(base+'/api/direct/requests/'+path,{data});
  const get=async()=> (await post('get',{humanRequestId:qid})).json();
  await page.goto(base+'/agents');await expect(page.getByRole('button',{name:'親のプロフィール',exact:true})).toBeVisible();
  const before=await get();expect(before.requestGraph.nodes).toHaveLength(3);expect(before.status).toBe('active');
  const response=await post('results',{humanRequestId:qid,workId:ids[1]});const result=(await response.json())[0];expect(result.handled).toBe(false);
  const ref={requestId:ids[2],resultId:result.id,version:result.version,decision:'accept'};
  expect((await post('respond',{humanRequestId:qid,workId:ids[0],runId:runIds[0],operationId:randomUUID(),results:[ref]})).status()).toBe(409);
  expect((await post('finish',{humanRequestId:qid,workId:ids[1],runId:runIds[1],operationId:randomUUID(),results:[ref]})).status()).toBe(200);
  const childResult=(await (await post('results',{humanRequestId:qid,workId:ids[0]})).json())[0];
  expect((await post('finish',{humanRequestId:qid,workId:ids[0],runId:runIds[0],operationId:randomUUID(),results:[{requestId:ids[1],resultId:childResult.id,version:childResult.version,decision:'accept'}]})).status()).toBe(200);
  const final=await get();expect(final.status).toBe('completed');expect(final.requestGraph.nodes.every(n=>n.state.kind==='completed')).toBe(true);expect(final.runs).toHaveLength(3);
  await page.reload();await expect(page.locator('#agent-'+agentIds[0])).toContainText('親の結果');
  const state=await (await page.request.get(base+'/api/direct')).json();expect(state.reviews[agentIds[1]].attention).toBe(false);expect(state.reviews[agentIds[2]].attention).toBe(false);
 }finally{if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}await rm(dir,{recursive:true,force:true});}
});
