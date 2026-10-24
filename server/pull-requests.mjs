import { githubToken } from './github.mjs';
import { open, readFile, mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const repo = '/repos/eletim/ai-village';
const fail = code => Object.assign(new Error(code), {code});
// Fixed origin, repository and endpoint vocabulary; no caller-controlled URL or shell.
export async function prApi(path, method='GET', body) {
  if (!/^\/(?:user|repos\/eletim\/ai-village\/(?:pulls(?:\/[1-9][0-9]*(?:\/merge)?)?|issues\/(?:[1-9][0-9]*\/comments|comments\/[1-9][0-9]*)))(?:\?[A-Za-z0-9_%=&.~-]+)?$/.test(path)) throw fail('invalid_endpoint');
  const token = await githubToken();
  if (!token) throw fail('authentication');
  let response;
  try { response = await fetch('https://api.github.com'+path, {method, redirect:'error', signal:AbortSignal.timeout(20000), headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'ai-village'}, ...(body===undefined?{}:{body:JSON.stringify(body)})}); }
  catch { throw fail('network'); }
  if (!response.ok) throw fail(response.status===401?'authentication':response.status===429||response.headers.get('x-ratelimit-remaining')==='0'?'rate_limit':response.status===403?'permission':response.status===409?'conflict':response.status===405?'merge_blocked':response.status===422?'validation':response.status===404?'not_found_or_permission':'api_failure');
  try { const text=await response.text(); if(text.length>2000000)throw 0; return JSON.parse(text.split(token).join('[REDACTED]')); } catch {throw fail('network');}
}
const shapes={list:['state','page'],get:['number'],comments:['number','page'],create:['requestId','head','base','title','body'],edit:['requestId','number','title','body'],'comment-create':['requestId','number','body'],'comment-edit':['requestId','number','kind','id','body'],merge:['requestId','number','base','head','sha','method']};
export class PullRequests {
  constructor(dir, library, api=prApi){this.dir=resolve(dir,'pr-operations');this.library=library;this.api=api;this.queue=Promise.resolve();}
  commands(){return Object.keys(shapes).map(action=>({name:`pr ${action}`,usage:`pr ${action} JSON {${shapes[action].join(',')}}`,mutation:!['list','get','comments'].includes(action),run:args=>{if(args.length!==1)throw fail('one_json_argument_required');return this.run(action,JSON.parse(args[0]));}}));}
  async run(action,input){
    const task=this.queue.catch(()=>{}).then(()=>this.perform(action,input));this.queue=task;return task;
  }
  async perform(action,p){
    if(!p||Array.isArray(p)||typeof p!=='object'||Object.keys(p).some(k=>!shapes[action].includes(k)))throw fail('invalid_arguments');
    for(const [k,v] of Object.entries(p)) {
      if(['number','id','page'].includes(k)){if(!Number.isSafeInteger(v)||v<1)throw fail('invalid_id');}
      else if(typeof v!=='string'||v.length>1500)throw fail('invalid_text');
    }
    for(const k of shapes[action])if(!['list','comments','edit'].includes(action)&&p[k]===undefined)throw fail('missing_'+k);
    if(['get','comments','edit','comment-create','comment-edit','merge'].includes(action)&&!p.number)throw fail('missing_number');
    if(p.title!==undefined&&(!p.title.trim()||p.title.length>256))throw fail('invalid_title');
    for(const k of ['head','base'])if(p[k]!==undefined&&!/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/.test(p[k]))throw fail('invalid_ref');
    if(action==='merge'&&(!/^[a-f0-9]{40}$/.test(p.sha)||!['merge','squash','rebase'].includes(p.method)))throw fail('explicit_sha_and_method_required');
    if(action==='comment-edit'&&p.kind!=='issue')throw fail('review_comments_unsupported');
    if(action==='edit'&&p.title===undefined&&p.body===undefined)throw fail('missing_edit');
    const doc=await this.library.read('development.md');
    if(!/^repository: https:\/\/github\.com\/eletim\/ai-village(?:\.git)?\s*$/m.test(doc.content.match(/^---\n([\s\S]*?)\n---/)?.[1]||''))throw fail('repository_mismatch');
    const api=this.api, get=()=>api(`${repo}/pulls/${p.number}`);
    if(action==='list'){if(p.state&&!['open','closed','all'].includes(p.state))throw fail('invalid_state');return {untrusted:true,items:await api(`${repo}/pulls?state=${p.state||'open'}&per_page=100&page=${p.page||1}`),pagination:'100/page; full page requires next page'};}
    if(action==='get')return {untrusted:true,pr:await get()};
    if(action==='comments'){await get();return {untrusted:true,kind:'issue',items:await api(`${repo}/issues/${p.number}/comments?per_page=100&page=${p.page||1}`),pagination:'100/page; review comments excluded'};}
    if(!/^[a-f0-9-]{36}$/.test(p.requestId||''))throw fail('request_id_required');
    await mkdir(this.dir,{recursive:true,mode:0o700});
    const file=resolve(this.dir,p.requestId+'.json');
    let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw fail('journal_unavailable');}
    if(previous){if(JSON.stringify(previous.input)!==JSON.stringify(p)||previous.action!==action)throw fail('request_id_reused');return {...previous.result,ok:false,status:'recorded_request',record:previous, guidance:'Do not resend; query PR/comments to confirm current state.'};}
    for(const name of await readdir(this.dir)){if(!name.endsWith('.json'))continue;const record=JSON.parse(await readFile(resolve(this.dir,name),'utf8'));if(record.state==='started'||record.state==='unknown')return {ok:false,status:'unknown',requestId:record.input.requestId,guidance:'Query PR/comments and reconcile; automatic retry disabled.'};}
    let current;
    if(action!=='create'){current=await get();if(current.number!==p.number)throw fail('pr_mismatch');}
    if(action==='merge'){
      if(current.base.ref!==p.base||current.head.ref!==p.head||current.head.repo?.full_name!=='eletim/ai-village'||current.head.sha!==p.sha)throw fail('head_changed');
      if(current.draft)throw fail('draft');if(current.state!=='open')throw fail('not_open');if(current.mergeable===false)throw fail('conflict');if(current.mergeable!==true)throw fail('mergeability_unknown');
    }
    if(action==='comment-edit'){
      const comment=await api(`${repo}/issues/comments/${p.id}`),user=await api('/user');
      if(comment.id!==p.id||comment.issue_url!==`https://api.github.com${repo}/issues/${p.number}`)throw fail('comment_pr_mismatch');
      if(comment.user?.id!==user.id)throw fail('comment_author_required');
    }
    if(action==='create'){
      const existing=await api(`${repo}/pulls?state=open&head=${encodeURIComponent('eletim:'+p.head)}&base=${encodeURIComponent(p.base)}&per_page=100`);
      if(existing.length){const observed=await api(`${repo}/pulls/${existing[0].number}`);return {ok:true,status:'existing',verification:{confirmed:true},url:observed.html_url,id:observed.id,number:observed.number,pr:observed,untrusted:true};}
    }
    const record={action,input:p,state:'started',at:new Date().toISOString()};
    const handle=await open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
    let sent=false,writeReturned=false,result;
    const mutate=async (...args)=>{const value=await api(...args);writeReturned=true;return value;};
    try {
      let changed,observed,confirmed=false;
      sent=true;
      if(action==='create'){changed=await mutate(`${repo}/pulls`,'POST',{head:p.head,base:p.base,title:p.title,body:p.body});observed=await api(`${repo}/pulls/${changed.number}`);confirmed=observed.head.ref===p.head&&observed.base.ref===p.base&&observed.title===p.title&&(observed.body||'')===p.body;}
      if(action==='edit'){await mutate(`${repo}/pulls/${p.number}`,'PATCH',{...(p.title===undefined?{}:{title:p.title}),...(p.body===undefined?{}:{body:p.body})});observed=await get();confirmed=observed.number===p.number&&(p.title===undefined||observed.title===p.title)&&(p.body===undefined||(observed.body||'')===p.body);}
      if(action==='comment-create'||action==='comment-edit'){changed=await mutate(action==='comment-create'?`${repo}/issues/${p.number}/comments`:`${repo}/issues/comments/${p.id}`,action==='comment-create'?'POST':'PATCH',{body:p.body});observed=await api(`${repo}/issues/comments/${changed.id}`);confirmed=(action!=='comment-edit'||changed.id===p.id)&&observed.id===changed.id&&(observed.body||'')===p.body&&observed.issue_url===`https://api.github.com${repo}/issues/${p.number}`;}
      if(action==='merge'){changed=await mutate(`${repo}/pulls/${p.number}/merge`,'PUT',{sha:p.sha,merge_method:p.method});observed=await get();confirmed=changed.merged===true&&observed.merged===true&&observed.head.sha===p.sha&&observed.base.ref===p.base&&observed.head.ref===p.head;}
      result={ok:confirmed,status:confirmed?'confirmed':'unknown',verification:{confirmed},url:observed.html_url,id:observed.id,number:observed.number,observed,untrusted:true};
    }catch(error){
      if(action==='merge'&&!writeReturned&&error.code==='conflict'){try{const latest=await get();if(latest.head.sha!==p.sha)error=fail('head_changed');}catch{/* Original refusal remains definite; latest head is unavailable. */}}
      result={ok:false,status:sent&&(writeReturned||!error.code||['network','api_failure'].includes(error.code))?'unknown':'failed',reason:error.code||'internal',guidance:'Query current PR/comments; do not automatically resend.'};}
    record.state=result.ok?'completed':result.status;record.result=result;
    await writeFile(file+'.tmp',JSON.stringify(record),{mode:0o600});await rename(file+'.tmp',file);
    return result;
  }
}
