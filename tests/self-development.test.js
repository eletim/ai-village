import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { WebReader,htmlText } from '../server/web-reader.mjs';
import { allowedPush } from '../server/git-transport.mjs';
import { Development } from '../server/development.mjs';
import { run } from '../server/bridge.mjs';
const sha='1'.repeat(40),file=(path,text)=>({path,sha:'blob',html_url:'https://github.com/o/r/blob/'+sha+'/'+path,encoding:'base64',content:Buffer.from(text).toString('base64')});
test('repo read resolves default ref to commit; branch with slash reads its actual path',async()=>{
  const calls=[],api=async path=>{calls.push(path);if(path==='/repos/o/r')return {default_branch:'dev'};if(path.endsWith('/commits/dev')||path.endsWith('/commits/feature%2Fx'))return {sha};if(path.includes('/commits/'))throw Object.assign(new Error('missing'),{status:404});if(path.includes('/readme?'))return file('README.md','readme');if(path.includes('/contents/a.js?'))return file('a.js','correct branch');throw new Error(path);};
  const reader=new WebReader({api});const a=await reader.read('https://github.com/o/r');assert.equal(a.ref,'dev');assert.equal(a.commit,sha);assert.equal(a.content,'readme');assert.ok(calls.includes('/repos/o/r/readme?ref='+sha));
  const b=await reader.read('https://github.com/o/r/blob/feature/x/a.js');assert.equal(b.ref,'feature/x');assert.equal(b.path,'a.js');assert.equal(b.content,'correct branch');
});
test('issues/PR return real body/comments/diff provenance and authentication errors stay failures',async()=>{
  const api=async path=>path.includes('/comments?')?[{body:'comment',user:{login:'u'}}]:path.includes('/files?')?[{filename:'a',patch:'+change'}]:{number:7,title:'title',body:'body',head:{sha,ref:'head'},base:{ref:'base'}};
  const reader=new WebReader({api});const pr=await reader.read('https://github.com/o/r/pull/7');assert.equal(pr.kind,'pull_request');assert.equal(pr.ref,sha);assert.match(pr.content,/comment/);assert.match(pr.content,/\+change/);
  const issue=await reader.read('https://github.com/o/r/issues/7');assert.equal(issue.kind,'issue');
  const failed=new WebReader({api:async()=>{throw Object.assign(new Error('GitHub HTTP 401 未取得'),{status:401});}});await assert.rejects(failed.read('https://github.com/o/r'),/401/);
  await assert.rejects(reader.read('https://token@github.com/o/r'),/認証/);
});
test('ordinary web text omits scripts; bounded reading and failures do not invent text',async()=>{
  assert.equal(htmlText('<h1>Title</h1><script>secret()</script><p>A &amp; B</p>').includes('secret'),false);
  const reader=new WebReader({fetcher:async()=>new Response('<h1>Hello</h1><p>本文</p>',{headers:{'Content-Type':'text/html'}})});assert.match((await reader.read('https://example.test')).content,/本文/);
  const failed=new WebReader({fetcher:async()=>new Response('private',{status:403})});await assert.rejects(failed.read('https://example.test'),/未取得/);
  await assert.rejects(reader.read('file:///etc/passwd'),/HTTP/);
});
function packet(branch){const line='0'.repeat(40)+' '+sha+' refs/heads/'+branch+'\0report-status\n';return Buffer.from((Buffer.byteLength(line)+4).toString(16).padStart(4,'0')+line+'0000PACK');}
test('scoped Git push allows only the assigned branch and rejects malformed updates/main',()=>{
  assert.equal(allowedPush(packet('village/work-1'),'village/work-1'),true);assert.equal(allowedPush(packet('main'),'village/work-1'),false);assert.equal(allowedPush(Buffer.from('xxxx'),'village/work-1'),false);
});
test('deployment apply is single-flight and a persisted operation is reused after restart without launching anything',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'village-deployment-'));await mkdir(join(dir,'deployments'));const id='11111111-1111-4111-8111-111111111111',record={id,jobId:'job',phase:'queued',createdAt:new Date().toISOString()};await writeFile(join(dir,'deployments',id+'.json'),JSON.stringify(record));
  const bridge={dir,jobs:[]},development=new Development(bridge,{});
  const a=development.apply('job'),b=development.apply('job');assert.equal(a,b);assert.deepEqual(await a,record);assert.deepEqual(await development.apply('job'),record);
});
async function refusedDeployment(branch,dirty){
  const dir=await mkdtemp(join(tmpdir(),'village-apply-')),root=join(dir,'repo'),runtime=join(dir,'runtime');await mkdir(root);await mkdir(runtime);
  const git=(...args)=>run('git',['-C',root,...args]);await git('init','-b',branch);await git('config','user.name','Test');await git('config','user.email','test@example.test');await writeFile(join(root,'file.txt'),'original');await git('add','.');await git('commit','-m','initial');const head=(await git('rev-parse','HEAD')).trim();if(dirty)await writeFile(join(root,'file.txt'),'keep my edit');
  await writeFile(join(runtime,'supervisor.json'),JSON.stringify({pid:process.pid}));const record={id:'test',root,stateDir:runtime,branch,targetCommit:sha,changeBranch:'village/job',repository:'https://github.com/o/r.git',createdAt:new Date().toISOString()};const file=join(dir,'record.json');await writeFile(file,JSON.stringify(record));await run(process.execPath,[resolve('scripts/apply.mjs'),file]);return {saved:JSON.parse(await readFile(file,'utf8')),head:(await git('rev-parse','HEAD')).trim(),originalHead:head,content:await readFile(join(root,'file.txt'),'utf8')};
}
test('actual deployment runner refuses dirty core without discarding edits or moving HEAD',async()=>{const r=await refusedDeployment('feat/test',true);assert.equal(r.saved.phase,'failed');assert.match(r.saved.error,/未commit/);assert.equal(r.head,r.originalHead);assert.equal(r.content,'keep my edit');assert.equal(r.saved.appliedCommit,undefined);});
test('actual deployment runner refuses main even when the tree is clean',async()=>{const r=await refusedDeployment('main',false);assert.equal(r.saved.phase,'failed');assert.match(r.saved.error,/ブランチ/);assert.equal(r.head,r.originalHead);});

test('lost deployment worker becomes unconfirmed failure without erasing the actually applied commit',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'village-lost-worker-'));await mkdir(join(dir,'deployments'));const id='22222222-2222-4222-8222-222222222222';
  await writeFile(join(dir,'deployments',id+'.json'),JSON.stringify({id,jobId:'job',phase:'restarting',workerPid:99999999,appliedCommit:sha,createdAt:new Date().toISOString()}));
  const development=new Development({dir,jobs:[]},{});const [record]=await development.list();assert.equal(record.phase,'failed');assert.equal(record.appliedCommit,sha);assert.match(record.error,/未確認/);
});
