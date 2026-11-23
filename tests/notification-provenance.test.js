import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentEntries} from '../src/completions.js';
import {isHumanInput} from '../src/run-groups.js';
import {workspaceSnapshot,historyPage} from '../server/conversation-pages.mjs';
import {humanProjection} from '../server/report-view.mjs';
import {supplementSource} from '../src/input-source.js';
import {fixture} from './notification-fixture.js';
import {fixtureModels} from './model-fixtures.mjs';
test('formal supplement provenance survives projection and paging after final report; native duplicate stays deduplicated',()=>{
 const s=fixture(),graph=structuredClone(s.requests[0].requestGraph);fixtureModels(s,{refresh:true});s.requests[0].requestGraph=graph;const before=JSON.stringify(s),view=humanProjection(s);
 const entries=agentEntries(view,view.agents[0]);assert.equal(entries.filter(e=>e.turnId==='turn'||e.id==='turn').length,1);
 const expected=['program','program','program','agent','human','unknown','human','agent'];
 for(const page of [workspaceSnapshot(view).conversations.a,historyPage(view,'a')]){
  const inputs=page.entries.filter(e=>e.inputReceipt);assert.deepEqual(inputs.map(e=>e.inputSource.actor),expected);assert.deepEqual(inputs.map(isHumanInput),[false,false,false,false,true,true,true,false]);
 }
 assert.equal(JSON.stringify(s),before);
});
test('unknown provenance is not guessed from wording or mismatched operation',()=>{
 const q=fixture().requests[0],n=q.requestGraph.nodes[0];
 assert.equal(supplementSource(q,n,{id:'x',kind:'supplement',text:'依頼の通知: deadline'}).actor,'unknown');
 assert.equal(supplementSource(q,n,{...n.inbox[6],text:'different'}).actor,'unknown');
 assert.equal(supplementSource(q,n,{...n.inbox[6],source:{actor:'program'}}).actor,'program');
});
test('older notification pages retain source and stable identity without expanding the snapshot window',()=>{
 const s=fixture(),n=s.requests[0].requestGraph.nodes[0];n.inbox=Array.from({length:130},(_,i)=>({...n.inbox[0],id:'p'+i,createdAt:new Date(1700000000000+i*1000).toISOString()}));
 const page=workspaceSnapshot(s).conversations.a,older=historyPage(s,'a',page.cursor);assert.equal(page.entries.length,100);assert.equal(older.entries.length,31);
 assert(older.entries.every(e=>e.inputSource.actor==='program'));assert.equal(new Set([...page.entries,...older.entries].map(e=>e.id)).size,131);
});
