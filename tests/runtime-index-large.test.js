import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,appendFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {RuntimeReader} from '../server/runtime-reader.mjs';
import {correlate,inputHash} from '../server/runtime-events.mjs';
test('1 GiB JSONL catches up in bounded batches; unchanged/restart transfers no history and append is incremental',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-gib-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));const sid='11111111-2222-3333-4444-555555555555',file=join(dir,'sessions',sid+'.jsonl');
 execFileSync('python3',['-c',`import sys,json
with open(sys.argv[1],'wb') as f:
 for row in [{'type':'event_msg','payload':{'type':'task_started','turn_id':'t'}},{'type':'event_msg','payload':{'type':'user_message','turn_id':'t','message':'hello'}}]:f.write((json.dumps(row)+'\\n').encode())
 line=(json.dumps({'type':'padding','data':'x'*65500})+'\\n').encode()
 for i in range((1024*1024*1024)//len(line)+1):f.write(line)
 f.write((json.dumps({'type':'event_msg','payload':{'type':'task_complete','turn_id':'t','last_agent_message':'done'}})+'\\n').encode())`,file]);
 const env={...process.env,CODEX_HOME:dir,VILLAGE_NATIVE_CACHE_DIR:join(dir,'cache')},a={provider:'codex',connection:{connectionType:'local'}},status={agentSessionId:sid};let last,bytes=0,maxResponse=0,maxCallMs=0,calls=0;
 const execute=async(_,args)=>{const t0=performance.now(),raw=execFileSync(args[0],args.slice(1),{env,maxBuffer:15e6,timeout:60000}).toString();maxCallMs=Math.max(maxCallMs,performance.now()-t0);last=JSON.parse(raw);bytes+=Buffer.byteLength(raw);maxResponse=Math.max(maxResponse,Buffer.byteLength(raw));calls++;return raw;};
 let reader=new RuntimeReader(dir),s;const began=performance.now(),size=(await stat(file)).size;
 const run={dispatchConfirmed:true,baselineRuntime:{sessionId:sid,cursor:0},inputHash:inputHash('hello')};
 for(let i=0;i<200;i++){s=await reader.read(a,status,execute);assert(last.indexedBytes<=40*1024*1024);if(s.available)break;assert.equal(correlate(run,s).state,'unknown');}
 assert(s.available);assert.equal(s.cursor,size);assert.equal(correlate(run,s).state,'completed');const initial={size,calls,ms:Math.round(performance.now()-began),wireBytes:bytes,maxResponse,maxCallMs:Math.round(maxCallMs)};
 reader=new RuntimeReader(dir);let t0=performance.now();s=await reader.read(a,status,execute);assert.equal(last.indexedBytes,0);assert.equal(last.pieces.length,0);assert.equal(s.turns[0].output,'done');const unchanged={ms:Math.round(performance.now()-t0),wireBytes:Buffer.byteLength(JSON.stringify(last)),indexedBytes:last.indexedBytes};
 const addition=JSON.stringify({type:'event_msg',payload:{type:'task_started',turn_id:'new'}})+'\n';await appendFile(file,addition);t0=performance.now();s=await reader.read(a,status,execute);assert(s.available);assert.equal(last.indexedBytes,Buffer.byteLength(addition));assert.equal(s.turns.at(-1).id,'new');
 t.diagnostic(JSON.stringify({initial,unchanged,append:{ms:Math.round(performance.now()-t0),indexedBytes:last.indexedBytes,wireBytes:Buffer.byteLength(JSON.stringify(last))}}));
});
test('dense assistant history has bounded first sync, zero history on restart and only new message on append',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-dense-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));const sid='11111111-2222-3333-4444-555555555555',file=join(dir,'sessions',sid+'.jsonl');
 execFileSync('python3',['-c',`import sys,json
with open(sys.argv[1],'w') as f:
 def row(x):f.write(json.dumps(x)+'\\n')
 row({'type':'event_msg','payload':{'type':'task_started','turn_id':'t'}})
 row({'type':'event_msg','payload':{'type':'user_message','turn_id':'t','message':'hello'}})
 for i in range(320):row({'type':'response_item','payload':{'role':'assistant','id':'m'+str(i),'turn_id':'t','content':[{'type':'output_text','text':str(i)+':'+('body '*13000)}]}})
 row({'type':'event_msg','payload':{'type':'task_complete','turn_id':'t','last_agent_message':'final'}})`,file]);
 const env={...process.env,CODEX_HOME:dir,VILLAGE_NATIVE_CACHE_DIR:join(dir,'cache')},a={provider:'codex',connection:{connectionType:'local'}},status={agentSessionId:sid};let wire=0,calls=0,last;
 const execute=async(_,args)=>{const raw=execFileSync(args[0],args.slice(1),{env,maxBuffer:15e6,timeout:60000}).toString();wire+=Buffer.byteLength(raw);calls++;last=JSON.parse(raw);assert(Buffer.byteLength(raw)<15e6);return raw;};
 let reader=new RuntimeReader(dir),s,polls=0;const began=performance.now();
 do{s=await reader.read(a,status,execute);polls++;assert(polls<100);}while(!s.available);
 assert.equal(s.turns[0].messages.length,320);assert(s.turns[0].output.includes('319:body'));const initial={sourceBytes:(await stat(file)).size,pages:calls,observations:polls,ms:Math.round(performance.now()-began),wireBytes:wire};
 wire=0;calls=0;reader=new RuntimeReader(dir);const t0=performance.now();s=await reader.read(a,status,execute);assert(s.available);assert.equal(last.pieces.length,0);const restart={ms:Math.round(performance.now()-t0),wireBytes:wire,pages:calls};
 const addition=JSON.stringify({type:'response_item',payload:{role:'assistant',turn_id:'t',content:[{type:'output_text',text:'new small message'}]}})+'\n';await appendFile(file,addition);wire=0;calls=0;s=await reader.read(a,status,execute);assert(s.available);assert.equal(s.turns[0].messages.length,321);assert.equal(last.indexedBytes,Buffer.byteLength(addition));assert(wire<4096);
 t.diagnostic(JSON.stringify({denseInitial:initial,restart,append:{wireBytes:wire,pages:calls,indexedBytes:last.indexedBytes}}));
});
