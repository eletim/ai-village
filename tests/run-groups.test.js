import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isAlwaysVisible,rootRunIds,foldEntriesHTML,exchangeLabel} from '../src/run-groups.js';
const render=r=>`<span data-id="${r.id}"></span>`;
test('human inputs and published reports remain visible; even current root internal exchanges fold',()=>{
 for(const r of [{origin:'human'},{external:true},{},{inputReceipt:true}])assert(isAlwaysVisible(r));
 const ids=rootRunIds([{status:'active',requestGraph:{nodes:[{currentRunId:'result'}]}},{status:'completed',finalRunId:'report'}]);
 for(const origin of ['steering','delegation','retry','continuation','report','result','agent','inbox'])assert(!isAlwaysVisible({id:'result',origin},ids));
 assert(isAlwaysVisible({id:'report',origin:'report'},ids));
});
test('consecutive internal chats each have their own disclosure, preserving order and identity',()=>{
 const entries=[{id:'h',origin:'human'},{id:'d',origin:'delegation'},{id:'r',origin:'result'},{id:'h2',origin:'human'}];
 const html=foldEntriesHTML(entries,render);
 assert.equal((html.match(/<details/g)||[]).length,2);
 assert.match(html,/chat:d/);assert.match(html,/chat:r/);assert(!html.includes(' open'));
 assert.deepEqual([...html.matchAll(/data-id="([^"]+)"/g)].map(m=>m[1]),['h','d','r','h2']);
 assert.equal((html.match(/…（途中経過）/g)||[]).length,2);
});
test('routing is based on work ownership, and names and IDs are escaped',()=>{
 const state={agents:[{id:'s',name:'秘書<script>'},{id:'w',name:'工房'}],requests:[{id:'q',requestGraph:{nodes:[{id:'p',assignee:'s'},{id:'c',parentId:'p',assignee:'w'}]}}]};
 const entry={id:'"<script>',agentId:'w',humanRequestId:'q',workId:'c',origin:'delegation'};
 assert.equal(exchangeLabel(entry,state),'秘書<script> → 工房・作業依頼');
 const html=foldEntriesHTML([entry],()=>'',new Set(),r=>exchangeLabel(r,state));
 assert(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
 assert.match(exchangeLabel({...entry,origin:'result',agentId:'s',workId:'p'},state),/子作業の担当Agent → 秘書/);
});
