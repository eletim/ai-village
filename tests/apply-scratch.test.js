import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,symlink,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Git/npm are fixtures. The actual durable apply worker and scratch doctor run,
// but no core, remote, merge, installation or restart can be reached.
for(const required of [false,true])test(`apply fixture: ${required?'required missing equipment blocks':'disabled scratch permits existing checks before'} merge`,async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'apply-scratch-fixture-'));
 try {
  const bin=resolve(dir,'bin'),state=resolve(dir,'state'),candidate=resolve(state,'deployments/test/candidate'),root=resolve(dir,'root');
  for(const path of [bin,state,root,resolve(candidate,'scripts'),resolve(candidate,'server')])await mkdir(path,{recursive:true});
  for(const name of ['scripts/diagnose-scratch.mjs','server/scratch.mjs','server/images.mjs'])await copyFile(name,resolve(candidate,name));
  await symlink(resolve('node_modules'),resolve(candidate,'node_modules'),'dir');
  const sha='1'.repeat(40),repository='https://fixture.invalid/repo.git';
  await writeFile(resolve(bin,'git'),`#!${process.execPath}
const a=process.argv.slice(2);
if(a[0]==='branch')console.log('feat/test');
if(a[0]==='remote')console.log(${JSON.stringify(repository)});
if(a[0]==='rev-parse')console.log('${sha}');
if(a[0]==='merge'){console.error('fixture stops before any merge');process.exit(91);}
`,{mode:0o700});
  await writeFile(resolve(bin,'npm'),`#!${process.execPath}\nconsole.log('fixture npm: '+process.argv.slice(2).join(' '));\n`,{mode:0o700});
  await writeFile(resolve(state,'supervisor.json'),JSON.stringify({pid:process.pid}));
  const file=resolve(dir,'record.json');await writeFile(file,JSON.stringify({id:'test',root,stateDir:state,branch:'feat/test',repository,changeBranch:'village/fixture',targetCommit:sha}));
  const env={...process.env,PATH:bin+':'+process.env.PATH,VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:''};
  for(const key of ['VILLAGE_SCRATCH_RUNTIME','VILLAGE_SCRATCH_BWRAP','VILLAGE_SCRATCH_REQUIRED'])delete env[key];
  if(required)env.VILLAGE_SCRATCH_REQUIRED='1';
  const result=spawnSync(process.execPath,[resolve('scripts/apply.mjs'),file],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const record=JSON.parse(await readFile(file,'utf8'));
  assert.equal(record.phase,'failed');assert.equal(record.appliedCommit,undefined);
  const doctor=record.checks.find(c=>c.command.includes('scripts/diagnose-scratch.mjs'));
  assert.ok(doctor);assert.equal(doctor.ok,!required);
  const merge=record.checks.find(c=>c.command[1]==='merge');
  if(required){assert.match(doctor.output,/未設定/);assert.equal(merge,undefined);assert.ok(!record.checks.some(c=>c.command.includes('test:ui')));}
  else {assert.match(doctor.output,/NOT RUN/);assert.ok(merge);assert.ok(record.checks.some(c=>c.command.includes('test:ui')));}
 }finally{await rm(dir,{recursive:true,force:true});}
});
