import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkshopBridge, run } from '../server/bridge.mjs';
import { VillageOperations } from '../server/operations.mjs';
import { VillageLibrary } from '../server/library.mjs';
import { Secretariat } from '../server/secretariat.mjs';
import { isOnDesk, jobStatus } from '../src/job-state.js';
const id='11111111-1111-4111-8111-111111111111';
class Workshop extends WorkshopBridge {
  constructor(dir){super({dir});this.calls=[];this.tabs=[{workspaceId:'own-ws',tabId:'own-tab',sessionName:'own-session',panelType:'codex-cli'},{workspaceId:'own-ws',tabId:'other-tab',panelType:'terminal'}];}
  async stopAgentProcesses() {}
  async remote(args){
    if(args[0]==='python3')return '[]';
    this.calls.push(args);if(this.fail)throw new Error('SSH unavailable');
    if(args[1]==='workspaces')return JSON.stringify({workspaces:[{id:'own-ws'}]});
    if(args[2]==='list')return JSON.stringify({tabs:this.tabs});
    if(args[2]==='close'){assert.equal(args.at(-1),'own-tab');this.tabs=this.tabs.filter(t=>t.tabId!=='own-tab');return 'ok';}
    throw new Error('unexpected '+args.join(' '));
  }
}
async function setup(){
  const dir=await mkdtemp(join(tmpdir(),'village-operations-')),bridge=new Workshop(dir);await bridge.init();
  bridge.job={id,phase:'working',request:'仕事',sshHost:'original',cwd:'/work/own',workspaceId:'own-ws',tabId:'own-tab',sessionName:'own-session',releaseState:'held'};
  bridge.jobs=[bridge.job,{id:'other',phase:'awaiting_review',report:'別の未確認報告',releaseState:'held'}];await bridge.persist();
  return {dir,bridge,ops:new VillageOperations(bridge)};
}
test('cancel stops the scoped local execution before closing only its agent; duplicate calls and restart are idempotent',async()=>{
  const {bridge,dir,ops}=await setup();let stopped=false;
  bridge.launch(async()=>{while(!bridge.executions.get(id)?.controller.signal.aborted)await new Promise(r=>setTimeout(r,2));stopped=true;});
  const a=bridge.cancel(id),b=bridge.cancel(id);assert.equal(a,b);await a;
  assert.ok(stopped);assert.equal(bridge.job.phase,'cancelled');assert.ok(bridge.job.stopConfirmedAt);assert.equal(isOnDesk(bridge.job),false);
  assert.deepEqual(bridge.tabs.map(t=>t.tabId),['other-tab']);assert.equal(bridge.snapshot().desk[0].id,'other');
  const result=await ops.execute(['jobs','cancel',id]);assert.equal(result.ok,true);assert.equal(result.result.verification.confirmed,true);
  assert.equal(bridge.calls.filter(a=>a[2]==='close').length,1);
  const restored=new Workshop(dir);await restored.init();await restored.cancel(id);assert.equal(restored.calls.length,0);assert.equal(isOnDesk(restored.job),false);
});
test('failed cancellation is visible and durable, cannot be dismissed, and can be retried',async()=>{
  const {bridge,dir,ops}=await setup();bridge.fail=true;
  let result=await ops.execute(['jobs','cancel',id]);assert.equal(result.ok,false);assert.equal(result.result.verification.confirmed,false);assert.equal(jobStatus(bridge.job),'cancellation_pending');assert.ok(isOnDesk(bridge.job));assert.equal(bridge.job.cancelledAt,undefined);
  result=await ops.execute(['desk','dismiss',id]);assert.equal(result.ok,false);assert.match(result.error,/未完了/);
  const restored=new Workshop(dir);await restored.init();assert.equal(restored.job.releaseState,'failed');assert.equal(restored.calls.length,0);
  await restored.cancel(id);assert.equal(restored.job.phase,'cancelled');assert.equal(isOnDesk(restored.job),false);
});
test('historical approved records leave the desk without changing old phases, prose or artifacts; search is local',async()=>{
  const {bridge,ops}=await setup();Object.assign(bridge.job,{phase:'awaiting_review',report:'以前の成果',approvedAt:'past',releaseState:'released',artifacts:[{path:'result.txt',size:5}]});await bridge.persist();
  const before=JSON.stringify(bridge.job), list=await ops.execute(['reports','list']);assert.equal(list.result.length,1);
  const history=await ops.execute(['history','search','--query','以前の成果']);assert.equal(history.result[0].status,'approved');assert.equal(history.result[0].onDesk,false);
  const detail=await ops.execute(['history','get',id]);assert.match(detail.result.artifacts[0].url,/result.txt/);assert.equal(JSON.stringify(bridge.job),before);assert.equal(bridge.calls.length,0);
  assert.equal((await ops.execute(['jobs','cancel',id])).ok,false);assert.equal(bridge.calls.length,0);
});
test('cancel local planning never connects; ambiguous creation never closes an unknown tab',async()=>{
  const {bridge}=await setup();Object.assign(bridge.job,{resourceStep:'local',workspaceId:null,tabId:null,phase:'planning'});await bridge.cancel(id);assert.equal(bridge.calls.length,0);
  Object.assign(bridge.job,{resourceStep:'agent-create',workspaceId:'own-ws',tabId:null,cancelledAt:null,releaseState:'failed'});
  await bridge.cancel(id);assert.equal(bridge.job.releaseState,'failed');assert.ok(isOnDesk(bridge.job));assert.equal(bridge.calls.some(a=>a[2]==='close'),false);
});
test('cancellation waits for an in-flight create and records its returned identity before cleanup',async()=>{
  const {bridge}=await setup();Object.assign(bridge.job,{phase:'connecting',tabId:null});let complete;
  const created=new Promise(r=>complete=r);
  bridge.launch(async()=>{await created;await bridge.update({tabId:'own-tab'});bridge.assertRunning();throw new Error('must never dispatch');});
  const pending=bridge.cancel(id);await new Promise(r=>setTimeout(r,5));assert.equal(bridge.calls.length,0);complete();await pending;
  assert.equal(bridge.job.phase,'cancelled');assert.equal(bridge.calls.filter(a=>a[2]==='close').length,1);
});
test('aborting a core process rejects only after it exits',async()=>{
  const controller=new AbortController();const execution=run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});controller.abort();await assert.rejects(execution,/キャンセル/);
});
test('secretary reads the current manual, performs a generic registered operation and rechecks its result',async()=>{
  const {bridge,dir,ops}=await setup();const root=join(dir,'library');await mkdir(root);await writeFile(join(root,'manual.md'),'# 操作\nhelpで調べて操作する。');
  const secretary=new Secretariat(bridge,new VillageLibrary(root),ops);await secretary.init();
  const choices=[{action:'village',argv:['jobs','cancel',id]},{action:'read_document',document:'manual.md'},{action:'village',argv:['help']},{action:'village',argv:['jobs','cancel',id]},{action:'village',argv:['jobs','get',id]},{action:'reply',message:'停止と解放を確認しました。'}];
  secretary.decide=async()=>({message:'',document:'',task:'',...choices.shift()});await secretary.send('その仕事をキャンセルして');await secretary.running;
  assert.equal(bridge.job.phase,'cancelled');const tools=secretary.messages.filter(m=>m.role==='tool');assert.match(tools[0].content,/最新のmanual/);assert.ok(tools.some(m=>m.argv?.[1]==='get'&&JSON.parse(m.content).result.status==='cancelled'));
  const audit=await readFile(join(dir,'operations.jsonl'),'utf8');assert.match(audit,/secretary:/);assert.equal(secretary.messages.at(-1).content,'停止と解放を確認しました。');
});

test('OS cleanup kills tracked children in separate groups, rejects PID reuse and preserves unrelated processes',async()=>{
  const {spawn}=await import('node:child_process');const {stopProcessesScript}=await import('../server/processes.mjs');
  const dir=await mkdtemp(join(tmpdir(),'village-processes-'));
  const owned=spawn('sleep',['60'],{cwd:dir,detached:true,stdio:'ignore'}),other=spawn('sleep',['60'],{detached:true,stdio:'ignore'});
  const start=async pid=>{const raw=await readFile(`/proc/${pid}/stat`,'utf8');return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];};
  try {
    const record={pid:owned.pid,start:await start(owned.pid)};
    await assert.rejects(run('python3',['-c',stopProcessesScript,JSON.stringify([{...record,start:'wrong'}]),dir,'[]']),/所有関係未確認/);
    process.kill(owned.pid,0);process.kill(other.pid,0);
    const verified=JSON.parse(await run('python3',['-c',stopProcessesScript,JSON.stringify([record]),dir,'[]']));
    assert.equal(verified.remainingOwned,0);assert.equal(verified.untrackedInDirectory,0);process.kill(other.pid,0);
  } finally {try{owned.kill('SIGKILL');}catch{}try{other.kill('SIGKILL');}catch{}}
});

test('pre-close capture freezes the Agent and descendants even when the tool creates its own session',async()=>{
  const {spawn}=await import('node:child_process');const {captureProcessesScript,stopProcessesScript}=await import('../server/processes.mjs');
  const dir=await mkdtemp(join(tmpdir(),'village-capture-'));
  const parent=spawn('python3',['-c',"import subprocess,time;child=subprocess.Popen(['sleep','60'],start_new_session=True);print(child.pid,flush=True);time.sleep(60)"],{cwd:dir,stdio:['ignore','pipe','ignore']});
  const childPid=Number(await new Promise(resolve=>parent.stdout.once('data',chunk=>resolve(chunk.toString().trim()))));
  try {
    const records=JSON.parse(await run('python3',['-c',captureProcessesScript.replace('root=pane(sys.argv[1])','root=int(sys.argv[1])'),String(parent.pid)]));
    assert.ok(records.some(v=>v.pid===parent.pid));assert.ok(records.some(v=>v.pid===childPid));
    const stat=await readFile(`/proc/${childPid}/stat`,'utf8');assert.equal(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0],'T');
    const result=JSON.parse(await run('python3',['-c',stopProcessesScript,JSON.stringify(records),dir,'[]']));assert.equal(result.remainingOwned,0);
  } finally {try{process.kill(childPid,'SIGKILL');}catch{}try{parent.kill('SIGKILL');}catch{}}
});
