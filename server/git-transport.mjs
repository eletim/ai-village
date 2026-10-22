import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { githubToken } from './github.mjs';
export function allowedPush(body,branch){
  let offset=0,count=0;
  while(offset+4<=body.length){const len=parseInt(body.subarray(offset,offset+4).toString(),16);if(len===0)return count>0;if(!Number.isInteger(len)||len<4||offset+len>body.length)return false;
    const command=body.subarray(offset+4,offset+len).toString().split('\0')[0].trim().split(' ');
    if(command.length!==3||!/[1-9a-f]/.test(command[1])||command[2]!==`refs/heads/${branch}`)return false;count++;offset+=len;
  }return false;
}
export async function openGitTransport({repository,branch,host}){
  const url=new URL(repository);if(url.hostname!=='github.com'||url.username||url.password)throw new Error('開発対象は認証値を含まないGitHub URLにしてください。');
  const path=url.pathname.replace(/\.git$/,'')+'.git';
  const server=createServer(async(req,res)=>{
    try{
      const requested=new URL(req.url,'http://localhost');
      const service=requested.searchParams.get('service');
      const allowed=(req.method==='GET'&&requested.pathname===path+'/info/refs'&&['git-upload-pack','git-receive-pack'].includes(service))||(req.method==='POST'&&[path+'/git-upload-pack',path+'/git-receive-pack'].includes(requested.pathname));
      if(!allowed){res.writeHead(403);res.end();return;}
      const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>100e6)throw new Error('pack too large');chunks.push(c);}const body=Buffer.concat(chunks);
      if(requested.pathname.endsWith('/git-receive-pack')&&!allowedPush(body,branch)){res.writeHead(403);res.end('Only the assigned job branch can be pushed');return;}
      const token=await githubToken();if(!token)throw new Error('GitHub credential unavailable');
      const upstream=await fetch('https://github.com'+requested.pathname+requested.search,{method:req.method,headers:{Authorization:'Basic '+Buffer.from('x-access-token:'+token).toString('base64'),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{}),...(req.headers['content-encoding']?{'Content-Encoding':req.headers['content-encoding']}:{})},...(req.method==='POST'?{body}:{}),signal:AbortSignal.timeout(60000),redirect:'error'});
      res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/octet-stream','Cache-Control':'no-store'});
      for await(const chunk of upstream.body)res.write(chunk);res.end();
    }catch{if(!res.headersSent)res.writeHead(502);res.end('Scoped Git transport failed; credentials are never returned');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const child=spawn('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ExitOnForwardFailure=yes','-R',`127.0.0.1:0:127.0.0.1:${server.address().port}`,host,'cat'],{stdio:['pipe','ignore','pipe']});
  const close=()=>{child.stdin.end();child.kill('SIGTERM');server.close();server.closeAllConnections();};
  try{
    const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Git用SSH転送がタイムアウトしました。')),15000);
      child.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/Allocated port (\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.on('error',()=>{clearTimeout(timer);reject(new Error('Git用SSH転送を起動できません。'));});child.on('exit',()=>{clearTimeout(timer);reject(new Error('Git用SSH転送が終了しました。'));});
    });return {url:`http://127.0.0.1:${port}${path}`,close};
  }catch(error){close();throw error;}
}
