import {VillageOperations} from '../server/operations.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VillageNotifier} from '../server/notifier.mjs';
import {destinationPatch} from '../server/notification-destination.mjs';
test('destination validation rejects credentials, non-TLS remote URL and topic injection; empty fields preserve',()=>{
 for(const server of ['http://remote.test','https://user:secret@host.test','https://host.test?token=secret','https://host.test/#secret','file:///tmp/x','https://host.test\nHeader:x'])assert.throws(()=>destinationPatch({server}));
 for(const topic of ['../x','x/y','x?token','x\ny','a b'])assert.throws(()=>destinationPatch({topic}));
 assert.throws(()=>destinationPatch({token:'secret'}));assert.throws(()=>destinationPatch({server:7}));
 assert.deepEqual(destinationPatch({server:'https://host.test/base/',topic:'demo_1-2'}),{server:'https://host.test/base',topic:'demo_1-2'});
 assert.deepEqual(destinationPatch({server:' ',topic:''}),{});assert.equal(destinationPatch({server:'http://127.0.0.1:9000'}).server,'http://127.0.0.1:9000');
});
test('destination persists through toggles/restart, blank save preserves, explicit reset restores CLI inheritance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-destination-')),n=new VillageNotifier({dir,environment:{NOTIFY_TOKEN:'never-return-this'}});await n.init();let sends=0;n.send=async()=>{sends++;};
 await n.configure({server:'https://notify.test',topic:'alpha'});await n.configure(false);await n.configure({server:'',topic:''});assert.deepEqual(n.status().destination,{server:'https://notify.test',topic:'alpha'});assert.equal(sends,0);
 const restart=new VillageNotifier({dir,environment:{}});await restart.init();assert.deepEqual(restart.status().destination,n.status().destination);assert.equal(restart.enabled,false);
 await Promise.all([restart.configure({topic:'beta'}),restart.configure(true)]);assert.equal(restart.status().destination.topic,'beta');assert.equal(restart.enabled,true);
 const before=await readFile(join(dir,'notification-settings.json'),'utf8');await assert.rejects(restart.configure({server:'https://user:pw@notify.test'}));assert.equal(await readFile(join(dir,'notification-settings.json'),'utf8'),before);assert(!JSON.stringify(restart.status()).includes('never-return-this'));
 await restart.configure({resetDestination:true});assert.deepEqual(restart.status().destination,{});assert.equal(restart.status().destinationSource,'notify-cli');
});
test('actual notify CLI uses overrides before environment before config, with mock curl only', {skip:!process.env.VILLAGE_TEST_NOTIFY_BIN},async()=>{
 const executable=process.env.VILLAGE_TEST_NOTIFY_BIN;await access(executable);const dir=await mkdtemp(join(tmpdir(),'village-notify-contract-')),capture=join(dir,'capture'),config=join(dir,'config');
 await writeFile(config,'NOTIFY_SERVER=https://config.test\nNOTIFY_TOPIC=config_topic\nNOTIFY_TOKEN=fixture-token\n',{mode:0o600});
 // Fake curl records only URL and whether fd3 carries auth. Never records the token.
 await writeFile(join(dir,'curl'),`#!/usr/bin/env node\nconst fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.CAPTURE,JSON.stringify({url:args.at(-1),auth:fs.readFileSync(3,'utf8').startsWith('Authorization: Bearer '),tokenInEnv:!!process.env.NOTIFY_TOKEN})+'\\n');process.stdout.write('200');\n`,{mode:0o700});
 const environment={...process.env,PATH:dir+':'+process.env.PATH,NOTIFY_CONFIG:config,NOTIFY_SERVER:'https://env.test',NOTIFY_TOPIC:'env_topic',VILLAGE_NOTIFY_BIN:executable,VILLAGE_OFFICE_URL:'http://village.test/agents',CAPTURE:capture};delete environment.NOTIFY_TOKEN;
 const n=new VillageNotifier({dir,environment});await n.init();await n.configure(true);await n.configure({server:'https://override.test/base',topic:'override_topic'});
 await assert.rejects(readFile(capture));assert.equal((await n.enqueue({id:'a',role:'assistant',content:'test'})).status,'sent');
 await n.configure({server:'',topic:''});await n.enqueue({id:'b',role:'assistant',content:'test'});
 await n.configure({resetDestination:true});await n.enqueue({id:'c',role:'assistant',content:'test'});
 const noEnv={...environment};delete noEnv.NOTIFY_SERVER;delete noEnv.NOTIFY_TOPIC;const fromConfig=new VillageNotifier({dir,environment:noEnv});await fromConfig.init();await fromConfig.enqueue({id:'d',role:'assistant',content:'test'});
 const calls=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(c=>c.url),['https://override.test/base/override_topic','https://override.test/base/override_topic','https://env.test/env_topic','https://config.test/config_topic']);assert(calls.every(c=>c.auth&&!c.tokenInEnv));
 for(const file of ['notification-settings.json','notifications.jsonl'])assert(!(await readFile(join(dir,file),'utf8')).includes('fixture-token'));assert(!JSON.stringify(n.status()).includes('fixture-token'));
});

test('operation audit does not retain accidentally pasted credentials or token fields',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-notify-audit-')),n=new VillageNotifier({dir,environment:{}});await n.init();const ops=new VillageOperations({dir},n);
 for(const input of [{server:'https://user:private-password@host.test'},{token:'private-token'},'{invalid-private-token']){
  const result=await ops.execute(['notifications','configure',typeof input==='string'?input:JSON.stringify(input)]);assert.equal(result.ok,false);assert(!JSON.stringify(result).includes('private-'));
 }
 const journal=await readFile(join(dir,'operations.jsonl'),'utf8');assert(!journal.includes('private-'));assert.match(journal,/redacted/);
});
