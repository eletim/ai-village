import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VillageLibrary } from '../server/library.mjs';
import { Secretariat } from '../server/secretariat.mjs';
const markdown=(host='host-one',description='調査済みの説明')=>`---\nname: 試験工房\nssh_host: ${host}\npurplemux_url: http://workshop.example:8022/\nwork_root: /work/village\n---\n# 試験工房\n${description}\n`;
async function setup(choices=[]) {
  const dir=await mkdtemp(join(tmpdir(),'village-chat-'));const root=join(dir,'library');await mkdir(root);await writeFile(join(root,'README.md'),'# 村の資料\n');await writeFile(join(root,'workshop.md'),markdown());
  const calls=[];const bridge={dir,jobs:[],job:null,snapshot(){return {job:this.job,jobs:this.jobs};},async submit(request,connection,instruction){calls.push({request,connection,instruction});this.job={id:'new-job',request,connection,phase:'working'};this.jobs.push(this.job);},async remote(){calls.push('ssh');throw new Error('SSH unavailable');}};
  const library=new VillageLibrary(root);const secretary=new Secretariat(bridge,library);
  secretary.decide=async()=>{const choice=choices.shift();if(!choice)throw new Error('missing choice');return choice;};await secretary.init();
  return {dir,root,library,bridge,secretary,calls};
}
const choice=(action,message='',document='',task='')=>({action,message,document,task});
async function send(secretary,message){await secretary.send(message);await secretary.running;}

test('local replies, fresh document reads and state inspection do not SSH or allocate a job',async()=>{
  const {secretary,calls}=await setup([choice('reply','こんにちは'),choice('read_document','','workshop.md'),choice('read_state'),choice('reply','資料に基づいて説明します')]);
  await send(secretary,'こんにちは');await send(secretary,'工房と仕事の状況を知りたい');assert.deepEqual(calls,[]);assert.equal(secretary.messages.filter(m=>m.role==='assistant').length,2);
});
test('conversation is restored with proposal context; agreed task uses the latest document connection',async()=>{
  const {secretary,bridge,library,root,calls}=await setup([choice('reply','小さな手紙を作りましょう')]);await send(secretary,'どんなものがよい？');
  await writeFile(join(root,'workshop.md'),markdown('host-updated','更新後の説明'));
  const restored=new Secretariat(bridge,library);await restored.init();assert.equal(restored.messages[1].content,'小さな手紙を作りましょう');
  const choices=[choice('read_document','','workshop.md'),choice('dispatch','合意した手紙を作ります','workshop.md','手紙を作って報告してください')];restored.decide=async()=>choices.shift();
  await send(restored,'それで進めて');assert.equal(calls.length,1);assert.equal(calls[0].connection.sshHost,'host-updated');assert.equal(calls[0].instruction,'手紙を作って報告してください');assert.ok(calls[0].connection.documentHash);
});
test('dispatch requires a document actually read this turn, and changed documents require a new read',async()=>{
  const {secretary,root,calls}=await setup();let step=0;
  secretary.decide=async()=>{
    step++;
    if(step===1)return choice('dispatch','開始','workshop.md','作る');
    if(step===2)return choice('read_document','','workshop.md');
    if(step===3){await writeFile(join(root,'workshop.md'),markdown('host-two'));return choice('dispatch','開始','workshop.md','作る');}
    return choice('reply','資料が更新されたので改めて確認します');
  };
  await send(secretary,'作って');assert.deepEqual(calls,[]);assert.equal(secretary.messages.filter(m=>m.role==='tool'&&m.content.includes('最新')).length,2);
});
test('SSH inspection failure is a tool result; conversation and documents remain available',async()=>{
  const {secretary,calls,bridge}=await setup([choice('read_document','','workshop.md'),choice('check_workshop','','workshop.md'),choice('reply','接続できず、現在値は未確認です'),choice('reply','こんにちは')]);
  await send(secretary,'現在の工房を確認して');assert.equal(calls.filter(c=>c==='ssh').length,2);assert.equal(bridge.jobs.length,0);assert.ok(secretary.messages.some(m=>m.role==='tool'&&m.content.includes('SSH unavailable')));await send(secretary,'こんにちは');assert.equal(secretary.messages.at(-1).content,'こんにちは');
});
test('a held job never blocks conversation; rejected dispatch does not repeat or create a report',async()=>{
  const {secretary,bridge}=await setup([choice('read_document','','workshop.md'),choice('dispatch','進める','workshop.md','作る'),choice('dispatch','再実行','workshop.md','作る'),choice('reply','前の報告の確認が必要です'),choice('reply','相談しましょう')]);let attempts=0;bridge.submit=async()=>{attempts++;throw new Error('確認待ち');};
  await send(secretary,'作って');await send(secretary,'相談したい');assert.equal(attempts,1);assert.equal(bridge.jobs.length,0);assert.equal(secretary.messages.at(-1).content,'相談しましょう');
});
test('report arrival is added once, persisted, and interrupted decisions are never redispatched',async()=>{
  const {secretary,bridge,library,dir}=await setup();const job={id:'delivered-job',report:'工房からの報告です'};bridge.jobs=[job];await secretary.receiveReport(job);await secretary.receiveReport(job);assert.equal(secretary.messages.length,1);
  secretary.status='thinking';await secretary.persist();const restored=new Secretariat(bridge,library);await restored.init();assert.equal(restored.status,'idle');assert.equal(restored.messages.filter(m=>m.kind==='report').length,1);assert.ok(restored.messages.some(m=>m.interrupted));
  assert.equal(JSON.parse(await readFile(join(dir,'conversation.json'),'utf8')).knownReports[0],job.id);
});
test('Markdown is the single source, re-read without caching, with path and symlink boundaries',async()=>{
  const {library,root,dir}=await setup();assert.equal((await library.workshop('workshop.md')).sshHost,'host-one');
  await writeFile(join(root,'workshop.md'),markdown('host-two','更新テスト'));assert.equal((await library.workshop('workshop.md')).sshHost,'host-two');assert.match((await library.read('workshop.md')).content,/更新テスト/);
  await writeFile(join(dir,'outside.md'),'secret');await symlink(join(dir,'outside.md'),join(root,'link.md'));await assert.rejects(library.read('link.md'),/範囲外/);await assert.rejects(library.read('../outside.md'),/範囲外/);await assert.rejects(library.read('not-json.json'),/Markdown/);
});
