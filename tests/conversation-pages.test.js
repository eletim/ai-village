import {fixtureModels} from './model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceSnapshot,historyPage} from '../server/conversation-pages.mjs';
import {matchingRun} from '../src/pending-message.js';
import {rootRunIds,foldEntriesHTML} from '../src/run-groups.js';
import {humanProjection} from '../server/report-view.mjs';
export function fixture(n=230){return {agents:[{id:'a',state:'idle',name:'Fixture',location:'mayor',connection:{},nativeTurns:[]}],workshops:[],projects:[],reviews:{a:{unreviewed:true,attention:true}},notification:{enabled:false},requests:[],runs:Array.from({length:n},(_,i)=>({id:'r'+i,agentId:'a',createdAt:new Date(1700000000000+i*1000).toISOString(),state:'completed',instruction:'question '+i,output:'answer '+i+' '+ 'word '.repeat(400),finalOutput:'final '+i}))};}
test('100 boundary, agent-bound stable cursors, no native duplicate, repeated legitimate text preserved',()=>{
 const v=fixture();v.agents.push({id:'b',nativeTurns:[]});v.runs[229].turnId='native';v.runs[229].sessionId='s';v.agents[0].nativeTurns=[{id:'native',sessionId:'s',state:'completed',output:'duplicate'}];
 const s=workspaceSnapshot(v),p=s.conversations.a;assert.equal(p.entries.length,100);assert.equal(p.entries[0].id,'r130');assert(p.hasMore);assert.equal(p.entries.filter(r=>r.external).length,0);
 const older=historyPage(v,'a',p.cursor);assert.equal(older.entries.length,100);assert.equal(older.entries[0].id,'r30');assert.equal(older.entries.at(-1).id,'r129');
 v.runs.push({...v.runs.at(-1),id:'new',createdAt:'2030-01-01',turnId:'new-native'});
 const next=workspaceSnapshot(v,{a:older.cursor});assert.equal(next.conversations.a.entries.length,201);assert.equal(new Set(next.conversations.a.entries.map(r=>r.id)).size,201);
 assert.throws(()=>historyPage(v,'b',p.cursor),{status:400});assert.throws(()=>historyPage(v,'a','bad'),{status:400});assert.throws(()=>historyPage(v,'missing'),{status:404});
 assert.equal(historyPage(v,'a',older.cursor).entries.length,30);assert.equal(workspaceSnapshot(fixture(100)).conversations.a.hasMore,false);assert.equal(workspaceSnapshot(fixture(101)).conversations.a.hasMore,true);
});
test('active old inputs stay controllable; full request records excluded and source untouched',()=>{
 const v=fixture();v.runs[0].state='queued';v.runs[0].humanRequestId='q';v.runs[0].baselineRuntime={secret:'not a display field'};v.requests=[{id:'q',status:'active',instruction:'SECRET',inbox:[{text:'SECRET'}],works:[{id:'w',currentRunId:'r0',instruction:'SECRET'}]}];
 const s=workspaceSnapshot(v);assert.equal(s.conversations.a.entries.length,101);assert(s.runs.some(r=>r.id==='r0'));assert(!JSON.stringify(s).includes('SECRET'));assert(!JSON.stringify(s).includes('not a display field'));assert.equal(v.requests[0].instruction,'SECRET');assert.deepEqual(s.reviews,v.reviews);
});
test('projection applied before paging: report instructions hidden, completed work collapsed, updates retained',()=>{
 const v=fixture(2);v.runs[0].humanRequestId='q';Object.assign(v.runs[1],{humanRequestId:'q',phase:'report',origin:'report',instruction:'PRIVATE REPORT',output:'PRIVATE DRAFT',workId:'w'});v.requests=[{id:'q',reportMode:true,status:'active',works:[{id:'w',currentRunId:'r1'}]}];
 let s=workspaceSnapshot(humanProjection(fixtureModels(v,{refresh:true})));assert(!JSON.stringify(s).includes('PRIVATE'));const cursor=s.conversations.a.cursor;
 v.requests[0].status='completed';v.requests[0].finalRunId='r1';v.runs[1].finalOutput='public final';s=workspaceSnapshot(humanProjection(fixtureModels(v,{refresh:true})),{a:cursor});assert(s.conversations.a.entries[0].collapsedHistory);assert.equal(s.conversations.a.entries[1].output,'public final');assert(!JSON.stringify(s).includes('PRIVATE REPORT'));
});
test('cursor unaffected by managed run acceptance and external sessions remain distinct',()=>{
 const v=fixture(1);const p=historyPage(v,'a');v.runs[0].sessionId='new';assert.equal(workspaceSnapshot(v,{a:p.cursor}).conversations.a.entries.length,1);
 v.agents[0].nativeTurns=[{id:'same',sessionId:'x',startedAt:'2020',output:'same text'},{id:'same',sessionId:'y',startedAt:'2020',output:'same text'}];assert.equal(historyPage(v,'a').entries.length,3);
});
test('focus narrows bodies to the requested agents; everyone else keeps only a bodiless latest control',()=>{
 const v=fixture(3);v.agents.push({id:'b',state:'idle',name:'Other',location:'mayor',connection:{},nativeTurns:[]});
 v.runs.push(...Array.from({length:5},(_,i)=>({id:'b'+i,agentId:'b',createdAt:new Date(1800000000000+i*1000).toISOString(),state:'completed',instruction:'b question '+i,output:'b answer '+i,humanRequestId:'qb'})));
 v.requests=[{id:'qb',status:'active',works:[{id:'wb',currentRunId:'b4'}]}];
 const s=workspaceSnapshot(v,{},['a']);
 assert(s.conversations.a);assert.equal(s.conversations.a.entries.length,3);assert.equal(s.conversations.a.entries[0].output,v.runs[0].output);
 assert.equal(s.conversations.b,undefined);
 const bControl=s.runs.find(r=>r.id==='b4');assert(bControl);assert.equal(bControl.output,undefined);assert.equal(bControl.instruction,undefined);
 assert.equal(s.runs.some(r=>r.id==='b0'),false);
 assert.equal(s.requests.length,1);assert.equal(s.requests[0].id,'qb');
 assert(!JSON.stringify(s).includes('b question'));assert(!JSON.stringify(s).includes('b answer'));
});
test('empty focus (initial summary) sends no conversation bodies for anyone',()=>{
 const v=fixture(3);v.agents.push({id:'b',state:'idle',name:'Other',location:'mayor',connection:{},nativeTurns:[]});
 const s=workspaceSnapshot(v,{},[]);
 assert.deepEqual(s.conversations,{});
 assert.equal(s.runs.length,1);assert.equal(s.runs[0].id,'r2');assert.equal(s.runs[0].output,undefined);
 assert(!JSON.stringify(s).includes('answer'));
});
test('omitted focus keeps legacy full-snapshot behaviour',()=>{
 const v=fixture(3);v.agents.push({id:'b',state:'idle',name:'Other',location:'mayor',connection:{},nativeTurns:[]});
 const s=workspaceSnapshot(v);assert(s.conversations.a);assert.equal(s.conversations.a.entries.length,3);
 // 'b' still gets a (empty) conversation entry without focus-narrowing, unlike the focus=['a'] case above.
 assert.deepEqual(s.conversations.b,{entries:[],hasMore:false,cursor:null});
});
test('invalid focus is rejected',()=>{
 const v=fixture(1);
 assert.throws(()=>workspaceSnapshot(v,{},'a'),{status:400});
 assert.throws(()=>workspaceSnapshot(v,{},[1]),{status:400});
 assert.throws(()=>workspaceSnapshot(v,{},['x'.repeat(201)]),{status:400});
});
test('supplements obey history window while compact receipts survive and older pages retain attachments',()=>{
 const v=fixture(0);const inbox=Array.from({length:150},(_,i)=>({id:'i'+i,operationId:'op'+i,kind:'supplement',text:'BODY'+i,createdAt:new Date(1700000000000+i*1000).toISOString(),handledBy:'done',attachments:[{id:'file',name:'file'+i}]}));
 v.requests=[{id:'q',status:'active',requestGraph:{nodes:[{id:'w',assignee:'a',inbox}]}}];
 const s=workspaceSnapshot(v,{},['a']);assert.equal(s.conversations.a.entries.length,100);assert(s.conversations.a.hasMore);assert(!JSON.stringify(s).includes('"BODY0"'));
 assert.deepEqual(s.requests[0].requestGraph.nodes[0].inbox[0],{id:'i0',operationId:'op0'});
 assert.equal(matchingRun(s,'a','op0').id,'i0');
 const p=historyPage(v,'a',s.conversations.a.cursor);assert.equal(p.entries.length,50);assert.equal(p.entries[0].instruction,'BODY0');assert.equal(p.entries[0].attachments[0].name,'file0');
 const expanded=workspaceSnapshot(v,{a:p.cursor},['a']);assert.equal(expanded.conversations.a.entries.length,150);assert.equal(new Set(expanded.conversations.a.entries.map(x=>x.id)).size,150);
});

test('published report stays visible through compact paging when source work remains current',()=>{
 const v=fixture(2);Object.assign(v.runs[0],{humanRequestId:'q',origin:'human'});Object.assign(v.runs[1],{humanRequestId:'q',origin:'report',phase:'report',suppressUser:true});
 v.requests=[{id:'q',status:'completed',finalRunId:'r1',requestGraph:{rootId:'w',nodes:[{id:'w',parentId:null,assignee:'a',currentRunId:'r0'}]}}];
 const snapshot=workspaceSnapshot(v),current=rootRunIds(snapshot.requests);
 assert(current.has('r0'));assert(current.has('r1'));
 assert(!foldEntriesHTML(snapshot.conversations.a.entries,r=>r.id,current).includes('run-group'));
 v.requests[0].status='active';assert(!rootRunIds(workspaceSnapshot(v).requests).has('r1'));
});
