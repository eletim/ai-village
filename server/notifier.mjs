import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// AWM transport contract: notify send --title ... --message ... --click ... .
// Credentials and NOTIFY_CONFIG precedence belong to the CLI, never to our API.
export class VillageNotifier {
  constructor({ dir, environment = process.env } = {}) {
    this.dir = resolve(dir || environment.VILLAGE_STATE_DIR || '.runtime');
    this.environment = { ...environment };
    this.enabled = !['0','false','off'].includes((environment.VILLAGE_NOTIFICATIONS || 'true').toLowerCase());
    this.executable = environment.VILLAGE_NOTIFY_BIN || 'notify';
    const timeout = Number(environment.VILLAGE_NOTIFY_TIMEOUT_MS || 10000);
    this.timeout = Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 30000) : 10000;
    this.officeUrl = null;
    try {
      const url = new URL(environment.VILLAGE_OFFICE_URL);
      if (['http:','https:'].includes(url.protocol) && !url.username && !url.password && /^\/office\/?$/.test(url.pathname) && !url.hash) this.officeUrl = url.href;
    } catch { /* A missing/invalid destination must not break the village. */ }
    this.seen = new Set(); this.queue = Promise.resolve(); this.latest = null; this.journalAvailable = true;
  }
  async init() {
    try {
      await mkdir(this.dir,{recursive:true});
      for (const line of (await readFile(resolve(this.dir,'notifications.jsonl'),'utf8')).split('\n').filter(Boolean)) {
        // A partial trailing record after a crash is not grounds to replay history.
        try { const entry=JSON.parse(line); this.seen.add(entry.messageId); this.latest=entry; } catch {}
      }
    } catch(error) {
      if(error.code!=='ENOENT') {
        // If deduplication history cannot be read, skip delivery rather than
        // replaying messages or preventing the village from starting.
        this.journalAvailable=false;this.latest={status:'notification_journal_unavailable',delivered:false};
      }
    }
  }
  status() {
    return { enabled:this.enabled, officeUrl:this.officeUrl, destinationConfigured:!!this.officeUrl, journalAvailable:this.journalAvailable,
      executable:this.executable, timeoutMs:this.timeout, configPath:this.environment.NOTIFY_CONFIG || null,
      latest:this.latest, deliveryMeaning:'notify CLI exit 0 means server accepted; device receipt/click is not confirmed' };
  }
  async record(entry) {
    await appendFile(resolve(this.dir,'notifications.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});
    this.latest=entry;
  }
  enqueue(message) {
    if(!this.journalAvailable)return Promise.resolve({status:'notification_journal_unavailable',delivered:false});
    if(message.role!=='assistant' || this.seen.has(message.id))return Promise.resolve({status:'duplicate_or_internal',delivered:false});
    this.seen.add(message.id);
    const task=this.queue.catch(()=>{}).then(async()=>{
      const base={messageId:message.id,kind:message.kind || 'reply'};
      const skip=!this.enabled?'disabled':!this.officeUrl?'office_url_missing_or_invalid':null;
      if(skip){const result={...base,at:new Date().toISOString(),status:skip,delivered:false};await this.record(result);return result;}
      // Claim before the external side effect; neither restart nor UI restoration retries it.
      await this.record({...base,at:new Date().toISOString(),status:'attempting',delivered:false});
      const title=message.kind==='deployment'?'AI村 · 村への変更反映':message.kind==='report'?'AI村 · 工房からの報告':message.kind==='error'?'AI村 · ミクからのお知らせ':message.kind==='test'?'AI村 · 通知テスト':'AI村 · ミクからの返答';
      const prose=message.content || (message.attachments?.length ? `ミクから画像が${message.attachments.length}枚届きました。執務室で確認できます。` : '');
      const content=Array.from(prose).slice(0,2000).join('')+(Array.from(prose).length>2000?'…':'');
      const outcome=await this.send(title,content);
      const result={...base,at:new Date().toISOString(),...outcome};
      await this.record(result);return result;
    });
    // Only sanitized diagnostics. Never return/log the CLI's output or environment.
    this.queue=task.catch(()=>{
      this.latest={messageId:message.id,status:'notification_journal_failed',delivered:false};return this.latest;
    });
    return this.queue;
  }
  send(title, message) {
    return new Promise(resolve=>{
      let child, timer, done=false;
      const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve(result);};
      try {
        child=spawn(this.executable,['send','--title',title,'--message',message,'--click',this.officeUrl],{env:this.environment,stdio:'ignore',detached:true});
      } catch {finish({status:'cli_unavailable',delivered:false});return;}
      timer=setTimeout(()=>{
        try{process.kill(-child.pid,'SIGKILL');}catch{}
        finish({status:'timed_out',delivered:false});
      },this.timeout);
      child.on('error',error=>finish({status:error.code==='ENOENT'?'cli_unavailable':'cli_start_failed',delivered:false}));
      child.on('close',code=>finish({status:code===0?'sent':'cli_failed',delivered:code===0,exitCode:code}));
    });
  }
  async test() {
    return this.enqueue({id:`test:${randomUUID()}`,role:'assistant',kind:'test',content:'AI村の通知テストです。クリックすると設定した執務室を開きます。'});
  }
  async flush() { await this.queue; }
}
