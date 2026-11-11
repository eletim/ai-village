import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
const NAME='village-human-ui',TTL=12*60*60*1000;
// An accidental-use guard, NOT an authorization boundary against same-user Agents.
export function humanUI({secret=randomBytes(32),clock=Date.now,publicOrigin=process.env.VILLAGE_PUBLIC_ORIGIN}={}){
 const sign=value=>createHmac('sha256',secret).update(value).digest('hex');
 const origin=req=>publicOrigin&&req.headers.host===new URL(publicOrigin).host?publicOrigin:`http://${req.headers.host}`;
 return {
  issue(req,res){const value=clock()+'.'+randomBytes(24).toString('hex');res.setHeader('Set-Cookie',`${NAME}=${value}.${sign(value)}; Path=/api/direct/human/; HttpOnly; SameSite=Strict; Max-Age=${TTL/1000}${origin(req).startsWith('https:')?'; Secure':''}`);},
  allow(req){
   if(req.headers.origin!==origin(req)||req.headers['x-village-human-ui']!=='1'||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return false;
   const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(NAME+'='))?.slice(NAME.length+1)||'';
   const match=/^(\d+)\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(token);if(!match)return false;
   const age=clock()-Number(match[1]);return age>=0&&age<TTL&&timingSafeEqual(Buffer.from(match[3]),Buffer.from(sign(match[1]+'.'+match[2])));
  }
 };
}
