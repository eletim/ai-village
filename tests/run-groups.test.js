import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isHumanInput,chatBodyHTML,exchangeLabel} from '../src/run-groups.js';
test('human input classification does not depend on current root run',()=>{
 for(const r of [{origin:'human'},{external:true},{},{inputReceipt:true}])assert(isHumanInput(r));
 for(const origin of ['steering','delegation','retry','continuation','report','result','agent','inbox'])assert(!isHumanInput({origin}));
});
test('input and response have independent disclosures, and only body is wrapped',()=>{
 const r={id:'r'};
 assert.equal(chatBodyHTML(r,'input','human text',false),'human text');
 const input=chatBodyHTML(r,'input','input text',true),output=chatBodyHTML(r,'output','answer',true);
 assert.match(input,/data-disclosure="chat:r:input"/);assert.match(output,/data-disclosure="chat:r:output"/);
 assert(!input.includes(' open'));assert(!input.includes('message'));
 assert.equal(chatBodyHTML(r,'output','',true),'');
});
test('routing uses ownership; disclosure IDs are escaped',()=>{
 const state={agents:[{id:'s',name:'秘書'},{id:'w',name:'工房'}],requests:[{id:'q',requestGraph:{nodes:[{id:'p',assignee:'s'},{id:'c',parentId:'p',assignee:'w'}]}}]};
 const entry={id:'"<script>',agentId:'w',humanRequestId:'q',workId:'c',origin:'delegation'};
 assert.equal(exchangeLabel(entry,state),'秘書 → 工房・作業依頼');
 const html=chatBodyHTML(entry,'input','safe',true);assert(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
});
