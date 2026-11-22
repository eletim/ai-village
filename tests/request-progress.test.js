import test from 'node:test';import assert from 'node:assert/strict';
import {requestProgress} from '../src/request-progress.js';import {reviewCycle} from './rework-fixture.mjs';import {historyPage,workspaceSnapshot} from '../server/conversation-pages.mjs';import {exchangeLabel} from '../src/run-groups.js';
test('two committed reworks link both directions; acceptance clears historical waiting without mutation',()=>{
 const {q,view}=reviewCycle(),before=JSON.stringify(view);
 assert.deepEqual(requestProgress(q,'second',view.agents),{label:'差し戻し・再依頼済み',waiting:'',replacementId:'third',replacesId:'first'});
 assert.equal(requestProgress(q,'first').replacementId,'second');assert.equal(requestProgress(q,'third').label,'承認済み');assert.equal(requestProgress(q,'cancel').label,'取り下げ');assert.equal(requestProgress(q,'plan').label,'取り下げ');assert.equal(JSON.stringify(view),before);
});
test('uncommitted reservation and prose cannot imply replacement; current reviewer/worker is explicit',()=>{
 const {q,view}=reviewCycle(),n=q.requestGraph.nodes[3];n.state={kind:'submitted'};q.requestGraph.nodes[0].handling.pop();assert.equal(requestProgress(q,n.id,view.agents).waiting,'確認担当の確認待ち');n.state={kind:'active',review:[]};assert.equal(requestProgress(q,n.id,view.agents).waiting,'実装担当の作業・対応待ち');const old=q.requestGraph.nodes[1];delete old.replacementId;old.replacements=[{replacementId:'second'}];old.state={kind:'submitted'};assert.equal(requestProgress(q,old.id).label,'差し戻し');assert.equal(requestProgress(q,old.id).replacementId,undefined);
});
test('history pages and focused snapshots retain minimal review display even without graph on client',()=>{
 const {view}=reviewCycle();const paged=historyPage(view,'worker'),snapshot=workspaceSnapshot(view,{},['worker']);
 for(const entries of [paged.entries,snapshot.conversations.worker.entries]){
  assert.equal(entries[0].requestProgress.label,'差し戻し・再依頼済み');assert.equal(entries[2].requestProgress.label,'承認済み');assert.match(exchangeLabel(entries[0],{agents:view.agents,requests:[]}),/差し戻し・再依頼済み/);assert(!exchangeLabel(entries[0],{agents:view.agents,requests:[]}).includes('確認待ち'));
 }
});
