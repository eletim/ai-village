import {humanProjection} from './report-view.mjs';
import {visualReportContext} from './visual-report-context.mjs';
import {hasReport} from '../src/job-state.js';
import { createHash, randomUUID } from 'node:crypto';
import { MEMO_LIMIT, RESULT_LIMIT, validMemo, recoveryReason, rotationReason, observeContext, pendingBatch } from './secretary-continuity.mjs';
import { ImageStore } from './images.mjs';
import { readFile, writeFile, rename, mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { run } from './bridge.mjs';
export class Secretariat {
  constructor(bridge, library, operations, notifier, images = new ImageStore(bridge.dir)) {
    this.images = images; this.runCodex = run; this.observeContext = observeContext;
    this.completedTurnId = null; this.memo = null; this.transition = null; this.activeTurn = null; this.operationLog = []; this.diagnostics = {};
    this.notifier = notifier; this.operations = operations; this.bridge = bridge; this.library = library; this.dir = bridge.dir;
    this.session = null; this.messages = []; this.knownReports = []; this.knownDeployments = []; this.status = 'idle'; this.queue = Promise.resolve();
    bridge.onReport = job => this.receiveReport(job).catch(error => console.error('Report conversation:', error.message));
  }
  async memoSnapshot() {
    // Read only the committed conversation, never a reply still being saved.
    let saved;
    try { saved = JSON.parse(await readFile(resolve(this.dir, 'conversation.json'), 'utf8')); }
    catch (error) { if(error.code==='ENOENT')return {memo:null}; throw new Error('秘書のメモを読み込めません'); }
    const memo = saved.memo;
    return {memo: validMemo(memo?.value) ? {value:structuredClone(memo.value),updatedAt:typeof memo.updatedAt==='string'?memo.updatedAt:null} : null};
  }
  snapshot() {
    if(!this.direct)return {status:this.status,messages:this.messages};
    const visible=humanProjection(this.direct.data);
    const agents=visible.agents.filter(a=>a.location==='mayor');
    const ids=new Set(agents.map(a=>a.id));
    const messages=visible.runs.filter(r=>ids.has(r.agentId)).flatMap(r=>[
      ...(!r.suppressUser?[{id:r.id,role:'user',content:r.instruction,travelContexts:r.travelContexts,attachments:r.attachments,at:r.createdAt}]:[]),
      ...(r.output?[{id:r.id+':reply',role:'assistant',content:r.output,finalOutput:r.finalOutput,collapsedHistory:r.collapsedHistory,state:r.state,at:r.completedAt}]:[])]);
    const available=agents.filter(a=>a.state!=='terminated'),target=available.length===1&&available[0].canSteer?available[0]:null;
    return {reportPending:agents.some(a=>a.reportPending),reportStatus:visible.runs.filter(r=>ids.has(r.agentId)&&r.phase==='report').at(-1)?.reportStatus,steering:target?{agentId:target.id,steerTarget:target.steerTarget}:null,capabilities:{steering:true,travelContexts:true,attachments:!!this.direct.attachments},status:agents.some(a=>a.state==='busy')?'thinking':'idle',messages:[...this.messages,...messages],agents};
  }
  async init() {
    await mkdir(this.dir, { recursive: true });
    let saved;
    try { saved = JSON.parse(await readFile(resolve(this.dir,'conversation.json'),'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (saved) {
      this.session = saved.codexSession || null;
      this.completedTurnId = saved.completedTurnId || null;
      const interrupted = saved.status === 'thinking' && !(this.completedTurnId && !saved.activeTurn);
      this.memo = validMemo(saved.memo?.value) ? saved.memo : null;
      this.transition = saved.transition || null; this.activeTurn = saved.activeTurn || null;
      this.operationLog = saved.operationLog || []; this.diagnostics = saved.diagnostics || {};
      if (this.transition) this.session = null; // Durable switch intent wins over an old session.
      // An interrupted model call may have committed remotely. Abandon it, retaining the delivery checkpoint.
      if (interrupted) {
        if (this.activeTurn) this.activeTurn.recovering = true;
        this.transition ||= { reason: 'restart-interrupted', from: this.session?.id || null, position: this.session?.position || (this.session?.cursor ? {id:this.session.cursor,offset:0} : null) };
        this.session = null;
      }
      this.knownDeployments = saved.knownDeployments || [];
      this.messages = saved.messages; this.knownReports = saved.knownReports || [];
      if (interrupted && !this.activeTurn) {
        const lastUser = this.messages.findLast(m=>m.role==='user');
        if (lastUser) this.activeTurn = {id:lastUser.id,recoveryAttempts:0,recovering:true,legacyInterrupted:true};
      }
      if (!this.memo) {
        const end = this.messages.findLastIndex(m=>m.role==='assistant' && !m.interrupted && (!m.kind || m.kind==='dispatch'));
        if (end>=0) {
          const reply = this.messages[end], user = this.messages.slice(0,end).findLast(m=>m.role==='user');
          const migrated = {value:{topic:(user?.content || '').slice(0,200),purpose:'旧データからの抜粋。目的は必要時に原文を確認。',decisions:reply.content.slice(0,200),permissions:'許可は未移行。村長発言の原文を確認。',unfinished:interrupted?'中断した発言と操作成否を確認。':'未確認',references:[user?.id,reply.id].filter(Boolean).join(',')},cursor:{id:reply.id,offset:0},updatedAt:new Date().toISOString(),legacy:true};
          if (validMemo(migrated.value)) this.memo = migrated;
        }
      }
      if (interrupted) this.add('assistant', '会話の処理中にサーバーが再起動しました。未完了の発言と操作記録は保存しています。操作は再実行せず、次の発言で続きと成否を確認します。', { interrupted: true });
      for (const job of this.bridge.jobs.filter(hasReport)) await this.receiveReport(job, { notify: false });
    } else {
      for (const job of this.bridge.jobs.filter(hasReport)) await this.receiveReport(job,{notify:false});
    }
    await this.persist();
  }
  async persist() {
    const text = JSON.stringify({ version: 3, completedTurnId: this.completedTurnId, codexSession: this.session, memo: this.memo, transition: this.transition, activeTurn: this.activeTurn, operationLog: this.operationLog, diagnostics: this.diagnostics, messages: this.messages, knownReports: this.knownReports, knownDeployments: this.knownDeployments, status: this.status },null,2);
    const operation = this.queue.catch(()=>{}).then(async()=>{
      await writeFile(resolve(this.dir,'conversation.tmp'),text,{mode:0o600});
      await rename(resolve(this.dir,'conversation.tmp'),resolve(this.dir,'conversation.json'));
    });
    this.queue = operation; await operation;
  }
  add(role, content, extra = {}) {
    const message = { id: randomUUID(), role, content, at: new Date().toISOString(), ...extra };
    this.messages.push(message); return message;
  }
  async publish(content, extra = {}, { notify = true } = {}) {
    const message = this.add('assistant',content,extra);
    try { await this.persist(); }
    catch (error) { this.messages = this.messages.filter(m=>m.id!==message.id); throw error; }
    // Do not await network/CLI: saved conversation and job completion stand alone.
    if (notify && !this.direct) {
      try { this.notifier?.enqueue(message)?.catch(()=>{}); } catch { /* Notification failure cannot undo a saved reply. */ }
    }
    return message;
  }
  async receiveReport(job, options) {
    if (this.knownReports.includes(job.id)) return;
    this.knownReports.push(job.id);
    try { await this.publish(job.report, { jobId: job.id, kind: 'report' }, options); }
    catch (error) { this.knownReports = this.knownReports.filter(id=>id!==job.id); throw error; }
  }
  async receiveDeployment(record) {
    if (this.knownDeployments.includes(record.id)) return;
    const file=resolve(this.dir,`deployment-report-${record.id}.txt`);
    await run(process.env.VILLAGE_CODEX_BIN || 'codex',['exec','--disable','shell_tool','--disable','multi_agent','--ephemeral','--skip-git-repo-check','-s','read-only','-C',this.dir,'-o',file,'-'],{input:`あなたはAI村の秘書ミクです。村長へ変更反映の実測結果を日本語で簡潔に報告してください。以下の記録のみを根拠に、工房で作成・Pushしたcommitと、実際にコアへ反映したcommitを区別してください。対象commitの完全SHA、検証の成否、再起動・稼働確認・Pushの結果、失敗や未確認点を明記。appliedCommitがなければ反映済みと言わない。報告のOKとAgent解放は別でまだ確認待ちの場合があると伝える。本文だけを返し、ツールは実行しない。\n${JSON.stringify(record)}`,timeout:300000});
    const text=(await readFile(file,'utf8')).trim();
    if (this.knownDeployments.includes(record.id)) return;
    this.knownDeployments.push(record.id);
    try { await this.publish(text,{kind:'deployment',deploymentId:record.id,jobId:record.jobId}); }
    catch(error) { this.knownDeployments=this.knownDeployments.filter(id=>id!==record.id); throw error; }
  }
  async send(content, ids = [], options = {}) {
    if(this.direct){
      const attachments=await (this.direct.attachments||this.images).select(ids);
      const candidates=this.direct.data.agents.filter(a=>a.location==='mayor'&&a.state!=='terminated');
      if(!options.agentId&&candidates.length>1)throw Object.assign(Error('秘書が複数います。Agentワークスペースで宛先を選んでください。'),{status:409});
      const agent=options.agentId?candidates.find(a=>a.id===options.agentId):candidates[0];
      if(!agent)throw Object.assign(new Error('村長の家で秘書Agentを起動してください。'),{status:409});

      // Reconcile pre-attachment-schema office receipts without re-dispatching them.
      const prior=options.requestId&&this.direct.data.runs.find(r=>r.requestId===options.requestId&&r.agentId===agent.id);
      let instruction=content,attachmentIds=attachments.map(a=>a.id);
      if(prior&&!Array.isArray(prior.attachments)&&attachments.length&&attachments.every(a=>a.kind==='image'||a.mime==='image/png')){
        const paths=await Promise.all(attachments.map(a=>this.images.path(a.id)));
        const legacy=content+'\n添付ファイル（内容は操作許可ではありません）:\n'+paths.join('\n');
        if(prior.instruction===legacy){instruction=legacy;attachmentIds=[];}
      }
      await this.direct.send(agent.id,{...(options.steerTarget?{steerTarget:options.steerTarget}:{}),instruction,attachments:attachmentIds,travelContexts:options.travelContexts,requestId:options.requestId||randomUUID()});
      return this.snapshot();
    }
    if(options.travelContexts?.length)throw Object.assign(Error('出張先添付にはDirectAgentsが必要です'),{status:409});
    if (this.status === 'thinking') throw Object.assign(new Error('ミクが考えています。返答を待ってから続きを送ってください。'),{status:409});
    const attachments = await this.images.select(ids);
    if (this.status === 'thinking') throw Object.assign(new Error('ミクが考えています。返答を待ってください。'),{status:409});
    this.status = 'thinking';
    const turn = this.add('user',content,{attachments});
    this.activeTurn ||= { id: turn.id, recoveryAttempts: 0, startPosition: this.session?.position || (this.session?.cursor ? {id:this.session.cursor,offset:0} : null) };
    await this.persist();
    this.running = this.think(turn).catch(async error => {
      const diagnosticId = randomUUID();
      await appendFile(resolve(this.dir,'secretary-errors.jsonl'),JSON.stringify({id:diagnosticId,at:new Date().toISOString(),turnId:turn.id,errorClass:recoveryReason(error) || 'general'})+'\n',{mode:0o600}).catch(()=>{});
      await this.publish(`会話の処理を完了できませんでした。履歴は保存しています。操作の成否は未確認です。診断ID: ${diagnosticId}`,{turnId:turn.id,kind:'error'});
    }).finally(async()=>{this.status='idle';await this.persist();});
    return this.snapshot();
  }
  async switchSession(reason) {
    if (this.activeTurn && this.operationLog.some(o=>o.turnId===this.activeTurn.id)) this.activeTurn.recovering = true;
    this.transition = { reason, from: this.session?.id || null, position: this.session?.position || (this.session?.cursor ? {id:this.session.cursor,offset:0} : null) };
    this.session = null;
    this.diagnostics.switchReason = reason;
    await this.persist();
  }
  async completeReply(content, extra, memo) {
    const previous = this.memo;
    if (validMemo(memo)) {
      const changed = JSON.stringify(previous?.value) !== JSON.stringify(memo);
      this.memo = { value: changed ? memo : previous.value, cursor: this.session?.position || previous?.cursor || null,
        updatedAt: changed ? new Date().toISOString() : previous.updatedAt, turnId: extra.turnId };
      this.diagnostics.memoUpdate = changed ? 'replaced' : 'unchanged';
    } else {
      this.diagnostics.memoUpdate = memo == null ? 'unchanged' : 'rejected';
      if (memo == null && previous) this.memo = {...previous,cursor:this.session?.position || previous.cursor,turnId:extra.turnId};
    }
    this.diagnostics.memoChars = this.memo ? JSON.stringify(this.memo.value).length : 0;
    this.diagnostics.memoLimit = MEMO_LIMIT;
    const active = this.activeTurn, completed = this.completedTurnId; this.activeTurn = null; this.completedTurnId = extra.turnId;
    try { await this.publish(content, extra); }
    catch (error) { this.memo = previous; this.activeTurn = active; this.completedTurnId = completed; throw error; }
  }
  async decide(turn, observations, step) {
    // Native Codex lifecycle events are machine-generated. The assistant's prose
    // is never decoded as JSON or interpreted as a host action.
    const file=resolve(this.dir,`conversation-${turn.id}-${step}.txt`);
    const args=['exec','--skip-git-repo-check','-s','read-only','-C',this.library.root,'--json'];
    if(this.session)args.push('resume',this.session.id);
    for(const image of turn.attachments||[])args.push('--image',await this.images.path(image.id));
    args.push('-o',file,'-');
    const output=await this.runCodex(process.env.VILLAGE_CODEX_BIN||'codex',args,{input:turn.content+visualReportContext('node '+JSON.stringify(resolve('scripts/village.mjs')),this.direct?.villageUrl||'http://127.0.0.1:5173'),timeout:300000});
    const events=output.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    if(!events.some(e=>e.type==='turn.completed')||events.some(e=>e.type==='turn.failed'))throw new Error('Runtime completion not observed');
    const id=events.find(e=>e.type==='thread.started')?.thread_id;
    if(!id||(this.session&&this.session.id!==id))throw new Error('Runtime session unknown');
    this.session={id};await this.persist();
    return {action:'reply',message:await readFile(file,'utf8'),attachments:[],memo:null};
  }
  async think(turn) {
    const interrupted = this.activeTurn?.id;
    const observations = this.messages.filter(m=>m.role==='tool' && m.turnId===interrupted).slice(-1).map(m=>({action:m.action,document:m.document,argv:m.argv,result:JSON.parse(m.content)})), reads = new Map();
    let dispatched = false, batches = 0;
    for (let step=0;step<12;step++) {
      const choice = await this.decide(turn,observations,step);
      if (choice.action === 'drain') { if (++batches >= 64) throw new Error('未処理発言の分割受領を中断しました。送信位置を保存しています。'); step--; continue; }
      if (choice.action === 'reply') {
        const attachments = await this.images.select(choice.attachments || []);
        await this.completeReply(choice.message,{turnId:turn.id,attachments},choice.memo); return;
      }
      let result;
      try {
        if (choice.action === 'read_conversation') {
          if (choice.document === 'index') {
            const offset = Math.max(0, Math.floor(Number(choice.argv?.[0]) || 0));
            result = {entries:this.messages.slice().reverse().slice(offset,offset+40).map(m=>({id:m.id,role:m.role,kind:m.kind,chars:m.content.length})),nextOffset:offset+40<this.messages.length?offset+40:null};
          } else if (choice.document.startsWith('operation:')) {
            result = this.operationLog.find(o=>o.key===choice.document.slice(10)) || {error:'操作記録が見つかりません。'};
          }
          else {
            const message = this.messages.find(m=>m.id===choice.document);
            if (!message) throw new Error('発言IDが見つかりません。');
            const offset = Math.max(0, Number(choice.argv?.[0]) || 0);
            result = { ...message, content:message.content.slice(offset,offset+12000), offset, totalChars:message.content.length };
          }
        } else if (choice.action === 'read_image') {
          result = await this.images.get(choice.document);
          await this.images.content(result.id);
          const selected = new Set([...(turn.attachments||[]).map(i=>i.id),...observations.filter(o=>o.action==='read_image'&&o.result?.id).map(o=>o.result.id),result.id]);
          if (selected.size>8) throw new Error('1ターンで閲覧できる画像は8枚までです。');
        } else if (choice.action === 'read_document') {
          result = await this.library.read(choice.document); reads.set(result.path,result.hash);
        } else if (choice.action === 'village') {
          if (!this.operations) throw new Error('村の操作窓口がありません。');
          const {command} = this.operations.resolve(choice.argv);
          if (command.mutation) {
            const manual = await this.library.read('manual.md');
            if (reads.get(manual.path)!==manual.hash) throw new Error('このターンで最新のmanual.mdをread_documentしてから操作してください。');
          }
          result = command.mutation ? await this.recordOperation(turn,choice,()=>this.operations.execute(choice.argv,`secretary:${turn.id}`)) : await this.operations.execute(choice.argv,`secretary:${turn.id}`);
        } else if (choice.action === 'read_state') {
          result = this.bridge.snapshot();
        } else {
          const connection = await this.library.workshop(choice.document);
          if (reads.get(connection.document)!==connection.documentHash) throw new Error('このターンで最新の工房資料をread_documentしてから選んでください。');
          if (choice.action === 'check_workshop') result = await this.inspect(connection);
          else if (choice.action === 'dispatch') {
            if (dispatched) throw new Error('このターンでは既に実行を試みました。結果を説明してください。');
            dispatched = true;
            if (!choice.task.trim() || !choice.message.trim()) throw new Error('工房への指示または村長への説明が空です。');
            // The connection is from the file we just read, never from model-supplied host names.
            const dispatchedResult = await this.recordOperation(turn,choice,async()=>{await this.bridge.submit(choice.message,connection,choice.task);return {ok:true,jobId:this.bridge.job.id};});
            if (!dispatchedResult.ok) throw new Error(dispatchedResult.error || '工房操作の成否は未確認です。');
            await this.completeReply(choice.message,{turnId:turn.id,jobId:dispatchedResult.jobId,kind:'dispatch'},choice.memo); return;
          }
        }
      } catch (error) { result = { error: error.message, verified: false }; }
      const message = this.add('tool',JSON.stringify(result),{turnId:turn.id,action:choice.action,document:choice.document,argv:choice.argv});
      observations.push({action:choice.action,document:choice.document,argv:choice.argv,result,messageId:message.id});
      await this.persist();
    }
    throw new Error('調査の上限に達しました。ここまでの参照結果は会話履歴に保存しています。');
  }
  async recordOperation(turn, choice, execute) {
    const turnId = this.activeTurn?.id || turn.id;
    if (this.activeTurn?.legacyInterrupted) throw new Error('旧データの中断位置では操作記録が不足しています。変更を再実行せず実状態を確認してください。');
    const key = createHash('sha256').update(JSON.stringify([turnId,choice.action,choice.document,choice.task,choice.argv])).digest('hex');
    const existing = this.operationLog.find(o=>o.key===key);
    if (existing) return existing.state === 'completed' ? existing.result : {verified:false,error:'操作の成否が未確認です。再実行せず実状態を照会してください。',operation:key};
    if (this.activeTurn?.recovering && this.operationLog.some(o=>o.turnId===turnId)) throw new Error('復旧中のターンでは追加変更を実行しません。保存された操作結果を確認して報告してください。');
    if (this.operationLog.some(o=>o.state==='started')) throw new Error('中断した操作の成否が未確認のため変更操作を停止しています。実状態と操作記録を確認してください。');
    const record = {key,turnId,action:choice.action,request:{document:choice.document,task:choice.task,argv:choice.argv},state:'started',at:new Date().toISOString()};
    this.operationLog.push(record);
    await this.persist(); // Write-ahead intent: crash after this point never replays the operation.
    let result;
    try { result = await execute(); }
    catch (error) {
      // A transport error can follow a committed side effect. Keep the uncertain intent.
      throw error;
    }
    record.result = result; record.state = 'completed';
    const message = this.add('tool',JSON.stringify(result),{turnId,action:choice.action,operation:key,document:choice.document,argv:choice.argv});
    record.resultMessage = message.id;
    await this.persist();
    return result;
  }
  async inspect(connection) {
    const script = `import os,platform,json,shutil,sys,subprocess
result={'host':platform.node(),'cpu_count':os.cpu_count(),'load_average':os.getloadavg(),'memory_kib':{},'storage':dict(zip(('total','used','free'),shutil.disk_usage(sys.argv[1])))}
with open('/proc/meminfo') as f:
 for line in f:
  key, value=line.split(':',1)
  if key in ('MemTotal','MemAvailable','SwapTotal','SwapFree'): result['memory_kib'][key]=value.strip()
try: result['gpu']=subprocess.check_output(['nvidia-smi','--query-gpu=name,utilization.gpu,memory.used,memory.total','--format=csv,noheader'],text=True,timeout=10).strip()
except Exception as e: result['gpu_unverified']=str(e)
print(json.dumps(result))`;
    const result = { checkedAt: new Date().toISOString(), document: connection.document };
    const observe = async (key, operation) => {
      try { result[key] = { verified: true, value: await operation() }; }
      catch (error) { result[key] = { verified: false, error: error.message }; }
    };
    await observe('equipment', async () => JSON.parse(await this.bridge.remote(['python3','-c',script,connection.remoteRoot],connection.sshHost)));
    await observe('workspaces', async () => JSON.parse(await this.bridge.remote(['purplemux','workspaces'],connection.sshHost)));
    const current = this.bridge.job;
    if (current?.sshHost === connection.sshHost && current.tabId && current.releaseState!=='released') {
      await observe('agent', async () => JSON.parse(await this.bridge.remote(['purplemux','tab','status','-w',current.workspaceId,current.tabId],connection.sshHost)));
    }
    return result;
  }
}
