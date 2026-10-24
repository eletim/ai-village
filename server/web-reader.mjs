import { githubApi } from './github.mjs';
const enc=encodeURIComponent;
const entities=text=>text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,s)=>s[0]==='#'?String.fromCodePoint(Math.min(0x10ffff,parseInt(s.slice(s[1]?.toLowerCase()==='x'?2:1),s[1]?.toLowerCase()==='x'?16:10))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[s.toLowerCase()]);
export function htmlText(html){return entities(html.replace(/<(script|style|noscript|svg|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<!--[^]*?-->/g,' ').replace(/<\/?(?:p|div|h[1-6]|li|br|article|section|pre|tr)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim();}
export class WebReader {
  constructor({api=githubApi,fetcher=fetch}={}){this.api=api;this.fetch=fetcher;}
  async read(input){
    const url=new URL(input);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search.match(/(?:token|access_token|auth|password|secret)=/i))throw new Error('認証情報を含まないHTTP(S) URLを指定してください。');
    // Only public HTTP reads; GitHub credentials are used exclusively by githubApi.
    const result=url.hostname.toLowerCase()==='github.com'?await this.github(url):await this.page(url);
    const text=result.content||'';return {requestedUrl:url.href,fetchedAt:new Date().toISOString(),...result,content:text.slice(0,50000),truncated:text.length>50000,untrusted:true};
  }
  async github(url){
    const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent),[owner,repoName,kind,...rest]=parts,repo=repoName?.replace(/\.git$/,'');
    if(!owner||!repo)throw new Error('GitHubリポジトリURLを指定してください。');
    const base=`/repos/${enc(owner)}/${enc(repo)}`,source={provider:'github',repository:`${owner}/${repo}`,sourceUrl:url.href};
    if(['issues','pull'].includes(kind)&&/^\d+$/.test(rest[0])){
      const pr=kind==='pull',item=await this.api(`${base}/${pr?'pulls':'issues'}/${rest[0]}`);
      const comments=await this.api(`${base}/issues/${rest[0]}/comments?per_page=30`);
      const files=pr?await this.api(`${base}/pulls/${rest[0]}/files?per_page=50`):[];
      return {...source,kind:pr?'pull_request':'issue',number:item.number,title:item.title,state:item.state,ref:pr?item.head.sha:null,baseRef:item.base?.ref,headRef:item.head?.ref,content:[item.title,item.body||'',...comments.map(c=>`Comment (${c.user?.login}):\n${c.body}`),...files.map(f=>`${f.filename}\n${f.patch||'(patchなし)'}`)].join('\n\n'),pagination:'comments先頭30件・PR files先頭50件まで'};
    }
    let ref,path='',commit;
    if(['blob','tree'].includes(kind)){
      for(let n=Math.min(rest.length-(kind==='blob'?1:0),16);n>=1;n--){
        const candidate=rest.slice(0,n).join('/');
        try{commit=await this.api(`${base}/commits/${enc(candidate)}`);ref=candidate;path=rest.slice(n).join('/');break;}catch(e){if(e.status!==404&&e.status!==422)throw e;}
      }
      if(!ref)throw new Error('ブランチ・タグ・commitを解決できませんでした。');
    }else if(kind)throw new Error('対応するGitHub URLはrepo/tree/blob/issues/pullです。');
    else{const metadata=await this.api(base);ref=metadata.default_branch;commit=await this.api(`${base}/commits/${enc(ref)}`);}
    const resolved=commit.sha;
    const file=await this.api(`${base}/${path?'contents/'+path.split('/').map(enc).join('/'):'readme'}?ref=${enc(resolved)}`);
    if(Array.isArray(file))return {...source,kind:'directory',ref,commit:resolved,path,content:file.map(f=>`${f.type} ${f.path} ${f.html_url}`).join('\n')};
    if(file.encoding!=='base64')throw new Error('本文を取得できませんでした（大きすぎる/非テキストの可能性）。');
    return {...source,kind:'file',ref,commit:resolved,path:file.path,blobSha:file.sha,sourceUrl:file.html_url,content:Buffer.from(file.content,'base64').toString('utf8')};
  }
  async page(url){
    // No credentials/ambient cookies are forwarded, including on redirects.
    let current=url;
    for(let hop=0;hop<6;hop++){
      if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new Error('転送先URLが不正です。');
      const r=await this.fetch(current,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'ai-village-reader','Accept':'text/html,text/plain,application/json'}});
      if([301,302,303,307,308].includes(r.status)){current=new URL(r.headers.get('location'),current);continue;}
      if(!r.ok)throw new Error(`Web HTTP ${r.status}。本文は未取得です。`);
      const type=r.headers.get('content-type')||'';if(!/(text\/|json|xml)/i.test(type))throw new Error('テキスト以外の応答は取得しません。');
      const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>1000000)throw new Error('Web本文が1MBの上限を超えました。');chunks.push(chunk);}
      const body=Buffer.concat(chunks).toString('utf8');return {provider:'web',sourceUrl:current.href,contentType:type,content:type.includes('html')?htmlText(body):body};
    }throw new Error('Webの転送回数が上限を超えました。');
  }
}
