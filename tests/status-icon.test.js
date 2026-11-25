import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredRole,workshopPattern,roleSVG,iconLabel,statusIcon} from '../src/status-icon.js';
import {normalizeDisplay} from '../src/display-preferences.js';
test('roles use only registered role/location, including explicit unknown and conflicts',()=>{
 assert.equal(registeredRole({location:'mayor'}),'secretary');assert.equal(registeredRole({location:'workshop'}),'worker');assert.equal(registeredRole({role:'secretary'}),'secretary');
 for(const a of [{name:'秘書',cwd:'/secretary',workshopId:'w'},{role:'other',location:'mayor'},{role:'secretary',location:'workshop'},{}])assert.equal(registeredRole(a),'unknown');
 assert.notEqual(roleSVG({location:'mayor'}),roleSVG({location:'workshop'}));assert.notEqual(roleSVG({}),roleSVG({location:'workshop'}));
});
test('workshop identicon is stable across Agent and workshop renames; absent ID has explicit fallback',()=>{
 const a={name:'A',location:'workshop',workshopId:'w1',connection:{name:'Old'}};const svg=roleSVG(a);assert.equal(svg,roleSVG({...a,name:'Renamed',connection:{name:'New'}}));assert.notDeepEqual(workshopPattern('w1'),workshopPattern('w2'));assert.equal(workshopPattern(null),null);assert.equal(workshopPattern(''),null);assert.match(roleSVG({location:'workshop'}),/m7 11 6 5/);
 assert.match(iconLabel(a,[{id:'w1',name:'New'}],'作業中',true),/A · 工房Agent · New · 作業中 · 依頼完了・要確認/);assert.match(iconLabel({name:'秘書'},[],'不明'),/役割不明 · 工房未登録/);
});
test('labels and attributes are escaped; SVG never contains names, IDs, URLs or scripts',()=>{
 const a={id:'" onerror="evil',name:'<script>x</script>',location:'workshop',workshopId:'"<svg>',connection:{name:'<img src=x>'}};
 const html=statusIcon(a,{mode:'roles',sidebar:true,state:'" onclick="evil',attention:true});assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(!html.includes(' onerror="evil'));assert.match(html,/&lt;script&gt;/);assert(!roleSVG(a).includes(a.workshopId));assert(!roleSVG(a).includes('http'));assert.equal((html.match(/<svg/g)||[]).length,1);
 assert(!statusIcon(a).includes('<svg'));assert.equal(normalizeDisplay().iconMode,'roles');assert.equal(normalizeDisplay({iconMode:'bad'}).iconMode,'roles');assert.deepEqual(normalizeDisplay({iconMode:'roles',theme:'sepia',font:'serif',viewer:'plain'}),{projectView:'secretary',textSize:'medium',iconMode:'roles',theme:'sepia',font:'serif',viewer:'plain'});
});

test('leader flag supplements workshop shape and state in role and dot modes',()=>{
 const a={id:'a',name:'担当',location:'workshop',workshopId:'w'};
 for(const mode of ['roles','dots']){
  const options={mode,unread:true,state:'busy',attention:true,sidebar:true,projects:[{id:'p',leaderAgentId:'a'}]};
  const html=statusIcon(a,options);assert.match(html,/has-leader/);assert.match(html,/leader-icon-flag/);assert.match(html,/Projectリーダー（仕事の管理役）/);assert.match(html,/data-state="busy"/);assert.match(html,/data-attention="true"/);assert.match(html,/data-unread="true"/);
  assert(html.includes(roleSVG(a,[],true)));assert.equal(roleSVG(a,[],true).split('<g fill="currentColor">')[1],roleSVG(a).split('<g fill="currentColor">')[1]);assert.equal((html.match(/<svg/g)||[]).length,1);assert.match(html,/viewBox="0 0 20 20"/);
  for(const leaderAgentId of ['b',null])assert(!statusIcon(a,{...options,projects:[{id:'p',leaderAgentId}]}).includes('leader-icon-flag'));
 }
});
