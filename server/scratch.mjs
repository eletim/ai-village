import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const runner = fileURLToPath(new URL('./scratch-runner.py', import.meta.url));
const valid = name => typeof name==='string' && /^[\p{L}\p{N}_-][\p{L}\p{N}_. -]{0,119}$/u.test(name);
const idOK = id => /^[0-9a-f-]{36}$/.test(id);
export class Scratch {
  constructor(dir, images, runtime=process.env.VILLAGE_SCRATCH_RUNTIME) { this.root=resolve(dir,'secretary-work'); this.images=images; this.runtime=runtime; this.busy=false; }
  async init() { await mkdir(this.root,{recursive:true,mode:0o700}); }
  async save(name,value) { await this.init(); await writeFile(resolve(this.root,name+'.tmp'),JSON.stringify(value),{mode:0o600}); await rename(resolve(this.root,name+'.tmp'),resolve(this.root,name+'.json')); }
  async load(name, fallback) { try{return JSON.parse(await readFile(resolve(this.root,name+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;} }
  async files() { return this.load('files',{}); }
  validate(files) { let size=0; if(!files||Array.isArray(files)||Object.keys(files).length>100)throw Error('ファイル数制限'); for(const [name,data] of Object.entries(files)){ if(!valid(name)||typeof data!=='string'||(data.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)))throw Error('ファイル形式が不正'); const bytes=Buffer.from(data,'base64').length;size+=bytes;if(bytes>8*1024*1024||size>16*1024*1024)throw Error('ファイル容量制限'); } }
  async get(id) { if(!idOK(id))throw Error('実行IDが不正'); const record=await this.load('run-'+id); if(!record)throw Error('実行記録なし'); if(record.state==='running'&&this.activeId!==id)return {...record,ok:false,state:'unknown',message:'中断した実行です。自動再送しません。'}; return record; }
  async execute(id,code) {
    if(!idOK(id)||typeof code!=='string'||code.length>2000)throw Error('IDまたはコードが不正');
    const prior=await this.load('run-'+id); if(prior)return this.get(id);
    if(this.busy)throw Error('作業場所は実行中');
    this.busy=true; this.activeId=id; this.cancelled=false;
    const record={id,state:'running',at:new Date().toISOString(),codeHash:createHash('sha256').update(code).digest('hex')};
    try {
      await this.save('run-'+id,record);
      if(!this.runtime)throw Error('runtime unavailable');
      const args=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--clearenv','--setenv','PATH','/usr/bin','--setenv','PYTHONPATH','/runtime','--setenv','HOME','/work',
        '--ro-bind','/usr/bin','/usr/bin','--ro-bind','/usr/lib','/usr/lib','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--ro-bind','/usr/share/fonts','/usr/share/fonts',
        '--ro-bind',resolve(this.runtime),'/runtime','--ro-bind',runner,'/runner.py','--proc','/proc','--dir','/dev','--ro-bind','/dev/null','/dev/null','--ro-bind','/dev/urandom','/dev/urandom','--size','67108864','--tmpfs','/work','--remount-ro','/','--chdir','/work','/usr/bin/python3','-B','/runner.py'];
      const snapshot=await this.files(); this.validate(snapshot);
      if(this.cancelled)throw Error('cancelled');
      const result=await new Promise((accept,reject)=>{
        const child=spawn(process.env.VILLAGE_SCRATCH_BWRAP || '/usr/bin/bwrap',args,{env:{},stdio:['pipe','pipe','pipe']});let output=[],size=0,killed=false;
        const timer=setTimeout(()=>{killed=true;child.kill('SIGKILL');},10000);
        child.stdout.on('data',chunk=>{size+=chunk.length;if(size>24*1024*1024){killed=true;child.kill('SIGKILL');}else output.push(chunk);});
        let stderrBytes=0;child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>16000){killed=true;child.kill('SIGKILL');}});child.stdin.on('error',()=>{});
        child.on('error',()=>{clearTimeout(timer);reject(Error('sandbox unavailable'));});
        child.on('close',code=>{clearTimeout(timer);if(code!==0||killed)reject(Error('sandbox stopped'));else {try{accept(JSON.parse(Buffer.concat(output)));}catch{reject(Error('invalid result'));}}});
        child.stdin.end(JSON.stringify({code,files:snapshot}));
        this.child=child;
      });
      this.validate(result.files);
      if(typeof result.output!=='string'||result.output.length>16000)throw Error('output limit');
      await this.save('files',result.files);
      Object.assign(record,{state:result.ok?'succeeded':'failed',output:result.output});
    } catch { Object.assign(record,{state:this.cancelled?'cancelled':'failed',output:'隔離実行が失敗または制限で停止しました。設備を確認し、同じIDを再送しないでください。'}); }
    finally {record.ok=record.state==='succeeded';record.finishedAt=new Date().toISOString();try {await this.save('run-'+id,record);} finally {this.child=null;this.busy=false;this.activeId=null;}}
    return record;
  }
  async publish(name) { const files=await this.files();if(!valid(name)||!Object.hasOwn(files,name))throw Error('ファイルなし'); const bytes=Buffer.from(files[name],'base64'); if(/\.png$/i.test(name))return this.images.save(bytes,name,{kind:'secretary-work',name}); const id=randomUUID();await this.save('download-'+id,{name,data:files[name]});return {id,name,url:'/api/secretary-files/'+id}; }
  async download(id) {if(!idOK(id))throw Error('IDが不正');const file=await this.load('download-'+id);if(!file)throw Error('ファイルなし');return {name:file.name,bytes:Buffer.from(file.data,'base64')};}
  commands() { const command=(verb,count,mutation,run)=>({name:'work '+verb,usage:'work '+verb+({run:' UUID PYTHON',get:' UUID',cancel:' UUID',read:' NAME',write:' NAME TEXT',publish:' NAME'}[verb] || ''),mutation,run:args=>{if(args.length!==count)throw Error('引数数を確認してください');return run(...args);}});return [
    command('run',2,true,(id,code)=>this.execute(id,code)),
    command('get',1,false,id=>this.get(id)),
    command('cancel',1,true,async id=>{if(id===this.activeId){this.cancelled=true;this.child?.kill('SIGKILL');}return this.get(id);}),
    command('runs',0,false,async()=>{await this.init();return Promise.all((await readdir(this.root)).filter(n=>/^run-.*\.json$/.test(n)).map(n=>this.get(n.slice(4,-5))));}),
    command('list',0,false,async()=>Object.entries(await this.files()).map(([name,data])=>({name,size:Buffer.from(data,'base64').length}))),
    command('read',1,false,async name=>{const files=await this.files();if(!valid(name)||!Object.hasOwn(files,name))throw Error('ファイルなし');const bytes=Buffer.from(files[name],'base64');if(bytes.length>16000)throw Error('読取は16000 bytesまで');return {name,text:bytes.toString('utf8')};}),
    command('write',2,true,async(name,text)=>{
      if(this.busy)throw Error('実行中');
      if(!valid(name))throw Error('単一ファイル名を指定');
      this.busy=true;
      try {const files=await this.files();Object.defineProperty(files,name,{value:Buffer.from(text).toString('base64'),enumerable:true,configurable:true,writable:true});this.validate(files);await this.save('files',files);return {name};}
      finally {this.busy=false;}
    }),
    command('publish',1,true,name=>this.publish(name)),
  ]; }
}
