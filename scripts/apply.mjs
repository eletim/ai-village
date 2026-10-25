import {scratchEnvironment} from './scratch-config.mjs';
// Copied with scratch-config.mjs to the durable deployment directory before launch:
// a checkout/restart cannot replace the code currently managing this operation.
import { readFile,writeFile,rename,mkdir,access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
const exec=promisify(execFile),file=process.argv[2],record=JSON.parse(await readFile(file,'utf8'));
const save=async patch=>{Object.assign(record,patch,{updatedAt:new Date().toISOString()});await writeFile(file+'.tmp',JSON.stringify(record,null,2),{mode:0o600});await rename(file+'.tmp',file);};
const command=async(cmd,args,cwd=record.root,env=process.env)=>{
  const at=new Date().toISOString();try{const r=await exec(cmd,args,{cwd,env,timeout:300000,maxBuffer:8e6});record.checks.push({command:[cmd,...args],cwd,at,ok:true,output:(r.stdout+r.stderr).slice(-10000)});await save({});return r.stdout.trim();}
  catch(error){record.checks.push({command:[cmd,...args],cwd,at,ok:false,output:((error.stdout||'')+(error.stderr||'')).slice(-10000)});await save({});throw new Error(`${cmd} ${args.join(' ')} failed (see checks)`);}
};
const git=(...args)=>command('git',args);
const clean=async()=>{if(await git('status','--porcelain'))throw new Error('コアに未commit変更があります。上書きせず停止しました。');};
let candidate;
try{
  // Keep credentials out of logs; failure is recorded by the deployment catch.
  const probeHeaders=process.env.VILLAGE_PUBLIC_ORIGIN ? {Authorization:'Basic '+Buffer.from((await readFile(process.env.VILLAGE_AUTH_FILE,'utf8')).trim()).toString('base64')} : {};
  const testEnv={...scratchEnvironment(process.env,record.stateDir),VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:''};
  const stat=await readFile(`/proc/${process.pid}/stat`,'utf8');
  await save({phase:'checking',workerPid:process.pid,workerStart:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],checks:[]});
  const supervisor=JSON.parse(await readFile(resolve(record.stateDir,'supervisor.json'),'utf8'));process.kill(supervisor.pid,0);
  await clean();if(await git('branch','--show-current')!==record.branch||['main','master'].includes(record.branch))throw new Error('反映先ブランチが一致しません。');
  if((await git('remote','get-url','origin')).replace(/\.git$/,'')!==record.repository.replace(/\.git$/,''))throw new Error('コアのoriginと開発資料が一致しません。');
  const from=await git('rev-parse','HEAD');await save({fromCommit:from});
  await git('fetch',record.repository,`refs/heads/${record.changeBranch}`);if(await git('rev-parse','FETCH_HEAD')!==record.targetCommit)throw new Error('対象commitとリモート先端が異なります。');
  await git('merge-base','--is-ancestor',from,record.targetCommit);
  candidate=resolve(record.stateDir,'deployments',record.id,'candidate');await git('worktree','add','--detach',candidate,record.targetCommit);
  await command('npm',['ci'],candidate);
  // Older candidates without scratch remain deployable. Configured scratch must pass real probes.
  const hasScratch=await access(resolve(candidate,'scripts/diagnose-scratch.mjs')).then(()=>true,()=>false);
  if(hasScratch){
    await command(process.execPath,['scripts/diagnose-scratch.mjs','--deployment'],candidate,testEnv);
    if(testEnv.VILLAGE_SCRATCH_RUNTIME || testEnv.VILLAGE_SCRATCH_BWRAP || testEnv.VILLAGE_SCRATCH_FONT || testEnv.VILLAGE_SCRATCH_REQUIRED){
      testEnv.VILLAGE_SCRATCH_REQUIRED='1';
      const preflight=await access(resolve(candidate,'scripts/preflight-scratch.mjs')).then(()=>true,()=>false);
      await command('npm',['run',preflight?'scratch:preflight':'test:scratch'],candidate,testEnv);
    }
  }
  await command('npm',['run','check'],candidate);await command('npm',['test'],candidate,testEnv);
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  await command('npm',['run','test:ui'],candidate,{...testEnv,VILLAGE_TEST_PORT:String(port),VILLAGE_TEST_STATE:resolve(record.stateDir,'deployments',record.id,'browser-state'),VILLAGE_NOTIFICATIONS:'false'});
  await command('npm',['run','build'],candidate);
  await clean();if(await git('rev-parse','HEAD')!==from)throw new Error('検証中にコアHEADが変わりました。');
  await save({phase:'applying'});await git('merge','--ff-only',record.targetCommit);await save({appliedCommit:await git('rev-parse','HEAD'),appliedAt:new Date().toISOString()});
  await command('npm',['ci']);
  await command('npm',['run','build']);
  const before=await(await fetch(record.healthUrl+'/api/health',{headers:probeHeaders,signal:AbortSignal.timeout(5000)})).json();
  await save({phase:'restarting',beforeInstance:before.instanceId});
  const restart=resolve(record.stateDir,'restart.json');await writeFile(restart+'.tmp',JSON.stringify({id:record.id,targetCommit:record.targetCommit}));await rename(restart+'.tmp',restart);
  const deadline=Date.now()+60000;let verified;
  while(Date.now()<deadline){try{
    const health=await(await fetch(record.healthUrl+'/api/health',{headers:probeHeaders,signal:AbortSignal.timeout(2000)})).json();
    if(health.commit!==record.targetCommit||health.instanceId===before.instanceId)throw new Error('waiting');
    if((testEnv.VILLAGE_SCRATCH_RUNTIME || testEnv.VILLAGE_SCRATCH_BWRAP || testEnv.VILLAGE_SCRATCH_FONT || testEnv.VILLAGE_SCRATCH_REQUIRED) && !health.scratch?.available)throw new Error('scratch unavailable after restart');
    const office=await fetch(record.healthUrl+'/office',{headers:probeHeaders,signal:AbortSignal.timeout(3000)});if(!office.ok)throw new Error('office failed');
    const state=await(await fetch(record.healthUrl+'/api/state',{headers:probeHeaders,signal:AbortSignal.timeout(3000)})).json();if(!state.secretary.messages.length||!state.jobs.some(j=>j.id===record.jobId))throw new Error('persisted state missing');
    verified={health,officeStatus:office.status,conversationMessages:state.secretary.messages.length,jobRestored:true};break;
  }catch{await new Promise(r=>setTimeout(r,500));}}
  if(!verified)throw new Error('再起動後のcommit・執務室・保存状態を確認できません。');await save({verification:verified,restarted:true});
  await git('push','origin',`HEAD:refs/heads/${record.branch}`);await save({pushed:true,phase:'succeeded',finishedAt:new Date().toISOString()});
}catch(error){await save({phase:'failed',error:error.message,finishedAt:new Date().toISOString()});}
finally{if(candidate){try{await command('git',['worktree','remove',candidate]);}catch{}}}
