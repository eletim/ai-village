import test from 'node:test';
import assert from 'node:assert/strict';
import {isProjectLeader,leaderMarker} from '../src/leader-marker.js';
import {villageModel} from '../src/village-model.js';
test('leader marker follows saved assignment without changing role/status',()=>{
 const a={id:'a',name:'リーダー',location:'workshop',workshopId:'w',projectId:'p',state:'busy'},b={...a,id:'b'};
 const p={id:'p',leaderAgentId:'a'},snapshot={agents:[a,b],projects:[p],workshops:[{id:'w',name:'工房'}]};
 assert(isProjectLeader(a,[p]));assert(!isProjectLeader(b,[p]));assert(!isProjectLeader({},[{}]));assert(!isProjectLeader(a,[{...p,deletedAt:'now'}]));
 let model=villageModel(snapshot);assert.equal(model.residents[0].role,'工房Agent');assert.equal(model.residents[0].status,'busy');assert(model.residents[0].leader);
 p.leaderAgentId='b';model=villageModel(snapshot);assert(!model.residents[0].leader);assert(model.residents[1].leader);
 p.leaderAgentId=null;assert(villageModel(snapshot).residents.every(r=>!r.leader));
 assert.match(leaderMarker(true),/aria-label="Projectリーダー（仕事の管理役）"/);assert.match(leaderMarker(true),/<svg/);assert.equal(leaderMarker(false),'');
});
