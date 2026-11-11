import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from '../server/execution.mjs';
import {RuntimeReader} from '../server/runtime-reader.mjs';

test('run() keeps multi-byte characters intact when a pipe chunk splits them',async()=>{
 // Write the 3 bytes of 成 in two separate writes with a pause, forcing two 'data' chunks.
 const script="const b=Buffer.from('前回の成績');process.stdout.write(b.subarray(0,10));setTimeout(()=>process.stdout.write(b.subarray(10)),50);";
 assert.equal(await run(process.execPath,['-e',script]),'前回の成績');
});

test('a replica page that no longer matches the source is dropped and rebuilt from the start',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'replica-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const reader=new RuntimeReader(dir),a={provider:'codex',connection:{connectionType:'local'}};
 const value=JSON.stringify({id:'t',state:'completed'});
 const piece=(part,data,done)=>({seq:1,kind:'turn',key:'t',part,data,done});
 let calls=[];
 const reply=pieces=>JSON.stringify({available:true,generation:'g',pieces,next:{seq:pieces.at(-1).done?1:0,part:pieces.at(-1).done?0:pieces[0].part+pieces[0].data.length},more:!pieces.at(-1).done});
 // First page: corrupted length (one character too many), claims 4 characters were sent.
 const execute=async(_a,args)=>{const req=JSON.parse(args.at(-1));calls.push(req.cursor);
  if(!req.cursor||!req.cursor.part)return calls.length===1?JSON.stringify({available:false,generation:'g',pieces:[piece(0,'��'+value.slice(1,3),false)],next:{seq:0,part:3},more:true}):reply([piece(0,value,true)]);
  return reply([piece(3,value.slice(3),true)]);};
 await assert.rejects(reader.read(a,{agentSessionId:'s'},execute),/cache chunk/);
 assert.deepEqual(await readdir(join(dir,'native-index-replica')).catch(()=>[]),[]);
 const s=await reader.read(a,{agentSessionId:'s'},execute);
 assert(s.available);assert.equal(s.turns[0].id,'t');
});
