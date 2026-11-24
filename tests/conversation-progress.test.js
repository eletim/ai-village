// Native-to-presentation acceptance: raw text stays intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runtimeScript,correlate} from '../server/runtime-events.mjs';
import {Conversations} from '../server/conversations.mjs';
import {conversationFixture} from './helpers/conversation-answer-fixture.mjs';
import {responseHTML} from '../src/response-content.js';
import {humanProjection} from '../server/report-view.mjs';
import {workspaceSnapshot,historyPage} from '../server/conversation-pages.mjs';
test('native commentary stays in raw history, not humanAnswer or notification; UI folds progress',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'conversation-progress-native-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'sessions'));
 const sid='11111111-2222-3333-4444-555555555555',progress='確認しています。',final='確認した成果を説明します。';
 const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'t'}},{type:'event_msg',payload:{type:'user_message',turn_id:'t',message:'ai-village-run-repro'}},...['commentary','final'].map((phase,i)=>({type:'response_item',payload:{role:'assistant',phase,content:[{type:'output_text',text:i?final:progress}]}})),{type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:final}}];
 await writeFile(join(dir,'sessions',sid+'.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const native=JSON.parse(execFileSync('python3',['-c',runtimeScript,'codex',sid],{env:{...process.env,CODEX_HOME:dir}}));
 const observed=correlate({id:'repro',inputMarker:'ai-village-run-repro',baselineRuntime:{sessionId:sid,cursor:0},runModel:{facts:[{type:'transport-ack',at:0}]}},native);
 assert.equal(observed.output,progress+'\n\n'+final);assert.equal(observed.finalOutput,final);assert(native.turns[0].messages.every(m=>m.phase===undefined));
 const data=conversationFixture(),r=data.runs[103];data.runs=[r];Object.assign(r,{output:observed.output,finalOutput:observed.finalOutput,notificationPolicy:'conversation'});
 const sent=[];const service=new Conversations({data,flow:{requests:[]},locked:async(_key,f)=>f(),persist:async f=>f(),save:async()=>{},notifier:{enqueue:async m=>{sent.push(m);return {status:'sent'};}}});
 assert.equal(service.get('c',r.id).runs[0].humanAnswer,final);await service.notifications();assert.equal(sent.length,1);assert(!sent[0].content.includes(progress));assert(sent[0].content.includes(final));
 const view=humanProjection(data),entry=workspaceSnapshot(view).conversations.s.entries[0];assert(entry.conversationAnswer);assert.equal(historyPage(view,'s').entries[0].output,observed.output);
 const html=responseHTML(entry);assert(html.includes('response-progress'));assert(html.includes('<details'));assert.equal((html.match(/確認した成果を説明します。/g)||[]).length,1);
 t.diagnostic(JSON.stringify({nativeOutput:observed.output,finalOutput:observed.finalOutput,humanAnswer:service.get('c',r.id).runs[0].humanAnswer,notification:sent[0].content,progressInitiallyExpanded:!html.includes('<details')},null,2));
});
test('unspecified normal boundary does not identify dispatch update versus human question',()=>{
 const data=conversationFixture();for(const text of ['依頼しました。','どちらを優先しますか？','設定についての説明です。']){const r={...data.runs[103],output:text,finalOutput:text};assert(humanProjection({...data,runs:[r]}).runs[0].conversationAnswer);}
});
