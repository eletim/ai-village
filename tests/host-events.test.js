import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once,EventEmitter} from 'node:events';
import {HostEvents} from '../server/host-events.mjs';
import {EventMonitor} from '../server/event-monitor.mjs';
test('host watches native files, ignores layout timestamps, and multiplexes commands without reconnecting',async t=>{
 const keepAlive=setTimeout(()=>{},10000);t.after(()=>clearTimeout(keepAlive));
 const home=await mkdtemp(join(tmpdir(),'village-host-events-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const layout=join(home,'.purplemux/workspaces/ws-test/layout.json');await mkdir(join(home,'.purplemux/workspaces/ws-test'),{recursive:true});
 const log=join(home,'.codex/sessions/test.jsonl');await mkdir(join(home,'.codex/sessions'),{recursive:true});
 await writeFile(layout,JSON.stringify({root:{tabs:[{id:'t',agentSessionId:'s'}]},updatedAt:1}));
 let starts=0;const host=new HostEvents({connectionType:'local'},{spawnProcess:(cmd,args,options)=>{starts++;return spawn(cmd,args,{...options,env:{...process.env,HOME:home,CODEX_HOME:join(home,'.codex')}});}});t.after(()=>host.close());
 const ready=once(host,'ready');host.start();await ready;
 const events=[];host.on('changed',e=>events.push(e));
 assert.equal(await host.execute(['python3','-c','print("first")']),'first\n');
 await writeFile(layout,JSON.stringify({root:{tabs:[{id:'t',agentSessionId:'s'}]},updatedAt:2}));
 const changed=once(host,'changed');await writeFile(log,'{}\n');await changed;
 assert(events.some(e=>e.paths.includes(log)));
 assert.equal(await host.execute(['python3','-c','print("barrier")']),'barrier\n');
 assert(!events.some(e=>e.paths.includes(layout)));assert.equal(starts,1);
 const reconnect=once(host,'ready');host.child.kill();await reconnect;assert.equal(starts,2);
 assert.equal(await host.execute(['python3','-c','print("resynced")']),'resynced\n');
});
test('monitor reconciles on connection/events only, coalesces bursts and preserves changes during a read',async t=>{
 class Host extends EventEmitter{start(){this.ready=true;this.emit('ready');}send(){}close(){}}
 const host=new Host(),a={id:'a',tabId:'t',sessionName:'s',connection:{connectionType:'local'},runtime:{agentSessionId:'native'}};
 let reads=0,release,first=true;
 const d={localBin:'purplemux',data:{agents:[a],runs:[]},locked:(_,fn)=>fn(),progress:async()=>{},observe:async()=>{reads++;if(first){first=false;await new Promise(r=>{release=r;});}return {changed:false};}};
 const m=new EventMonitor(d,{hostFactory:()=>host});t.after(()=>m.close());m.start();
 await new Promise(resolve=>setTimeout(resolve,120));assert.equal(reads,1);
 host.emit('changed',{paths:['/sessions/native.jsonl']});host.emit('changed',{paths:['/sessions/native.jsonl']});release();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);
 m.update();host.emit('changed',{paths:['/sessions/other.jsonl']});
 await new Promise(resolve=>setTimeout(resolve,150));assert.equal(reads,2);
});
test('process exit without a final log record wakes the observer through pidfd',async t=>{
 const home=await mkdtemp(join(tmpdir(),'village-process-event-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const agent=spawn('bash',['-c','exec -a codex sleep 60']);t.after(()=>agent.kill());
 const bin=join(home,'bin');await mkdir(bin);await writeFile(join(bin,'tmux'),'#!/bin/sh\necho '+agent.pid+'\n',{mode:0o700});
 const host=new HostEvents({connectionType:'local'},{spawnProcess:(cmd,args,options)=>spawn(cmd,args,{...options,env:{...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),PATH:bin+':'+process.env.PATH}})});t.after(()=>host.close());
 const ready=once(host,'ready');host.start();await ready;
 assert.equal((await host.inspect({id:'a',sessionName:'test'})).agentAlive,true);
 const changed=once(host,'changed');agent.kill();const [event]=await changed;
 assert.deepEqual(event.agentIds,['a']);assert.equal((await host.inspect({id:'a',sessionName:'test'})).agentAlive,false);
});
