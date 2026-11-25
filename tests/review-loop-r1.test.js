// Regression fixtures for the 2026-11-25 improvement loop, round 1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './inbox-fixture.js';
import {appendAudit,compressArchives,maintainAudit} from '../server/audit-log.mjs';
import {conversationTurnHTML,notificationNoteHTML} from '../src/conversation-status.js';

test('deleting a Project leader is refused until the leader role is released',async t=>{
 const f=await fixture(t),d=f.service,p=await d.putProject({requestId:randomUUID(),name:'Leader deletion'});
 for(const a of f.agents)a.projectId=p.id;
 await d.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);const leader=f.agents[2];
 await assert.rejects(d.deleteAgent(leader.id,{operationId:'delete-leader-1',revision:leader.metadataRevision||0}),/リーダーを解除/);
 assert.equal(leader.deletion,undefined);assert.equal(d.data.projects.find(x=>x.id===p.id).leaderAgentId,leader.id);
 await d.putProject({revision:d.data.projects.find(x=>x.id===p.id).revision,leaderAgentId:null},p.id);
 const r=await d.deleteAgent(leader.id,{operationId:'delete-leader-2',revision:leader.metadataRevision||0});
 assert(['deleted','partial'].includes(r.status));
 for(const x of d.data.projects.filter(x=>x.leaderAgentId))assert.notEqual(x.leaderAgentId,leader.id);
});

test('a failed or unconfirmed answer notification is shown quietly, never as a resend offer',()=>{
 const answered={conversationLifecycle:{code:'answered'}};
 assert.match(conversationTurnHTML({...answered,notification:{status:'cli_failed',exitCode:22,reason:'http_error'}}),/通知を送れませんでした（自動再送しません）/);
 assert.match(conversationTurnHTML({...answered,notification:{status:'delivery_unknown'}}),/送信結果を確認できません/);
 for(const status of ['sent','disabled','pending','attempting',undefined])assert.equal(notificationNoteHTML({notification:status&&{status}}),'');
 assert.equal(conversationTurnHTML(answered),'');
 assert.doesNotMatch(conversationTurnHTML({...answered,notification:{status:'cli_failed'}}),/<button|再送する/);
});

test('audit journal rotates at the size limit, keeps every line, and compresses archives',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'audit-rotate-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const old=Array.from({length:50},(_,i)=>JSON.stringify({at:'old',i})+'\n').join('');await writeFile(join(dir,'local-audit.jsonl'),old);
 await Promise.all(Array.from({length:20},(_,i)=>appendAudit(dir,'local-audit.jsonl',{at:'new',i},{maxBytes:1024})));
 await compressArchives(dir,'local-audit.jsonl');
 const files=await readdir(dir),archives=files.filter(f=>f.endsWith('.jsonl.gz'));
 assert(archives.length>=1);assert.equal(files.filter(f=>/local-audit-.*\.jsonl$/.test(f)).length,0);
 const gunzip=async f=>{const chunks=[];for await(const c of createReadStream(join(dir,f)).pipe(createGunzip()))chunks.push(c);return Buffer.concat(chunks).toString();};
 const text=(await Promise.all(archives.sort().map(gunzip))).join('')+await readFile(join(dir,'local-audit.jsonl'),'utf8');
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(rows.filter(r=>r.at==='old').length,50);assert.deepEqual(rows.filter(r=>r.at==='new').map(r=>r.i),Array.from({length:20},(_,i)=>i));
 assert((await readFile(join(dir,'local-audit.jsonl'))).length<=1024);
});

test('a secretary owning several conversations (after handover) continues the newest one, not the last stored',async t=>{
 const f=await fixture(t),d=f.service,p=await d.putProject({requestId:randomUUID(),name:'Newest conversation'});
 for(const a of f.agents)a.projectId=p.id;
 const first=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'最初'});await f.submit(first);await f.complete(first);
 // An older conversation handed over later is stored after the current one.
 d.data.conversations.push({id:randomUUID(),agentId:f.agents[0].id,projectId:p.id,createdAt:'2026-01-01T00:00:00.000Z',sequence:0,operations:[],deliveries:[]});await d.save();
 const next=await d.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'次'});
 assert.equal(next.conversationId,first.conversationId);
});

test('startup maintenance moves aside an oversized journal and finishes an interrupted compression',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'audit-maintain-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'ssh-audit.jsonl'),Array.from({length:100},(_,i)=>JSON.stringify({i})+'\n').join(''));
 await writeFile(join(dir,'ssh-audit-2026-01-01T00-00-00-000Z.jsonl'),JSON.stringify({left:'uncompressed'})+'\n');
 await writeFile(join(dir,'ssh-audit-2026-01-01T00-00-00-000Z.jsonl.gz.tmp'),'partial');
 await maintainAudit(dir,'ssh-audit.jsonl',{maxBytes:512});
 const files=(await readdir(dir)).sort();
 assert.equal(files.filter(f=>f.endsWith('.tmp')||/ssh-audit-.*\.jsonl$/.test(f)).length,0);assert.equal(files.filter(f=>f.endsWith('.jsonl.gz')).length,2);
 assert(!files.includes('ssh-audit.jsonl'));
 const gunzip=async f=>{const chunks=[];for await(const c of createReadStream(join(dir,f)).pipe(createGunzip()))chunks.push(c);return Buffer.concat(chunks).toString();};
 const all=(await Promise.all(files.filter(f=>f.endsWith('.gz')).map(gunzip))).join('');
 assert.equal(all.trim().split('\n').length,101);
});

test('handover is not refused by a deleted Project that still names the secretary as leader',async t=>{
 const {secretaryHandoverPlan}=await import('../server/secretary-handover.mjs');
 const f=await fixture(t),d=f.service,[old,target]=f.agents;
 const p=await d.putProject({requestId:randomUUID(),name:'handover-deleted'});for(const a of f.agents)a.projectId=p.id;
 d.data.projects.push({id:randomUUID(),name:'deleted',revision:1,leaderAgentId:old.id,deletedAt:'2026-01-01T00:00:00.000Z'});
 assert.doesNotThrow(()=>secretaryHandoverPlan(d,old.id,target.id));
 d.data.projects.at(-1).deletedAt=undefined;assert.throws(()=>secretaryHandoverPlan(d,old.id,target.id),/引継ぎ先を利用できません/);
});
