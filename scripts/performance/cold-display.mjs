import {chromium} from '@playwright/test';
import {conversationFixture} from '../../tests/helpers/conversation-answer-fixture.mjs';
import {newRun,transitionRun} from '../../server/state/run.ts';
import {mkdtemp,writeFile,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
// Stable generated IDs make payload and state identical across revisions.
const idStyle=process.env.PERF_ID_STYLE||'prefix';let fixtureSequence=0;
const randomUUID=()=>{const n=++fixtureSequence;if(idStyle==='prefix')return `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const h=createHash('sha256').update(String(n)).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {serverReady} from '../../tests/helpers/server-ready.mjs';
const port=Number(process.env.PERF_PORT||15642),base='http://127.0.0.1:'+port;
const out=process.env.PERF_OUT;if(!out)throw Error('PERF_OUT required');await mkdir(out,{recursive:true});
const probe=createServer();probe.listen(port,'127.0.0.1');await once(probe,'listening');await new Promise(r=>probe.close(r));
const results=[],browser=await chromium.launch();
const instrumented=process.env.PERF_INSTRUMENT==='1',repeats=Number(process.env.PERF_REPEATS||3);
try{for(const count of (process.env.PERF_COUNTS||'10,1000').split(',').map(Number))for(const width of (process.env.PERF_WIDTHS||'1440,390').split(',').map(Number))for(const single of [false,true])for(const reviewed of (process.env.PERF_READS||'false,true').split(',').map(x=>x==='true'))for(let trial=0;trial<repeats;trial++){
 fixtureSequence=0;
 const dir=await mkdtemp(tmpdir()+'/village-cold-'),data=conversationFixture(),template=data.runs[0];data.runs=[];data.agents=[];data.conversations=[];data.projects=[];
 for(let k=0;k<2;k++){const pid=randomUUID();data.projects.push({id:pid,name:'Project '+k,revision:0});for(let j=0;j<2;j++){
 const id=randomUUID(),cid=randomUUID();data.agents.push({id,name:'Agent '+k+'-'+j,location:'mayor',projectId:pid,state:'idle',connection:{connectionType:'local'},provider:'codex',workspaceId:'fake-'+id,tabId:'fake',agentModel:{id,intent:null,observation:null}});data.conversations.push({id:cid,agentId:id,projectId:pid,sequence:count,operations:[],deliveries:[]});
 for(let i=0;i<count;i++){const rid=randomUUID(),session='fixture-session-'+id,tid='turn'+i;
 const body=Array.from({length:40},(_,n)=>`生成fixture ${i}/${n}: 会話本文の計測です。実データは含みません。公開回答と内部資料の読み込みを測定します。`).join('\n');
 const r={...template,id:rid,requestId:randomUUID(),agentId:id,conversationId:cid,conversationSequence:i+1,createdAt:new Date(1700000000000+i*1000).toISOString(),instruction:'生成相談 '+i,output:body,finalOutput:body,inputId:'input'+i,turnId:tid,sessionId:session,conversationSource:{kind:i%2?'leader':'human'},...(i%2?{conversationDisplay:{mode:'progress',version:1}}:{})};
 r.runModel=newRun(r.id,r.requestId,i%2?'program':'human',null,{phase:'conversation'}).value;
 for(const e of [{type:'dispatch',at:1,sessionId:session,agentIdle:true},{type:'input',at:2,sessionId:session,turnId:tid,inputId:r.inputId,matchedRunId:r.id,competing:false},{type:'terminal',at:3,sessionId:session,turnId:tid,outcome:'normal'}])r.runModel=transitionRun(r.runModel,{actor:'program',...e}).value;
 data.runs.push(r);
 }
 }}

 await writeFile(dir+'/direct.json',JSON.stringify(data));await writeFile(dir+'/pmux','#!/bin/sh\nexit 1\n',{mode:0o700});
 const name=[count,width,single?'single':'all',reviewed?'read':'unread',trial].join('-'),log=out+'/'+name+'-server.jsonl';
 const args=[...(instrumented?['--import','./scripts/performance/cold-instrument.mjs']:[]),'scripts/dev.mjs','--host','127.0.0.1','--port',String(port)];
 const child=spawn(process.execPath,args,{env:{...process.env,HOME:dir,CODEX_HOME:dir,VILLAGE_STATE_DIR:dir,VILLAGE_PMUX_BIN:dir+'/pmux',VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',PERF_LOG:log},stdio:['ignore','pipe','pipe']});
 let context;
 try{
  await serverReady(child,{timeout:120000});await new Promise(r=>setTimeout(r,2000));
  // Equal warm presentation cache at navigation. Each trial has fresh server state;
  // read receipts are the only difference between the two explicitly labelled groups.
  const snapshot=await (await fetch(base+'/api/direct?view=workspace&focus=[]')).json();
  if(reviewed){for(const a of data.agents){const r=await fetch(base+'/api/direct/agents/'+a.id+'/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:snapshot.reviews[a.id].revision})});if(!r.ok)throw Error('fixture ack failed '+r.status);}}
  await (await fetch(base+'/api/direct?view=workspace&focus=[]')).arrayBuffer();
  context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();
  await page.addInitScript(()=>{window.longtasks=[];new PerformanceObserver(l=>window.longtasks.push(...l.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});});
  let cdp;if(instrumented){cdp=await context.newCDPSession(page);await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReturnAsStream'});}
  const started=Date.now(),at=performance.now();await page.goto(base+'/agents'+(single?'#agent-'+data.agents[0].id:''));
  await page.waitForFunction(()=>{const logs=[...document.querySelectorAll('.agent-panel:not([hidden]) .runs')];return logs.length&&logs.every(n=>n.dataset.loading==='false'&&n.querySelector('.run'));});
  const ready=performance.now()-at;let paintedReadyMs=null;if(instrumented){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));paintedReadyMs=performance.now()-at;}await page.waitForTimeout(500);
  let layout=[];
  if(cdp){const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const tr=await done;let trace='';for(;;){const x=await cdp.send('IO.read',{handle:tr.stream});trace+=x.data;if(x.eof)break;}await cdp.send('IO.close',{handle:tr.stream});layout=JSON.parse(trace).traceEvents.filter(e=>['Layout','UpdateLayoutTree'].includes(e.name)&&e.ph==='X').map(e=>({name:e.name,ms:e.dur/1000,ts:e.ts}));await writeFile(out+'/'+name+'-layout.json',JSON.stringify(layout));}
  const metrics=await page.evaluate(()=>({origin:performance.timeOrigin,longtasks:window.longtasks,resources:performance.getEntriesByType('resource').filter(e=>!e.name.includes('/events')).map(e=>({url:e.name,start:e.startTime,duration:e.duration,ttfb:e.responseStart-e.requestStart,encoded:e.encodedBodySize,decoded:e.decodedBodySize})),entries:document.querySelectorAll('.run').length,visibleEntries:[...document.querySelectorAll('.agent-panel:not([hidden]) .run')].length,nodes:document.querySelectorAll('*').length}));
  const end=await (await fetch(base+'/api/direct?view=workspace&focus=[]')).json();
  results.push({name,idStyle,count,width,single,reviewed,trial,instrumented,started,readyMs:ready,paintedReadyMs,layout,metrics,unreadAfter:Object.values(end.reviews).filter(r=>r.unreviewed).length});
  await writeFile(out+'/measurements.json',JSON.stringify(results,null,2));console.log(name,Math.round(ready));
 }finally{await context?.close();if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}await rm(dir,{recursive:true,force:true});}
}}finally{await browser.close();}
