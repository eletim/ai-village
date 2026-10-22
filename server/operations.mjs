import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isOnDesk, isSettled, jobStatus } from '../src/job-state.js';

// The same registry serves the secretary, HTTP and the human CLI. Adding a village
// operation doesn't require adding a new LLM action or teaching a keyword router.
export class VillageOperations {
  constructor(bridge, notifier, {web, development} = {}) {
    this.bridge = bridge;
    const detail = id => this.describe(bridge.jobById(id));
    this.commands = [
      { name:'help', usage:'help', run:args=>{if(args.length)throw new Error('usage: help');return this.commands.map(({name,usage,mutation})=>({name,usage,mutation:!!mutation}));} },
      { name:'notifications status', usage:'notifications status', run:args=>{if(args.length)throw new Error('usage: notifications status');return notifier?.status() || {enabled:false,unavailable:true};} },
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
  summary(job) {return {id:job.id,request:job.request,status:jobStatus(job),onDesk:isOnDesk(job),hasReport:!!job.report,releaseState:job.releaseState,approvedAt:job.approvedAt,cancelledAt:job.cancelledAt,releasedAt:job.releasedAt,releaseError:job.releaseError};}
  describe(job) {return {...job,...this.summary(job),artifacts:(job.artifacts||[]).map(file=>({...file,url:`/api/jobs/${job.id}/artifact?path=${encodeURIComponent(file.path)}`}))};}
  list(args) {
    if(args.length && (args.length!==2||args[0]!=='--scope'||!['desk','all'].includes(args[1])))throw new Error('usage: jobs/reports list [--scope desk|all]');
    return this.bridge.jobs.filter(job=>args[1]==='all'||isOnDesk(job)).map(job=>this.summary(job));
  }
  resolve(argv) {
    if(!Array.isArray(argv)||!argv.length||argv.length>12||argv.some(arg=>typeof arg!=='string'||arg.length>2000))throw new Error('argvは1〜12個の文字列で指定してください。');
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
    if(command.mutation)await appendFile(resolve(this.bridge.dir,'operations.jsonl'),JSON.stringify({at:new Date().toISOString(),operationId,issuer,argv,result})+'\n',{mode:0o600});
    return {...result,operationId};
  }
}
