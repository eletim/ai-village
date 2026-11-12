import test from 'node:test';
import assert from 'node:assert/strict';
import {humanUI} from '../server/human-ui.mjs';
for(const origin of ['http://localhost:5398','http://100.78.154.38:5173','https://village.example'])test('human UI hints for '+origin,()=>{
 let now=1000,cookie;const guard=humanUI({clock:()=>now,publicOrigin:origin.startsWith('https:')?origin:''}),host=new URL(origin).host;
 guard.issue({headers:{host}},{setHeader(key,value){cookie=value;}});assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.equal(cookie.includes('; Secure'),origin.startsWith('https:'));
 const headers={host,origin,cookie:cookie.split(';')[0],'x-village-human-ui':'1'};assert(guard.allow({headers}));assert(guard.allow({headers:{...headers,'sec-fetch-site':'same-origin'}}));
 for(const key of ['origin','cookie','x-village-human-ui']){const absent={...headers};delete absent[key];assert(!guard.allow({headers:absent}));}
 assert(!guard.allow({headers:{...headers,'sec-fetch-site':'cross-site'}}));assert(!guard.allow({headers:{...headers,origin:'http://evil.test'}}));
 assert(!guard.allow({headers:{...headers,cookie:headers.cookie+'bad'}}));now+=12*60*60*1000;assert(!guard.allow({headers}));
});
