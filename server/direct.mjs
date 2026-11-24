import {Conversations} from './conversations.mjs';
import {enrollLegacy,legacyAllowed,legacyContext,legacyReviewDue} from './legacy-contract.mjs';
import {migrateCommonRequests} from './common-request-migration.mjs';
import {PartitionStore} from './partition-store.mjs';
import {RequestUnits} from './request-units.mjs';
import {EventEmitter} from 'node:events';
import {EventMonitor} from './event-monitor.mjs';
import {migrateProjectOrder} from './project-order-migration.mjs';
import {orderedProjects,orderedProjectAgents} from '../src/board-state.js';
import {migrateUnifiedStore} from './unified-request-migration.mjs';
import {quarantineRequests,quarantinedRun} from './request-integrity.mjs';
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
import {inputCorrelation,installInstructionsScript,verifyInstructionsScript} from './input-envelope.mjs';
import {sessionModel} from './session-model.mjs';
import {ProjectGuides} from './project-guides.mjs';
import {humanProjection} from './report-view.mjs';
import {validWorkshopPattern} from '../src/workshop-pattern.js';
import {deleteAgent} from './agent-deletion.mjs';
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
  constructor({dir, remote, notifier, attachments, transferAttachment=stageAttachment, localRun=run, localBin=process.env.VILLAGE_PMUX_BIN || 'purplemux', pollMs=2000, hostFactory, villageUrl='http://127.0.0.1:5173'}) {
    Object.assign(this,{dir,remote,notifier,attachments,transferAttachment,localRun,localBin,pollMs,hostFactory,villageUrl});
    this.data={version:1,workshops:[],projects:[],agents:[],runs:[]};
    this.projectGuides=new ProjectGuides(undefined,this);
    this.flow=new RequestFlow(this);this.conversations=new Conversations(this);this.events=new EventEmitter();
    this.persistence=new PersistenceBoundary();
    this.queue=Promise.resolve(); this.locks=new Map(); this.monitors=new Map();
    this.units=new RequestUnits(this);
    this.store=new PartitionStore({dir:this.dir,capture:()=>this.data,selection:()=>this.units.selection(),affected:c=>this.units.affected(c)});
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
    const stored=this.store.open();
    try { this.data=stored||JSON.parse(await readFile(resolve(this.dir,'direct.json'),'utf8')); }
    catch(e) { if(e.code!=='ENOENT')throw e; }
    quarantineRequests(this.data);
    this.data=await migrateRunStore(this.dir,this.data);
    if(!this.data.unifiedRequestVersion)this.data=await migrateRequestStore(this.dir,this.data);
    this.data=await migrateAgentStore(this.dir,this.data);
    if(!this.data.unifiedRequestVersion)this.data=await migrateCanonicalStore(this.dir,this.data);
    if(!this.data.unifiedRequestVersion)this.data=await migrateMarkerStore(this.dir,this.data);
    this.data=await migrateUnifiedStore(this.dir,this.data);
    this.data=migrateCommonRequests(this.data);
    this.data.projects ||= [];
    migrateProjectOrder(this.data.projects);
    for(const p of this.data.projects)if(p.deletion?.status==='running'){p.deletion.status='partial';p.deletion.interruptedAt=now();}
    for(const w of this.data.workshops)w.connectionType ||= 'ssh';
    for(const a of this.data.agents) {
      a.connection.connectionType ||= 'ssh';
      a.inputEnvelope ||= {mode:'legacy'};
      enrollLegacy(a);
      if(a.inputEnvelope.mode==='startup-v2'&&a.inputEnvelope.hash!==createHash('sha256').update(this.startupInstructions()).digest('hex'))a.inputEnvelope={...a.inputEnvelope,mode:'migration-required',reason:a.inputEnvelope.reason||'startup-contract-upgrade-required'};
      a.modelInfo={available:false};
      bindAgent(a);delete a.steerTarget;
      // A removed tab identity cannot be reused; otherwise live observations expire on restart.
      if(!(a.agentModel.intent==='stop'&&a.processVerification?.remainingOwned===0&&a.terminatedAt))a.agentModel={...a.agentModel,observation:null};

    }
    for(const p of this.data.projects)if(!p.deletedAt)await this.projectGuides.initialize(p);
    this.data.conversations ||= [];
    this.flow.init();this.conversations.validate();
    await this.save();
    if(watch){this.flow.reporting.start();this.monitor=new EventMonitor(this,this.hostFactory?{hostFactory:this.hostFactory}:{});this.monitor.start();void this.progress().catch(()=>{});}
  }
  close(){this.monitor?.close();this.flow.reporting.close();clearInterval(this.timer);this.owner?.close();this.store.close();}
  presentation(){
    if(!this.presentationCache){const view=humanProjection(this.data);this.presentationCache={...view,projects:view.projects.filter(p=>!p.deletedAt),capabilities:{secretaryConversations:true,requestSplitting:true,requestInbox:true,steering:true,travelContexts:true,attachments:!!this.attachments},reviews:this.reviewStates(view)};}
    const live=new Map(this.data.agents.map(a=>[a.id,a]));
    return {...this.presentationCache,agents:this.presentationCache.agents.map(a=>({...a,lastCheckedAt:live.get(a.id)?.lastCheckedAt,runtime:live.get(a.id)?.runtime})),notification:this.notifier.status()};
  }
  snapshot(){return structuredClone(this.presentation());}
  reviewStates(view=humanProjection(this.data)){
    const keys=new Map(this.data.agents.map(a=>[a.id,[]]));
    for(const entry of completedEntries(view))keys.get(entry.agentId)?.push(entry.key);
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
  discovery(){return {agents:this.data.agents.filter(a=>!a.deletedAt).map(a=>({...agentIdentity(a),leaderForProjects:this.data.projects.filter(p=>p.leaderAgentId===a.id&&!p.deletedAt).map(p=>p.id),projectId:a.projectId||null,projectName:this.data.projects.find(p=>p.id===a.projectId)?.name||null,metadataRevision:a.metadataRevision||0,displayOrder:a.displayOrder??null})),projects:structuredClone(this.data.projects.filter(p=>!p.deletedAt)),workshops:structuredClone(this.data.workshops),management:{workshopPattern:'PUT /api/direct/workshops/:id {iconPattern:[none|line|diamond x8]}; null resets to stable default; omitted fields preserved',help:'node scripts/village.mjs help',agentUpdate:'PUT /api/direct/agents/:id {revision,name?,projectId?,displayOrder?:integer|null}',projects:'POST /api/direct/projects {requestId,name}; PUT /api/direct/projects/:id {revision,name?,suspended?:boolean,displayOrder?:integer|null (display only)}',projectDelete:'GET /api/direct/projects/:id/delete-plan; POST /api/direct/projects/:id/delete {operationId,revision,members}; deletes all member Agents, retry same operation on partial result',namePolicy:'村の表示名のみ変更。PurpleMuxのラベル、ID、セッション、接続先は維持。',requests:{help:'node scripts/village.mjs help',list:'GET /api/direct/requests',get:'POST /api/direct/requests/get {humanRequestId}',operations:'delegate / results / finish: POST /api/direct/requests/:operation',policy:'人間の依頼ごとに通知権1枚。正式delegateで親子を登録し、委任なしはnative正常終了、委任ありは子結果を確認後のfinishとnative正常終了で全体完了。生PurpleMux送信・旧runを自動関連付けしない。'}}};}
  project(id){return this.data.projects.find(p=>p.id===id)||fail('Projectがありません',404);}
  projectDeletePlan(id){return deletionPlan(this,id);}
  deleteProject(id,input){return deleteProject(this,id,input);}
  writableProject(id){const p=this.project(id);if(p.deletion||p.deletedAt)fail('Projectは削除処理中または削除済みです');return p;}
  deleteAgent(id,input){return deleteAgent(this,id,input);}
  agentDeleting(a){return !!(a.deletion||a.deletedAt||this.data.projects.find(p=>p.id===a.projectId)?.deletion);}
  writableAgent(a){if(a.runtimeRetiredTo)fail('旧ランタイム保管用Agentです。新規依頼は移行先を使用してください');if(this.agentDeleting(a))fail('所属Projectは削除処理中または削除済みです');return a;}
  validName(name){if(typeof name!=='string'||!name.trim()||name.length>120)fail('名前を1〜120文字で指定してください',400);return name.trim();}
  async putProject(input,id){return this.locked('projects',()=>this.persist(async()=>{
    if('pinned' in input)fail('先頭固定は廃止されました。表示順を指定してください',400);
    if(id){
      const p=this.writableProject(id);
      if (!('name' in input)&&!('suspended' in input)&&!('displayOrder' in input)&&!('leaderAgentId' in input))fail('名前、suspendedまたはdisplayOrderを指定してください',400);
      if ('suspended' in input&&typeof input.suspended!=='boolean')fail('suspendedはbooleanです',400);
      if('displayOrder' in input&&input.displayOrder!==null&&!Number.isSafeInteger(input.displayOrder))fail('displayOrderは安全な整数またはnullです',400);
      if('leaderAgentId' in input&&input.leaderAgentId!==null){const leader=this.writableAgent(this.agent(input.leaderAgentId));if(leader.projectId!==id||leader.location!=='workshop')fail('同じProjectの工房Agentをリーダーに指定してください');}
      const name='name' in input?this.validName(input.name):p.name;
      if(!Number.isInteger(input.revision)||input.revision!==p.revision)fail('Projectが更新されています。再読込してください');
      if(this.data.projects.some(p=>!p.deletedAt&&p.id!==id&&p.name===name))fail('同名のProjectがあります');
      Object.assign(p,{name,...('leaderAgentId' in input?{leaderAgentId:input.leaderAgentId}:{}),...('displayOrder' in input?{displayOrder:input.displayOrder}:{}),...('suspended' in input?{suspended:input.suspended}:{}),revision:p.revision+1,updatedAt:now()});
      await this.save();return {...p};
    }
    const name=this.validName(input.name);
    if(typeof input.requestId!=='string'||! /^[\w-]{8,100}$/.test(input.requestId))fail('requestIdが必要です',400);
    const old=this.data.projects.find(p=>p.requestId===input.requestId);
    if(old){if(old.initialName!==name)fail('requestIdの再利用です');return {...old};}
    if(this.data.projects.some(p=>!p.deletedAt&&p.name===name))fail('同名のProjectがあります');
    const p={id:randomUUID(),requestId:input.requestId,initialName:name,name,revision:0,createdAt:now()};
    await this.projectGuides.initialize(p);
    this.data.projects.push(p);await this.save();return {...p};
  }));}
  async reorder(input){return this.locked('projects',()=>this.persist(async()=>{
    const {kind,id,targetId,position,revision,targetRevision,projectId}=input;
    if(!['projects','agents'].includes(kind)||!['before','after'].includes(position)||typeof id!=='string'||typeof targetId!=='string'||id===targetId)fail('並び替えの対象と位置が不正です',400);
    const members=kind==='projects'?this.data.projects.filter(p=>!p.deletedAt):this.data.agents.filter(a=>!a.deletedAt&&a.projectId===projectId);
    if(kind==='agents')this.writableProject(projectId);
    const source=members.find(x=>x.id===id),target=members.find(x=>x.id===targetId),key=kind==='projects'?'revision':'metadataRevision';
    if(!source||!target)fail('同じ一覧内の対象を指定してください',400);
    if(kind==='projects'){this.writableProject(id);this.writableProject(targetId);}
    else{this.writableAgent(source);this.writableAgent(target);}
    if(!Number.isInteger(revision)||!Number.isInteger(targetRevision)||revision!==(source[key]||0)||targetRevision!==(target[key]||0))fail('一覧が更新されています。再読込して並べ替えてください');
    const ordered=(kind==='projects'?orderedProjects(members):orderedProjectAgents(members)).filter(x=>x.id!==id);
    const index=ordered.findIndex(x=>x.id===targetId);if(index<0)fail('並び替え対象がありません',400);
    ordered.splice(index+(position==='after'?1:0),0,source);
    for(const [rank,item] of ordered.entries()){item.displayOrder=rank;item[key]=(item[key]||0)+1;}
    await this.save();return {ok:true};
  }));}
  async putProjectGuide(id,input){return this.locked('projects',async()=>{
    this.writableProject(id);
    if(typeof input.content!=='string'||!input.content.trim()||input.content.length>20000||input.content.includes('\0'))fail('方針は空白のみを除く1〜20000文字で指定してください',400);
    if(typeof input.revision!=='string'||input.revision.length>100)fail('表示した方針のrevisionが必要です',400);
    const current=await this.projectGuides.get(id);
    if(!current.available||current.revision!==input.revision)fail('方針が更新されているか取得できません。下書きを控えて再読込してください');
    return this.persist(async()=>{
      const policies=this.data.projectPolicies ||= {};
      policies[id]={content:input.content,revision:(policies[id]?.revision??0)+1};
      await this.save();return this.projectGuides.get(id);
    });
  });}
  async updateAgent(id,input){return this.locked('projects',()=>this.locked(id,()=>this.persist(async()=>{
    const a=this.writableAgent(this.agent(id)),revision=a.metadataRevision||0;
    if(!Number.isInteger(input.revision)||input.revision!==revision)fail('Agentが更新されています。再読込してください');
    if(Object.keys(input).some(k=>!['revision','name','projectId','displayOrder'].includes(k))||(!('name' in input)&&!('projectId' in input)&&!('displayOrder' in input)))fail('名前、Project所属またはdisplayOrderを指定してください',400);
    const patch={metadataRevision:revision+1};
    if('name' in input)patch.name=this.validName(input.name);
    if('projectId' in input&&input.projectId!==a.projectId&&this.conversations.pendingForAgent(a.id))fail('未完了の会話配送・仕事がある秘書はProjectを変更できません');
    if('projectId' in input){if(input.projectId!==null)this.writableProject(input.projectId);patch.projectId=input.projectId;if(input.projectId!==a.projectId)patch.displayOrder=null;}
    if('displayOrder' in input){if(input.displayOrder!==null&&!Number.isSafeInteger(input.displayOrder))fail('displayOrderは安全な整数またはnullです',400);if(!(patch.projectId===undefined?a.projectId:patch.projectId))fail('Project所属が必要です',400);patch.displayOrder=input.displayOrder;}
    a.creationInput ||= {workshopId:a.workshopId,cwd:a.cwd,name:a.name,provider:a.provider||'codex',location:a.location||'workshop',projectId:a.projectId||null};
    Object.assign(a,patch);await this.save();
    return structuredClone(a);
  })));}
  get rules(){let url=this.villageUrl;try{url=new URL(this.notifier.status().officeUrl).origin;}catch{}return new AgentRules(url);}
  secretaryContext(agent){const identity=agentIdentity(agent);return this.rules.discovery({agentId:agent.id,role:identity.role,location:identity.location,projectId:agent.projectId||null});}
  instructionStatus(id){
    const a=this.agent(id),runs=this.data.runs.filter(r=>r.agentId===id),tracking=runs.filter(r=>['sent','running'].includes(modelOf(r).state.kind));
    return {agentId:id,envelope:structuredClone(a.inputEnvelope||{mode:'migration-required'}),requiredContract:2,
      requiresFreshSession:a.inputEnvelope?.mode!=='startup-v2',tracking:tracking.map(r=>({runId:r.id,state:modelOf(r).state.kind,requestId:r.humanRequestId})),
      queued:runs.filter(r=>modelOf(r).state.kind==='queued').map(r=>r.id),
      legacyCompatibility:a.legacyContract||null,legacyDispatchAllowed:legacyAllowed(a),legacyMigrationReviewDue:legacyReviewDue(a),runtimeUpgrade:a.runtimeUpgrade||null,
      conversations:(this.data.conversations||[]).filter(c=>c.agentId===id).map(c=>({conversationId:c.id,requiredRead:['conversations','get',c.id]})),
      requests:this.data.requests.flatMap(q=>q.requestGraph?.nodes.filter(n=>n.assignee===id&&n.state.kind==='active').map(n=>({humanRequestId:q.id,workId:n.id,currentRunId:n.currentRunId,revision:q.revision}))||[]),
      migration:'依頼で許可された対象だけ agents prepare-runtime AGENT_ID {operationId,revision}で次送信を保留。現在runの正常終了・idleを確認。同じ登録属性の未使用新Agentをcreate。agents adopt-runtime AGENT_ID {operationId,revision,replacementAgentId,replacementRevision,handover}で既存IDへランタイム採用。queuedは同じrunを保持。sent/runningは終端待ち。旧ランタイムの停止は別途判断。'};
  }
  async prepareRuntime(id,x){
    if(!x||typeof x.operationId!=='string'||! /^[\w-]{8,100}$/.test(x.operationId)||!Number.isInteger(x.revision)||Object.keys(x).some(k=>!['operationId','revision'].includes(k)))fail('prepare-runtimeの入力が不正です',400);
    return this.locked(id,()=>this.persist(async()=>{
      const a=this.writableAgent(this.agent(id));
      if(a.runtimeUpgrade?.operationId===x.operationId){if(a.runtimeUpgrade.revision!==x.revision)fail('operationIdの再利用です');return structuredClone(a.runtimeUpgrade);}
      if((a.metadataRevision||0)!==x.revision)fail('Agentが更新されています。再読込してください');
      a.runtimeUpgrade={state:'prepared',operationId:x.operationId,revision:x.revision,at:now()};a.metadataRevision=(a.metadataRevision||0)+1;await this.save();return structuredClone(a.runtimeUpgrade);
    }));
  }
  async adoptRuntime(id,x){
    if(!x||typeof x.operationId!=='string'||! /^[\w-]{8,100}$/.test(x.operationId)||typeof x.replacementAgentId!=='string'||x.replacementAgentId===id||!Number.isInteger(x.revision)||!Number.isInteger(x.replacementRevision)||Object.keys(x).some(k=>!['operationId','replacementAgentId','revision','replacementRevision','handover'].includes(k)))fail('runtime adoptionの入力が不正です',400);
    if(x.handover!==undefined&&(typeof x.handover!=='string'||!x.handover.trim()||x.handover.length>30000))fail('handoverは1〜30000文字です',400);
    const payload=JSON.stringify({replacementAgentId:x.replacementAgentId,revision:x.revision,replacementRevision:x.replacementRevision,...(x.handover!==undefined?{handover:x.handover}:{})});
    return this.locked('projects',()=>this.locked(id,()=>this.locked(x.replacementAgentId,async()=>{
      const a=this.agent(id),b=this.agent(x.replacementAgentId),receipt=a.runtimeMigrations?.find(m=>m.operationId===x.operationId);
      if(receipt){if(receipt.payload!==payload)fail('operationIdの再利用です');return structuredClone(receipt);}
      this.writableAgent(a);this.writableAgent(b);
      if((a.metadataRevision||0)!==x.revision||(b.metadataRevision||0)!==x.replacementRevision)fail('Agentが更新されています。再読込してください');
      if(['provider','location','projectId','workshopId','cwd'].some(k=>(a[k]||null)!==(b[k]||null))||JSON.stringify(a.connection)!==JSON.stringify(b.connection))fail('同じ場所・Project・provider・接続の未使用Agentを指定してください');
      if(!b.tabId||b.tabId===a.tabId||!b.workspaceId||b.workspaceId===a.workspaceId)fail('独立した新ランタイムが必要です');
      if(this.data.runs.some(r=>r.agentId===b.id)||this.data.requests.some(q=>q.requestGraph?.nodes.some(n=>n.assignee===b.id)))fail('移行元ランタイムは未使用である必要があります');
      if(this.data.runs.some(r=>r.agentId===id&&['sent','running'].includes(modelOf(r).state.kind)))fail('受付不明・実行中runの追跡が残っています。自動再送せず終端を確認してください');
      if(this.data.runs.some(r=>r.agentId===id&&r.dispatchAttemptedAt)&&!x.handover?.trim())fail('過去の外部操作・未完了事項・不明点を確認したhandoverが必要です',400);
      const oldSnapshot=await this.observe(a),fresh=await this.observe(b);
      if((oldSnapshot.inputs.length||oldSnapshot.turns.length)&&!x.handover?.trim())fail('native履歴の外部操作・未完了事項・不明点を確認したhandoverが必要です',400);
      if(!agentControls(a).canSend||!agentControls(b).canSend||!oldSnapshot.available||!(fresh.available||b.provider==='claude'&&fresh.unrecorded===true)||fresh.inputs.length||fresh.turns.length)fail('両ランタイムのidleと新ランタイムの未使用を確認できません');
      if(this.data.runs.some(r=>r.agentId===id&&['sent','running'].includes(modelOf(r).state.kind)))fail('受付中runが発生しました');
      await this.verifyInstructions(b);
      if(b.inputEnvelope?.mode!=='startup-v2'||b.inputEnvelope.hash!==createHash('sha256').update(this.startupInstructions()).digest('hex'))fail('新ランタイムの固定起動契約を確認できません');
      const keys=['workspaceId','initialTabId','tabId','sessionName','terminalUrl','runtime','observedSessionId','inputEnvelope','modelInfo','setupRequired','ownedProcesses','processVerification','terminatedAt','lastCheckedAt'];
      const fields=o=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,structuredClone(o[k])]));
      const old=fields(a),replacement=fields(b);
      return this.persist(async()=>{
        // No request, run, input, result or notification is reissued or reassigned.
        const record={operationId:x.operationId,payload,at:now(),agentId:id,replacementAgentId:b.id,oldRuntime:structuredClone(old),newRuntime:structuredClone(replacement),handover:x.handover||null,requestContexts:this.data.requests.flatMap(q=>(q.requestGraph?.nodes||[]).filter(n=>n.assignee===id).map(n=>({humanRequestId:q.id,workId:n.id})))};
        a.nativeTurns=(a.nativeTurns||[]).map(t=>({...t,sessionId:t.sessionId||a.observedSessionId}));
        for(const k of keys){delete a[k];delete b[k];}Object.assign(a,replacement);Object.assign(b,old);
        a.agentModel={...a.agentModel,intent:null,observation:structuredClone(b.agentModel.observation)};
        b.agentModel={...b.agentModel,intent:null,observation:{connected:true,process:'alive',activity:'idle',canSteer:false}};
        b.inputEnvelope={...b.inputEnvelope,mode:'migration-required',reason:'runtime-retired'};b.runtimeRetiredTo=a.id;b.name=b.name+'（旧ランタイム保管）';b.nativeTurns=[];
        delete a.error;delete a.steerTarget;delete b.steerTarget;a.metadataRevision=(a.metadataRevision||0)+1;b.metadataRevision=(b.metadataRevision||0)+1;
        if(a.runtimeUpgrade)a.runtimeUpgrade={...a.runtimeUpgrade,state:'adopted',adoptionOperationId:x.operationId};
        (a.runtimeMigrations ||= []).push(record);await this.save();return structuredClone(record);
      });
    })));
  }
  startupInstructions(){return this.rules.startup();}
  async installInstructions(a){
    if(a.tabId)throw Error('既存セッションへ起動契約を再インストールできません。新しいAgentを作成してください。');
    let envelope={mode:'migration-required',reason:'startup-receipt-invalid'};
    try{
      const body=this.startupInstructions();
      const receipt=JSON.parse(await this.execute(a,['python3','-c',installInstructionsScript,a.workspaceId,a.provider,body]));
      if(receipt.installed===true&&receipt.hash===createHash('sha256').update(body).digest('hex'))envelope={mode:'startup-v2',hash:receipt.hash,installedAt:now()};
    }catch{envelope={mode:'migration-required',reason:'startup-instructions-unavailable'};}
    await this.persist(async()=>{a.inputEnvelope=envelope;await this.save();});
  }
  async verifyInstructions(a){
    if(a.inputEnvelope?.mode!=='startup-v2')return;
    let reason='startup-instructions-missing-or-changed';
    try{
      const result=JSON.parse(await this.execute(a,['python3','-c',verifyInstructionsScript,a.workspaceId,a.provider,a.inputEnvelope.hash||'']));
      if(result.verified===true)return;
    }catch{reason='startup-instructions-check-failed';}
    await this.persist(async()=>{a.inputEnvelope={...a.inputEnvelope,mode:'migration-required',reason,downgradedAt:now()};await this.save();});
  }
  // Only synchronous model edits and save() belong inside this boundary.
  // Read remote evidence first; dispatch external effects only after it commits.
  async persist(change,roots=this.data){return this.persistence.run(async()=>{
    const scope=this.persistence.context.getStore();
    if(scope.restore)return change();
    scope.roots=roots;scope.restore=this.units.checkpoint()||checkpoint(roots);
    try{return await change();}
    catch(error){
      if(error.persistenceUncertain)this.persistence.failure=error;
      else scope.restore();
      throw error;
    }
  });}
  async save(options){return this.persistence.run(async()=>{
    const restore=this.units.checkpoint()||checkpoint(this.persistence.context.getStore()?.roots||this.data);
    try{const task=this.store.save(options);this.queue=task;await task;this.presentationCache=null;this.flow.reporting.schedule(this.store.lastChanges.filter(c=>c.kind==='requests').map(c=>c.id));
      if(this.publishedFingerprint!==this.store.fingerprint){this.publishedFingerprint=this.store.fingerprint;setImmediate(()=>{this.events.emit('change');if(this.monitor&&!this.monitor.closed){this.monitor.update();void this.progress().catch(()=>{});}});}
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
  async runtime(a,status){this.runtimeReader ||= new RuntimeReader(this.dir);return this.runtimeReader.read(a,status,(agent,args)=>this.observationCommand(agent,args));}
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
  async send(id,input,originKind='human'){return input.mode==='conversation'?this.conversations.start(id,input,originKind):this.flow.start(id,input,originKind);}
  async attemptRun(r){return this.locked(r.agentId,async()=>{
    if(quarantinedRun(this.data,r))return r;
    if(runState(r)!=='queued'||r.nextTransferAt>Date.now()||!this.flow.schedulable(r))return r;
    const a=this.agent(r.agentId);
    const blocked=(reason,message=reason)=>this.persist(async()=>{changeRun(r,{type:modelOf(r).state.kind==='queued'?'dispatch-blocked':'lost',actor:'program',at:Date.now(),reason});r.error=message;await this.save();return r;});
    if(this.agentDeleting(a)||(a.agentModel?.intent==='stop'||agentControls(a).state==='terminated')||!a.tabId)return blocked('target-unavailable-before-dispatch');
    const baseline=await this.observe(a);
    if(this.agentDeleting(a))return blocked('project-deletion-before-dispatch');
    if(r.childContinuation&&!this.flow.childContinuationBoundary(this.flow.run(r.runModel.retryOf),baseline,a.runtime))return blocked('dispatch-boundary-changed','継続元の終了境界が変わりました。自動送信せず状況確認が必要です。');
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
    if(r.childContinuation&&!this.flow.childContinuationBoundary(this.flow.run(r.runModel.retryOf),confirmed,a.runtime))return blocked('dispatch-boundary-changed','添付転送中に継続元の終了境界が変わりました。自動送信しません。');
    if(r.autoRecoveryFrom&&(Date.now()>r.recoveryDeadline||!this.flow.recoveryBoundary(this.flow.run(r.autoRecoveryFrom),confirmed,a.runtime)))return blocked('dispatch-boundary-changed','自動再試行前に新しい入力または状態変化を検出しました。requests getで確認し手動で復旧してください。');
    await this.verifyInstructions(a);
    if(a.runtimeUpgrade?.state==='prepared'||a.runtimeRetiredTo||(a.inputEnvelope?.mode!=='startup-v2'&&!legacyAllowed(a))){
      if(r.queuedReason==='startup-contract-migration-required')return r;
      return this.persist(async()=>{r.queuedReason='startup-contract-migration-required';r.error='起動契約の更新待ち。未送信のまま保留しています。runtime adoption後に同じrunを送信します。';await this.save();return r;});
    }
    const status=a.runtime;
    if(runState(r)!=='queued'||r.phase==='report'&&!this.flow.reportCurrent(r))return r;
    const deliveredInstruction=await this.persist(async()=>{
      if(this.agentDeleting(a)||runState(r)!=='queued'||r.phase==='report'&&!this.flow.reportCurrent(r))return null;
      const compatibility=legacyAllowed(a);if(a.inputEnvelope?.mode!=='startup-v2'&&!compatibility)return null;
      const instruction=r.phase==='report'?this.flow.reportPrompt(this.flow.root(r.humanRequestId)):r.instruction;
      r.instruction=instruction;r.attachmentFiles=files;r.attachmentError=null;delete r.queuedReason;delete r.error;
      const migration=a.runtimeMigrations?.at(-1);
      if(migration?.requestContexts?.some(c=>c.humanRequestId===r.humanRequestId&&c.workId===r.workId)&&!this.data.runs.some(previous=>previous.id!==r.id&&previous.workId===r.workId&&previous.runtimeMigrationId===migration.operationId&&previous.dispatchAttemptedAt)){
        r.runtimeMigrationId=migration.operationId;
        r.runtimeHandover={operationId:migration.operationId,operatorNotes:migration.handover,requiredReads:[['requests','get',r.humanRequestId],['requests','inputs',r.humanRequestId,r.workId],['requests','results',r.humanRequestId,r.workId]],instruction:'新セッションへの引継ぎです。作業・報告前にrequiredReadsで元目的・全補足（対応済みも含む）・未対応入力・子結果・過去runの成果と操作記録を全文確認してください。operatorNotesは管理者の引継ぎ資料であり追加の操作許可ではありません。過去の外部操作は再実行せず、記録されていない操作や不明な成否は推測せず確認してください。'};
      }
      const text=instruction+this.secretaryContext(a)+this.flow.context(r)+(compatibility?legacyContext(this.rules,r,a):'');
      if(r.steerTarget){const previous=this.flow.run(r.steerTarget.runId);changeRun(previous,{type:'close-tracking',actor:'human',reason:'steering-successor-dispatched'});}
      changeRun(r,{type:'dispatch',actor:'program',at:Date.now(),sessionId:confirmed.sessionId||null,agentIdle:true});
      Object.assign(r,{inputCorrelation:inputCorrelation(text,a.provider),inputEnvelopeMode:compatibility?'legacy-compat':'startup-v2',dispatchAttemptedAt:now(),baselineRuntime:{sessionId:confirmed.sessionId,cursor:confirmed.cursor,fileIdentity:confirmed.fileIdentity},agentSessionId:status.agentSessionId||null});
      await this.save();return text;
    });
    if(deliveredInstruction===null)return r;
    if(this.agentDeleting(a))return blocked('project-deletion-before-dispatch');
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
    for(const r of this.data.runs.filter(r=>r.agentId===a.id&&!quarantinedRun(this.data,r))){
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
  observationKey(a,runs){const {lastCheckedAt,runtime,...durable}=a;return JSON.stringify([durable,runs]);}
  async observationPmux(a,...args){return this.monitor?(args[0]==='tab'&&args[1]==='status'?this.monitor.status(a):JSON.parse(await this.monitor.execute(a,['purplemux',...args]))):this.pmux(a,...args);}
  observationCommand(a,args){return this.monitor?this.monitor.execute(a,args):this.execute(a,args);}
  async observe(a){
    if(!this.units.context.getStore()?.agentIds?.has(a.id))return this.units.agent(a.id,()=>this.observe(a));
    if(this.agentDeleting(a))return this.persist(async()=>{this.releaseStuckRuns(a);this.updateAvailability(a);await this.save();return {available:false,turns:[],inputs:[]};});
    try{
      let s;
      try{s=await this.observationPmux(a,'tab','status','-w',a.workspaceId,a.tabId);}catch(error){
        const {tabs}=await this.observationPmux(a,'tab','list','-w',a.workspaceId);
        if(!Array.isArray(tabs)||tabs.some(t=>t.tabId===a.tabId))throw error;
        s={alive:false,cliState:'inactive'};
      }
      const snapshot=await this.runtime(a,s);
      let setupRequired=false;
      if(s.alive&&!s.agentSessionId){const capture=await this.observationPmux(a,'tab','capture','-w',a.workspaceId,a.tabId);setupRequired=/Do you trust|trust this|trust the contents/i.test(capture.content||'');}
      const roots={agent:a,runs:this.data.runs.filter(r=>r.agentId===a.id)};
      return await this.persist(async()=>{
      const before=this.observationKey(a,roots.runs);
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
      if(a.inputEnvelope?.mode==='startup-v2'&&s.agentSessionId){
        if(a.inputEnvelope.sessionId&&a.inputEnvelope.sessionId!==s.agentSessionId)a.inputEnvelope={...a.inputEnvelope,mode:'migration-required',reason:'native-session-changed'};
        else a.inputEnvelope.sessionId=s.agentSessionId;
      }
      if(snapshot.sessionId)a.observedSessionId=snapshot.sessionId;
      for(const r of this.data.runs.filter(r=>r.agentId===a.id&&active(r)&&!quarantinedRun(this.data,r))){
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
      this.releaseStuckRuns(a);this.updateAvailability(a);const changed=before!==this.observationKey(a,roots.runs);if(changed)await this.save();return {...snapshot,changed};
      },roots);
    }catch(error){
      if(error.persistenceFailure)throw error;
      const roots={agent:a,runs:this.data.runs.filter(r=>r.agentId===a.id)};
      return this.persist(async()=>{
      const before=this.observationKey(a,roots.runs);
      for(const r of this.data.runs.filter(r=>r.agentId===a.id&&active(r)&&!quarantinedRun(this.data,r)))r.error ||= 'runtime-unavailable';
      a.modelInfo={available:false};agentChange(a,{type:'observe',actor:'program',observation:{connected:false,process:'unknown',activity:'unknown',canSteer:false}});a.error='接続・状態取得ができません。監視を継続します。';this.releaseStuckRuns(a);this.updateAvailability(a);const changed=before!==this.observationKey(a,roots.runs);if(changed)await this.save();return {available:false,turns:[],inputs:[],changed};
      },roots);
    }
  }
  async poll(a){
    if(this.locks.has(a.id)||!a.tabId||a.agentModel?.intent==='stop'&&a.agentModel.observation?.process==='absent')return;
    return this.locked(a.id,()=>this.observe(a));
  }
  async progress(){
    this.progressDirty=true;
    if(this.progressTask)return this.progressTask;
    const task=(async()=>{
      await new Promise(resolve=>setImmediate(resolve));
      while(this.progressDirty){
        this.progressDirty=false;
        for(const [id,version] of [...this.store.jobs]){
          const q=this.data.requests.find(q=>q.id===id);
          if(q)await this.units.run(id,async()=>{await this.flow.pump(false,[q],false);await this.flow.notifications([q]);});
          this.store.acknowledge(id,version);
        }
        await this.flow.dispatchReady();
      }
    })();
    this.progressTask=task;
    try{await task;}finally{if(this.progressTask===task)this.progressTask=null;}
  }
  async tick(){
    const tasks=[];
    for(const a of this.data.agents){
      // A slow connection must not accumulate waiter cycles or block other connections.
      if(this.monitors.has(a.id))continue;
      const task=this.poll(a).then(async observation=>{if(observation?.changed)await this.progress();});
      this.monitors.set(a.id,task);
      const clear=()=>this.monitors.delete(a.id);task.then(clear,clear);tasks.push(task);
    }
    const orphaned=this.data.runs.filter(r=>!quarantinedRun(this.data,r)&&(
      r.runModel?.supersededBy&&r.runModel.state.kind==='running'&&this.flow.run(r.runModel.supersededBy)?.runModel.state.kind!=='queued'||
      active(r)&&!this.data.agents.some(a=>a.id===r.agentId&&a.tabId&&!['terminated','stopping'].includes(agentControls(a).state))));
    if(orphaned.length)await this.persist(async()=>{
      const before=JSON.stringify(orphaned);
      for(const r of orphaned){
        if(r.runModel?.supersededBy&&r.runModel.state.kind==='running')changeRun(r,{type:'close-tracking',actor:'human',reason:'steering-successor-settled'});
        if(active(r)){r.error ||= 'agent-unavailable';this.releaseStuckRuns({id:r.agentId});}
      }
      if(JSON.stringify(orphaned)!==before)await this.save();
    },{runs:this.data.runs.filter(r=>orphaned.some(o=>o.agentId===r.agentId))});
    // Queued sends/retry deadlines and API changes also need progress without a new observation.
    await this.progress();
    const observations=await Promise.allSettled(tasks);
    const failed=observations.find(x=>x.status==='rejected'&&x.reason?.persistenceFailure);if(failed)throw failed.reason;
    await Promise.allSettled([...this.flow.dispatching.values()]);
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
