import {runtimeScript,inputHash,correlate} from './runtime-events.mjs';
import { run } from './bridge.mjs';
import { captureProcessesScript, stopProcessesScript } from './processes.mjs';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, realpath, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fail = (message, status=409) => { throw Object.assign(new Error(message), {status}); };
const now = () => new Date().toISOString();
const ready = s => ['idle','ready-for-review'].includes(s.cliState);
const active = r => ['sending','running','send_unknown','unknown','waiting_input'].includes(r.state);
const blocking = r => active(r)&&r.blocksInput!==false;


// Human and future secretary callers share this service. No model-generated
// instruction, approval, or report is required. One server owns a state directory.
export class DirectAgents {
  constructor({dir, remote, notifier, localRun=run, localBin=process.env.VILLAGE_PMUX_BIN || 'purplemux', pollMs=2000}) {
    Object.assign(this,{dir,remote,notifier,localRun,localBin,pollMs});
    this.data={version:1,workshops:[],agents:[],runs:[]};
    this.queue=Promise.resolve(); this.locks=new Map(); this.monitors=new Map();
  }
  async init({watch=true}={}) {
    await mkdir(this.dir,{recursive:true});
    this.dir=await realpath(this.dir);
    if(watch){
      // Linux abstract sockets are released by the kernel even after SIGKILL.
      // A second backend must not concurrently claim the same saved mutations.
      this.owner=createServer();
      await new Promise((ok,no)=>{this.owner.once('error',no);this.owner.listen('\0ai-village-direct-'+createHash('sha256').update(resolve(this.dir)).digest('hex'),ok);});
    }
    try { this.data=JSON.parse(await readFile(resolve(this.dir,'direct.json'),'utf8')); }
    catch(e) { if(e.code!=='ENOENT')throw e; }
    for(const w of this.data.workshops)w.connectionType ||= 'ssh';
    for(const a of this.data.agents) {
      a.connection.connectionType ||= 'ssh';
      a.canSend=false;a.sendReason='再接続して稼働状態を確認しています';
      if(a.state!=='terminated'){a.connectionState='unknown';a.activityState='unknown';}
      if(a.state==='creating')a.state='creation_unknown';
      if(a.state==='stopping')a.state='stop_unknown';
    }
    for(const r of this.data.runs)if(r.state==='sending')r.state='send_unknown';
    await this.save();
    if(watch){this.timer=setInterval(()=>this.tick().catch(()=>{}),this.pollMs);this.timer.unref();void this.tick();}
  }
  close(){clearInterval(this.timer);this.owner?.close();}
  snapshot(){return structuredClone({...this.data,notification:this.notifier.status()});}
  async save(){
    const value=JSON.stringify(this.data,null,2);
    const task=this.queue.catch(()=>{}).then(async()=>{
      const file=await open(resolve(this.dir,'direct.tmp'),'w',0o600);
      try{await file.writeFile(value);await file.sync();}finally{await file.close();}
      await rename(resolve(this.dir,'direct.tmp'),resolve(this.dir,'direct.json'));
      const directory=await open(this.dir,'r');try{await directory.sync();}finally{await directory.close();}
    });this.queue=task;await task;
  }
  async locked(id,fn){
    const previous=this.locks.get(id)||Promise.resolve();
    const task=previous.catch(()=>{}).then(fn);this.locks.set(id,task);
    try{return await task;}finally{if(this.locks.get(id)===task)this.locks.delete(id);}
  }
  workshop(input,id){
    const {name,baseUrl,workplaces,connectionType='ssh'}=input;
    if(!['ssh','local'].includes(connectionType))fail('接続方式はSSHまたはローカルを選んでください',400);
    const sshHost=connectionType==='local'?null:input.sshHost;
    if(typeof name!=='string'||!name.trim()||name.length>120||(connectionType==='ssh'&&(typeof sshHost!=='string'||! /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,200}$/.test(sshHost))))fail('名前とSSH接続先を確認してください',400);
    let url;try{url=new URL(baseUrl);}catch{fail('PurpleMux URLが不正です',400);}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('HTTP(S) URLを指定してください',400);
    if(!Array.isArray(workplaces)||!workplaces.length||workplaces.length>30||workplaces.some(p=>typeof p!=='string'||!p.startsWith('/')||p.length>1000||/[\r\n\0]/.test(p)))fail('作業場所を絶対パスで指定してください',400);
    return {id:id||randomUUID(),name:name.trim(),connectionType,sshHost,baseUrl:url.href,workplaces:[...new Set(workplaces)],updatedAt:now()};
  }
  async putWorkshop(input,id){
    const w=this.workshop(input,id);const i=this.data.workshops.findIndex(x=>x.id===id);
    if(id&&i<0)fail('工房がありません',404);
    if(i<0)this.data.workshops.push(w);else this.data.workshops[i]=w;
    await this.save();return w;
  }
  agent(id){return this.data.agents.find(a=>a.id===id)||fail('Agentがありません',404);}
  async execute(a,args){
    const type=a.connection.connectionType || 'ssh';
    if(type==='ssh')return this.remote(args,a.connection.sshHost,a.id);
    if(type!=='local')fail('保存された接続方式が不正です');
    // Local commands use argv directly, never SSH or interpolated shell text.
    // Audit identities/operation only: instructions and credentials stay out.
    await appendFile(resolve(this.dir,'local-audit.jsonl'),JSON.stringify({at:now(),agentId:a.id,command:args[0],operation:args[0]==='purplemux'?args.slice(1,3):[]})+'\n',{mode:0o600});
    return this.localRun(args[0]==='purplemux'?this.localBin:args[0],args.slice(1));
  }
  async pmux(a,...args){return JSON.parse(await this.execute(a,['purplemux',...args]));}
  async runtime(a,status){return JSON.parse(await this.execute(a,['python3','-c',runtimeScript,a.provider||'codex',status.agentSessionId||'']));}
  async create(input){return this.locked('create:'+input.requestId,()=>this.createOnce(input));}
  async createOnce({workshopId,cwd,name='Agent',requestId,provider='codex',location='workshop'}){
    if(typeof requestId!=='string'||! /^[\w-]{8,100}$/.test(requestId))fail('requestIdが必要です',400);
    const old=this.data.agents.find(a=>a.requestId===requestId);if(old){if(old.workshopId!==workshopId||old.cwd!==cwd||old.name!==name||(old.provider||'codex')!==provider||(old.location||'workshop')!==location)fail('requestIdの再利用です');return old;}
    if(!['codex','claude'].includes(provider)||!['mayor','workshop'].includes(location))fail('Agent種類または場所が不正です',400);
    const w=this.data.workshops.find(w=>w.id===workshopId);if(!w||!w.workplaces.includes(cwd))fail('工房と登録済み作業場所を選んでください',400);
    if(location==='mayor'&&w.connectionType!=='local')fail('秘書はローカル工房の実行環境を選んでください',400);
    if(typeof name!=='string'||!name.trim()||name.length>120)fail('Agent名が不正です',400);
    const a={id:randomUUID(),requestId,workshopId,connection:structuredClone(w),cwd,name,provider,location,state:'creating',lifecycle:'starting',activityState:'unknown',connectionState:'unknown',canSend:false,createdAt:now()};
    this.data.agents.push(a);await this.save();
    return this.locked(a.id,async()=>{
      try{
        // Every non-idempotent mutation is preceded by a durable intent. Never retry.
        const ws=await this.pmux(a,'workspace','create','--cwd',cwd,'--name',`AI村 direct ${a.id}`);
        if(!ws.id||!ws.initialTab?.tabId)throw Error('workspace応答の識別情報が不足しています');
        Object.assign(a,{workspaceId:ws.id,initialTabId:ws.initialTab.tabId});await this.save();
        const tab=await this.pmux(a,'tab','create','-w',a.workspaceId,'-n',name,'-t',provider==='claude'?'claude-code':'codex-cli');
        if(!tab.tabId||!tab.sessionName)throw Error('tab応答の識別情報が不足しています');
        const url=new URL(w.baseUrl);url.searchParams.set('workspace',ws.id);url.searchParams.set('tab',tab.tabId);
        Object.assign(a,{tabId:tab.tabId,sessionName:tab.sessionName,terminalUrl:url.href,state:'starting'});
      }catch{a.state='creation_unknown';a.error='起動結果不明。自動再試行しません。PurpleMuxで確認してください。';}
      await this.save();return a;
    });
  }
  async send(id,{instruction,requestId}){
    if(typeof instruction!=='string'||!instruction.trim()||instruction.length>16000||typeof requestId!=='string'||! /^[\w-]{8,100}$/.test(requestId))fail('指示とrequestIdを確認してください',400);
    const old=this.data.runs.find(r=>r.requestId===requestId);if(old){if(old.agentId!==id||old.instruction!==instruction)fail('requestIdの再利用です');return old;}
    return this.locked('request:'+requestId,()=>this.locked(id,async()=>{
      const duplicate=this.data.runs.find(r=>r.requestId===requestId);
      if(duplicate){if(duplicate.agentId!==id||duplicate.instruction!==instruction)fail('requestIdの再利用です');return duplicate;}
      const a=this.agent(id);
      if(!a.tabId||['terminated','stopping','stop_unknown'].includes(a.state))fail('Agentは送信可能ではありません');
      const baseline=await this.observe(a);
      if(!a.canSend)fail(a.sendReason||'Agentの待機状態を確認できません');
      const status=a.runtime;
      const r={id:randomUUID(),requestId,agentId:id,instruction,state:'sending',blocksInput:true,dispatchConfirmed:false,baselineRuntime:{sessionId:baseline.sessionId,cursor:baseline.cursor,fileIdentity:baseline.fileIdentity},inputHash:inputHash(instruction),agentSessionId:status.agentSessionId||null,createdAt:now(),achievement:'unverified'};
      this.data.runs.push(r);await this.save();
      try{await this.pmux(a,'tab','send','-w',a.workspaceId,a.tabId,instruction);r.dispatchConfirmed=true;r.state='running';}
      catch{r.state='send_unknown';r.error='送信結果不明。重複防止のため再送していません。';}
      a.state='busy';a.activityState='busy';a.canSend=false;a.sendReason='指示の受付を確認しています';await this.save();return r;
    }));
  }
  async notify(r){
    if(r.state!=='completed'||r.notification)return;
    r.notification=await this.notifier.enqueue({id:`direct:${r.id}`,role:'assistant',kind:'direct',agentId:r.agentId,content:`${this.agent(r.agentId).name} の応答が完了しました。達成状況は未判定です。\n${r.output}`});await this.save();
  }
  updateAvailability(a){
    const blocked=this.data.runs.some(r=>r.agentId===a.id&&blocking(r));
    a.canSend=a.lifecycle==='alive'&&a.connectionState==='connected'&&a.activityState==='idle'&&!blocked;
    a.sendReason=a.canSend?null:a.connectionState!=='connected'?'接続・稼働状態を確認できません':a.lifecycle!=='alive'?'Agentが稼働していません':a.activityState==='waiting_input'?'PurpleMuxで入力・許可を確認してください':blocked?'前の指示の受付・実行状態を確認中です':a.activityState==='busy'?'Agentが実行中です':'待機状態を確認できません';
  }
  async observe(a){
    try{
      const s=await this.pmux(a,'tab','status','-w',a.workspaceId,a.tabId);
      const snapshot=await this.runtime(a,s);
      a.connectionState='connected';a.error=null;a.lastCheckedAt=now();a.runtime=s;
      a.lifecycle=!s.alive||s.cliState==='inactive'?'unavailable':!s.cliState||s.cliState==='unknown'?'unknown':'alive';a.setupRequired=false;
      if(s.alive&&!s.agentSessionId){
        const capture=await this.pmux(a,'tab','capture','-w',a.workspaceId,a.tabId);
        a.setupRequired=/Do you trust|trust this|trust the contents/i.test(capture.content||'');
      }
      const latest=snapshot.turns.at(-1);
      a.activityState=s.permissionRequest||a.setupRequired||['needs-input','waiting-for-input','waiting-for-permission'].includes(s.cliState)?'waiting_input':latest?.state==='running'?'busy':ready(s)?'idle':s.cliState==='busy'?'busy':'unknown';
      if(!snapshot.available||(a.observedSessionId&&!snapshot.sessionId))a.activityState='unknown';
      if(a.setupRequired)a.error='作業場所の信頼確認が必要です。PurpleMuxで確認してください。';
      a.currentAction=a.activityState==='busy'&&s.currentAction?.toolName?s.currentAction.toolName+': '+(s.currentAction.summary||''):null;
      a.nativeTurns=snapshot.available?snapshot.turns.map(t=>({...t,instruction:snapshot.inputs.filter(i=>i.turnId===t.id).map(i=>i.text).join('\n')})):a.nativeTurns||[];
      if(snapshot.sessionId)a.observedSessionId=snapshot.sessionId;
      for(const r of this.data.runs.filter(r=>r.agentId===a.id&&active(r))){
        const observation=correlate(r,snapshot);
        if(observation.turnId){r.turnId=observation.turnId;r.sessionId=observation.sessionId;r.inputId ||= observation.inputId;if(typeof observation.output==='string')r.output=observation.output;}
        if(['completed','interrupted','failed'].includes(observation.state)){
          Object.assign(r,{state:observation.state,output:observation.output,completedAt:observation.completedAt||now(),completionEvent:observation.completionEvent,error:observation.error||null,blocksInput:false});
        }else{
          r.state=a.activityState==='waiting_input'?'waiting_input':observation.state==='running'&&s.alive?'running':'unknown';r.error=observation.reason||null;
          // Preserve uncertain attribution, but a later native terminal boundary plus
          // an idle live CLI can release the input gate. Never resend or infer success.
          const checkpoint=r.baselineRuntime;
          const sameStream=checkpoint&&(!checkpoint.sessionId||checkpoint.sessionId===snapshot.sessionId)&&(!checkpoint.fileIdentity||checkpoint.fileIdentity===snapshot.fileIdentity);
          const oldSession=r.sessionId||r.agentSessionId||checkpoint?.sessionId;
          const boundary=latest&&['completed','interrupted','failed'].includes(latest.state)&&(
            (sameStream&&snapshot.inputs.some(i=>i.offset>checkpoint.cursor&&i.turnId===latest.id))||
            (oldSession&&snapshot.sessionId&&oldSession!==snapshot.sessionId));
          if(r.state==='unknown'&&a.activityState==='idle'&&boundary&&snapshot.available){r.blocksInput=false;r.inputReleasedAt ||= now();}
        }
      }
      a.state=a.lifecycle==='alive'?a.activityState:a.lifecycle==='unknown'?'unknown':'unavailable';
      this.updateAvailability(a);await this.save();return snapshot;
    }catch{
      a.connectionState='unknown';a.lifecycle='unknown';a.activityState='unknown';a.state='unknown';a.error='接続・状態取得ができません。監視を継続します。';this.updateAvailability(a);await this.save();return {available:false,turns:[],inputs:[]};
    }
  }
  async poll(a){
    if(this.locks.has(a.id)||!a.tabId||['terminated','stopping','stop_unknown'].includes(a.state))return;
    await this.locked(a.id,()=>this.observe(a));
  }
  async tick(){
    // A disconnected workshop must not delay completion delivery for another.
    await Promise.allSettled(this.data.agents.map(a=>{
      if(this.monitors.has(a.id))return this.monitors.get(a.id);
      const task=(async()=>{await this.poll(a);for(const r of this.data.runs)if(r.agentId===a.id)await this.notify(r);})();
      this.monitors.set(a.id,task);
      const clear=()=>this.monitors.delete(a.id);task.then(clear,clear);
      return task;
    }));
  }
  async stop(id){return this.locked(id,async()=>{
    const a=this.agent(id);if(a.state==='terminated')return a;
    if(!a.tabId)fail('tab識別情報がないため、PurpleMuxで確認してください');
    const {tabs}=await this.pmux(a,'tab','list','-w',a.workspaceId);
    const target=tabs.find(t=>t.tabId===a.tabId);
    if(target&&target.sessionName!==a.sessionName)fail('tabの識別情報が一致しません');
    a.state='stopping';a.lifecycle='stopping';a.canSend=false;await this.save();
    try{
      if(target&&!a.ownedProcesses){a.ownedProcesses=JSON.parse(await this.execute(a,['python3','-c',captureProcessesScript,a.sessionName]));await this.save();}
      if(target)await this.execute(a,['purplemux','tab','close','-w',a.workspaceId,a.tabId]);
      const remaining=await this.pmux(a,'tab','list','-w',a.workspaceId);
      if(remaining.tabs.some(t=>t.tabId===a.tabId))throw Error('tab remains');
      if(a.ownedProcesses)a.processVerification=JSON.parse(await this.execute(a,['python3','-c',stopProcessesScript,JSON.stringify(a.ownedProcesses),a.cwd,'[]','--owned-only']));
      a.state='terminated';a.lifecycle='terminated';a.activityState='unknown';a.canSend=false;a.error=null;a.terminatedAt=now();
      for(const r of this.data.runs)if(r.agentId===id&&active(r)){r.blocksInput=false;r.agentTerminatedAt=a.terminatedAt;if(!['unknown','send_unknown'].includes(r.state))r.state='terminated';}
    }catch{a.state='stop_unknown';a.lifecycle='unknown';a.canSend=false;a.error='終了結果不明。再度終了を選ぶと対象tabの存在を照合します。';}
    await this.save();return a;
  });}
}
