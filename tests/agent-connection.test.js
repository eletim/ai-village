import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {DirectAgents} from '../server/direct.mjs';
import {VillageOperations} from '../server/operations.mjs';
import {AgentRules} from '../server/agent-rules.mjs';
import {remoteVillageConnection,connectionArgs,connectionCommand} from '../server/agent-connection.mjs';
import {installInstructionsScript} from '../server/input-envelope.mjs';
const exec=promisify(execFile),hash=s=>createHash('sha256').update(s).digest('hex');
const config={url:'http://100.64.0.2:15680',cliPath:'/remote dir/village.mjs'};
test('remote config rejects loopback, credentials, untrusted HTTP and invalid paths; trusted network defaults',()=>{
 for(const url of ['http://127.0.0.1:5173','https://localhost','https://localhost.','https://x.localhost','http://example.test','https://user:secret@example.test','https://example.test/path','https://example.test/?token=secret','http://0.0.0.0','https://127.0.0.2','https://[::]','https://[::ffff:127.0.0.1]'])assert.throws(()=>remoteVillageConnection({...config,url}));
 assert.throws(()=>remoteVillageConnection({}),/未設定/);
 assert.throws(()=>remoteVillageConnection({url:config.url}),/cliPath/);
 assert.throws(()=>remoteVillageConnection({...config,url:'https://village.test'}),/authFile/);
 assert.throws(()=>remoteVillageConnection({...config,cliPath:'relative'}));
 assert.throws(()=>remoteVillageConnection({...config,password:'secret'}));
 assert.deepEqual(remoteVillageConnection({cliPath:config.cliPath},{url:config.url}),config);
 assert.deepEqual(remoteVillageConnection({cliPath:config.cliPath,authFile:'/private/auth'},{url:'https://village.test',authRequired:true}),{...config,url:'https://village.test',authFile:'/private/auth'});
});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'agent-connection-'));t.after(()=>rm(dir,{recursive:true,force:true}));const calls=[];let fail=false,version=1;
 const remote=async args=>{calls.push(args);if(args[0]==='env'){if(fail)throw Error('HTTP 401');return JSON.stringify({ok:true,clientConnectionVersion:version,result:d.rules.specification()});}
 if(args[0]==='python3'&&args[2]===installInstructionsScript)return JSON.stringify({installed:true,hash:hash(args.at(-1))});
 if(args[1]==='workspace')return JSON.stringify({id:'ws-test',initialTab:{tabId:'initial'}});
 if(args[2]==='create')return JSON.stringify({tabId:'tab-test',sessionName:'test'});throw Error('unexpected command');};
 const options={dir,remote,localRun:(bin,args)=>remote([bin,...args]),notifier:{status:()=>({})}};
 const d=new DirectAgents(options);await d.init({watch:false});t.after(()=>d.close());return {d,options,calls,fail:v=>fail=v,version:v=>version=v};
}
test('missing remote settings and failed read-only probe never create a workspace/Agent',async t=>{
 const f=await fixture(t),w=await f.d.putWorkshop({name:'remote',sshHost:'registered',baseUrl:'http://pmux.test',workplaces:['/tmp']});
 const input={workshopId:w.id,cwd:'/tmp',requestId:'missing-config'};
 await assert.rejects(f.d.create(input),/未設定/);assert.equal(f.calls.length,0);assert.equal(f.d.data.agents.length,0);
 await f.d.putWorkshop({villageConnection:config},w.id);f.fail(true);
 await assert.rejects(f.d.create(input),/読取疎通/);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'env');assert.equal(f.d.data.agents.length,0);
 f.fail(false);f.version(0);await assert.rejects(f.d.create(input),/CLI\/接続先\/仕様/);assert.equal(f.d.data.agents.length,0);assert.equal(f.calls.length,2);
});
test('remote leader startup uses host CLI and scoped rules; persistence freezes config without changing local hashes',async t=>{
 const f=await fixture(t),d=f.d,w=await d.putWorkshop({name:'remote',sshHost:'registered',baseUrl:'http://pmux.test',workplaces:['/tmp'],villageConnection:config});
 const project=await d.putProject({requestId:'connection-project',name:'local secretary remote leader'});
 const a=await d.create({workshopId:w.id,cwd:'/tmp',requestId:'remote-leader',projectId:project.id});
 await d.putProject({revision:project.revision,leaderAgentId:a.id},project.id);
 const localWorkshop=await d.putWorkshop({name:'local secretary',connectionType:'local',baseUrl:'http://local.test',workplaces:['/tmp']});
 const secretary=await d.create({workshopId:localWorkshop.id,cwd:'/tmp',requestId:'local-secretary',location:'mayor',projectId:project.id});
 assert.equal(secretary.villageConnection,undefined);assert.equal(secretary.inputEnvelope.contract,3);
 assert.deepEqual(d.discovery().agents.find(x=>x.agentId===a.id).leaderForProjects,[project.id]);
 assert.equal(d.instructionStatus(a.id).connectionAccess.readProbeRequired,true);assert.equal(a.inputEnvelope.mode,'startup-v2');const body=d.startupInstructions(a);assert.match(body,/100\.64\.0\.2:15680/);assert.match(body,/remote dir/);assert.match(body,/VILLAGE_AGENT_ID/);
 assert.equal(a.inputEnvelope.hash,hash(body));assert.equal(f.calls[0][0],'env');assert.equal(f.calls[1][1],'workspace');
 const ops=new VillageOperations({dir:f.options.dir},null,{direct:d});const result=await ops.execute(['rules','get','work','leader','--agent',a.id]);
 assert.equal(result.ok,true);assert.match(result.result.text,/remote dir/);assert.equal(result.result.revision,d.rules.specification().revision);
 const local={id:'local',connection:{connectionType:'local'}};assert.equal(d.startupInstructions(local),new AgentRules(d.villageUrl).startup());
 await d.putWorkshop({villageConnection:{...config,url:'http://100.64.0.3:15680'}},w.id);assert.equal(d.startupInstructions(a),body);
 d.close();const restored=new DirectAgents(f.options);await restored.init({watch:false});t.after(()=>restored.close());
 assert.equal(restored.agent(a.id).inputEnvelope.mode,'startup-v2');assert.equal(restored.startupInstructions(restored.agent(a.id)),body);
 assert.equal(restored.data.workshops[0].villageConnection.url,'http://100.64.0.3:15680');
 // Runtime adoption changes owner ID, but fixed command selector follows the runtime.
 const moved={...restored.agent(a.id),id:'replacement'};restored.data.agents=[moved];assert.equal(restored.startupInstructions(moved),body);assert.match(restored.rulesFor(a.id).leader('id'),/remote dir/);
});
test('existing remote contract remains byte-identical and new local creation needs no remote settings',async t=>{
 const f=await fixture(t),d=f.d;const legacy={id:'existing',connection:{connectionType:'ssh'}};
 assert.equal(d.startupInstructions(legacy),d.rules.startup());
 const w=await d.putWorkshop({name:'local',connectionType:'local',baseUrl:'http://pmux.test',workplaces:['/tmp']});const a=await d.create({workshopId:w.id,cwd:'/tmp',requestId:'local-create'});
 assert.equal(a.villageConnection,undefined);assert.equal(a.inputEnvelope.hash,hash(d.rules.startup()));assert.equal(f.calls.some(x=>x[0]==='env'),false);
 // Model a previously started SSH runtime with the old shared fixed contract.
 a.connection.connectionType='ssh';a.connection.sshHost='registered';await d.save();d.close();
 const restored=new DirectAgents(f.options);await restored.init({watch:false});t.after(()=>restored.close());
 assert.equal(restored.agent(a.id).inputEnvelope.mode,'startup-v2');assert.equal(restored.agent(a.id).inputEnvelope.hash,a.inputEnvelope.hash);
 assert.match(restored.instructionStatus(a.id).connectionAccess.error,/未設定/);
});
test('generated command quotes shell metacharacters without execution',()=>{
 const c={...config,cliPath:"/tmp/quote' $(touch forbidden).mjs",authFile:'/tmp/a `secret`'};
 assert.ok(connectionArgs(config).includes('VILLAGE_AUTH_FILE='));assert.ok(connectionArgs(config).includes('VILLAGE_AGENT_ID='));assert.ok(connectionArgs(config).includes('VILLAGE_PUBLIC_ORIGIN='));
 assert.match(connectionCommand(c,'id'),/'\\''/);assert.deepEqual(connectionArgs(c,'id').slice(-2),['node',c.cliPath]);
});
test('actual CLI HTTP authentication, scoped rules and redirect refusal; no secrets in output',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'connection-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));const auth=join(dir,'auth');const credentials='fixture:abcdefghijklmnopqrstuv';await writeFile(auth,credentials,{mode:0o600});let mode='ok',requests=[];
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests.push({auth:req.headers.authorization,body});if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1'});return res.end();}if(mode==='auth'){res.writeHead(401);return res.end('secret must not be reflected');}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result:{argv:JSON.parse(body).argv}}));});
 await new Promise(r=>server.listen(15680,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const env={...process.env,VILLAGE_URL:'http://127.0.0.1:15680',VILLAGE_AUTH_FILE:auth,VILLAGE_AGENT_ID:'fixture-agent'};delete env.VILLAGE_PUBLIC_ORIGIN;
 const args=[resolve('scripts/village.mjs'),'--connection-check','rules','get','work'];const out=await exec('node',args,{env});const parsed=JSON.parse(out.stdout);assert.equal(parsed.clientConnectionVersion,1);assert.deepEqual(parsed.result.argv,['rules','get','work','--agent','fixture-agent']);assert.equal(requests[0].auth,'Basic '+Buffer.from(credentials).toString('base64'));assert.equal(out.stdout.includes(credentials),false);
 mode='auth';await assert.rejects(exec('node',args,{env}),e=>/HTTP 401/.test(e.stderr)&&!e.stderr.includes('secret must'));
 await assert.rejects(exec('node',args,{env:{...env,VILLAGE_URL:'http://127.0.0.1:15689'}}),e=>/接続が失敗/.test(e.stderr));
 mode='redirect';await assert.rejects(exec('node',args,{env}));assert.equal(requests.length,3);
 await assert.rejects(exec('node',args,{env:{...env,VILLAGE_AUTH_FILE:join(dir,'missing')}}),e=>!e.stderr.includes(credentials));
});
