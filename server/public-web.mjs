import {BlockList,isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
// Conservative special-use exclusions; see docs/access-boundaries.md (IANA).
const denied=new BlockList(),global6=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(ip,bits,'ipv4');
global6.addSubnet('2000::',3,'ipv6');
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])denied.addSubnet(ip,bits,'ipv6');
export function publicAddress(address){const family=isIP(address);return family===4?!denied.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!denied.check(address,'ipv6');}
export async function publicTarget(url,resolver=lookup){
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolver(hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('公開Web専用です。非公開アドレスへの接続は拒否しました。');
 return addresses[0];
}
// Keep hostname for Host/SNI/certificate validation, pin lookup to the checked IP.
// No proxy, pooled socket, second DNS lookup, or implicit redirect is used.
export function pinnedFetch(url,{target,signal,headers},requester=url.protocol==='https:'?https.request:http.request){
 return new Promise((resolve,reject)=>{
  const req=requester(url,{method:'GET',agent:false,signal,headers:{'Accept-Encoding':'identity',...headers},lookup:(_host,options,cb)=>cb(null,...(options?.all?[[target]]:[target.address,target.family]))},res=>{
   resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,headers:{get:name=>res.headers[name.toLowerCase()]},body:res,async text(){const chunks=[];let bytes=0;for await(const chunk of res){bytes+=chunk.length;if(bytes>2000000)throw Error('Web応答が取得上限を超えました。');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}});
  });
  req.on('error',reject);req.end();
 });
}
