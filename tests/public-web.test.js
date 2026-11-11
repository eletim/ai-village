import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {publicAddress,publicTarget,pinnedFetch} from '../server/public-web.mjs';
import {WebReader} from '../server/web-reader.mjs';
const privateIPs=['0.0.0.0','0.1.2.3','10.0.0.1','127.9.8.7','172.16.0.1','172.31.255.255','192.168.1.1','100.64.0.1','100.127.255.255','169.254.169.254','224.0.0.1','255.255.255.255','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','::','::1','fc00::1','fd00::1','fe80::1','ff02::1','::ffff:8.8.8.8','::ffff:127.0.0.1','64:ff9b::7f00:1','2001:db8::1','2002:7f00:1::','3fff::1'];
test('non-public literal addresses are rejected before any transport',async()=>{
 const reader=new WebReader({fetcher:async()=>{assert.fail('transport reached');}});
 for(const ip of privateIPs){assert.equal(publicAddress(ip),false,ip);await assert.rejects(reader.read('http://'+(ip.includes(':')?'['+ip+']':ip)),/非公開/);}
 for(const url of ['http://2130706433','http://0x7f000001','http://127.1'])await assert.rejects(reader.read(url),/非公開/);
 for(const ip of ['8.8.8.8','93.184.216.34','2606:4700:4700::1111'])assert(publicAddress(ip));
});
test('DNS private/mixed answers and redirect to internal destination never connect',async()=>{
 for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'::1',family:6}]])await assert.rejects(publicTarget(new URL('https://internal.test'),async()=>addresses),/非公開/);
 let calls=0;const reader=new WebReader({resolver:async host=>[{address:host==='internal.test'?'10.0.0.1':'8.8.8.8',family:4}],fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://internal.test/'}});}});
 await assert.rejects(reader.read('https://public.test'),/非公開/);assert.equal(calls,1);
});
test('checked address is pinned in the actual transport lookup; hostname remains for TLS and Host',async()=>{
 let resolutions=0;const target=await publicTarget(new URL('https://public.test/path'),async()=>{resolutions++;return [{address:resolutions===1?'8.8.8.8':'127.0.0.1',family:4}];});
 const r=await pinnedFetch(new URL('https://public.test/path'),{target,headers:{},signal:AbortSignal.timeout(1000)},(url,options,callback)=>{
  assert.equal(url.hostname,'public.test');assert.equal(options.agent,false);
  options.lookup('public.test',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  options.lookup('public.test',{all:true},(error,addresses)=>assert.deepEqual(addresses,[target]));
  const req=new EventEmitter();req.end=()=>callback({statusCode:200,headers:{},async *[Symbol.asyncIterator](){yield Buffer.from('ok');}});return req;
 });assert.equal(await r.text(),'ok');assert.equal(resolutions,1);
});
test('GitHub web read also rejects an internal API DNS answer before sending credentials',async()=>{
 const before=process.env.GH_TOKEN;process.env.GH_TOKEN='fixture-not-a-real-token';
 try{const reader=new WebReader({resolver:async hostname=>{assert.equal(hostname,'api.github.com');return [{address:'127.0.0.1',family:4}];}});await assert.rejects(reader.read('https://github.com/example/repo'),/非公開/);}finally{if(before===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=before;}
});
