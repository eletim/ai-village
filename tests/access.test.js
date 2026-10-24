import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {accessPolicy} from '../server/access.mjs';
test('VPN proxy requires explicit HTTPS origin and authentication; reject forged Host/Origin and wildcard bind',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'village-access-'));try{
 const authFile=join(dir,'auth');await writeFile(authFile,'mayor:long-test-password-123456');
 await assert.rejects(accessPolicy({host:'0.0.0.0',port:1234}));
 await assert.rejects(accessPolicy({host:'127.0.0.1',port:1234,origin:'https://village.example'}));
 const allow=await accessPolicy({host:'127.0.0.1',port:1234,origin:'https://village.example',authFile});
 const probe=headers=>{let status=200;const ok=allow({headers},{writeHead(code){status=code;},end(){}});return [ok,status];};
 assert.deepEqual(probe({host:'evil.example'}),[false,403]);
 assert.deepEqual(probe({host:'village.example'}),[false,401]);
 const authorization='Basic '+Buffer.from('mayor:long-test-password-123456').toString('base64');
 assert.deepEqual(probe({host:'village.example',origin:'https://evil.example',authorization}),[false,403]);
 assert.deepEqual(probe({host:'village.example',origin:'https://village.example',authorization}),[true,200]);
 assert.deepEqual(probe({host:'localhost:1234'}),[false,401]);
 assert.deepEqual(probe({host:'localhost:1234',authorization}),[true,200]);
 assert.deepEqual(probe({host:'localhost:1234','x-forwarded-host':'village.example'}),[false,401]);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('direct VPN listener accepts only VPN peers and exact Host/Origin',async()=>{
 const allow=await accessPolicy({host:'127.0.0.1',port:5173,vpnAddress:'100.78.154.38'});
 const probe=(headers,remoteAddress='100.80.1.2',localAddress='100.78.154.38')=>{let status=200;const ok=allow({headers,socket:{localAddress,remoteAddress}},{writeHead(code){status=code;},end(){}});return [ok,status];};
 assert.deepEqual(probe({host:'100.78.154.38:5173',origin:'http://100.78.154.38:5173'}),[true,200]);
 assert.deepEqual(probe({host:'100.78.154.38:5173'},'192.168.11.2'),[false,403]);
 assert.deepEqual(probe({host:'100.78.154.38:5173'},'127.0.0.1','127.0.0.1'),[false,403]);
 assert.deepEqual(probe({host:'attacker.example'}),[false,403]);
 assert.deepEqual(probe({host:'100.78.154.38:5173',origin:'https://attacker.example'}),[false,403]);
 assert.deepEqual(probe({host:'localhost:5173'},'127.0.0.1','127.0.0.1'),[true,200]);
});
