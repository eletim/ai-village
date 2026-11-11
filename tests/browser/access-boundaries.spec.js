import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createServer as httpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
for(const mode of ['PC','mobile','HTTPS'])test(`real human API and browser controls (${mode})`,async({browser})=>{
 const mobile=mode==='mobile';
 const dir=await mkdtemp(join(tmpdir(),'human-browser-'));let child,context,proxy;
 try{
  const id=randomUUID(),sid=randomUUID(),agent={id,name:'検証Agent',provider:'codex',location:'mayor',connection:{connectionType:'local'},workspaceId:'fixture',tabId:'fixture',cwd:dir,state:'busy'};
  const requests=['complete','cancel','retry','queued'].map(name=>({id:randomUUID(),rootWorkId:randomUUID(),instruction:name,revision:0,status:'active',reportMode:false,works:[]}));
  const runs=requests.map(q=>{const r={id:randomUUID(),humanRequestId:q.id,workId:q.rootWorkId,agentId:id,origin:'human',instruction:q.instruction,state:q.instruction==='queued'?'queued':'failed'};q.initialRunId=r.id;q.works=[{id:q.rootWorkId,agentId:id,parentWorkId:null,runIds:[r.id],currentRunId:r.id}];return r;});
  await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],agents:[agent],runs,requests}));
  await mkdir(join(dir,'sessions'));await writeFile(join(dir,'sessions',sid+'.jsonl'),JSON.stringify({type:'event_msg',payload:{type:'task_started',turn_id:'external'}})+'\n');
  const bin=join(dir,'pmux');await writeFile(bin,'#!/bin/sh\nprintf \'%s\\n\' \''+JSON.stringify({alive:true,cliState:'busy',agentSessionId:sid})+'\'\n',{mode:0o700});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));let base=`http://127.0.0.1:${port}`,publicOrigin='',authFile='';
  if(mode==='HTTPS'){
   const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-days','1'],{stdio:'ignore'});
   proxy=httpsServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{const upstream=httpRequest({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});upstream.on('error',()=>res.destroy());req.pipe(upstream);});
   proxy.listen(0,'127.0.0.1');await once(proxy,'listening');base=publicOrigin=`https://127.0.0.1:${proxy.address().port}`;authFile=join(dir,'auth');await writeFile(authFile,'mayor:test-password-long-enough');
  }
  child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_PMUX_BIN:bin,VILLAGE_VPN_ADDRESS:'',VILLAGE_PUBLIC_ORIGIN:publicOrigin,VILLAGE_AUTH_FILE:authFile,VILLAGE_NOTIFICATIONS:'false',VILLAGE_RATE_LIMITS_FILE:join(dir,'no-rate-limits.json'),CODEX_HOME:dir,VILLAGE_NATIVE_CACHE_DIR:join(dir,'native-cache')},stdio:['ignore','pipe','pipe']});
  await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('startup timeout')),10000);child.once('exit',()=>{clearTimeout(timer);no(Error('server exited'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);ok();}});});
  context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile,ignoreHTTPSErrors:true,...(mode==='HTTPS'?{httpCredentials:{username:'mayor',password:'test-password-long-enough'}}:{})});const page=await context.newPage();await page.goto(base+'/agents');page.on('dialog',d=>d.accept());
  const cookie=(await context.cookies(base+'/api/direct/human/requests/complete')).find(c=>c.name==='village-human-ui');expect(cookie.httpOnly).toBe(true);expect(cookie.secure).toBe(mode==='HTTPS');
  for(const action of ['complete','cancel','retry','resume','cancel-queued'])expect((await context.request.post(base+'/api/direct/human/requests/'+action,{data:{}})).status()).toBe(403);
  expect((await context.request.post(base+'/api/direct/requests/get',{data:{humanRequestId:requests[0].id}})).status()).toBe(200);
  const help=await (await context.request.post(base+'/api/village',{data:{argv:['help']}})).json();
  for(const action of ['retry','resume','cancel','complete','cancel-queued'])expect(JSON.stringify(help)).not.toContain('requests '+action);
  const responses=[];page.on('response',r=>{if(r.url().includes('/human/'))responses.push(r);});
  await page.locator('#run-recovery-inbox summary').click();
  await page.locator(`[data-recovery-complete="${requests[0].id}"]`).click();
  await expect.poll(()=>responses.length).toBe(1);expect(responses[0].status()).toBe(200);
  await page.locator(`[data-recovery-cancel="${requests[1].id}"]`).click();
  await expect.poll(()=>responses.length).toBe(2);expect(responses[1].status()).toBe(200);
  await page.locator(`[data-recovery-retry="${requests[2].id}"]`).click();
  await expect.poll(()=>responses.length).toBe(3);expect(responses[2].status()).toBe(200);
  await page.getByRole('button',{name:'送信待ちを取り消す',exact:true}).click();
  await expect.poll(()=>responses.length).toBe(4);expect(responses[3].status()).toBe(200);
 }finally{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}try{await context?.close();}finally{if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}await rm(dir,{recursive:true,force:true});}}
});
