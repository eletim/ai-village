import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VillageNotifier} from '../server/notifier.mjs';
async function setup(mode='ok'){
 const dir=await mkdtemp(join(tmpdir(),'village-notify-')),exe=join(dir,'notify');
 await writeFile(exe,`#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
appendFileSync(process.env.CAPTURE,JSON.stringify(process.argv.slice(2))+'\\n');
${mode==='hang'?'setInterval(()=>{},1000)':mode==='fail'?"console.error(process.env.NOTIFY_TOKEN);process.exit(7)":'process.exit(0)'}
`,{mode:0o700});
 const environment={...process.env,VILLAGE_NOTIFY_BIN:exe,VILLAGE_OFFICE_URL:'http://village.test:5173/agents',VILLAGE_NOTIFY_TIMEOUT_MS:'150',NOTIFY_TOKEN:'test-secret-do-not-log',CAPTURE:join(dir,'calls.jsonl')};
 const notifier=new VillageNotifier({dir,environment});await notifier.init();return {dir,environment,notifier};
}
const message={id:'request:q',role:'assistant',kind:'request',content:'成果の報告'};
test('notification delivery deduplicates before side effects and across restart',async t=>{
 const {dir,environment,notifier}=await setup();t.after(()=>rm(dir,{recursive:true,force:true}));
 await notifier.enqueue(message);await notifier.enqueue(message);
 const restored=new VillageNotifier({dir,environment});await restored.init();await restored.enqueue(message);
 assert.equal((await readFile(join(dir,'calls.jsonl'),'utf8')).trim().split('\n').length,1);
});
test('failed and slow notification transports preserve sanitized diagnostics',async t=>{
 for(const mode of ['fail','hang']){const {dir,notifier}=await setup(mode);t.after(()=>rm(dir,{recursive:true,force:true}));await notifier.enqueue(message);await notifier.flush();assert.equal(notifier.status().latest.delivered,false);assert.doesNotMatch(await readFile(join(dir,'notifications.jsonl'),'utf8'),/test-secret-do-not-log/);}
});
test('unreadable deduplication journal prevents delivery',async t=>{
 const {dir,environment}=await setup();t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'notifications.jsonl'));
 const notifier=new VillageNotifier({dir,environment});await notifier.init();assert.equal(notifier.status().journalAvailable,false);assert.equal((await notifier.enqueue(message)).delivered,false);
});
test('image-only result keeps image bytes out of notifications',async t=>{
 const {dir,notifier}=await setup();t.after(()=>rm(dir,{recursive:true,force:true}));const calls=[];notifier.send=async(title,content)=>{calls.push(content);return {delivered:true,status:'sent'};};
 await notifier.enqueue({...message,content:'',attachments:[{id:'saved-image'}]});assert.match(calls[0],/画像が1枚/);assert.doesNotMatch(calls[0],/saved-image/);
});
test('direct response notification accepts agents page and uses an agent title',async()=>{
  const {dir,environment}=await setup();
  const notifier=new VillageNotifier({dir,environment:{...environment,VILLAGE_OFFICE_URL:'http://127.0.0.1:5173/agents'}});await notifier.init();
  const calls=[];notifier.send=async(title,content)=>{calls.push({title,content});return {status:'sent',delivered:true};};
  await notifier.enqueue({id:'direct:run',role:'assistant',kind:'direct',content:'Agent response'});
  await notifier.enqueue({id:'direct:run',role:'assistant',kind:'direct',content:'Agent response'});
  assert.equal(calls.length,1);assert.match(calls[0].title,/Agentの応答完了/);assert.equal(notifier.status().destinationConfigured,true);
});

test('direct notification has a VPN Agent deep link and restart never replays it',async()=>{
 const {dir,environment}=await setup();const settings={...environment,VILLAGE_OFFICE_URL:'http://100.87.176.23:5173/office'};
 const notifier=new VillageNotifier({dir,environment:settings});await notifier.init();const calls=[];
 notifier.send=async(title,content,click)=>{calls.push({title,click});return {status:'sent',delivered:true};};
 const agentId='bdeab87b-6247-4355-9b5c-3a17c1a3c955';
 const message={id:'direct:deep',role:'assistant',kind:'direct',agentId,content:'response'};
 const result=await notifier.enqueue(message);
 assert.equal(result.clickUrl,`http://100.87.176.23:5173/agents#agent-${agentId}`);assert.equal(calls[0].click,result.clickUrl);
 const restarted=new VillageNotifier({dir,environment:settings});await restarted.init();restarted.send=async()=>{throw Error('must not replay');};
 assert.equal((await restarted.enqueue(message)).status,'duplicate_or_internal');
});

test('configuration errors are recorded without exposing CLI output',async()=>{
 const {dir,environment}=await setup();const exe=join(dir,'no-token');
 await writeFile(exe,'#!/bin/sh\necho private-cli-diagnostic >&2\nexit 2\n',{mode:0o700});
 const notifier=new VillageNotifier({dir,environment:{...environment,VILLAGE_NOTIFY_BIN:exe}});await notifier.init();
 const result=await notifier.test();assert.equal(result.status,'cli_failed');assert.equal(result.reason,'cli_configuration_error');assert.equal(result.delivered,false);
 assert.doesNotMatch(await readFile(join(dir,'notifications.jsonl'),'utf8'),/private-cli-diagnostic/);
});
