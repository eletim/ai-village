// Lean screen transports (docs/lean-fetch.md): same rendered model, fewer bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSnapshot} from '../server/map-view.mjs';
import {workspaceSnapshot} from '../server/conversation-pages.mjs';
import {villageModel} from '../src/village-model.js';

const strip=rs=>rs.map(({source,...r})=>r);
const rendered=m=>JSON.stringify({...m,places:m.places.map(p=>({...p,residents:strip(p.residents)})),residents:strip(m.residents),suspendedProjects:m.suspendedProjects.map(p=>({...p,residents:strip(p.residents)}))});
function random(seed){let x=seed>>>0||1;return ()=>((x=Math.imul(x^x>>>15,2246822507)^Math.imul(x^x>>>13,3266489909),x^=x>>>16)>>>0)/4294967296;}
const states=['completed','failed','interrupted','running','queued','completed','terminated'];
// Randomised registries exercise ties in createdAt, matched/unmatched native turns, hidden
// entries, sessions with and without an observed session, deletion and termination.
function village(seed){
 const rnd=random(seed),pick=a=>a[Math.floor(rnd()*a.length)],at=()=>new Date(Date.UTC(2026,0,1,0,Math.floor(rnd()*6))).toISOString();
 const projects=[{id:'p1',name:'P1',leaderAgentId:'a1'},{id:'p2',name:'P2',suspended:true},{id:'p3',name:'gone',deletedAt:at()}];
 const workshops=[{id:'w1',name:'W1'},{id:'w2',name:'W2',deletedAt:at()}];
 const agents=[],runs=[],reviews={};
 for(let i=0;i<14;i++){
  const id='a'+i,sessions=['s1','s2'],observed=rnd()<.7?pick(sessions):undefined;
  const nativeTurns=Array.from({length:Math.floor(rnd()*5)},(_,j)=>({id:'t'+i+'-'+j,...(rnd()<.8?{sessionId:pick(sessions)}:{}),state:pick(states),startedAt:at(),instruction:'NATIVE BODY',output:'NATIVE BODY'}));
  agents.push({id,name:'Agent '+i,location:pick(['mayor','workshop','elsewhere']),workshopId:pick(['w1','w2','missing']),projectId:pick(['p1','p2','p3',undefined]),state:pick(['idle','idle','idle','busy','terminated','failed']),...(rnd()<.15?{connectionState:'unknown'}:{}),...(rnd()<.1?{lifecycle:'unknown'}:{}),...(rnd()<.1?{deletedAt:at()}:{}),observedSessionId:observed,createdAt:at(),nativeTurns,runtimeMigrations:[{oldRuntime:'AUDIT'}],secretaryHandover:{body:'AUDIT'}});
  for(let j=0;j<Math.floor(rnd()*6);j++){
   const turn=rnd()<.4?pick(nativeTurns.length?nativeTurns:[{id:'none'}]):null;
   runs.push({id:'r'+i+'-'+j,agentId:id,state:pick(states),createdAt:at(),instruction:'RUN BODY',output:'RUN BODY',...(turn?{turnId:turn.id,sessionId:turn.sessionId||observed}:rnd()<.5?{agentSessionId:pick(sessions)}:{}),...(rnd()<.15?{hideEntry:true}:{})});
  }
  if(rnd()<.5)reviews[id]={revision:'x',hasCompleted:true,unreviewed:rnd()<.5,attention:rnd()<.3,attentionRequestIds:['q']};
 }
 return {version:1,agents,runs,workshops,projects,reviews,requests:[{id:'q',instruction:'REQUEST BODY'}],conversations:{}};
}

test('map view renders exactly the same village as the complete snapshot, without bodies',()=>{
 for(let seed=1;seed<=300;seed++){
  const full=village(seed),lean=mapSnapshot(full);
  for(const online of [true,false])assert.equal(rendered(villageModel(lean,online)),rendered(villageModel(full,online)),'seed '+seed);
  const text=JSON.stringify(lean);
  for(const body of ['NATIVE BODY','RUN BODY','REQUEST BODY','AUDIT'])assert(!text.includes(body),body+' leaked (seed '+seed+')');
  assert(lean.agents.every(a=>!a.deletedAt));
 }
});

test('map view keeps only the latest entries per Agent',()=>{
 const full=village(7);full.runs.push(...Array.from({length:500},(_,i)=>({id:'bulk'+i,agentId:'a1',state:'completed',createdAt:'2025-01-01T00:00:00.000Z',output:'x'.repeat(1000)})));
 const lean=mapSnapshot(full);assert(lean.runs.filter(r=>r.agentId==='a1').length<=4);assert(Buffer.byteLength(JSON.stringify(lean))<20000);
});

test('lean workspace drops only Agent audit material the Workspace never renders',()=>{
 const view={version:1,agents:[
  {id:'a',name:'A',state:'idle',secretaryHandover:{conversations:['x']},runtimeMigrations:[{at:'1',oldRuntime:'OLD'},{at:'2',oldRuntime:'OLD',handover:'NOTE',legacyRetirement:{oldRuns:[{id:'r',outcome:'unknown'}],oldWorks:[]}}],nativeTurns:[]},
  {id:'b',name:'B',state:'idle',runtimeMigrations:[{at:'3',oldRuntime:'OLD'}],nativeTurns:[]},
  {id:'c',name:'C',state:'terminated',deletedAt:'4',nativeTurns:[]}],
  runs:[],requests:[],workshops:[],projects:[],reviews:{},notification:{}};
 const legacy=workspaceSnapshot(view,{},[]),lean=workspaceSnapshot(view,{},[],{lean:true});
 assert.deepEqual(legacy.agents[0].runtimeMigrations,view.agents[0].runtimeMigrations);assert.deepEqual(legacy.agents[0].secretaryHandover,{conversations:['x']});
 const [a,b,c]=lean.agents;
 assert.equal(a.secretaryHandover,undefined);assert.deepEqual(a.runtimeMigrations,[{at:'2',legacyRetirement:view.agents[0].runtimeMigrations[1].legacyRetirement}]);
 assert.deepEqual(b.runtimeMigrations,[{at:'3'}]);assert.equal(b.runtimeMigrations.at(-1).legacyRetirement,undefined);
 assert.equal(c.runtimeMigrations,undefined);assert.equal(c.deletedAt,'4');
 assert(!JSON.stringify(lean).includes('OLD'));
 // Every other field is identical.
 const drop=({secretaryHandover,runtimeMigrations,...x})=>x;assert.deepEqual(lean.agents.map(drop),legacy.agents.map(drop));
 assert.deepEqual({...lean,agents:null},{...legacy,agents:null});
});

// Stage 2 (V2): folded Agent-to-Agent bodies are fetched when the fold is opened.
import {historyPage,entryBody} from '../server/conversation-pages.mjs';
import {entryIdentity} from '../src/run-groups.js';
function conversation(){
 const at=i=>new Date(1700000000000+i*1000).toISOString();
 const runs=[
  {id:'human',agentId:'a',origin:'human',state:'completed',createdAt:at(1),instruction:'HUMAN QUESTION',output:'HUMAN ANSWER',finalOutput:'HUMAN ANSWER'},
  {id:'delegated',agentId:'a',origin:'delegation',suppressUser:true,humanRequestId:'q',state:'completed',createdAt:at(2),instruction:'AGENT INSTRUCTION',output:'AGENT PROGRESS',finalOutput:'AGENT RESULT'},
  {id:'running',agentId:'a',origin:'delegation',suppressUser:true,state:'running',createdAt:at(3),instruction:'RUNNING INSTRUCTION',output:'STREAMING'},
  {id:'published',agentId:'a',origin:'report',humanRequestId:'done',state:'completed',createdAt:at(4),instruction:'REPORT PROMPT',output:'FINAL REPORT',finalOutput:'FINAL REPORT'},
 ];
 const requests=[{id:'q',status:'active'},{id:'done',status:'completed',finalRunId:'published'}];
 return {version:1,agents:[{id:'a',name:'A',state:'idle',nativeTurns:[]}],workshops:[],projects:[],reviews:{},notification:{},runs,requests};
}
test('lean conversation defers only folded bodies; visible ones and running progress stay inline',()=>{
 const view=conversation(),legacy=workspaceSnapshot(view,{},['a']),lean=workspaceSnapshot(view,{},['a'],{lean:true});
 const by=(s,id)=>s.conversations.a.entries.find(e=>e.id===id);
 assert.equal(by(lean,'human').instruction,'HUMAN QUESTION');assert.equal(by(lean,'human').output,'HUMAN ANSWER');assert.equal(by(lean,'human').bodyDeferred,undefined);
 const d=by(lean,'delegated');assert.equal(d.instruction,undefined);assert.equal(d.output,undefined);assert.equal(d.finalOutput,undefined);assert.deepEqual(Object.keys(d.bodyDeferred),['input','output']);assert.equal(d.bodyDeferred.output.final,true);
 const r=by(lean,'running');assert.equal(r.instruction,undefined);assert.equal(r.output,'STREAMING');assert.deepEqual(Object.keys(r.bodyDeferred),['input']);
 const p=by(lean,'published');assert.equal(p.output,'FINAL REPORT');assert.equal(p.bodyDeferred?.output,undefined);
 // Nothing else about an entry changes, and the legacy shape is untouched.
 const drop=({instruction,output,finalOutput,bodyDeferred,...x})=>x;assert.deepEqual(lean.conversations.a.entries.map(drop),legacy.conversations.a.entries.map(drop));
 assert(legacy.conversations.a.entries.every(e=>!e.bodyDeferred));
 // The body endpoint returns exactly what was left out, under the announced version.
 const input=entryBody(view,'a',entryIdentity(d),'input'),output=entryBody(view,'a',entryIdentity(d),'output');
 assert.deepEqual(input,{side:'input',v:d.bodyDeferred.input.v,instruction:'AGENT INSTRUCTION'});
 assert.deepEqual(output,{side:'output',v:d.bodyDeferred.output.v,output:by(legacy,'delegated').output,finalOutput:'AGENT RESULT'});
 // A changed body announces a new version, so an open fold refetches it.
 view.runs[1].finalOutput='AGENT RESULT v2';assert.notEqual(by(workspaceSnapshot(view,{},['a'],{lean:true}),'delegated').bodyDeferred.output.v,d.bodyDeferred.output.v);
 assert.throws(()=>entryBody(view,'a',entryIdentity(d),'other'),{status:400});assert.throws(()=>entryBody(view,'a','["run","","missing"]','input'),{status:404});assert.throws(()=>entryBody(view,'missing',entryIdentity(d),'input'),{status:404});
 // Older pages follow the same rule.
 const page=historyPage(view,'a',null,{lean:true});assert.equal(page.entries.find(e=>e.id==='delegated').instruction,undefined);assert.equal(historyPage(view,'a',null).entries.find(e=>e.id==='delegated').instruction,'AGENT INSTRUCTION');
});
test('internal supplement receipts defer their text; human supplements stay visible',()=>{
 const view=conversation();view.requests=[{id:'q',status:'active',instruction:'x',requestGraph:{rootId:'w',nodes:[{id:'w',assignee:'a',metadata:{instruction:'x'},inbox:[
  {id:'p',kind:'supplement',source:{actor:'program'},text:'PROGRAM NOTICE',createdAt:'2023-11-14T22:13:30.000Z'},
  {id:'h',kind:'supplement',source:{actor:'human'},text:'HUMAN SUPPLEMENT',createdAt:'2023-11-14T22:13:31.000Z'}]}]}}];
 const entries=workspaceSnapshot(view,{},['a'],{lean:true}).conversations.a.entries,by=id=>entries.find(e=>e.id===id);
 assert.equal(by('input:p').instruction,undefined);assert(by('input:p').bodyDeferred.input.v);assert.equal(by('input:h').instruction,'HUMAN SUPPLEMENT');
 assert.equal(entryBody(view,'a',entryIdentity(by('input:p')),'input').instruction,'PROGRAM NOTICE');
});
