import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isAlwaysVisible,rootRunIds,foldEntriesHTML} from '../src/run-groups.js';
const render=r=>`<span data-id="${r.id}"></span>`;
test('only human-origin, external/native and unclassified-origin entries are never folded on their own',()=>{
 assert.equal(isAlwaysVisible({origin:'human'}),true);
 assert.equal(isAlwaysVisible({external:true}),true);
 assert.equal(isAlwaysVisible({origin:undefined}),true);
 assert.equal(isAlwaysVisible({}),true);
 assert.equal(isAlwaysVisible({origin:'steering'}),false);
 assert.equal(isAlwaysVisible({origin:'delegation'}),false);
 assert.equal(isAlwaysVisible({origin:'retry'}),false);
 assert.equal(isAlwaysVisible({origin:'continuation'}),false);
 assert.equal(isAlwaysVisible({origin:'report'}),false);
 assert.equal(isAlwaysVisible({origin:'result'}),false);
});
test('a run that is the live head of its own request\'s root work is visible even with a non-human origin',()=>{
 const current=rootRunIds([{works:[{id:'w',parentWorkId:null,currentRunId:'retry-run'}]}]);
 assert.equal(isAlwaysVisible({id:'retry-run',origin:'retry'},current),true);
 assert.equal(isAlwaysVisible({id:'other-run',origin:'retry'},current),false);
});
test('rootRunIds never includes a delegated child work\'s current run, even though it is current for that work',()=>{
 const current=rootRunIds([{works:[{id:'root',parentWorkId:null,currentRunId:'r1'},{id:'child',parentWorkId:'root',currentRunId:'d1'}]}]);
 assert.equal(current.has('r1'),true);assert.equal(current.has('d1'),false);
});
test('a lone human entry renders ungrouped; a run of non-human entries folds into one collapsed details',()=>{
 const html=foldEntriesHTML([{id:'h1',origin:'human'}],render);
 assert.equal(html,'<span data-id="h1"></span>');
 const folded=foldEntriesHTML([{id:'s1',origin:'steering'},{id:'d1',origin:'delegation'}],render);
 assert.match(folded,/^<details class="run-group" data-disclosure="group:s1">/);
 assert(!folded.includes(' open'));
 assert.match(folded,/<summary>.*2件.*<\/summary>/);
 assert.match(folded,/<span data-id="s1">/);assert.match(folded,/<span data-id="d1">/);
});
test('human and non-human entries alternate without merging across a human boundary',()=>{
 const entries=[{id:'h1',origin:'human'},{id:'s1',origin:'steering'},{id:'h2',origin:'human'},{id:'r1',origin:'retry'},{id:'r2',origin:'continuation'}];
 const html=foldEntriesHTML(entries,render);
 const order=[...html.matchAll(/data-id="([^"]+)"|data-disclosure="group:([^"]+)"/g)].map(m=>m[1]||'group:'+m[2]);
 assert.deepEqual(order,['h1','group:s1','s1','h2','group:r1','r1','r2']);
});
test('a native/PurpleMux external turn stays ungrouped between folded village-internal entries',()=>{
 const entries=[{id:'s1',origin:'steering'},{id:'n1',external:true},{id:'d1',origin:'delegation'}];
 const html=foldEntriesHTML(entries,render);
 const order=[...html.matchAll(/data-id="([^"]+)"|data-disclosure="group:([^"]+)"/g)].map(m=>m[1]||'group:'+m[2]);
 assert.deepEqual(order,['group:s1','s1','n1','group:d1','d1']);
});
test('a retried answer on a non-human-origin run that is still the root work\'s current run stays unfolded',()=>{
 const current=rootRunIds([{works:[{id:'w',parentWorkId:null,currentRunId:'retry-run'}]}]);
 const entries=[{id:'h1',origin:'human',state:'failed'},{id:'retry-run',origin:'retry',state:'completed',finalOutput:'answer'}];
 const html=foldEntriesHTML(entries,render,current);
 assert(!html.includes('<details'));
 const order=[...html.matchAll(/data-id="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(order,['h1','retry-run']);
});
test('a dangerous entry id cannot break out of the data-disclosure attribute',()=>{
 const html=foldEntriesHTML([{id:'"><script>alert(1)</script>',origin:'steering'},{id:'r2',origin:'result'}],()=>'');
 assert(!html.includes('<script>'));
 assert.match(html,/data-disclosure="group:&quot;&gt;&lt;script&gt;/);
 assert.match(html,/補足・子作業結果/);
});
