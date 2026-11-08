import {hasReport} from '../src/job-state.js';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isOnDesk, isSettled, jobStatus } from '../src/job-state.js';

// The same registry serves the secretary, HTTP and the human CLI. Adding a village
// operation doesn't require adding a new LLM action or teaching a keyword router.
export class VillageOperations {
  constructor(bridge, notifier, {web, development, images, todos, prs, direct, travelRegistry} = {}) {
    this.bridge = bridge;
    const detail = id => this.describe(bridge.jobById(id));
    this.commands = [
      ...(travelRegistry?[
        {name:'travel list',usage:'travel list (registered computers and folders; IDs and revision)',run:args=>{if(args.length)throw Error('引数は不要です');return travelRegistry.snapshot();}},
        {name:'travel update',usage:'travel update JSON {revision,entity:computer|folder,action:add|edit|delete,id?,computerId?,name?,sshHost?,cwd?,notes?}',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return travelRegistry.update(JSON.parse(args[0]));}}
      ]:[]),
      ...(direct?[{name:'agents list',usage:'agents list',run:args=>{if(args.length)throw new Error('usage: agents list');return direct.discovery();}}]:[]),
      ...(direct?[
        {name:'workshops pattern',usage:'workshops pattern WORKSHOP_ID JSON_ARRAY_8_OR_NULL (none|line|diamond; top row left to right, then bottom)',mutation:true,run:args=>{if(args.length!==2)throw Error('工房IDと8セルのJSON配列を指定してください');return direct.putWorkshop({iconPattern:JSON.parse(args[1])},args[0]);}},
        {name:'agents create',usage:'agents create JSON({requestId,workshopId,cwd,name,provider,location,projectId?})',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return direct.create(JSON.parse(args[0]));}},
        {name:'agents stop',usage:'agents stop AGENT_ID',mutation:true,run:args=>{if(args.length!==1)throw Error('Agent IDを指定してください');return direct.stop(args[0]);}},
        {name:'agents rename',usage:'agents rename AGENT_ID REVISION NAME',mutation:true,run:args=>{if(args.length!==3)throw Error('ID REVISION NAMEを指定してください');return direct.updateAgent(args[0],{revision:Number(args[1]),name:args[2]});}},
        {name:'agents project',usage:'agents project AGENT_ID REVISION PROJECT_ID|-',mutation:true,run:args=>{if(args.length!==3)throw Error('ID REVISION PROJECT_IDを指定してください');return direct.updateAgent(args[0],{revision:Number(args[1]),projectId:args[2]==='-'?null:args[2]});}},
        {name:'projects guide',usage:'projects guide PROJECT_ID (latest secretary policy; available:false if absent; does not authorize actions)',run:args=>{if(args.length!==1)throw Error('PROJECT_IDを指定してください');return direct.projectGuides.get(args[0]);}},
        {name:'projects list',usage:'projects list',run:args=>{if(args.length)throw Error('引数は不要です');return direct.discovery().projects;}},
        {name:'projects create',usage:'projects create REQUEST_ID NAME',mutation:true,run:args=>{if(args.length!==2)throw Error('REQUEST_ID NAMEを指定してください');return direct.putProject({requestId:args[0],name:args[1]});}},
        {name:'projects pin',usage:'projects pin PROJECT_ID REVISION true|false',mutation:true,run:args=>{if(args.length!==3||!['true','false'].includes(args[2]))throw Error('ID REVISION true|falseを指定してください');return direct.putProject({revision:Number(args[1]),pinned:args[2]==='true'},args[0]);}},
        {name:'projects delete-plan',usage:'projects delete-plan PROJECT_ID (confirm project, revision and all member Agents; running Agents will stop)',run:args=>{if(args.length!==1)throw Error('PROJECT_IDを指定');return direct.projectDeletePlan(args[0]);}},
        {name:'projects delete',usage:'projects delete PROJECT_ID JSON {operationId,revision,members:[{id,revision}]} (stop/delete ALL members; retry same payload on partial status)',mutation:true,run:args=>{if(args.length!==2)throw Error('PROJECT_ID JSONを指定');return direct.deleteProject(args[0],JSON.parse(args[1]));}},
        {name:'projects rename',usage:'projects rename PROJECT_ID REVISION NAME',mutation:true,run:args=>{if(args.length!==3)throw Error('ID REVISION NAMEを指定してください');return direct.putProject({revision:Number(args[1]),name:args[2]},args[0]);}},
      ]:[]),
      ...(direct?[
        {name:'reports status',usage:'reports status (village-wide; applies to new requests only)',run:args=>{if(args.length)throw Error('引数は不要です');return direct.flow.reportStatus();}},
        {name:'reports configure',usage:'reports configure true|false (default ON; no replay of existing requests)',mutation:true,run:args=>{if(args.length!==1)throw Error('true/falseを指定してください');return direct.flow.configureReport(JSON.parse(args[0]));}},
        {name:'requests start',usage:'requests start JSON {agentId,requestId,instruction,steerTarget?:{runId,sessionId,turnId},attachments?:[UPLOAD_ID],travelContexts?:[{name,sshHost,cwd,notes?}]} (human only; steerTarget from GET /api/direct agent.canSteer keeps same work/ticket; omit for independent queued request; use delegate for child work)',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定');const x=JSON.parse(args[0]);return direct.send(x.agentId,x);}},
        {name:'requests list',usage:'requests list [AGENT_ID]',run:args=>{if(args.length>1)throw Error('Agent IDは1つまで');return direct.flow.list(args[0]);}},
        {name:'requests get',usage:'requests get HUMAN_REQUEST_ID',run:args=>{if(args.length!==1)throw Error('依頼IDを指定');return direct.flow.get(args[0]);}},
        {name:'requests results',usage:'requests results HUMAN_REQUEST_ID WORK_ID',run:args=>{if(args.length!==2)throw Error('依頼IDと作業IDを指定');return direct.flow.results(...args);}},
        ...['delegate','acknowledge','finish','retry','resume','cancel'].map(action=>({name:'requests '+action,usage:'requests '+action+' JSON '+({delegate:'{humanRequestId,parentWorkId,actorRunId,agentId,operationId,instruction}',acknowledge:'{humanRequestId,workId,actorRunId,resultIds}',finish:'{humanRequestId,workId,runId,revision,operationId}',retry:'{humanRequestId,workId,revision,operationId,instruction,actorRunId?}',resume:'{humanRequestId,workId,revision,operationId,instruction,actorRunId?}',cancel:'{humanRequestId,revision}'})[action],mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定');const input=JSON.parse(args[0]);return action==='retry'||action==='resume'?direct.flow.continue(input,action==='retry'):direct.flow[action](input);}})),
      ]:[]),
      ...(prs?.commands() || []),
      { name:'todos list', usage:'todos list', run:args=>{if(args.length)throw new Error('usage: todos list');return todos.snapshot();} },
      ...['add','edit','toggle','delete'].map(action=>({name:`todos ${action}`,usage:`todos ${action} REVISION ${action==='add'?'TEXT':action==='edit'?'ID TEXT':action==='toggle'?'ID true|false':'ID'}`,mutation:true,run:args=>{
        const count=action==='edit'||action==='toggle'?3:2;
        if(args.length!==count||! /^(0|[1-9][0-9]*)$/.test(args[0]))throw new Error('TODOのrevisionと引数を確認してください');
        if(action==='toggle'&&!['true','false'].includes(args[2]))throw new Error('完了状態はtrue/falseです');
        return todos.update({action,revision:Number(args[0]),id:action==='add'?undefined:args[1],text:action==='add'?args[1]:args[2],done:args[2]==='true'});
      }})),
      { name:'images upload',usage:'node scripts/village.mjs images upload LOCAL_FILE (PNG/JPEG/WebP; uploads caller-local bytes)',run:()=>{throw Error('images uploadは呼び出し元のscripts/village.mjsで実行してください。HTTPはPOST /api/imagesへ画像本体を送信します。サーバーパスは受け付けません。');} },
      { name:'images list', usage:'images list', run:args=>{if(args.length)throw new Error('usage: images list');return images.list();} },
      { name:'images import', usage:'images import JOB_ID RELATIVE_PATH', run:args=>{if(args.length!==2)throw new Error('usage: images import JOB_ID RELATIVE_PATH');return images.importArtifact(bridge,...args);} },
      { name:'jobs artifacts', usage:'jobs artifacts JOB_ID', run:async args=>{const job=bridge.jobById(this.id(args));await bridge.update({artifacts:await bridge.listArtifacts(job)},job);return this.describe(job);} },
      { name:'help', usage:'help', run:args=>{if(args.length)throw new Error('usage: help');return this.commands.map(({name,usage,mutation})=>({name,usage,mutation:!!mutation}));} },
      { name:'notifications status', usage:'notifications status', run:args=>{if(args.length)throw new Error('usage: notifications status');return notifier?.status() || {enabled:false,unavailable:true};} },
      { name:'notifications configure',usage:'notifications configure true|false|JSON {enabled?,server?,topic?,resetDestination?}',mutation:true,run:args=>{if(args.length!==1)throw Error('usage: notifications configure true|false|JSON');if(!notifier)throw Error('通知処理がありません。');let input;try{input=JSON.parse(args[0]);}catch{throw Error('通知設定はtrue/falseまたはJSONで指定してください');}return notifier.configure(input);} },
      { name:'notifications test', usage:'notifications test', mutation:true, run:async args=>{if(args.length)throw new Error('usage: notifications test');if(!notifier)throw new Error('通知処理がありません。');const result=await notifier.test();return {...result,ok:result.delivered};} },
      { name:'web read', usage:'web read URL', run:async args=>{if(args.length!==1)throw new Error('usage: web read URL');return web.read(args[0]);} },
      { name:'development status', usage:'development status', run:()=>development.profile() },
      { name:'development start', usage:'development start --task TEXT [--apply]', mutation:true, run:args=>{if(args[0]!=='--task'||!args[1]||args.length>3||(args[2]&&args[2]!=='--apply'))throw new Error('usage: development start --task TEXT [--apply]');return development.start(args[1],{autoApply:args[2]==='--apply'});} },
      { name:'development inspect', usage:'development inspect JOB_ID', run:args=>development.inspect(this.id(args)) },
      { name:'development apply', usage:'development apply JOB_ID [--retry]', mutation:true, run:args=>{if(!args[0]||args.length>2||(args[1]&&args[1]!=='--retry'))throw new Error('usage: development apply JOB_ID [--retry]');return development.apply(args[0],{retry:args[1]==='--retry'});} },
      { name:'deployments list', usage:'deployments list', run:()=>development.list() },
      { name:'deployments get', usage:'deployments get ID', run:args=>{if(args.length!==1)throw new Error('usage: deployments get ID');return development.get(args[0]);} },
      { name:'jobs list', usage:'jobs list [--scope desk|all]', run:args=>this.list(args) },
      { name:'jobs get', usage:'jobs get ID', run:args=>detail(this.id(args)) },
      { name:'reports list', usage:'reports list [--scope desk|all]', run:args=>this.list(args).filter(job=>job.hasReport) },
      { name:'reports get', usage:'reports get ID', run:args=>detail(this.id(args)) },
      { name:'jobs cancel', usage:'jobs cancel ID [--reason TEXT]', mutation:true, run:async args=>{
        const id=this.id(args, true); const rest=args.slice(1);
        if(rest.length && (rest.length!==2||rest[0]!=='--reason'))throw new Error('usage: jobs cancel ID [--reason TEXT]');
        await bridge.cancel(id,rest[1]);return this.confirm(id);
      } },
      { name:'reports approve', usage:'reports approve ID', mutation:true, run:async args=>{const id=this.id(args);await bridge.approve(id);return this.confirm(id);} },
      { name:'desk list', usage:'desk list', run:args=>{if(args.length)throw new Error('usage: desk list');return bridge.jobs.filter(isOnDesk).map(job=>this.summary(job));} },
      { name:'desk dismiss', usage:'desk dismiss ID', mutation:true, run:async args=>{const id=this.id(args);await bridge.dismiss(id);return this.confirm(id);} },
      { name:'history search', usage:'history search [--query TEXT]', run:args=>{
        if(args.length && (args.length!==2||args[0]!=='--query'))throw new Error('usage: history search [--query TEXT]');
        const query=(args[1]||'').toLocaleLowerCase();
        return bridge.jobs.filter(job=>JSON.stringify(job).toLocaleLowerCase().includes(query)).map(job=>this.summary(job));
      } },
      { name:'history get', usage:'history get ID', run:args=>detail(this.id(args)) },
    ];
  }
  id(args, extras=false) {
    if(!args[0]||(!extras&&args.length!==1))throw new Error('仕事IDを1つ指定してください。');
    this.bridge.jobById(args[0]);return args[0];
  }
  summary(job) {return {id:job.id,request:job.request,status:jobStatus(job),onDesk:isOnDesk(job),hasReport:hasReport(job),releaseState:job.releaseState,approvedAt:job.approvedAt,cancelledAt:job.cancelledAt,releasedAt:job.releasedAt,releaseError:job.releaseError};}
  describe(job) {return {...job,...this.summary(job),artifacts:(job.artifacts||[]).map(file=>({...file,url:`/api/jobs/${job.id}/artifact?path=${encodeURIComponent(file.path)}`}))};}
  list(args) {
    if(args.length && (args.length!==2||args[0]!=='--scope'||!['desk','all'].includes(args[1])))throw new Error('usage: jobs/reports list [--scope desk|all]');
    return this.bridge.jobs.filter(job=>args[1]==='all'||isOnDesk(job)).map(job=>this.summary(job));
  }
  resolve(argv) {
    if(!Array.isArray(argv)||!argv.length||argv.length>12||argv.some(arg=>typeof arg!=='string'||arg.length>(argv[0]==='requests'?20000:argv[0]==='notifications'?4000:2000)))throw new Error('argvは1〜12個の文字列で指定してください。');
    const command=this.commands.find(command=>argv.slice(0,command.name.split(' ').length).join(' ')===command.name);
    if(!command)throw new Error('未対応の操作です。helpでマニュアルと操作一覧を確認してください。');
    return {command,args:argv.slice(command.name.split(' ').length)};
  }
  async confirm(id) {
    const saved=JSON.parse(await readFile(resolve(this.bridge.dir,'state.json'),'utf8'));
    const job=saved.jobs.find(job=>job.id===id);
    const confirmed=isSettled(job);
    return {job:this.describe(job),verification:{confirmed,source:'persisted state.json',onDesk:isOnDesk(job),cleanup:job.cleanupVerification||null},ok:confirmed};
  }
  async execute(argv, issuer='cli') {
    const {command,args}=this.resolve(argv), operationId=randomUUID();
    let result;
    try {const value=await command.run(args);result={ok:value?.ok!==false,operation:command.name,result:value};}
    catch(error){result={ok:false,operation:command.name,error:error.message};}
    // Rejected URLs/JSON may contain a mistakenly pasted credential. Never audit raw notification settings.
    const auditArgv=command.name==='notifications configure'?['notifications','configure','[redacted]']:argv;
    if(command.mutation)await appendFile(resolve(this.bridge.dir,'operations.jsonl'),JSON.stringify({at:new Date().toISOString(),operationId,issuer,argv:auditArgv,result})+'\n',{mode:0o600});
    return {...result,operationId};
  }
}
