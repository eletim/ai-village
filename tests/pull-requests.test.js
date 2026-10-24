import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PullRequests,prApi} from '../server/pull-requests.mjs';
import {VillageOperations} from '../server/operations.mjs';
const library={read:async()=>({content:'---\nrepository: https://github.com/eletim/ai-village.git\n---'})};
const id='11111111-1111-4111-8111-111111111111';
const pr={number:7,id:70,title:'title',body:'body',html_url:'https://github.com/eletim/ai-village/pull/7',base:{ref:'main'},head:{ref:'feat/live-workshop',sha:'a'.repeat(40),repo:{full_name:'eletim/ai-village'}},mergeable:true,state:'open',draft:false};
const create={requestId:id,head:'feat/live-workshop',base:'main',title:'title',body:'body'};
async function setup(api){const dir=await mkdtemp(join(tmpdir(),'village-pr-'));return {dir,service:new PullRequests(dir,library,api)};}
test('create confirms and duplicate head/base does not POST',async()=>{
 let writes=0;const {service}=await setup(async(path,method)=>{if(method){writes++;return pr;}return path.includes('?')?[]:pr;});
 assert.equal((await service.run('create',create)).ok,true);assert.equal(writes,1);
 assert.equal((await service.run('create',create)).status,'recorded_request');assert.equal(writes,1);
 const {service:other}=await setup(async(path,method)=>{assert.equal(method,undefined);return path.includes('?')?[pr]:pr;});assert.equal((await other.run('create',create)).status,'existing');
});
test('comment body is exact; author, kind and PR association checked',async()=>{
 const body='line 1\n"quotes" $(touch /tmp/never) `id` ${GH_TOKEN}';let writes=0;
 const comment={id:90,body,user:{id:2},issue_url:'https://api.github.com/repos/eletim/ai-village/issues/7',html_url:pr.html_url+'#issuecomment-90'};
 const {service}=await setup(async(path,method,data)=>{if(method){writes++;assert.deepEqual(data,{body});return comment;}return path==='/user'?{id:2}:path.includes('issues/comments')?comment:pr;});
 await assert.rejects(service.run('comment-edit',{requestId:id,number:7,kind:'review',id:90,body}),/review_comments_unsupported/);
 assert.equal((await service.run('comment-edit',{requestId:id,number:7,kind:'issue',id:90,body})).ok,true);assert.equal(writes,1);
 for(const [patch,error] of [[{user:{id:3}},'comment_author_required'],[{issue_url:'https://api.github.com/repos/other/repo/issues/7'},'comment_pr_mismatch']]){
 const {service:s}=await setup(async path=>path==='/user'?{id:2}:path.includes('issues/comments')?{...comment,...patch}:pr);await assert.rejects(s.run('comment-edit',{requestId:id,number:7,kind:'issue',id:90,body}),new RegExp(error));}
});
test('merge preconditions and explicit method, SHA CAS and reread',async()=>{
 const input={requestId:id,number:7,base:'main',head:pr.head.ref,sha:pr.head.sha,method:'squash'};
 for(const [patch,error] of [[{draft:true},'draft'],[{mergeable:false},'conflict'],[{mergeable:null},'mergeability_unknown'],[{head:{...pr.head,sha:'b'.repeat(40)}},'head_changed']]){const {service}=await setup(async(path,method)=>{assert.equal(method,undefined);return {...pr,...patch};});await assert.rejects(service.run('merge',input),new RegExp(error));}
 let merged=false;const {service}=await setup(async(path,method,body)=>{if(method){assert.deepEqual(body,{sha:pr.head.sha,merge_method:'squash'});merged=true;return {merged:true};}return {...pr,merged};});assert.equal((await service.run('merge',input)).ok,true);
});
test('success followed by lost response blocks replay after restart and new request IDs',async()=>{
 let writes=0;const api=async(path,method)=>{if(method){writes++;throw Object.assign(new Error('secret must not escape'),{code:'network'});}return pr;};
 const {service,dir}=await setup(api),input={requestId:id,number:7,body:'hello'};
 assert.equal((await service.run('comment-create',input)).status,'unknown');
 const restarted=new PullRequests(dir,library,api);assert.equal((await restarted.run('comment-create',input)).status,'recorded_request');
 assert.equal((await restarted.run('comment-create',{...input,requestId:'22222222-2222-4222-8222-222222222222'})).status,'unknown');assert.equal(writes,1);
 assert.ok(!(await readFile(join(dir,'pr-operations',id+'.json'),'utf8')).includes('secret must not escape'));
});
test('write-ahead crash prevents resending, reads remain available',async()=>{
 const {service,dir}=await setup(async()=>pr);await mkdir(join(dir,'pr-operations'));await writeFile(join(dir,'pr-operations',id+'.json'),JSON.stringify({action:'create',input:create,state:'started'}));
 assert.equal((await service.run('create',create)).status,'recorded_request');assert.equal((await service.run('get',{number:7})).pr.number,7);
});
test('registry preserves argv limit for all operations',async()=>{const {service,dir}=await setup(async()=>[]);const ops=new VillageOperations({dir},null,{prs:service});assert.ok((await ops.execute(['help'])).result.some(c=>c.name==='pr merge'));assert.throws(()=>ops.resolve(['pr','create','x'.repeat(2001)]));assert.equal((await ops.execute(['pr','list','{}'])).ok,true);});
test('HTTP boundary: fixed destination, JSON, redirect denial, sanitized auth and error classification',async()=>{
 const originalFetch=globalThis.fetch,originalToken=process.env.GH_TOKEN;process.env.GH_TOKEN='fixture-secret-token';
 try{
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.github.com/repos/eletim/ai-village/pulls');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-secret-token');assert.equal(JSON.parse(options.body).body,'\n"$(id)"');return new Response(JSON.stringify({body:'fixture-secret-token'}));};
 assert.deepEqual(await prApi('/repos/eletim/ai-village/pulls','POST',{body:'\n"$(id)"'}),{body:'[REDACTED]'});
 await assert.rejects(prApi('https://evil.test'),/invalid_endpoint/);assert.equal(calls,1);
 for(const [status,headers,code] of [[401,{},'authentication'],[403,{},'permission'],[403,{'x-ratelimit-remaining':'0'},'rate_limit'],[409,{},'conflict'],[405,{},'merge_blocked'],[422,{},'validation']]){globalThis.fetch=async()=>new Response('fixture-secret-token',{status,headers});await assert.rejects(prApi('/user'),new RegExp(code));}
 globalThis.fetch=async()=>{throw Error('fixture-secret-token');};await assert.rejects(prApi('/user'),/^Error: network$/);
 }finally{globalThis.fetch=originalFetch;if(originalToken===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=originalToken;}
});
test('service through HTTP fixture confirms edits and treats failed verification as unknown',async()=>{
 const originalFetch=globalThis.fetch,originalToken=process.env.GH_TOKEN;process.env.GH_TOKEN='fixture-secret';
 try{
 let value={...pr},writes=0,failRead=false;
 globalThis.fetch=async(url,options)=>{assert.ok(url.startsWith('https://api.github.com/repos/eletim/ai-village/'));if(options.method==='PATCH'){writes++;value={...value,...JSON.parse(options.body)};return Response.json(value);}if(failRead&&writes)return new Response('',{status:403});return Response.json(value);};
 const {service}=await setup(prApi);assert.equal((await service.run('edit',{requestId:id,number:7,body:'a\nb "quoted"'})).ok,true);
 writes=0;failRead=true;const {service:other}=await setup(prApi);const result=await other.run('edit',{requestId:id,number:7,title:'new'});assert.equal(result.status,'unknown');assert.equal(result.reason,'permission');assert.equal(writes,1);
 }finally{globalThis.fetch=originalFetch;if(originalToken===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=originalToken;}
});
test('head changes between preflight and merge are classified without resending',async()=>{
 let writes=0;const {service}=await setup(async(path,method)=>{if(method){writes++;throw Object.assign(Error('conflict'),{code:'conflict'});}return writes?{...pr,head:{...pr.head,sha:'b'.repeat(40)}}:pr;});
 const result=await service.run('merge',{requestId:id,number:7,base:'main',head:pr.head.ref,sha:pr.head.sha,method:'merge'});assert.equal(result.reason,'head_changed');assert.equal(result.status,'failed');assert.equal(writes,1);
});
