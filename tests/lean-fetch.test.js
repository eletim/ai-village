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
