import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeContext, recoveryReason, rotationReason, pendingBatch } from '../server/secretary-continuity.mjs';

test('rollout observer reads last context, ignoring cumulative usage and stale/missing data',async()=>{
  const home=await mkdtemp(join(tmpdir(),'village-usage-')),id='12345678-1234-1234-1234-123456789012';
  const dir=join(home,'sessions','2026','10','23');await mkdir(dir,{recursive:true});
  const path=join(dir,`rollout-test-${id}.jsonl`);
  const event=tokens=>JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:999999999},last_token_usage:{total_tokens:tokens},model_context_window:258400}}});
  await writeFile(path,'X'.repeat(300000)+'\n'+event(220000)+'\n'+event(20000)+'\n');
  const value=await observeContext(id,{home});assert.deepEqual(value,{source:'rollout-last',tokens:20000,window:258400});
  assert.equal(rotationReason({context:value}),null);assert.equal((await observeContext(id,{home,since:Date.now()+60000})).source,'unknown');
  await writeFile(path,'bad json\n'+JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:999999999}}}}));
  assert.equal((await observeContext(id,{home})).source,'unknown');assert.equal((await observeContext('../../other',{home})).source,'unknown');
});
test('actual CLI missing-rollout error is recoverable, billing/rate/auth/network errors are not',()=>{
  assert.equal(recoveryReason(new Error('Error: thread/resume: thread/resume failed: no rollout found for thread id 00000000-0000-0000-0000-000000000000 (code -32600)')),'session-missing');
  const error=new Error('codex exited 1: warning');error.stdout=JSON.stringify({type:'turn.failed',error:{message:'context_length_exceeded'}});
  assert.equal(recoveryReason(error),'context-limit');
  for(const text of ['rate limit exceeded','401 invalid token','ETIMEDOUT','stream disconnected','usage limit reached'])assert.equal(recoveryReason(new Error(text)),null);
});
test('batch offset preserves full messages and all report positions',()=>{
  const messages=[{id:'one',role:'user',content:'x'.repeat(15000)},{id:'two',role:'assistant',kind:'report',content:'report'},{id:'three',role:'tool',content:'large tool'}];
  const first=pendingBatch(messages,null),second=pendingBatch(messages,first.cursor);
  assert.equal(first.entries[0].content.length,12000);assert.equal(first.cursor.offset,12000);assert.equal(first.more,true);
  assert.equal(second.entries[0].content.length,3000);assert.equal(second.entries[1].content,'report');assert.equal(second.cursor.id,'three');assert.equal(second.more,false);
});
