import {spawn} from 'node:child_process';
import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const stateDirectory=(dir)=>resolve(dir||process.env.VILLAGE_STATE_DIR||'.runtime');
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
export function run(command, args, { input, timeout = 60000, signal, maxOutput = 15e6 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('処理はキャンセルされました。')); return; }
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: !!signal });
    let stdout = '', stderr = '', settled = false, stopped, killTimer;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (error) { Object.defineProperty(error,'stdout',{value:stdout,configurable:true}); reject(error); } else resolve(result);
    };
    const stop = error => {
      stopped ||= error;
      const kill = name => { try { if (signal) process.kill(-child.pid, name); else child.kill(name); } catch {} };
      kill('SIGTERM'); killTimer ||= setTimeout(() => kill('SIGKILL'), 1000);
    };
    const abort = () => stop(new Error('処理はキャンセルされました。'));
    const timer = setTimeout(() => stop(new Error(`${command}: timeout`)), timeout);
    // Decode as a stream: a multi-byte character split across pipe chunks must not become U+FFFD.
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > maxOutput) stop(new Error(`${command}: output too large`)); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.on('error', error => finish(error));
    child.on('close', code => finish(stopped || (code === 0 ? null : new Error(`${command} exited ${code}: ${stderr || stdout}`)), stdout));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    signal?.addEventListener('abort', abort, {once:true}); if (signal?.aborted) abort();
  });
}


export function remoteExecutor(dir){return async(args,host,agentId=null,options={})=>{
 if(!host)throw Error('保存された接続先がありません。');
 await appendFile(resolve(dir,'ssh-audit.jsonl'),JSON.stringify({at:new Date().toISOString(),host,command:args[0],operation:args[0]==='purplemux'?args.slice(1,3):[],agentId})+'\n',{mode:0o600});
 return run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10',host,'bash -lic '+quote(args.map(quote).join(' '))],options);
};}
