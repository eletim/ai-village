import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardLayout,orderedAgents,orderedProjects,PAGE_SIZE} from '../src/board-state.js';
import {completedEntries,unreadByAgent,agentEntries,completionKey,visualState,faviconHref} from '../src/completions.js';

test('desktop grids fit four as 2x2 and nine as 3x3, narrow layouts keep readable cards',()=>{
 for(const width of [800,1000,1400]){assert.equal(boardLayout(4,width,700).cols,2);assert.equal(boardLayout(4,width,700).rows,2);}
 assert.deepEqual(boardLayout(9,1100,700),{cols:3,rows:3,rowHeight:228});
 assert.equal(boardLayout(9,250,700).cols,1);assert.equal(boardLayout(9,250,700).rowHeight,220);
 assert.equal(PAGE_SIZE,9);
 const list=[{id:'a2',state:'idle',createdAt:'2026-01-02'},{id:'a1',state:'busy',createdAt:'2026-01-01'},{id:'gone',state:'terminated'}];
 assert.deepEqual(orderedAgents(list).map(a=>a.id),['a1','a2']);list[0].state='busy';list.reverse();assert.deepEqual(orderedAgents(list).map(a=>a.id),['a1','a2']);
});
test('completion identities deduplicate native/managed views and never confuse sessions or idle',()=>{
 const agent={id:'a',provider:'codex',observedSessionId:'s',state:'idle',nativeTurns:[{id:'t',state:'completed',output:'first'}]};
 const run={id:'r',agentId:'a',sessionId:'s',turnId:'t',state:'completed'};
 const state={agents:[agent],runs:[run]};assert.equal(completedEntries(state).length,1);
 const key=completionKey(agent,run);state.reviews={a:{unreviewed:false}};assert.equal(unreadByAgent(state).size,0);
 agent.nativeTurns.push({id:'t',sessionId:'s2',state:'completed'});state.reviews.a.unreviewed=true;assert.equal(unreadByAgent(state).get('a'),true);
 assert.equal(agentEntries(state,agent).length,2);
 state.agents.push({id:'idle',state:'idle'});assert.equal(unreadByAgent(state).has('idle'),false);
 assert.equal(completionKey(agent,{id:'fail',state:'failed'}),null);
 assert.equal(completionKey(agent,{id:'unknown',state:'unknown'}),null);
 assert.equal(visualState(agent),'completed');assert.equal(visualState({...agent,state:'busy'}),'busy');
 assert.notEqual(faviconHref(true),faviconHref(false));
});

test('completion green follows actual latest turn and survives review, never overriding active work',()=>{
 const a={id:'a',state:'idle'};assert.equal(visualState(a),'idle');
 const entries=[{state:'completed'}];assert.equal(visualState(a,entries),'completed');
 assert.equal(visualState(a,[...entries,{state:'interrupted'}]),'idle');
 assert.equal(visualState({...a,state:'busy'},entries),'busy');assert.equal(visualState({...a,state:'waiting_input'},entries),'waiting_input');
 const session={...a,observedSessionId:'new',nativeTurns:[{sessionId:'old',state:'completed'}]};assert.equal(visualState(session,entries),'idle');
 session.nativeTurns.push({sessionId:'new',state:'failed'});assert.equal(visualState(session,entries),'idle');
 session.nativeTurns.push({sessionId:'new',state:'completed'});assert.equal(visualState(session,entries),'completed');
});

test('general project precedes other projects without changing stored order or membership',()=>{
 const projects=[{id:'a',name:'村実装'},{id:'b',name:'全体'},{id:'c',name:'blokus'}];
 assert.deepEqual(orderedProjects(projects).map(p=>p.id),['b','a','c']);
 assert.deepEqual(projects.map(p=>p.id),['a','b','c']);
 assert.deepEqual(orderedProjects(projects.filter(p=>p.id!=='b')).map(p=>p.id),['a','c']);
});
