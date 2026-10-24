import { tailnetAddress } from './network.mjs';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
export async function accessPolicy({host,port,origin=process.env.VILLAGE_PUBLIC_ORIGIN,authFile=process.env.VILLAGE_AUTH_FILE,vpnAddress}) {
  if(!['127.0.0.1','::1'].includes(host))throw new Error('村はloopbackで起動してください。VPN接続には認証付きVPN限定HTTPSプロキシを使います。');
  if(vpnAddress&&!tailnetAddress(vpnAddress))throw new Error('VPNアドレスが不正です');
  const local=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
  let publicUrl,expected;
  if(origin){publicUrl=new URL(origin);if(publicUrl.protocol!=='https:'||publicUrl.origin!==origin||publicUrl.username||publicUrl.password||local.has(publicUrl.host))throw new Error('VILLAGE_PUBLIC_ORIGINにはHTTPS originだけを指定してください');
    if(!authFile)throw new Error('VPN接続にはVILLAGE_AUTH_FILEが必要です');
    const credentials=(await readFile(authFile,'utf8')).trim();if(!/^[^:\s]+:.{20,}$/.test(credentials))throw new Error('認証ファイルは user:20文字以上のpassword 形式が必要です');
    expected=Buffer.from('Basic '+Buffer.from(credentials).toString('base64'));
  }
  return (req,res)=>{
    const address=value=>value?.replace(/^::ffff:/,'');
    const vpnSocket=vpnAddress&&address(req.socket?.localAddress)===vpnAddress;
    const vpnHost=vpnAddress&&req.headers.host===`${vpnAddress}:${port}`;
    if((vpnSocket&&!tailnetAddress(address(req.socket?.remoteAddress)))||(vpnHost&&!vpnSocket)){res.writeHead(403);res.end('VPN peer rejected');return false;}
    const remote=req.headers.host===publicUrl?.host;
    if(!remote&&!vpnHost&&!local.has(req.headers.host)){res.writeHead(403);res.end('Host rejected');return false;}
    const allowed=remote?publicUrl.origin:`http://${req.headers.host}`;
    if(req.headers.origin&&req.headers.origin!==allowed){res.writeHead(403);res.end('Origin rejected');return false;}
    if(expected){const actual=Buffer.from(req.headers.authorization||'');if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="AI Village", charset="UTF-8"','Cache-Control':'no-store'});res.end('Authentication required');return false;}}
    return true;
  };
}
