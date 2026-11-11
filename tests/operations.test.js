import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from '../server/execution.mjs';
test('aborting a core process rejects only after it exits',async()=>{
  const controller=new AbortController();const execution=run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});controller.abort();await assert.rejects(execution,/キャンセル/);
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
