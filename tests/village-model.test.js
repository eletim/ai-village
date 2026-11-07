import {test} from 'node:test';
import assert from 'node:assert/strict';
import {villageModel,reconcileSelection,workspaceLink} from '../src/village-model.js';
const state=()=>({workshops:[{id:'w',name:'登録工房'}],projects:[{id:'p',name:'村実装'}],agents:[{id:'a',name:'名前は工房',location:'mayor',workshopId:'w',projectId:'p',state:'busy'},{id:'b',name:'秘書という名前',location:'workshop',workshopId:'w',state:'idle',connectionState:'unknown'},{id:'c',state:'terminated'},{id:'d',name:'不明',cwd:'/w',state:'failed'}],reviews:{a:{attention:true}},runs:[]});
test('official location/ID determines placement, not name/cwd; terminated excluded and unknown not idle',()=>{
 const m=villageModel(state());assert.equal(m.residents.length,3);assert.equal(m.places[0].residents[0].id,'a');assert.equal(m.places[1].residents[0].id,'b');assert.equal(m.residents[1].label,'状態不明');assert.equal(m.places[2].residents[0].id,'d');assert.equal(m.residents[0].project,'村実装');assert.equal(m.count.busy,1);assert.equal(m.count.attention,1);
 assert(villageModel(state(),false).residents.every(r=>r.status==='unknown'));
});
test('selection follows movement and falls back safely after removal; empty and large registry retain everyone',()=>{
 const s=state();s.agents[0].location='workshop';const m=villageModel(s);assert.deepEqual(reconcileSelection(m,{resident:'a',place:'mayor'}),{resident:'a',place:'workshop:w'});
 assert.deepEqual(reconcileSelection(m,{resident:'deleted',place:'gone'}),{resident:null,place:null});assert.equal(villageModel().places.length,1);
 for(let i=0;i<12;i++){s.workshops.push({id:'w'+i,name:'工房'+i});for(let j=0;j<4;j++)s.agents.push({id:`a${i}-${j}`,location:'workshop',workshopId:'w'+i,state:'idle'});}
 const large=villageModel(s);assert.equal(large.residents.length,51);assert.equal(large.places.flatMap(p=>p.residents).length,51);
 assert.equal(workspaceLink('a/b'),'/agents#agent-a%2Fb');
});
test('native failure and lifecycle uncertainty do not become idle; review attention is independent',()=>{
 const s=state();s.agents=[{id:'a',location:'mayor',state:'idle',observedSessionId:'s',nativeTurns:[{id:'t',sessionId:'s',state:'failed'}]}];assert.equal(villageModel(s).residents[0].status,'failed');s.agents[0].lifecycle='unknown';assert.equal(villageModel(s).residents[0].status,'unknown');
});
