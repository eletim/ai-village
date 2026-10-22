import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VillageNotifier } from '../server/notifier.mjs';
import { Secretariat } from '../server/secretariat.mjs';
import { VillageLibrary } from '../server/library.mjs';
async function setup(mode='ok') {
  const dir=await mkdtemp(join(tmpdir(),'village-notify-')),exe=join(dir,'notify');
  await writeFile(exe,`#!/usr/bin/env node\nimport {appendFileSync,readFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\n// Validate that the associated assistant message is already durably saved.\nconst saved=JSON.parse(readFileSync(process.env.SAVED_CONVERSATION,'utf8'));\nconst body=args[args.indexOf('--message')+1];\nif(!saved.messages.some(m=>m.role==='assistant'&&m.content.startsWith(body.replace(/…$/,''))))process.exit(9);\nappendFileSync(process.env.CAPTURE,JSON.stringify({args,config:process.env.NOTIFY_CONFIG,tokenInherited:!!process.env.NOTIFY_TOKEN})+'\\n');\n${mode==='hang'?"setInterval(()=>{},1000);":mode==='fail'?"console.error(process.env.NOTIFY_TOKEN);process.exit(7);":'process.exit(0);'}\n`,{mode:0o700});
  const environment={...process.env,VILLAGE_NOTIFY_BIN:exe,VILLAGE_OFFICE_URL:'http://village.test:5173/office',VILLAGE_NOTIFY_TIMEOUT_MS:'150',NOTIFY_CONFIG:'/private/notify/config',NOTIFY_TOKEN:'test-secret-do-not-log',CAPTURE:join(dir,'calls.jsonl'),SAVED_CONVERSATION:join(dir,'conversation.json')};
  const notifier=new VillageNotifier({dir,environment});await notifier.init();
  const bridge={dir,jobs:[],snapshot(){return {jobs:this.jobs};},async submit(request){this.job={id:'work-one',request};this.jobs.push(this.job);}};
  const root=join(dir,'library');await mkdir(root);await writeFile(join(root,'workshop.md'),'---\nname: 工房\nssh_host: host\npurplemux_url: http://workshop/\nwork_root: /work\n---\n# 工房');
  const secretary=new Secretariat(bridge,new VillageLibrary(root),null,notifier);await secretary.init();
  return {dir,notifier,secretary,bridge,environment,calls:async()=>{try{return (await readFile(join(dir,'calls.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}}};
}
const choice=(action,message='',document='',task='')=>({action,message,document,task});
async function turn(secretary,choices){secretary.decide=async()=>choices.shift();await secretary.send('村長の発言');await secretary.running;}
test('one notification per saved reply, dispatch, report and error; internal tools and duplicate reports are silent',async()=>{
  const {secretary,bridge,notifier,calls}=await setup();
  await turn(secretary,[choice('read_document','','workshop.md'),choice('read_state'),choice('reply','こんにちは')]);
  await turn(secretary,[choice('read_document','','workshop.md'),choice('dispatch','工房へ依頼しました','workshop.md','作って')]);
  const job={id:'report-one',report:'完成しました。成果は result.txt。'};bridge.jobs.push(job);await bridge.onReport(job);await bridge.onReport(job);
  secretary.decide=async()=>{throw new Error('Codex unavailable');};await secretary.send('質問');await secretary.running;await notifier.flush();
  const sent=await calls();assert.equal(sent.length,4);assert.equal(secretary.messages.filter(m=>m.role==='assistant').length,4);
  for(const call of sent){assert.equal(call.args[0],'send');assert.equal(call.args.at(-2),'--click');assert.equal(call.args.at(-1),'http://village.test:5173/office');assert.equal(call.config,'/private/notify/config');assert.equal(call.tokenInherited,true);}
  assert.ok(sent[2].args.includes('AI村 · 工房からの報告'));assert.ok(sent[3].args.includes('AI村 · ミクからのお知らせ'));
  const reportMessage=secretary.messages.find(m=>m.jobId==='report-one');await notifier.enqueue(reportMessage);assert.equal((await calls()).length,4);
});
test('restart/history catch-up never replays old notifications or reports',async()=>{
  const {secretary,bridge,notifier,environment,dir,calls}=await setup();await turn(secretary,[choice('reply','保存された回答')]);await notifier.flush();
  // A historical report missing from chat is restored silently, too.
  bridge.jobs.push({id:'old-report',report:'過去の報告'});
  const restoredNotifier=new VillageNotifier({dir,environment});await restoredNotifier.init();
  const restored=new Secretariat(bridge,secretary.library,null,restoredNotifier);await restored.init();await restoredNotifier.flush();
  assert.ok(restored.messages.some(m=>m.jobId==='old-report'));assert.equal((await calls()).length,1);
  await restoredNotifier.enqueue(secretary.messages.find(m=>m.role==='assistant'));assert.equal((await calls()).length,1);
});
test('notification failure is sanitized and cannot turn a saved answer or report into an error',async()=>{
  const {secretary,bridge,notifier,dir}=await setup('fail');await turn(secretary,[choice('reply','返答は保存')]);await bridge.onReport({id:'failed-notify-report',report:'報告も保存'});await notifier.flush();
  assert.equal(secretary.status,'idle');assert.equal(secretary.messages.filter(m=>m.kind==='error').length,0);
  const saved=await readFile(join(dir,'conversation.json'),'utf8');assert.match(saved,/報告も保存/);
  const journal=await readFile(join(dir,'notifications.jsonl'),'utf8');assert.match(journal,/cli_failed/);assert.doesNotMatch(journal,/test-secret-do-not-log/);
});
test('slow CLI runs outside conversation and is killed within its deadline',async()=>{
  const {secretary,notifier}=await setup('hang');await turn(secretary,[choice('reply','待たずに返答')]);
  assert.equal(secretary.status,'idle');assert.notEqual(notifier.status().latest?.status,'timed_out');await notifier.flush();assert.equal(notifier.status().latest.status,'timed_out');
});
test('missing destination, disabled notifications and missing executable do not break replies',async()=>{
  for(const overrides of [{VILLAGE_OFFICE_URL:''},{VILLAGE_OFFICE_URL:'javascript:alert(1)'},{VILLAGE_NOTIFICATIONS:'false'},{VILLAGE_NOTIFY_BIN:'/missing/notify'}]){
    const {secretary,environment,dir}=await setup();const notifier=new VillageNotifier({dir,environment:{...environment,...overrides}});await notifier.init();secretary.notifier=notifier;
    await turn(secretary,[choice('reply','質問できます')]);await notifier.flush();assert.equal(secretary.status,'idle');assert.equal(notifier.status().latest.delivered,false);
  }
});

test('unreadable deduplication journal disables delivery without losing conversation',async()=>{
  const {secretary,dir,environment,calls}=await setup();
  await mkdir(join(dir,'notifications.jsonl'));
  const notifier=new VillageNotifier({dir,environment});await notifier.init();secretary.notifier=notifier;
  await turn(secretary,[choice('reply','通知の監査ファイルが読めなくても返答は保存')]);await notifier.flush();
  assert.equal(secretary.status,'idle');assert.equal((await calls()).length,0);assert.equal(notifier.status().journalAvailable,false);
  assert.match(await readFile(join(dir,'conversation.json'),'utf8'),/返答は保存/);
});

test('image-only assistant replies have a readable notification without sending image bytes',async()=>{
  const {secretary,notifier}=await setup();const calls=[];notifier.send=async(title,content)=>{calls.push({title,content});return {delivered:true,status:'delivered'};};
  await secretary.publish('',{attachments:[{id:'saved-image'}]});await notifier.flush();assert.equal(calls.length,1);assert.match(calls[0].content,/画像が1枚/);assert.doesNotMatch(calls[0].content,/saved-image/);
});
