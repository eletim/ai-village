import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSync} from '../server/workspace-sync.mjs';
import {packWorkspace,unpackWorkspace,acceptWorkspace,applyChanges} from '../src/workspace-sync.js';

function fixture(count=100){
 const entries=Array.from({length:count},(_,i)=>({id:'r'+i,agentId:'a',instruction:'依頼 '+i,output:('履歴 '+i+' 長い文章。').repeat(1000),state:'completed'}));
 return {version:1,agents:[{id:'a',lastCheckedAt:'first',state:'idle'}],runs:entries.map(({id,state})=>({id,state})),requests:[],projects:[],workshops:[],reviews:{a:{attention:false}},notification:{enabled:false},conversations:{a:{cursor:'first',hasMore:true,entries}}};
}
test('workspace sync reconstructs changed, removed, reordered and historical entries exactly',()=>{
 const server=new WorkspaceSync(),opts={client:'browser-one'},original=fixture();
 assert.deepEqual(unpackWorkspace(packWorkspace(original)),original);
 let received=acceptWorkspace(null,server.reply(opts,original));
 const next=structuredClone(original);next.conversations.a.entries.at(-1).output+='追記';next.agents[0].lastCheckedAt='next';next.runs[0].state='failed';next.reviews.a.attention=true;
 let response=server.reply({...opts,since:received.cursor},next);assert.equal(response.mode,'delta');assert(response.changes.some(c=>c.op==='append'));assert(JSON.stringify(response).length<1500);
 received=acceptWorkspace(received,response);assert.deepEqual(received.state,next);
 next.conversations.a.entries.unshift({id:'older',output:'過去',state:'completed'});next.conversations.a.cursor='older';next.conversations.a.entries.splice(4,1);next.runs.reverse();delete next.reviews.a;
 response=server.reply({...opts,since:received.cursor,scope:'older'},next);received=acceptWorkspace(received,response);assert.deepEqual(received.state,next);
 delete next.conversations.a;next.agents=[];next.runs=[];
 received=acceptWorkspace(received,server.reply({...opts,since:received.cursor},next));assert.deepEqual(received.state,next);
});
test('idle transfer is independent of retained conversation size; no bodies resent on metadata or append',t=>{
 const server=new WorkspaceSync({maxBytes:2*1024*1024}),opts={client:'browser-one'},state=fixture(1000);
 const full=server.reply(opts,state),idle=server.reply({...opts,since:full.cursor},state);
 assert.equal(idle.mode,'delta');assert.deepEqual(idle.changes,[]);assert(JSON.stringify(idle).length<200);
 state.agents[0].lastCheckedAt='new';state.conversations.a.entries.at(-1).output+='新規';
 const update=server.reply({...opts,since:idle.cursor},state);assert(JSON.stringify(update).length<1000);
 t.diagnostic('full='+Buffer.byteLength(JSON.stringify(full))+' idle='+Buffer.byteLength(JSON.stringify(idle))+' append='+Buffer.byteLength(JSON.stringify(update))+' bytes');
});
test('lost responses, restart, evictions and stale cursors recover with a full response',()=>{
 let now=0;const server=new WorkspaceSync({ttl:100,clock:()=>now,maxClients:1}),state=fixture(2),opts={client:'browser-one'};
 const first=server.reply(opts,state);server.reply({...opts,since:first.cursor},state); // response lost
 assert.equal(server.reply({...opts,since:first.cursor},state).mode,'full');
 const latest=server.reply(opts,state);server.reply({client:'browser-two'},state);
 assert.equal(server.reply({...opts,since:latest.cursor},state).mode,'full');
 const last=server.reply(opts,state);now=101;assert.equal(server.reply({...opts,since:last.cursor},state).mode,'full');
 assert.equal(new WorkspaceSync().reply({...opts,since:last.cursor},state).mode,'full');
 const small=new WorkspaceSync({maxBytes:1});const huge=small.reply(opts,state);assert.equal(small.clients.size,0);assert.equal(small.reply({...opts,since:huge.cursor},state).mode,'full');
});
test('bad bases and malformed append never partly update a browser snapshot',()=>{
 const server=new WorkspaceSync(),opts={client:'browser-one'},state=fixture(1),current=acceptWorkspace(null,server.reply(opts,state));
 const before=structuredClone(current);state.conversations.a.entries[0].output+='new';const delta=server.reply({...opts,since:current.cursor},state);
 assert.throws(()=>acceptWorkspace({...current,cursor:'wrong'},delta));
 delta.changes.find(c=>c.op==='append').length=0;assert.throws(()=>acceptWorkspace(current,delta));assert.deepEqual(current,before);
 assert.throws(()=>applyChanges({},[{op:'set',path:['__proto__','polluted'],value:true}]));assert.equal({}.polluted,undefined);
});
