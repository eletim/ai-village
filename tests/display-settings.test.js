import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VillageNotifier} from '../server/notifier.mjs';
import {normalizeDisplay} from '../src/display-preferences.js';
import {reportHTML} from '../src/report-content.js';
test('display validation and plain safe literal rendering',()=>{
 assert.deepEqual(normalizeDisplay({font:'url(evil)',viewer:'html'}),{projectView:'secretary',textSize:'medium',iconMode:'roles',theme:'dark',font:'meiryo',viewer:'markdown'});
 globalThis.localStorage={getItem:()=>JSON.stringify({font:'serif',viewer:'plain'})};
 try{const html=reportHTML('# heading\n<script>bad()</script>\n![x](https://evil.test/x)');assert.match(html,/plain-report/);assert.match(html,/# heading/);assert.match(html,/&lt;script&gt;/);assert(!html.includes('<img'));}finally{delete globalThis.localStorage;}
});
test('notification toggle persists, validates, serializes and never replays disabled completions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-settings-')),environment={VILLAGE_OFFICE_URL:'http://village.test/agents?private=secret',NOTIFY_CONFIG:'/secret/config'};
 const n=new VillageNotifier({dir,environment});await n.init();let sends=0;n.send=async()=>{sends++;return {status:'sent',delivered:true};};
 await assert.rejects(n.configure('false'));
 await n.configure(false);await n.enqueue({id:'one',role:'assistant',kind:'request'});assert.equal(sends,0);
 await n.configure(true);await n.enqueue({id:'one',role:'assistant',kind:'request'});assert.equal(sends,0);
 await n.enqueue({id:'two',role:'assistant',kind:'request'});assert.equal(sends,1);assert(!JSON.stringify(n.status()).includes('secret'));
 await Promise.all([n.configure(true),n.configure(false)]);assert.equal(n.status().enabled,false);
 const restarted=new VillageNotifier({dir,environment});await restarted.init();assert.equal(restarted.status().enabled,false);await restarted.configure(true);assert.equal((await restarted.enqueue({id:'two',role:'assistant'})).status,'duplicate_or_internal');
 assert.deepEqual(JSON.parse(await readFile(join(dir,'notification-settings.json'),'utf8')),{enabled:true});
 await writeFile(join(dir,'notification-settings.json'),'broken');const broken=new VillageNotifier({dir,environment});await broken.init();assert.equal(broken.status().enabled,false);
});
test('Meiryo and text sizes validate; partial saves retain other browser preferences',async()=>{
 const {fonts,saveDisplay,displayPreferences}=await import('../src/display-preferences.js');
 assert.equal(fonts.meiryo,'Meiryo, sans-serif');
 for(const textSize of ['small','medium','large'])assert.equal(normalizeDisplay({textSize,font:'meiryo'}).textSize,textSize);
 assert.equal(normalizeDisplay({textSize:'huge'}).textSize,'medium');assert.equal(normalizeDisplay(null).textSize,'medium');
 let saved=JSON.stringify({theme:'sepia',iconMode:'roles',font:'mono',viewer:'plain'});
 globalThis.localStorage={getItem:()=>saved,setItem:(_,v)=>saved=v};globalThis.window={dispatchEvent:()=>{}};
 try{saveDisplay({textSize:'large'});assert.deepEqual(displayPreferences(),{projectView:'secretary',textSize:'large',theme:'sepia',iconMode:'roles',font:'mono',viewer:'plain'});saveDisplay({font:'meiryo'});assert.equal(displayPreferences().textSize,'large');}finally{delete globalThis.localStorage;delete globalThis.window;}
});
test('unset defaults use roles/dark/medium/Meiryo, saved selections remain authoritative',()=>{
 assert.deepEqual(normalizeDisplay(),{projectView:'secretary',textSize:'medium',iconMode:'roles',theme:'dark',font:'meiryo',viewer:'markdown'});
 assert.deepEqual(normalizeDisplay({textSize:'small',iconMode:'dots',theme:'light',font:'standard',viewer:'plain'}),{projectView:'secretary',textSize:'small',iconMode:'dots',theme:'light',font:'standard',viewer:'plain'});
});
