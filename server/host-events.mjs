import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
const script=readFileSync(new URL('./host-events.py',import.meta.url),'utf8');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export const hostKey=a=>a.connection.connectionType==='local'?'local':'ssh:'+a.connection.sshHost;
export class HostEvents extends EventEmitter {
 constructor(connection,{spawnProcess=spawn,localBin='purplemux'}={}){super();Object.assign(this,{connection,spawnProcess,localBin});this.pending=new Map();this.waiting=[];this.attempt=0;this.closed=false;}
 start(){
  if(this.closed)return;
  const remote=this.connection.connectionType==='ssh';
  const args=remote?['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=2',this.connection.sshHost,'bash -lic '+quote('exec python3 -u -c '+quote(script))]:['-u','-c',script];
  const child=this.spawnProcess(remote?'ssh':'python3',args,{stdio:['pipe','pipe','pipe']});this.child=child;this.ready=false;this.seq=0;
  let buffer='',ended=false;
  const disconnected=()=>{
   if(ended)return;ended=true;this.ready=false;clearTimeout(this.startTimer);clearInterval(this.heartbeat);
   child.kill();for(const {reject,timer} of this.pending.values()){clearTimeout(timer);reject(Error('変更通知の接続が切れました。操作は自動再送しません'));}this.pending.clear();for(const {reject} of this.waiting)reject(Error('変更通知の接続が切れました。操作は自動再送しません'));this.waiting=[];
   this.emit('offline');if(!this.closed){this.retry=setTimeout(()=>this.start(),Math.min(60000,1000*2**Math.min(this.attempt++,6)));this.retry.unref();}
  };
  child.on('error',disconnected);child.on('close',disconnected);child.stdin.on('error',disconnected);
  child.stderr.on('data',()=>{}); // Remote diagnostics can contain source/credentials; never publish them.
  child.stdout.on('data',chunk=>{
   buffer+=chunk.toString();if(buffer.length>24000000)return disconnected();
   let split;while((split=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,split);buffer=buffer.slice(split+1);let event;try{event=JSON.parse(line);}catch{return disconnected();}
    if(event.seq!==this.seq+1)return disconnected();this.seq=event.seq;this.lastReceived=Date.now();
    if(event.type==='ready'){
     if(event.protocol!==1)return disconnected();this.ready=true;this.attempt=0;clearTimeout(this.startTimer);this.emit('ready');
     this.heartbeat=setInterval(()=>{if(Date.now()-this.lastReceived>90000)return disconnected();this.send({type:'ping'});},30000);this.heartbeat.unref();
    }else if(event.type==='response'){
     const pending=this.pending.get(event.id);if(pending){this.pending.delete(event.id);clearTimeout(pending.timer);event.error?pending.reject(Error(event.error)):pending.resolve(event.output);this.flush();}
    }else if(event.type==='changed')this.emit('changed',event);
    else if(event.type==='resync'||event.type==='error')disconnected();
   }
  });
  this.startTimer=setTimeout(disconnected,20000);this.startTimer.unref();
 }
 send(message){if(this.child?.stdin.writable){if(this.child.stdin.writableLength>4000000){this.child.kill();return;}this.child.stdin.write(JSON.stringify(message)+'\n');}}
 execute(args){return this.request('command',{args:args[0]==='purplemux'&&this.connection.connectionType==='local'?[this.localBin,...args.slice(1)]:args});}
 async inspect(a){return JSON.parse(await this.request('watch-process',{agentId:a.id,sessionName:a.sessionName}));}
 request(type,fields){
  if(!this.ready)return Promise.reject(Error('変更通知の接続待ちです'));
  return new Promise((resolve,reject)=>{this.waiting.push({type,fields,resolve,reject});this.flush();});
 }
 flush(){
  while(this.ready&&!this.closed&&this.pending.size<2&&this.waiting.length){
   const {type,fields,resolve,reject}=this.waiting.shift(),id=randomUUID();
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('ホスト処理の応答期限を超過しました'));this.child?.kill();},70000);timer.unref();
   this.pending.set(id,{resolve,reject,timer});this.send({type,id,...fields});
  }
 }

 close(){this.closed=true;clearTimeout(this.retry);clearTimeout(this.startTimer);clearInterval(this.heartbeat);this.child?.kill();}
}
