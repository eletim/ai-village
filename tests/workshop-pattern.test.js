import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DirectAgents} from '../server/direct.mjs';
import {VillageOperations} from '../server/operations.mjs';
import {roleSVG,workshopPattern} from '../src/status-icon.js';
const pattern=['line','line','line','line','diamond','none','none','diamond'];
test('eight large cells replace fixed windows and dots; registered pattern wins over stable fallback',()=>{
 const agent={location:'workshop',workshopId:'w'};const svg=roleSVG(agent,[{id:'w',iconPattern:pattern}]);assert(!svg.includes('<rect'));assert(!svg.includes('M4 12h3'));assert.equal(workshopPattern('w').length,8);assert.deepEqual(workshopPattern('w'),workshopPattern('w'));
 assert.equal(svg,roleSVG({...agent,name:'Renamed'},[{id:'w',name:'Renamed workshop',iconPattern:pattern}]));assert.notEqual(svg,roleSVG(agent));assert.match(svg,/h2.6/);assert.match(svg,/l1.5 1.5/);
});
test('partial update validates, persists across rename/restart and preserves fields; failed save rolls back',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'village-pattern-'));t.after(()=>rm(dir,{recursive:true,force:true}));const options={dir,notifier:{status:()=>({})}};const d=new DirectAgents(options);await d.init({watch:false});
 const w=await d.putWorkshop({name:'Original',sshHost:'fixture',baseUrl:'http://fixture.test',workplaces:['/work'],connectionType:'ssh'});const ops=new VillageOperations({dir},null,{direct:d});const result=await ops.execute(['workshops','pattern',w.id,JSON.stringify(pattern)]);assert.equal(result.ok,true);assert.deepEqual(result.result.iconPattern,pattern);assert.equal(result.result.sshHost,'fixture');assert.deepEqual(result.result.workplaces,['/work']);
 await d.putWorkshop({name:'Renamed'},w.id);assert.deepEqual(d.data.workshops[0].iconPattern,pattern);
 for(const iconPattern of [[],['line'],Array(8).fill('invalid'),'<svg>',{},Array(9).fill('none'),new Array(8)])await assert.rejects(d.putWorkshop({iconPattern},w.id));
 const before=structuredClone(d.data.workshops);const save=d.save;d.save=async()=>{throw Error('disk full');};await assert.rejects(d.putWorkshop({iconPattern:Array(8).fill('diamond')},w.id));assert.deepEqual(d.data.workshops,before);d.save=save;
 const restarted=new DirectAgents(options);await restarted.init({watch:false});assert.equal(restarted.data.workshops[0].name,'Renamed');assert.deepEqual(restarted.data.workshops[0].iconPattern,pattern);await restarted.putWorkshop({iconPattern:null},w.id);assert.equal(restarted.data.workshops[0].iconPattern,null);
});
