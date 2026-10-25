import { readFile,writeFile,mkdir,copyFile,readdir,open,rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { run,activePhases } from './bridge.mjs';
import { openGitTransport } from './git-transport.mjs';
const terminal=new Set(['succeeded','failed']);
export async function developmentProfile(library){
  const doc=await library.read('development.md'),fields={};
  const header=doc.content.match(/^---\n([\s\S]*?)\n---/);if(!header)throw new Error('development.mdの設定がありません。');
  for(const line of header[1].split('\n')){const m=line.match(/^([a-z_]+):\s*(.+)$/);if(m)fields[m[1]]=m[2].startsWith('"')?JSON.parse(m[2]):m[2];}
  const repo=new URL(fields.repository);if(repo.hostname!=='github.com'||repo.protocol!=='https:'||repo.username||repo.password||repo.search||repo.hash)throw new Error('開発資料のrepositoryが不正です。');
  if(!fields.branch||fields.branch==='main'||fields.branch==='master'||!/^[\w./-]+$/.test(fields.branch))throw new Error('main以外の開発ブランチを指定してください。');
  if(resolve(fields.source_dir||'')!==resolve('.'))throw new Error('資料のsource_dirと稼働ソースの場所が一致しません。');
  return {document:doc.path,documentHash:doc.hash,repository:repo.href.replace(/\.git$/,'')+'.git',branch:fields.branch,sourceDir:resolve(fields.source_dir),workshopDocument:fields.workshop_document};
}
export class Development {
  constructor(bridge,library,{port=5173}={}){
    this.bridge=bridge;this.library=library;this.dir=resolve(bridge.dir,'deployments');this.healthUrl=`http://127.0.0.1:${port}`;this.transports=new Map();this.delivering=new Set();this.applying=new Map();
    bridge.canSubmit=async()=>{if((await this.list()).some(record=>!terminal.has(record.phase)))throw Object.assign(new Error('村への反映中です。新しい工房の配置は反映結果の確認後に行ってください。'),{status:409});};
    bridge.prepareJob=job=>job.development?this.prepare(job):undefined;
    bridge.inspectResult=job=>job.development?this.inspect(job.id).catch(async error=>{await bridge.update({development:{...job.development,inspectionError:error.message}},job);}):undefined;
    bridge.onDevelopmentReady=job=>job.development?.autoApply?this.apply(job.id).catch(error=>console.error('Automatic deployment:',error.message)):undefined;
    bridge.onReleased=job=>{this.transports.get(job.id)?.close();this.transports.delete(job.id);};
  }
  async profile(){return developmentProfile(this.library);}
  async start(task,{autoApply=false}={}){
    const cfg=await this.profile(),connection=await this.library.workshop(cfg.workshopDocument);
    const baseCommit=(await run('git',['rev-parse','HEAD'])).trim(),changeBranch=`village/work-${randomUUID()}`;
    const branch=(await run('git',['branch','--show-current'])).trim();if(branch!==cfg.branch)throw new Error('コアのブランチが開発資料と一致しません。');
    await this.bridge.submit(task,connection,task,{development:{...cfg,baseCommit,changeBranch,autoApply,applied:false}});
    return {jobId:this.bridge.job.id,changeBranch,baseCommit,autoApply,phase:this.bridge.job.phase};
  }
  async prepare(job){
    const d=job.development,transport=await openGitTransport({repository:d.repository,branch:d.changeBranch,host:job.sshHost});this.transports.set(job.id,transport);
    const docs=[await this.library.read(d.document),await this.library.read(d.workshopDocument)];
    const script=`import sys,json,os\nroot=sys.argv[1]\nfor doc in json.loads(sys.argv[2]):\n with open(os.path.join(root,'.village-'+os.path.basename(doc['path'])),'w') as f:f.write(doc['content'])`;
    await this.bridge.remote(['python3','-c',script,job.cwd,JSON.stringify(docs)],job.sshHost,job.id);
    const instruction=`${job.instruction}\n\nこれは村自身の開発です。専用作業場所 ${job.cwd} 内にある .village-development.md と .village-${d.workshopDocument.split('/').at(-1)} を最初に読んでください。コアのローカルパスは使わず、工房内 ${job.cwd}/source に次の仕事専用Git接続からcloneしてください。\ngit clone --branch ${d.branch} ${transport.url} ${job.cwd}/source\n取得後に base commit ${d.baseCommit} が含まれることを確認し、git switch -c ${d.changeBranch} ${d.baseCommit} で専用ブランチを作成。修正・必要なテスト・ビルドを実施し、git commitし、git push origin HEAD:refs/heads/${d.changeBranch} で実際にPushしてください。コアの認証はこの接続が仲介し、認証値は返しません。GitHub CLIの再認証やtoken取得は不要です。他ブランチはPushできません。mainへは一切変更しないでください。他Agentへ委任せず、この1人で作業してください。\n最後に自然文で変更内容、検証結果、commitの完全なSHA、Pushしたブランチ、未確認点を報告してください。工房でPushしただけでは稼働中の村にはまだ反映されません。反映操作はコアが別途行います。`;
    await this.bridge.update({instruction,development:{...d,repositoryDir:job.cwd+'/source',transportUrl:transport.url}},job);
  }
  async inspect(id){
    const job=this.bridge.jobById(id),d=job.development;if(!d?.repositoryDir)throw new Error('村開発の作業場所がありません。');
    const script=`import subprocess,json,sys\np=sys.argv[1]\ndef git(*args):return subprocess.check_output(['git','-C',p,*args],text=True).strip()\nprint(json.dumps({'commit':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'dirty':bool(git('status','--porcelain'))}))`;
    const result=JSON.parse(await this.bridge.remote(['python3','-c',script,d.repositoryDir],job.sshHost,job.id));
    if(!/^[0-9a-f]{40}$/.test(result.commit)||result.branch!==d.changeBranch||result.dirty)throw new Error('工房のcommit・ブランチ・クリーンな作業ツリーを確認できません。');
    const remote=(await run('git',['ls-remote',d.repository,`refs/heads/${d.changeBranch}`])).trim().split(/\s/)[0];
    if(remote!==result.commit)throw new Error('工房のcommitとGitHubブランチ先端が一致しません。');
    const development={...d,result:{...result,pushed:true,verifiedAt:new Date().toISOString()},inspectionError:null};await this.bridge.update({development},job);return development;
  }
  async list(){
    await mkdir(this.dir,{recursive:true});const result=[];
    for(const name of await readdir(this.dir)){
      if(!/^[0-9a-f-]{36}\.json$/.test(name))continue;
      const file=resolve(this.dir,name);let record=JSON.parse(await readFile(file,'utf8'));
      if(!terminal.has(record.phase)){
        let lost=false;
        if(record.workerPid){try{const stat=await readFile(`/proc/${record.workerPid}/stat`,'utf8'),parts=stat.slice(stat.lastIndexOf(')')+2).split(' ');lost=parts[0]==='Z'||(record.workerStart&&parts[19]!==record.workerStart);}catch{lost=true;}}
        else lost=Date.now()-new Date(record.createdAt).getTime()>30000;
        if(lost){
          record=JSON.parse(await readFile(file,'utf8'));
          if(!terminal.has(record.phase)){
            record={...record,phase:'failed',error:'反映プロセスの終了を検出しました。完了は未確認です。appliedCommitと検証記録を確認してください。',finishedAt:new Date().toISOString()};
            await writeFile(file+'.recover',JSON.stringify(record,null,2),{mode:0o600});await rename(file+'.recover',file);
          }
        }
      }
      result.push(record);
    }return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async get(id){if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('反映IDが不正です。');return JSON.parse(await readFile(resolve(this.dir,id+'.json'),'utf8'));}
  apply(jobId,options={}){
    if(this.applying.has(jobId))return this.applying.get(jobId);
    if(this.applying.size)throw new Error('別の変更反映を開始中です。結果を確認してください。');
    const operation=this.doApply(jobId,options).finally(()=>this.applying.delete(jobId));this.applying.set(jobId,operation);return operation;
  }
  async doApply(jobId,{retry=false}={}){
    const records=await this.list(),previous=records.find(record=>record.jobId===jobId);
    if(previous&&(!retry||!terminal.has(previous.phase)||previous.phase==='succeeded'))return previous;
    if(records.some(record=>!terminal.has(record.phase)))throw new Error('別の反映が実行中です。');
    if(this.bridge.jobs.some(j=>activePhases.has(j.phase)))throw new Error('実行中の仕事があるため、反映は保留します。完了後に実行してください。');
    const job=this.bridge.jobById(jobId);if(!job.report||job.cancelRequestedAt)throw new Error('完成報告のある村開発の仕事だけを反映できます。');
    const cfg=await this.profile(),d=await this.inspect(jobId);if(cfg.repository!==d.repository||cfg.branch!==d.branch)throw new Error('仕事と現在の開発対象が異なります。');
    const id=randomUUID(),record={id,jobId,createdAt:new Date().toISOString(),phase:'queued',targetCommit:d.result.commit,workshopVerification:d.result,changeBranch:d.changeBranch,branch:cfg.branch,repository:cfg.repository,root:cfg.sourceDir,stateDir:this.bridge.dir,healthUrl:this.healthUrl};
    const folder=resolve(this.dir,id);await mkdir(folder,{recursive:true});await copyFile(resolve('scripts/apply.mjs'),resolve(folder,'runner.mjs'));await copyFile(resolve('scripts/scratch-config.mjs'),resolve(folder,'scratch-config.mjs'));
    const file=resolve(this.dir,id+'.json');await writeFile(file,JSON.stringify(record,null,2),{mode:0o600});
    await this.bridge.update({development:{...job.development,deploymentId:id,deploymentPhase:'queued'}},job);
    const log=await open(resolve(folder,'runner.log'),'a',0o600);
    const child=spawn(process.execPath,[resolve(folder,'runner.mjs'),file],{cwd:cfg.sourceDir,env:process.env,detached:true,stdio:['ignore',log.fd,log.fd]});child.on('error',()=>writeFile(file,JSON.stringify({...record,phase:'failed',error:'反映プロセスを開始できません。',finishedAt:new Date().toISOString()}),{mode:0o600}).catch(()=>{}));child.unref();await log.close();return record;
  }
  watch(secretary){
    const tick=async()=>{
      for(const record of await this.list()){
        if(!terminal.has(record.phase)||secretary.knownDeployments.includes(record.id)||this.delivering.has(record.id))continue;
        this.delivering.add(record.id);
        try{
          const job=this.bridge.jobById(record.jobId);
          await this.bridge.update({development:{...job.development,deploymentId:record.id,deploymentPhase:record.phase,applied:!!record.appliedCommit,appliedCommit:record.appliedCommit || null,verification:record.verification || null}},job);
          await secretary.receiveDeployment({...record,workshopVerification:record.workshopVerification || job.development?.result,workshopReport:job.report});
        }catch(error){console.error('Deployment report unavailable:',error.message);}finally{this.delivering.delete(record.id);}
      }
    };
    const timer=setInterval(()=>tick().catch(error=>console.error('Deployment status unavailable:',error.message)),1500);timer.unref();tick().catch(()=>{});
  }
}
