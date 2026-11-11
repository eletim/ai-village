import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { WebReader,htmlText } from '../server/web-reader.mjs';
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
