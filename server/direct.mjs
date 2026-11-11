import {PersistenceBoundary,checkpoint} from './persistence-boundary.mjs';
import {migrateMarkerStore} from './marker-migration.mjs';
import {AgentRules} from './agent-rules.mjs';
import {migrateCanonicalStore} from './canonical-migration.mjs';
import {requestStatus} from './request-lifecycle.mjs';
import {agentControls,bindAgent,agentChange,runtimeObservation,projectControls} from './agent-lifecycle.mjs';
import {migrateAgentStore} from './agent-migration.mjs';
import {changeRun,observeRun,tracking,modelOf,runState} from './run-lifecycle.mjs';
import {migrateRequestStore} from './request-migration.mjs';
import {migrateRunStore} from './run-migration.mjs';
import {runMarker,markerContext,installInstructionsScript,verifyInstructionsScript} from './input-envelope.mjs';
import {sessionModel} from './session-model.mjs';
import {DirectStore,writeSnapshot} from './direct-store.mjs';
import {ProjectGuides} from './project-guides.mjs';
import {humanProjection} from './report-view.mjs';
import {validWorkshopPattern} from '../src/workshop-pattern.js';
import {deletionPlan,deleteProject} from './project-deletion.mjs';
import {stageAttachment} from './attachment-transfer.mjs';
import {RequestFlow} from './requests.mjs';
import {completedEntries} from '../src/completions.js';
import {agentIdentity,agentPlaceName} from '../src/agent-identity.js';
import {RuntimeReader} from './runtime-reader.mjs';
import {inputMatches,resolveInputPosition,correlate,terminalBoundary,outputBetween} from './runtime-events.mjs';
import { run } from './execution.mjs';
import { captureProcessesScript, stopProcessesScript } from './processes.mjs';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fail = (message, status=409) => { throw Object.assign(new Error(message), {status}); };
const now = () => new Date().toISOString();
const ready = s => ['idle','ready-for-review'].includes(s.cliState);
const active = tracking;
const blocking = active;
// A run whose native correlation stays unresolved must not block an agent forever.
// canSend still requires a freshly observed idle CLI, so releasing the stale block
// here never races a turn that native polling still reports as busy.
const STUCK_RUN_TIMEOUT_MS = 10*60*1000;


// Human and future secretary callers share this service. No model-generated
// instruction, approval, or report is required. One server owns a state directory.
export class DirectAgents {
  constructor({dir, remote, notifier, attachments, transferAttachment=stageAttachment, localRun=run, localBin=process.env.VILLAGE_PMUX_BIN || 'purplemux', pollMs=2000, villageUrl='http://127.0.0.1:5173'}) {
    Object.assign(this,{dir,remote,notifier,attachments,transferAttachment,localRun,localBin,pollMs,villageUrl});
    this.data={version:1,workshops:[],projects:[],agents:[],runs:[]};
    this.projectGuides=new ProjectGuides();
    this.flow=new RequestFlow(this);
    this.persistence=new PersistenceBoundary();
    this.queue=Promise.resolve(); this.locks=new Map(); this.monitors=new Map();
    this.store=new DirectStore({capture:()=>this.data,write:value=>writeSnapshot(this.dir,value)});
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
    this.data=await migrateRunStore(this.dir,this.data);
    this.data=await migrateRequestStore(this.dir,this.data);
    this.data=await migrateAgentStore(this.dir,this.data);
    this.data=await migrateCanonicalStore(this.dir,this.data);
    this.data=await migrateMarkerStore(this.dir,this.data);
    this.data.projects ||= [];
    for(const p of this.data.projects)if(p.deletion?.status==='running'){p.deletion.status='partial';p.deletion.interruptedAt=now();}
    for(const w of this.data.workshops)w.connectionType ||= 'ssh';
    for(const a of this.data.agents) {
      a.connection.connectionType ||= 'ssh';
      a.inputEnvelope ||= {mode:'legacy'};
      if(a.inputEnvelope.mode==='startup-v1'&&a.inputEnvelope.hash&&a.inputEnvelope.hash!==createHash('sha256').update(this.startupInstructions()).digest('hex'))a.inputEnvelope={...a.inputEnvelope,mode:'legacy',reason:'request-rules-updated'};
      a.modelInfo={available:false};
      bindAgent(a);delete a.steerTarget;
      // A removed tab identity cannot be reused; otherwise live observations expire on restart.
      if(!(a.agentModel.intent==='stop'&&a.processVerification?.remainingOwned===0&&a.terminatedAt))a.agentModel={...a.agentModel,observation:null};

    }
    this.flow.init();
    await this.save();
    if(watch){this.timer=setInterval(()=>this.tick().catch(()=>{}),this.pollMs);this.timer.unref();void this.tick();}
  }
  close(){clearInterval(this.timer);this.owner?.close();}
  snapshot(){return structuredClone({...humanProjection(this.data),projects:this.data.projects.filter(p=>!p.deletedAt),capabilities:{steering:true,travelContexts:true,attachments:!!this.attachments},reviews:this.reviewStates(),notification:this.notifier.status()});}
  reviewStates(){
    const keys=new Map(this.data.agents.map(a=>[a.id,[]]));
    for(const entry of completedEntries(humanProjection(this.data)))keys.get(entry.agentId)?.push(entry.key);
    const finalRequests=(this.data.requests||[]).filter(q=>requestStatus(q)==='completed');
    for(const q of finalRequests)keys.get(q.finalAgentId)?.push('request:'+q.id+':'+q.finalRunId);
    const legacy=new Set(this.data.reviewedCompletions||[]);
    return Object.fromEntries([...keys].map(([id,entries])=>{
      const revision=createHash('sha256').update(JSON.stringify(entries.sort())).digest('hex');
      const reviewed=this.data.agentReviews?.[id]===revision||(!this.data.agentReviews?.[id]&&entries.every(k=>legacy.has(k)));
      const attention=finalRequests.filter(q=>q.finalAgentId===id&&!q.reviewedAt).map(q=>q.id);
      return [id,{revision,hasCompleted:entries.length>0,unreviewed:entries.length>0&&!reviewed,attention:attention.length>0,attentionRequestIds:attention}];
    }));
  }
  async viewAgent(id,{revision}){return this.locked(id,()=>this.persist(async()=>{
    this.agent(id);
    if(typeof revision!=='string'||! /^[a-f0-9]{64}$/.test(revision))fail('表示したAgentのrevisionが必要です',400);
    const current=this.reviewStates()[id];
    if(revision!==current.revision)fail('新しい応答があります。表示を更新してください');
    if(!current.unreviewed&&!current.attention)return current;
    this.data.agentReviews ||= {};
    const requests=(this.data.requests||[]).filter(q=>current.attentionRequestIds.includes(q.id));
    for(const q of requests)q.reviewedAt=now();
    this.data.agentReviews[id]=revision;
    await this.save();
    return {...current,unreviewed:false,attention:false,attentionRequestIds:[]};
  }));}
  discovery(){return {agents:this.data.agents.filter(a=>!a.deletedAt).map(a=>({...agentIdentity(a),projectId:a.projectId||null,projectName:this.data.projects.find(p=>p.id===a.projectId)?.name||null,metadataRevision:a.metadataRevision||0})),projects:structuredClone(this.data.projects.filter(p=>!p.deletedAt)),workshops:structuredClone(this.data.workshops),management:{workshopPattern:'PUT /api/direct/workshops/:id {iconPattern:[none|line|diamond x8]}; null resets to stable default; omitted fields preserved',help:'node scripts/village.mjs help',agentUpdate:'PUT /api/direct/agents/:id {revision,name?,projectId?}',projects:'POST /api/direct/projects {requestId,name}; PUT /api/direct/projects/:id {revision,name?,pinned?:boolean,suspended?:boolean (display only)}',projectDelete:'GET /api/direct/projects/:id/delete-plan; POST /api/direct/projects/:id/delete {operationId,revision,members}; deletes all member Agents, retry same operation on partial result',namePolicy:'村の表示名のみ変更。PurpleMuxのラベル、ID、セッション、接続先は維持。',requests:{help:'node scripts/village.mjs help',list:'GET /api/direct/requests',get:'POST /api/direct/requests/get {humanRequestId}',operations:'delegate / results / finish: POST /api/direct/requests/:operation',policy:'人間の依頼ごとに通知権1枚。正式delegateで親子を登録し、委任なしはnative正常終了、委任ありは子結果を確認後のfinishとnative正常終了で全体完了。生PurpleMux送信・旧runを自動関連付けしない。'}}};}
  project(id){return this.data.projects.find(p=>p.id===id)||fail('Projectがありません',404);}
  projectDeletePlan(id){return deletionPlan(this,id);}
  deleteProject(id,input){return deleteProject(this,id,input);}
  writableProject(id){const p=this.project(id);if(p.deletion||p.deletedAt)fail('Projectは削除処理中または削除済みです');return p;}
  agentDeleting(a){return !!(a.deletedAt||this.data.projects.find(p=>p.id===a.projectId)?.deletion);}
  writableAgent(a){if(this.agentDeleting(a))fail('所属Projectは削除処理中または削除済みです');return a;}
  validName(name){if(typeof name!=='string'||!name.trim()||name.length>120)fail('名前を1〜120文字で指定してください',400);return name.trim();}
  async putProject(input,id){return this.locked('projects',()=>this.persist(async()=>{
    if(id){
      const p=this.writableProject(id);
      if (!('name' in input)&&!('pinned' in input)&&!('suspended' in input))fail('名前、pinnedまたはsuspendedを指定してください',400);
      if ('suspended' in input&&typeof input.suspended!=='boolean')fail('suspendedはbooleanです',400);
      if ('pinned' in input&&typeof input.pinned!=='boolean')fail('pinnedはbooleanです',400);
      const name='name' in input?this.validName(input.name):p.name;
      if(!Number.isInteger(input.revision)||input.revision!==p.revision)fail('Projectが更新されています。再読込してください');
      if(this.data.projects.some(p=>!p.deletedAt&&p.id!==id&&p.name===name))fail('同名のProjectがあります');
      Object.assign(p,{name,...('suspended' in input?{suspended:input.suspended}:{}),...('pinned' in input?{pinned:input.pinned}:{}),revision:p.revision+1,updatedAt:now()});
      await this.save();return {...p};
    }
    const name=this.validName(input.name);
    if(typeof input.requestId!=='string'||! /^[\w-]{8,100}$/.test(input.requestId))fail('requestIdが必要です',400);
    const old=this.data.projects.find(p=>p.requestId===input.requestId);
    if(old){if(old.initialName!==name)fail('requestIdの再利用です');return {...old};}
    if(this.data.projects.some(p=>!p.deletedAt&&p.name===name))fail('同名のProjectがあります');
    const p={id:randomUUID(),requestId:input.requestId,initialName:name,name,revision:0,createdAt:now()};
    this.data.projects.push(p);await this.save();return {...p};
  }));}
  async updateAgent(id,input){return this.locked('projects',()=>this.locked(id,()=>this.persist(async()=>{
    const a=this.writableAgent(this.agent(id)),revision=a.metadataRevision||0;
    if(!Number.isInteger(input.revision)||input.revision!==revision)fail('Agentが更新されています。再読込してください');
    if(Object.keys(input).some(k=>!['revision','name','projectId'].includes(k))||(!('name' in input)&&!('projectId' in input)))fail('名前またはProject所属を指定してください',400);
    const patch={metadataRevision:revision+1};
    if('name' in input)patch.name=this.validName(input.name);
    if('projectId' in input){if(input.projectId!==null)this.writableProject(input.projectId);patch.projectId=input.projectId;}
    a.creationInput ||= {workshopId:a.workshopId,cwd:a.cwd,name:a.name,provider:a.provider||'codex',location:a.location||'workshop',projectId:a.projectId||null};
    Object.assign(a,patch);await this.save();
    return structuredClone(a);
  })));}
  get rules(){let url=this.villageUrl;try{url=new URL(this.notifier.status().officeUrl).origin;}catch{}return new AgentRules(url);}
  secretaryContext(agent){const identity=agentIdentity(agent);return this.rules.discovery({agentId:agent.id,role:identity.role,location:identity.location,workshopId:agent.workshopId||null,projectId:agent.projectId||null,metadataRevision:agent.metadataRevision||0});}
  startupInstructions(){return this.rules.startup();}
  async installInstructions(a){
    let envelope={mode:'legacy'};
    try{
      const body=this.startupInstructions();
      const receipt=JSON.parse(await this.execute(a,['python3','-c',installInstructionsScript,a.workspaceId,a.provider,body]));
      if(receipt.installed===true&&receipt.hash===createHash('sha256').update(body).digest('hex'))envelope={mode:'startup-v1',hash:receipt.hash,installedAt:now()};
    }catch{envelope={mode:'legacy',reason:'startup-instructions-unavailable'};}
    await this.persist(async()=>{a.inputEnvelope=envelope;await this.save();});
  }
  async verifyInstructions(a){
    if(a.inputEnvelope?.mode!=='startup-v1')return;
    let reason='startup-instructions-missing-or-changed';
    try{
      const result=JSON.parse(await this.execute(a,['python3','-c',verifyInstructionsScript,a.workspaceId,a.provider,a.inputEnvelope.hash||'']));
      if(result.verified===true)return;
    }catch{reason='startup-instructions-check-failed';}
    await this.persist(async()=>{a.inputEnvelope={...a.inputEnvelope,mode:'legacy',reason,downgradedAt:now()};await this.save();});
  }
  // Only synchronous model edits and save() belong inside this boundary.
  // Read remote evidence first; dispatch external effects only after it commits.
  async persist(change){return this.persistence.run(async()=>{
    const scope=this.persistence.context.getStore();
    if(scope.restore)return change();
    scope.restore=checkpoint(this.data);
    try{return await change();}
    catch(error){
      if(error.persistenceUncertain)this.persistence.failure=error;
      else scope.restore();
      throw error;
    }
  });}
  async save(){return this.persistence.run(async()=>{
    const restore=checkpoint(this.data);
    try{const task=this.store.save();this.queue=task;await task;
      const scope=this.persistence.context.getStore();if(scope.restore)scope.restore=restore;
    }catch(error){error.persistenceFailure=true;if(error.persistenceUncertain)this.persistence.failure=error;throw error;}
  });}
  async locked(id,fn){
    const previous=this.locks.get(id)||Promise.resolve();
    const task=previous.catch(()=>{}).then(fn);this.locks.set(id,task);
    try{return await task;}finally{if(this.locks.get(id)===task)this.locks.delete(id);}
  }
  workshop(input,id){
    const {name,baseUrl,workplaces,connectionType='ssh'}=input;
    if(input.iconPattern!==undefined&&input.iconPattern!==null&&!validWorkshopPattern(input.iconPattern))fail('工房模様はnone/line/diamondの8セルで指定してください',400);
    if(!['ssh','local'].includes(connectionType))fail('接続方式はSSHまたはローカルを選んでください',400);
    const sshHost=connectionType==='local'?null:input.sshHost;
    if(typeof name!=='string'||!name.trim()||name.length>120||(connectionType==='ssh'&&(typeof sshHost!=='string'||! /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,200}$/.test(sshHost))))fail('名前とSSH接続先を確認してください',400);
    let url;try{url=new URL(baseUrl);}catch{fail('PurpleMux URLが不正です',400);}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('HTTP(S) URLを指定してください',400);
    if(!Array.isArray(workplaces)||!workplaces.length||workplaces.length>30||workplaces.some(p=>typeof p!=='string'||!p.startsWith('/')||p.length>1000||/[\r\n\0]/.test(p)))fail('作業場所を絶対パスで指定してください',400);
    return {id:id||randomUUID(),name:name.trim(),connectionType,sshHost,baseUrl:url.href,workplaces:[...new Set(workplaces)],...(input.iconPattern!==undefined?{iconPattern:input.iconPattern===null?null:[...input.iconPattern]}:{}),updatedAt:now()};
  }
  async putWorkshop(input,id){
    return this.locked('workshop:'+(id||'new'),()=>this.persist(async()=>{
      const i=this.data.workshops.findIndex(x=>x.id===id),previous=this.data.workshops[i];
      if(id&&i<0)fail('工房がありません',404);
      const w={...previous,...this.workshop({...previous,...input},id)};
      if(i<0)this.data.workshops.push(w);else this.data.workshops[i]=w;
      await this.save();return w;
    }));
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
  async runtime(a,status){this.runtimeReader ||= new RuntimeReader(this.dir);return this.runtimeReader.read(a,status,(agent,args)=>this.execute(agent,args));}
  async create(input){return this.locked('projects',()=>this.locked('create:'+input.requestId,()=>this.createOnce(input)));}
  async createOnce({workshopId,cwd,name='Agent',requestId,provider='codex',location='workshop',projectId=null}){
    if(typeof requestId!=='string'||! /^[\w-]{8,100}$/.test(requestId))fail('requestIdが必要です',400);
    const creationInput={workshopId,cwd,name,provider,location,projectId:projectId||null};
    const old=this.data.agents.find(a=>a.requestId===requestId);if(old){const original=old.creationInput||{workshopId:old.workshopId,cwd:old.cwd,name:old.name,provider:old.provider||'codex',location:old.location||'workshop',projectId:old.projectId||null};if(JSON.stringify(original)!==JSON.stringify(creationInput))fail('requestIdの再利用です');return old;}
    projectId ||= null;if(projectId)this.writableProject(projectId);
    if(!['codex','claude'].includes(provider)||!['mayor','workshop'].includes(location))fail('Agent種類または場所が不正です',400);
    const w=this.data.workshops.find(w=>w.id===workshopId);if(!w||!w.workplaces.includes(cwd))fail('工房と登録済み作業場所を選んでください',400);
    if(location==='mayor'&&w.connectionType!=='local')fail('秘書はローカル工房の実行環境を選んでください',400);
    if(typeof name!=='string'||!name.trim()||name.length>120)fail('Agent名が不正です',400);
    const a={id:randomUUID(),requestId,creationInput,workshopId,connection:structuredClone(w),cwd,name,provider,location,projectId,metadataRevision:0,createdAt:now()};
    await this.persist(async()=>{bindAgent(a);agentChange(a,{type:'start',actor:'human'});this.data.agents.push(a);await this.save();});
    return this.locked(a.id,async()=>{
      try{
        // Every non-idempotent mutation is preceded by a durable intent. Never retry.
        const ws=await this.pmux(a,'workspace','create','--cwd',cwd,'--name',`AI村 ${a.location==='mayor'?agentPlaceName(a):'工房（'+agentPlaceName(a)+'）'} · ${a.name} · ${a.id}`);
        if(!ws.id||!ws.initialTab?.tabId)throw Error('workspace応答の識別情報が不足しています');
        await this.persist(async()=>{Object.assign(a,{workspaceId:ws.id,initialTabId:ws.initialTab.tabId});await this.save();});
        await this.installInstructions(a);
        const tab=await this.pmux(a,'tab','create','-w',a.workspaceId,'-n',name,'-t',provider==='claude'?'claude-code':'codex-cli');
        if(!tab.tabId||!tab.sessionName)throw Error('tab応答の識別情報が不足しています');
        const url=new URL(w.baseUrl);url.searchParams.set('workspace',ws.id);url.searchParams.set('tab',tab.tabId);
        await this.persist(async()=>{Object.assign(a,{tabId:tab.tabId,sessionName:tab.sessionName,terminalUrl:url.href});await this.save();});
      }catch(error){if(error.persistenceFailure)throw error;await this.persist(async()=>{agentChange(a,{type:'observe',actor:'program',observation:{connected:false,process:'unknown',activity:'unknown',canSteer:false}});a.error='起動結果不明。自動再試行しません。PurpleMuxで確認してください。';await this.save();});}
      return a;
    });
  }
  async send(id,input,originKind='human'){return this.flow.start(id,input,originKind);}
  async attemptRun(r){return this.locked(r.agentId,async()=>{
    if(runState(r)!=='queued'||r.nextTransferAt>Date.now())return r;
    const a=this.agent(r.agentId);
    const blocked=(reason,message=reason)=>this.persist(async()=>{changeRun(r,{type:modelOf(r).state.kind==='queued'?'dispatch-blocked':'lost',actor:'program',at:Date.now(),reason});r.error=message;await this.save();return r;});
    if(this.agentDeleting(a)||(a.agentModel?.intent==='stop'||agentControls(a).state==='terminated')||!a.tabId)return blocked('target-unavailable-before-dispatch');
    const baseline=await this.observe(a);
    if(this.agentDeleting(a))return blocked('project-deletion-before-dispatch');
    const allowed=snapshot=>r.steerTarget?this.steeringBoundary(r,a,snapshot):agentControls(a).canSend;
    if(!allowed(baseline)){
      if(r.steerTarget)return blocked('dispatch-boundary-changed','補足対象の実行状態が変わりました。自動送信しません。');
      await this.persist(async()=>{r.queuedReason=agentControls(a).sendReason;await this.save();});return r;
    }
    const files=[];
    try{for(const record of r.attachments||[])files.push(await this.transferAttachment(a,record,await this.attachments.content(record.id)));}
    catch{await this.persist(async()=>{r.attachmentError='添付を接続先へ転送できません。送信前に再試行します。';r.nextTransferAt=Date.now()+30000;await this.save();});return r;}
    const confirmed=r.attachments?.length?await this.observe(a):baseline;
    if(!allowed(confirmed)||this.agentDeleting(a)){if(r.steerTarget)return blocked('dispatch-boundary-changed','添付転送中に補足対象が変わりました。自動送信しません。');return r;}
    if(r.autoRecoveryFrom&&(Date.now()>r.recoveryDeadline||!this.flow.recoveryBoundary(this.flow.run(r.autoRecoveryFrom),confirmed,a.runtime)))return blocked('dispatch-boundary-changed','自動再試行前に新しい入力または状態変化を検出しました。requests getで確認し手動で復旧してください。');
    await this.verifyInstructions(a);
    const status=a.runtime,compact=a.inputEnvelope?.mode==='startup-v1';
    const instruction=r.phase==='report'?this.flow.reportPrompt(this.flow.root(r.humanRequestId)):r.instruction;
    const guide=compact?'':await this.projectGuides.context(a,r,this.villageUrl);
    const deliveredInstruction=await this.persist(async()=>{
      if(this.agentDeleting(a))return null;
      r.instruction=instruction;r.attachmentFiles=files;r.attachmentError=null;
      const text=instruction+(r.phase!=='report'?this.secretaryContext(a):'')+guide+this.flow.context(r)+markerContext(r.id);
      if(r.steerTarget){const previous=this.flow.run(r.steerTarget.runId);changeRun(previous,{type:'close-tracking',actor:'human',reason:'steering-successor-dispatched'});}
      changeRun(r,{type:'dispatch',actor:'program',at:Date.now(),sessionId:confirmed.sessionId||null,agentIdle:true});
      Object.assign(r,{inputMarker:runMarker(r.id),inputEnvelopeMode:compact?'startup-v1':'legacy',dispatchAttemptedAt:now(),baselineRuntime:{sessionId:confirmed.sessionId,cursor:confirmed.cursor,fileIdentity:confirmed.fileIdentity},agentSessionId:status.agentSessionId||null});
      await this.save();return text;
    });
    if(deliveredInstruction===null||this.agentDeleting(a))return blocked('project-deletion-before-dispatch');
    let sent=false;
    try{await this.pmux(a,'tab','send','-w',a.workspaceId,a.tabId,deliveredInstruction);sent=true;}catch{/* An uncertain transport is never replayed. */}
    await this.persist(async()=>{
      if(sent)changeRun(r,{type:'transport-ack',actor:'program',at:Date.now()});
      else{r.unknownSince ||= now();r.error='送信結果不明。native入力を照合します。自動再送しません。';}
      this.updateAvailability(a);await this.save();
    });return r;
  });}
  steeringBoundary(r,a,snapshot){
    const t=r.steerTarget,previous=t&&this.flow.run(t.runId);
    if(!previous||!['codex','claude'].includes(a.provider)||(a.provider==='claude'&&previous.phase==='report')||agentControls(a).lifecycle!=='alive'||agentControls(a).connectionState!=='connected'||agentControls(a).activityState!=='busy'||a.runtime?.cliState!=='busy'||a.runtime?.permissionRequest||a.setupRequired||snapshot.incompleteTail||!snapshot.available)return false;
    const q=this.flow.root(r.humanRequestId);
    if(snapshot.sessionId!==t.sessionId||a.runtime.agentSessionId!==t.sessionId||snapshot.turns.at(-1)?.id!==t.turnId)return false;
    const observed=correlate(previous,snapshot);
    return observed.state==='running'&&observed.turnId===t.turnId&&snapshot.inputs.filter(i=>i.turnId===t.turnId).every(i=>r.priorInputs.some(p=>inputMatches(i,p)));
  }
  // Unknown labels are compatibility observations, not model states. Unresolved
  // sent/running records become terminal unconfirmed after a bounded wait, even
  // if an earlier observation already released the input gate.
  releaseStuckRuns(a){
    for(const r of this.data.runs.filter(r=>r.agentId===a.id)){
      if(active(r)&&r.error){
        r.unknownSince ||= now();
        if(Date.now()-Date.parse(r.unknownSince)>=STUCK_RUN_TIMEOUT_MS){
          changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'timeout'});r.error=r.error||'runtime-correlation-timeout';r.unknownResolvedAt=now();
        }
      }else delete r.unknownSince;
    }
  }
  updateAvailability(a){
    if(!a.agentModel)bindAgent(a);
    if(this.agentDeleting(a)&&a.agentModel.intent!=='stop')agentChange(a,{type:'stop',actor:'human'});
    projectControls(a,this.data.runs);
  }
  async observe(a){
    if(this.agentDeleting(a))return this.persist(async()=>{this.releaseStuckRuns(a);this.updateAvailability(a);await this.save();return {available:false,turns:[],inputs:[]};});
    try{
      let s;
      try{s=await this.pmux(a,'tab','status','-w',a.workspaceId,a.tabId);}catch(error){
        const {tabs}=await this.pmux(a,'tab','list','-w',a.workspaceId);
        if(!Array.isArray(tabs)||tabs.some(t=>t.tabId===a.tabId))throw error;
        s={alive:false,cliState:'inactive'};
      }
      const snapshot=await this.runtime(a,s);
      let setupRequired=false;
      if(s.alive&&!s.agentSessionId){const capture=await this.pmux(a,'tab','capture','-w',a.workspaceId,a.tabId);setupRequired=/Do you trust|trust this|trust the contents/i.test(capture.content||'');}
      return await this.persist(async()=>{
      if(!a.agentModel)bindAgent(a);
      const freshClaude=a.provider==='claude'&&snapshot.unrecorded===true&&s.alive&&ready(s)&&s.lastEvent?.name==='session-start'&&!s.lastUserMessage&&!this.data.runs.some(r=>r.agentId===a.id&&r.dispatchAttemptedAt);
      a.error=null;a.lastCheckedAt=now();a.runtime=s;
      a.modelInfo=sessionModel(snapshot,s);
      a.setupRequired=setupRequired;
      const latest=snapshot.turns.at(-1);
      const observation=runtimeObservation(s,{...snapshot,terminalBoundary:terminalBoundary(snapshot,s)},{freshClaude,setupRequired:a.setupRequired,previousSession:a.observedSessionId});
      if(a.agentModel.intent==='stop'&&observation.process==='absent'&&a.processVerification?.remainingOwned!==0)observation.process='unknown';
      agentChange(a,{type:'observe',actor:'program',observation});
      if(a.setupRequired)a.error='作業場所の信頼確認が必要です。PurpleMuxで確認してください。';
      a.currentAction=agentControls(a).activityState==='busy'&&s.currentAction?.toolName?s.currentAction.toolName+': '+(s.currentAction.summary||''):null;
      if(snapshot.available){
        // Preserve completed output from previous sessions for Agent view revisions.
        // Never relabel an old turn with the newly observed session identity.
        const archived=(a.nativeTurns||[]).map(t=>({...t,sessionId:t.sessionId||a.observedSessionId})).filter(t=>t.sessionId&&t.sessionId!==snapshot.sessionId&&['completed','failed','interrupted'].includes(t.state));
        a.nativeTurns=[...archived,...snapshot.turns.map(t=>({...t,sessionId:snapshot.sessionId,instruction:snapshot.inputs.filter(i=>i.turnId===t.id).map(i=>i.text).join('\n')}))];
      }
      if(a.inputEnvelope?.mode==='startup-v1'&&s.agentSessionId){
        if(a.inputEnvelope.sessionId&&a.inputEnvelope.sessionId!==s.agentSessionId)a.inputEnvelope={mode:'legacy',reason:'native-session-changed'};
        else a.inputEnvelope.sessionId=s.agentSessionId;
      }
      if(snapshot.sessionId)a.observedSessionId=snapshot.sessionId;
      for(const r of this.data.runs.filter(r=>r.agentId===a.id&&active(r))){
        const observation=correlate(r,snapshot);
        observeRun(r,observation,snapshot);
        if(observation.turnId){r.acceptedAt ||= now();r.turnId=observation.turnId;r.sessionId=observation.sessionId;r.inputId ||= observation.inputId;if(typeof observation.output==='string')r.output=observation.output;if(typeof observation.finalOutput==='string')r.finalOutput=observation.finalOutput;}
        if(observation.turnId&&r.steerTarget){
          // Bring the superseded chain up to each confirmed input boundary.
          // This also captures messages emitted between dispatch and acceptance.
          const turn=snapshot.turns.find(t=>t.id===r.turnId);
          const predecessor=this.flow.run(r.steerTarget.runId);
          if(r.steeringProvider==='claude'&&predecessor?.turnId!==r.turnId){
            const priorTurn=snapshot.turns.find(t=>t.id===predecessor?.turnId);
            if(priorTurn?.state==='completed'&&runState(predecessor)==='superseded')predecessor.output=priorTurn.output;
          }
          let next=r;
          const visited=new Set();
          while(turn?.messageOffsets===true&&next.steerTarget&&!visited.has(next.id)){
            visited.add(next.id);
            const previous=this.data.runs.find(p=>p.id===next.steerTarget.runId);
            const start=previous&&resolveInputPosition(snapshot.inputs,previous.inputId,r.turnId);
            const end=resolveInputPosition(snapshot.inputs,next.inputId,r.turnId);
            if(!previous||runState(previous)!=='superseded'||previous.sessionId!==r.sessionId||!start||!end||start.offset>=end.offset)break;
            previous.output=outputBetween(turn,start.offset,end.offset);
            next=previous;
          }
        }
        if(['completed','interrupted','failed'].includes(observation.state)){
          Object.assign(r,{output:observation.output,completedAt:observation.completedAt||now(),completionEvent:observation.completionEvent,error:observation.error||null,errorCode:observation.errorCode||null,runtimeError:observation.runtimeError||null,completionOffset:observation.completionOffset});
        }else{

          r.error=observation.reason||(observation.state==='running'&&!s.alive?'native-process-unavailable':null);
          const checkpoint=r.baselineRuntime;
          const sameStream=checkpoint&&(!checkpoint.sessionId||checkpoint.sessionId===snapshot.sessionId);
          const oldSession=r.sessionId||r.agentSessionId||checkpoint?.sessionId;
          const boundary=latest&&['completed','interrupted','failed'].includes(latest.state)&&(
            (sameStream&&snapshot.inputs.some(i=>i.offset>checkpoint.cursor&&i.turnId===latest.id))||
            (oldSession&&snapshot.sessionId&&oldSession!==snapshot.sessionId));
          if(observation.state==='unknown'&&snapshot.available&&((oldSession&&snapshot.sessionId&&oldSession!==snapshot.sessionId)||observation.reason==='session-changed'||(boundary&&agentControls(a).activityState==='idle'))){changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:oldSession&&snapshot.sessionId&&oldSession!==snapshot.sessionId?'session-changed':'turn-ended-without-marker'});r.inputReleasedAt ||= now();}
        }
      }
      this.releaseStuckRuns(a);this.updateAvailability(a);await this.save();return snapshot;
      });
    }catch(error){
      if(error.persistenceFailure)throw error;
      return this.persist(async()=>{
      for(const r of this.data.runs.filter(r=>r.agentId===a.id&&active(r)))r.error ||= 'runtime-unavailable';
      a.modelInfo={available:false};agentChange(a,{type:'observe',actor:'program',observation:{connected:false,process:'unknown',activity:'unknown',canSteer:false}});a.error='接続・状態取得ができません。監視を継続します。';this.releaseStuckRuns(a);this.updateAvailability(a);await this.save();return {available:false,turns:[],inputs:[]};
      });
    }
  }
  async poll(a){
    if(this.locks.has(a.id)||!a.tabId||a.agentModel?.intent==='stop'&&a.agentModel.observation?.process==='absent')return;
    await this.locked(a.id,()=>this.observe(a));
  }
  async tick(){
    // Poll independent connections concurrently before advancing durable requests.
    await Promise.allSettled(this.data.agents.map(a=>{
      if(this.monitors.has(a.id))return this.monitors.get(a.id);
      const task=this.poll(a);
      this.monitors.set(a.id,task);
      const clear=()=>this.monitors.delete(a.id);task.then(clear,clear);
      return task;
    }));
    await this.persist(async()=>{
    // A queued supplement may fail before sending; its superseded owner must not
    // remain a dormant nonterminal record forever. Cancellation restores ownership
    // in cancelQueued; all other settled successors close the old human boundary.
    for(const r of this.data.runs){
      if(r.runModel?.supersededBy&&r.runModel.state.kind==='running'&&this.flow.run(r.runModel.supersededBy)?.runModel.state.kind!=='queued')changeRun(r,{type:'close-tracking',actor:'human',reason:'steering-successor-settled'});
      if(active(r)&&!this.data.agents.some(a=>a.id===r.agentId&&a.tabId&&!['terminated','stopping'].includes(agentControls(a).state))){r.error ||= 'agent-unavailable';this.releaseStuckRuns({id:r.agentId});}
    }
    await this.save();
    });
    await this.flow.pump();await this.flow.notifications();
  }
  async stop(id,{requireProcessEvidence=false}={}){return this.locked(id,async()=>{
    const a=this.agent(id);if(agentControls(a).state==='terminated'&&(!requireProcessEvidence||a.processVerification?.remainingOwned===0))return a;
    if(!a.tabId)fail('tab識別情報がないため、PurpleMuxで確認してください');
    const {tabs}=await this.pmux(a,'tab','list','-w',a.workspaceId);
    const target=tabs.find(t=>t.tabId===a.tabId);
    if(target&&target.sessionName!==a.sessionName)fail('tabの識別情報が一致しません');
    await this.persist(async()=>{agentChange(a,{type:'stop',actor:'human'});await this.save();});
    try{
      if(requireProcessEvidence&&!target&&!a.ownedProcesses)throw Error('tabがなく所有プロセスを照合できません。手動確認が必要です');
      if(target&&!a.ownedProcesses){const owned=JSON.parse(await this.execute(a,['python3','-c',captureProcessesScript,a.sessionName]));await this.persist(async()=>{a.ownedProcesses=owned;await this.save();});}
      if(a.ownedProcesses&&(!Array.isArray(a.ownedProcesses)||!a.ownedProcesses.length))throw Error('所有プロセスの記録が不正です');
      if(target)await this.execute(a,['purplemux','tab','close','-w',a.workspaceId,a.tabId]);
      const remaining=await this.pmux(a,'tab','list','-w',a.workspaceId);
      if(remaining.tabs.some(t=>t.tabId===a.tabId))throw Error('tab remains');
      const verification=a.ownedProcesses?JSON.parse(await this.execute(a,['python3','-c',stopProcessesScript,JSON.stringify(a.ownedProcesses),a.cwd,'[]','--owned-only'])):null;
      await this.persist(async()=>{
      if(verification)a.processVerification=verification;
      if(a.ownedProcesses&&a.processVerification?.remainingOwned!==0)throw Error('所有プロセスの終了を確認できません');
      agentChange(a,{type:'observe',actor:'program',observation:{connected:true,process:'absent',activity:'unknown',canSteer:false}});a.error=null;a.terminatedAt=now();
      // A terminated agent is never observed/polled again, so releaseStuckRuns() can never
      // resolve an 'unknown'/'send_unknown' run of its own. Administrative stop is itself the
      // bounded wait's outcome here: resolve the same way, never as a presumed success.
      for(const r of this.data.runs)if(r.agentId===id&&active(r)){
       r.agentTerminatedAt=a.terminatedAt;

       changeRun(r,{type:'lost',actor:'program',at:Date.now(),reason:'agent-stopped'});
      }
      await this.save();
      });
    }catch(e){if(e.persistenceFailure)throw e;await this.persist(async()=>{agentChange(a,{type:'observe',actor:'program',observation:{connected:false,process:'unknown',activity:'unknown',canSteer:false}});a.error='終了結果不明。'+e.message+' 再度終了を選ぶと対象tabの存在を照合します。';await this.save();});}
    return a;
  });}
}
