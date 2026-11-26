import {chromium} from '@playwright/test';
import {conversationFixture} from '../../tests/helpers/conversation-answer-fixture.mjs';
import {newRun,transitionRun} from '../../server/state/run.ts';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
// Stable generated IDs make payload and state identical across revisions.
const idStyle=process.env.PERF_ID_STYLE||'prefix';let fixtureSequence=0;
const randomUUID=()=>{const n=++fixtureSequence;if(idStyle==='prefix')return `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const h=createHash('sha256').update(String(n)).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {serverReady} from '../../tests/helpers/server-ready.mjs';
const port=Number(process.env.PERF_PORT||15810),base='http://127.0.0.1:'+port;
const out=process.env.PERF_OUT;if(!out)throw Error('PERF_OUT required');await mkdir(out,{recursive:true});
const probe=createServer();probe.listen(port,'127.0.0.1');await once(probe,'listening');await new Promise(r=>probe.close(r));
const results=[],browser=await chromium.launch();
const instrumented=process.env.PERF_INSTRUMENT==='1';
const cases=JSON.parse(process.env.LOW_CASES||'[{"role":0,"mode":"normal","width":1440},{"role":1,"mode":"normal","width":1440},{"role":2,"mode":"normal","width":1440},{"role":0,"mode":"network","width":1440},{"role":0,"mode":"cpu","width":1440},{"role":0,"mode":"both","width":1440},{"role":0,"mode":"both","width":390}]');
try{for(const scenario of cases)for(let trial=0;trial<Number(process.env.PERF_REPEATS||1);trial++){const {role,mode,width,count=300,single=true,reviewed=false}=scenario;

 fixtureSequence=0;
 const dir=await mkdtemp(tmpdir()+'/village-cold-'),data=conversationFixture(),template=data.runs[0];data.runs=[];data.agents=[];data.conversations=[];data.projects=[];
 for(let k=0;k<1;k++){const pid=randomUUID();data.projects.push({id:pid,name:'Project '+k,revision:0});for(let j=0;j<3;j++){
 const id=randomUUID(),cid=randomUUID();data.agents.push({id,name:'Agent '+k+'-'+j,location:j===0?'mayor':'workshop',workshopId:j===0?undefined:'fixture-workshop',projectId:pid,state:'idle',connection:{connectionType:'local'},provider:'codex',workspaceId:'fake-'+id,tabId:'fake',agentModel:{id,intent:null,observation:null}});if(j===1)data.projects.at(-1).leaderAgentId=id;if(j===0)data.conversations.push({id:cid,agentId:id,projectId:pid,sequence:count,operations:[],deliveries:[]});
 for(let i=0;i<count;i++){const rid=randomUUID(),session='fixture-session-'+id,tid='turn'+i;
 const body=Array.from({length:40},(_,n)=>`生成fixture ${i}/${n}: 会話本文の計測です。実データは含みません。公開回答と内部資料の読み込みを測定します。`).join('\n');
 const r={...template,id:rid,requestId:randomUUID(),agentId:id,conversationId:cid,conversationSequence:i+1,createdAt:new Date(1700000000000+i*1000).toISOString(),instruction:'生成相談 '+i,output:body,finalOutput:body,inputId:'input'+i,turnId:tid,sessionId:session,conversationSource:{kind:i%2?'leader':'human'},...(i%2?{conversationDisplay:{mode:'progress',version:1}}:{})};
 r.runModel=newRun(r.id,r.requestId,j===0&&i%2?'program':'human',null,{phase:j===0?'conversation':'work'}).value;
 for(const e of [{type:'dispatch',at:1,sessionId:session,agentIdle:true},{type:'input',at:2,sessionId:session,turnId:tid,inputId:r.inputId,matchedRunId:r.id,competing:false},{type:'terminal',at:3,sessionId:session,turnId:tid,outcome:'normal'}])r.runModel=transitionRun(r.runModel,{actor:'program',...e}).value;
 if(j!==0){r.runModel.requestId='';delete r.conversationId;delete r.conversationSequence;delete r.conversationSource;delete r.conversationDisplay;r.origin=i%2?'delegation':'human';}
 data.runs.push(r);
 }
 }}

 await writeFile(dir+'/direct.json',JSON.stringify(data));await writeFile(dir+'/pmux','#!/bin/sh\nexit 1\n',{mode:0o700});
 const name=[role,mode,width,count,single?'hash':'board',reviewed?'read':'unread',trial].join('-'),log=out+'/'+name+'-server.jsonl';
 const args=[...(instrumented?['--import','./scripts/performance/low-resource-instrument.mjs']:[]),'scripts/dev.mjs','--host','127.0.0.1','--port',String(port)];
 const child=spawn(process.execPath,args,{env:{...process.env,HOME:dir,CODEX_HOME:dir,VILLAGE_STATE_DIR:dir,VILLAGE_PMUX_BIN:dir+'/pmux',VILLAGE_NOTIFICATIONS:'false',VILLAGE_AUTH_FILE:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_VPN_ADDRESS:'',PERF_LOG:log},stdio:['ignore','pipe','pipe']});
 let context,serverReadyMs;
 try{
  const serverStarted=performance.now();await serverReady(child,{timeout:120000});serverReadyMs=performance.now()-serverStarted;await new Promise(r=>setTimeout(r,2000));
  // Equal warm presentation cache at navigation. Each trial has fresh server state;
  // read receipts are the only difference between the two explicitly labelled groups.
  const snapshot=await (await fetch(base+'/api/direct?view=workspace&focus=[]')).json();
  if(reviewed){for(const a of data.agents){const r=await fetch(base+'/api/direct/agents/'+a.id+'/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:snapshot.reviews[a.id].revision})});if(!r.ok)throw Error('fixture ack failed '+r.status);}}
  await (await fetch(base+'/api/direct?view=workspace&focus=[]')).arrayBuffer();
  context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();
  await page.addInitScript(()=>{window.firstText=null;window.paintedText=null;window.interactive=null;new MutationObserver(()=>{if(window.firstText!==null)return;const panels=[...document.querySelectorAll('.agent-panel:not([hidden])')];if(panels.some(p=>p.querySelector('.runs[data-loading="false"] .run')?.textContent.includes('生成'))){window.firstText=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{window.paintedText=performance.now();const input=panels[0]?.querySelector('textarea');if(input&&!input.disabled){input.focus();input.value='measurement draft';input.dispatchEvent(new Event('input',{bubbles:true}));window.interactive=performance.now();}}));}}).observe(document,{childList:true,subtree:true});window.longtasks=[];new PerformanceObserver(l=>window.longtasks.push(...l.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});});
  if(instrumented)await page.addInitScript(()=>{window.parseCosts=[];const parse=JSON.parse;JSON.parse=function(...args){const at=performance.now();try{return parse.apply(this,args);}finally{if(typeof args[0]==='string'&&args[0].length>10000)window.parseCosts.push({chars:args[0].length,ms:performance.now()-at});}};});
  let cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});if(['network','both'].includes(mode))await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8});if(['cpu','both'].includes(mode))await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});if(instrumented){await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReturnAsStream'});}
  const started=Date.now(),at=performance.now();await page.goto(base+'/agents'+(single?'#agent-'+data.agents[role].id:''));
  await page.waitForFunction(()=>{const logs=[...document.querySelectorAll('.agent-panel:not([hidden]) .runs')];return logs.length&&logs.every(n=>n.dataset.loading==='false'&&n.querySelector('.run'));});
  const ready=performance.now()-at;let paintedReadyMs=null;if(instrumented){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));paintedReadyMs=performance.now()-at;}await page.waitForTimeout(500);
  let layout=[];
  if(instrumented){const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const tr=await done;let trace='';for(;;){const x=await cdp.send('IO.read',{handle:tr.stream});trace+=x.data;if(x.eof)break;}await cdp.send('IO.close',{handle:tr.stream});layout=JSON.parse(trace).traceEvents.filter(e=>['Layout','UpdateLayoutTree'].includes(e.name)&&e.ph==='X').map(e=>({name:e.name,ms:e.dur/1000,ts:e.ts}));await writeFile(out+'/'+name+'-layout.json',JSON.stringify(layout));}
  const metrics=await page.evaluate(()=>({parseCosts:window.parseCosts,firstText:window.firstText,paintedText:window.paintedText,interactive:window.interactive,origin:performance.timeOrigin,longtasks:window.longtasks,resources:performance.getEntriesByType('resource').filter(e=>!e.name.includes('/events')).map(e=>({url:e.name,start:e.startTime,duration:e.duration,ttfb:e.responseStart-e.requestStart,encoded:e.encodedBodySize,decoded:e.decodedBodySize})),visibleText:[...document.querySelectorAll('.agent-panel:not([hidden]) .run')].map(n=>n.textContent).join('\n'),entries:document.querySelectorAll('.run').length,visibleEntries:[...document.querySelectorAll('.agent-panel:not([hidden]) .run')].length,nodes:document.querySelectorAll('*').length}));
  const switchAt=await page.evaluate(()=>performance.now());await page.evaluate(id=>{location.hash='agent-'+id;},data.agents[(role+1)%3].id);await page.waitForFunction(id=>{const c=document.getElementById('agent-'+id);return c&&!c.hidden&&c.querySelector('.runs[data-loading="false"] .run')?.textContent.includes('生成');},data.agents[(role+1)%3].id);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const switchMs=await page.evaluate(t=>performance.now()-t,switchAt);
  const end=await (await fetch(base+'/api/direct?view=workspace&focus=[]')).json();
  const contentHash=createHash('sha256').update(metrics.visibleText).digest('hex');delete metrics.visibleText;
  results.push({contentHash,serverReadyMs,switchMs,role,mode,name,idStyle,count,width,single,reviewed,trial,instrumented,started,readyMs:ready,paintedReadyMs,layout,metrics,unreadAfter:Object.values(end.reviews).filter(r=>r.unreviewed).length});
  await writeFile(out+'/measurements.json',JSON.stringify(results,null,2));console.log(name,JSON.stringify({ready,firstText:metrics.firstText,painted:metrics.paintedText,interactive:metrics.interactive,switchMs}));
 }finally{await context?.close();if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}await rm(dir,{recursive:true,force:true});}
}}finally{await browser.close();}
