import {agentActions,actionUsage,conversationDisplayUsage,conversationDecisionUsage} from './agent-rules.mjs';
import {SECRETARY_COMMANDS_HELP} from './secretary-commands.mjs';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// The same registry serves the secretary, HTTP and the human CLI. Adding a village
// operation doesn't require adding a new LLM action or teaching a keyword router.
// `--run RUN` (or --run=RUN) may appear anywhere; the rest are the positional arguments.
function secretaryCommand(direct,action,args){
 let run,assignee;const rest=[];
 for(let i=0;i<args.length;i++){
  if(args[i]==='--run'){if(run!==undefined||i+1>=args.length)throw Error('--run RUN を1つ指定してください。');run=args[++i];}
  else if(args[i].startsWith('--run=')){if(run!==undefined)throw Error('--run RUN を1つ指定してください。');run=args[i].slice(6);}
  else if(args[i]==='--assignee'||args[i].startsWith('--assignee=')){
   if(action!=='order'||assignee!==undefined)throw Error('--assignee は新規orderで1つだけ指定してください。');
   assignee=args[i]==='--assignee'?args[++i]:args[i].slice(11);
   if(!assignee||assignee.startsWith('--'))throw Error('--assignee AGENT_ID を指定してください。');
  }
  else rest.push(args[i]);
 }
 if(run===undefined)throw Error('--run に発言の末尾の <village run="…"/> の値を指定してください。使い方: village help');
 const c=direct.secretaryCommands,text=value=>{if(typeof value!=='string'||!value.trim())throw Error('本文を指定してください。使い方: village help');return value;};
 const count=(...allowed)=>{if(!allowed.includes(rest.length))throw Error(action+' の引数の数が違います。使い方: village help');};
 if(action==='order'){count(1);return c.order(run,text(rest[0]),assignee);}
 if(action==='followup'){count(1,2);return rest.length===2?c.followup(run,rest[0],text(rest[1])):c.followup(run,undefined,text(rest[0]));}
 if(action==='accept'){count(1,2);return c.accept(run,text(rest.at(-1)),rest.length===2?rest[0]:undefined);}
 if(action==='ask'){count(1,2);return c.ask(run,text(rest.at(-1)),rest.length===2?rest[0]:undefined);}
 if(action==='withdraw'){count(2);return c.withdraw(run,rest[0],text(rest[1]));}
 count(0);return c.status(run);
}
export class VillageOperations {
  constructor({dir}, notifier, {web, images, todos, prs, direct, travelRegistry} = {}) {
    this.dir = dir;
    const secretaryUsage=SECRETARY_COMMANDS_HELP.split('\n');
    this.commands = [
      // Secretary operations first, so `help` shows them before the detailed registry.
      ...(direct?[['order',0,true],['followup',1,true],['accept',2,true],['ask',3,true],['withdraw',4,true],['status',5,false]].map(([action,line,mutation])=>({name:action,usage:secretaryUsage[line].replace(/^village /,'')+' '+secretaryUsage.at(-1),mutation,run:args=>secretaryCommand(direct,action,args)})):[]),
      ...(travelRegistry?[
        {name:'travel list',usage:'travel list (registered computers and folders; IDs and revision)',run:args=>{if(args.length)throw Error('引数は不要です');return travelRegistry.snapshot();}},
        {name:'travel update',usage:'travel update JSON {revision,entity:computer|folder,action:add|edit|delete,id?,computerId?,name?,sshHost?,cwd?,notes?}',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return travelRegistry.update(JSON.parse(args[0]));}}
      ]:[]),
      ...(direct?[{name:'rules get',usage:'rules get work|report [ACTION] (read-only contract or operation help)',run:args=>{let agentId;const at=args.indexOf('--agent');if(at>=0){if(at!==args.length-2)throw Error('--agent AGENT_ID');agentId=args[at+1];args=args.slice(0,at);}const rules=direct.rulesFor(agentId);if(args.length===2&&args[0]==='work')return rules.action(args[1]);if(args.length!==1)throw Error('rules get work|report [ACTION]');return rules.specification(args[0]);}},{name:'agents instructions',usage:'agents instructions AGENT_ID (read-only startup contract and migration diagnosis)',run:args=>{if(args.length!==1)throw Error('Agent ID required');return direct.instructionStatus(args[0]);}},{name:'agents list',usage:'agents list',run:args=>{if(args.length)throw new Error('usage: agents list');return direct.discovery();}}]:[]),
      ...(direct?[
        {name:'conversations get',usage:'conversations get CONVERSATION_ID [ACTOR_RUN_ID] (Agent: always pass current run; ordered turn view)',run:args=>{if(![1,2].includes(args.length))throw Error('CONVERSATION_ID [ACTOR_RUN_ID]');return direct.conversations.read(args[0],args[1]);}},
        {name:'conversations display',usage:conversationDisplayUsage,mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return direct.conversations.display(JSON.parse(args[0]));}},
        {name:'conversations read',usage:'conversations read CONVERSATION_ID ACTOR_RUN_ID JSON {kind:turn|purpose|delivery|relay,id}',run:args=>{if(args.length!==3)throw Error('CONVERSATION_ID ACTOR_RUN_ID JSON');return direct.conversations.material(args[0],args[1],JSON.parse(args[2]));}},
        {name:'conversations followup',usage:'conversations followup JSON {conversationId,actorRunId,operationId,purposeId,instruction} (same permission; atomically supplement/continue/reopen)',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return direct.conversations.followup(JSON.parse(args[0]));}},
        ...['relay','relayApply'].map(action=>({name:'conversations '+action,usage:action==='relay'?'conversations relay JSON {conversationId,actorRunId,operationId,authorization,evidenceDeliveryId,target,instruction} (saved recovery graph + subsequent human permission; exact target only)':'conversations relayApply JSON {conversationId,actorRunId,operationId,deliveryId} (exact received purpose only)',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return direct.conversations[action](JSON.parse(args[0]));}})),
        ...['job','amend','withdraw','decide'].map(action=>({name:'conversations '+action,usage:action==='decide'?conversationDecisionUsage:(action==='job'?'新規依頼の担当指定は assigneeAgentId（省略時Projectリーダー）。継続時は指定不可。 ':'')+'conversations '+action+' JSON {conversationId,actorRunId,operationId,instruction,authorization:{runId,quote},continue?:true,humanRequestId?,continuesRequestId?,deliveryId?,expectedPurposeVersion?,reason?,reopenRunId?}',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return direct.conversations[action](JSON.parse(args[0]));}})),
        {name:'projects leader',usage:'projects leader PROJECT_ID REVISION AGENT_ID|- (new jobs only)',mutation:true,run:args=>{if(args.length!==3)throw Error('PROJECT_ID REVISION AGENT_ID|-');return direct.putProject({revision:Number(args[1]),leaderAgentId:args[2]==='-'?null:args[2]},args[0]);}},
        {name:'workshops pattern',usage:'workshops pattern WORKSHOP_ID JSON_ARRAY_8_OR_NULL (none|line|diamond; top row left to right, then bottom)',mutation:true,run:args=>{if(args.length!==2)throw Error('工房IDと8セルのJSON配列を指定してください');return direct.putWorkshop({iconPattern:JSON.parse(args[1])},args[0]);}},
        {name:'agents create',usage:'agents create JSON({requestId,workshopId,cwd,name,provider,location,projectId?,launchProfile?:{version:1,provider:claude,model:full-ID,effort:low|medium|high|xhigh|max}})',mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定してください');return direct.create(JSON.parse(args[0]));}},
        ...['prepare-runtime','adopt-runtime'].map(action=>({name:'agents '+action,usage:'agents '+action+' AGENT_ID JSON '+(action==='prepare-runtime'?'{operationId,revision}':'{operationId,revision,replacementAgentId,replacementRevision,handover?,retireLegacyHistory?:{version:1,mode:"new-work-only",acknowledgement}}')+' (authorized session migration; preserves requests; requires idle and unused donor for adoption)',mutation:true,run:args=>{if(args.length!==2)throw Error('Agent IDとJSONを指定してください');return direct[action==='prepare-runtime'?'prepareRuntime':'adoptRuntime'](args[0],JSON.parse(args[1]));}})),
        {name:'agents handover-plan',usage:'agents handover-plan SOURCE TARGET',run:args=>{if(args.length!==2)throw Error('SOURCE TARGET');return direct.secretaryHandoverPlan(...args);}},
        {name:'agents handover',usage:'agents handover SOURCE JSON {operationId,planHash,targetAgentId,actorRunId,reason} (authorized same-project leader; stopped source only; preserves unknowns, never retries)',mutation:true,run:args=>{if(args.length!==2)throw Error('SOURCE JSON');return direct.handoverSecretary(args[0],JSON.parse(args[1]));}},
        {name:'agents delete',usage:'agents delete AGENT_ID JSON {operationId,revision} (idle/terminated only; rejects unfinished requests; preserves history; retry same operation on partial result)',mutation:true,run:args=>{if(args.length!==2)throw Error('Agent IDとJSONを指定してください');return direct.deleteAgent(args[0],JSON.parse(args[1]));}},
        {name:'agents stop',usage:'agents stop AGENT_ID',mutation:true,run:args=>{if(args.length!==1)throw Error('Agent IDを指定してください');return direct.stop(args[0]);}},
        {name:'agents rename',usage:'agents rename AGENT_ID REVISION NAME',mutation:true,run:args=>{if(args.length!==3)throw Error('ID REVISION NAMEを指定してください');return direct.updateAgent(args[0],{revision:Number(args[1]),name:args[2]});}},
        {name:'agents project',usage:'agents project AGENT_ID REVISION PROJECT_ID|-',mutation:true,run:args=>{if(args.length!==3)throw Error('ID REVISION PROJECT_IDを指定してください');return direct.updateAgent(args[0],{revision:Number(args[1]),projectId:args[2]==='-'?null:args[2]});}},
        {name:'projects guide',usage:'projects guide PROJECT_ID [secretary] (latest policy; secretary view preserves custom constraints)',run:args=>{if(![1,2].includes(args.length))throw Error('PROJECT_ID [secretary]を指定してください');return direct.projectGuides.get(args[0],args[1]);}},
        ...['projects','agents'].map(kind=>({name:kind+' order',usage:kind+' order ID REVISION INTEGER|null (ascending; unset last; agents: within project)',mutation:true,run:args=>{if(args.length!==3)throw Error('ID REVISION INTEGER|nullを指定してください');const displayOrder=JSON.parse(args[2]),patch={revision:Number(args[1]),displayOrder};return kind==='projects'?direct.putProject(patch,args[0]):direct.updateAgent(args[0],patch);}})),
        {name:'projects list',usage:'projects list',run:args=>{if(args.length)throw Error('引数は不要です');return direct.discovery().projects;}},
        {name:'projects create',usage:'projects create REQUEST_ID NAME',mutation:true,run:args=>{if(args.length!==2)throw Error('REQUEST_ID NAMEを指定してください');return direct.putProject({requestId:args[0],name:args[1]});}},
        ...['suspend','resume'].map(operation=>({name:'projects '+operation,usage:'projects '+operation+' PROJECT_ID REVISION (display only; Agents, requests and notifications keep running)',mutation:true,run:args=>{if(args.length!==2)throw Error('ID REVISIONを指定してください');return direct.putProject({revision:Number(args[1]),suspended:operation==='suspend'},args[0]);}})),
        {name:'projects delete-plan',usage:'projects delete-plan PROJECT_ID (confirm project, revision and all member Agents; running Agents will stop)',run:args=>{if(args.length!==1)throw Error('PROJECT_IDを指定');return direct.projectDeletePlan(args[0]);}},
        {name:'projects delete',usage:'projects delete PROJECT_ID JSON {operationId,revision,members:[{id,revision}]} (stop/delete ALL members; retry same payload on partial status)',mutation:true,run:args=>{if(args.length!==2)throw Error('PROJECT_ID JSONを指定');return direct.deleteProject(args[0],JSON.parse(args[1]));}},
        {name:'projects rename',usage:'projects rename PROJECT_ID REVISION NAME',mutation:true,run:args=>{if(args.length!==3)throw Error('ID REVISION NAMEを指定してください');return direct.putProject({revision:Number(args[1]),name:args[2]},args[0]);}},
      ]:[]),
      ...(direct?[
        {name:'reports status',usage:'reports status (village-wide; applies to new requests only)',run:args=>{if(args.length)throw Error('引数は不要です');return direct.flow.reportStatus();}},
        {name:'reports configure',usage:'reports configure true|false (default OFF; saved settings preserved; no replay of existing requests)',mutation:true,run:args=>{if(args.length!==1)throw Error('true/falseを指定してください');return direct.flow.configureReport(JSON.parse(args[0]));}},
        {name:'requests list',usage:'requests list [AGENT_ID]',run:args=>{if(args.length>1)throw Error('Agent IDは1つまで');return direct.flow.list(args[0]);}},
        {name:'requests get',usage:'requests get HUMAN_REQUEST_ID',run:args=>{if(args.length!==1)throw Error('依頼IDを指定');return direct.flow.get(args[0]);}},
        {name:'requests results',usage:'requests results HUMAN_REQUEST_ID WORK_ID',run:args=>{if(args.length!==2)throw Error('依頼IDと作業IDを指定');return direct.flow.results(...args);}},
        {name:'requests inputs',usage:'requests inputs HUMAN_REQUEST_ID WORK_ID',run:args=>{if(args.length!==2)throw Error('依頼IDと作業IDを指定');return direct.flow.inputs(...args);}},
        ...Object.keys(agentActions).map(action=>({name:'requests '+action,usage:actionUsage(action),mutation:true,run:args=>{if(args.length!==1)throw Error('JSONを1つ指定');return direct.flow[action](JSON.parse(args[0]));}})),
      ]:[]),
      ...(prs?.commands() || []),
      { name:'todos list', usage:'todos list', run:args=>{if(args.length)throw new Error('usage: todos list');return todos.snapshot();} },
      ...['add','edit','toggle','delete'].map(action=>({name:`todos ${action}`,usage:`todos ${action} REVISION ${action==='add'?'TEXT':action==='edit'?'ID TEXT':action==='toggle'?'ID true|false':'ID'}`,mutation:true,run:args=>{
        const count=action==='edit'||action==='toggle'?3:2;
        if(args.length!==count||! /^(0|[1-9][0-9]*)$/.test(args[0]))throw new Error('TODOのrevisionと引数を確認してください');
        if(action==='toggle'&&!['true','false'].includes(args[2]))throw new Error('完了状態はtrue/falseです');
        return todos.update({action,revision:Number(args[0]),id:action==='add'?undefined:args[1],text:action==='add'?args[1]:args[2],done:args[2]==='true'});
      }})),
      { name:'images help',usage:'images help (read-only: upload and show images in replies)',run:()=>({text:'画像は images upload LOCAL_FILE（PNG/JPEG/WebP）で実行PC上のファイルを登録し、返された ![説明](village-image:UUID) を返信本文にそのまま記載します。複数枚は参照を並べます。images list で登録済み画像を確認できます。内部ファイルパスや外部画像URLでは表示されません。許可された画像だけを使用してください。途中発言と確定回答で同じ参照を使用できます。'}) },
      { name:'images upload',usage:'node scripts/village.mjs images upload LOCAL_FILE (PNG/JPEG/WebP; reply with returned ![description](village-image:UUID); see images help)',run:()=>{throw Error('images uploadは呼び出し元のscripts/village.mjsで実行してください。HTTPはPOST /api/imagesへ画像本体を送信します。サーバーパスは受け付けません。');} },
      { name:'images list', usage:'images list', run:args=>{if(args.length)throw new Error('usage: images list');return images.list();} },
      { name:'help', usage:'help', run:args=>{if(args.length)throw new Error('usage: help');return this.commands.filter(c=>!c.hidden).map(({name,usage,mutation})=>({name,usage,mutation:!!mutation}));} },
      { name:'notifications status', usage:'notifications status', run:args=>{if(args.length)throw new Error('usage: notifications status');return notifier?.status() || {enabled:false,unavailable:true};} },
      { name:'notifications configure',usage:'notifications configure true|false|JSON {enabled?,server?,topic?,resetDestination?}',mutation:true,run:args=>{if(args.length!==1)throw Error('usage: notifications configure true|false|JSON');if(!notifier)throw Error('通知処理がありません。');let input;try{input=JSON.parse(args[0]);}catch{throw Error('通知設定はtrue/falseまたはJSONで指定してください');}return notifier.configure(input);} },
      { name:'notifications test', usage:'notifications test', mutation:true, run:async args=>{if(args.length)throw new Error('usage: notifications test');if(!notifier)throw new Error('通知処理がありません。');const result=await notifier.test();return {...result,ok:result.delivered};} },
      { name:'web read', usage:'web read URL', run:async args=>{if(args.length!==1)throw new Error('usage: web read URL');return web.read(args[0]);} },
    ];
  }
  resolve(argv) {
    if(!Array.isArray(argv)||!argv.length||argv.length>12||argv.some(arg=>typeof arg!=='string'||arg.length>(argv[0]==='agents'&&argv[1]==='adopt-runtime'?40000:argv[0]==='conversations'&&['relay','relayApply'].includes(argv[1])?20000:['requests','order','followup','accept','ask','withdraw'].includes(argv[0])?20000:argv[0]==='notifications'?4000:2000)))throw new Error('argvは1〜12個の文字列で指定してください。');
    const command=this.commands.find(command=>argv.slice(0,command.name.split(' ').length).join(' ')===command.name);
    if(!command)throw new Error('未対応の操作です。helpでマニュアルと操作一覧を確認してください。');
    return {command,args:argv.slice(command.name.split(' ').length)};
  }
  async execute(argv, issuer='cli') {
    const {command,args}=this.resolve(argv), operationId=randomUUID();
    let result;
    try {const value=await command.run(args);result={ok:value?.ok!==false,operation:command.name,result:value};}
    catch(error){result={ok:false,operation:command.name,error:error.message};}
    // Rejected URLs/JSON may contain a mistakenly pasted credential. Never audit raw notification settings.
    const auditArgv=command.name==='notifications configure'?['notifications','configure','[redacted]']:argv;
    if(command.mutation)await appendFile(resolve(this.dir,'operations.jsonl'),JSON.stringify({at:new Date().toISOString(),operationId,issuer,argv:auditArgv,result})+'\n',{mode:0o600});
    return {...result,operationId};
  }
}
