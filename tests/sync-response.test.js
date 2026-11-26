import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {syncResponse} from '../server/sync-response.mjs';
test('wire compression respects gzip negotiation, body size and cache isolation',async()=>{
 const value={text:'会話の履歴'.repeat(1000)};
 for(const [accepts,compress] of [['gzip',true],['br, gzip;q=0.5',true],['gzip;q=0',false],['gzip;q=0.000',false],['identity',false]]){
  let headers,body;await syncResponse({headers:{'accept-encoding':accepts}},{writeHead(status,h){assert.equal(status,200);headers=h;},end(b){body=b;}},value);
  assert.equal(headers['Content-Length'],body.length);assert.equal(headers['Vary'],'Accept-Encoding');assert.equal(headers['Cache-Control'],'no-store');
  assert.equal(headers['Content-Encoding'],compress?'gzip':undefined);assert.deepEqual(JSON.parse((compress?gunzipSync(body):body).toString()),value);
 }
});

test('static HTML and modules retain exact bytes and MIME',async()=>{
 const {contentResponse}=await import('../server/sync-response.mjs');
 for(const type of ['text/html; charset=utf-8','text/javascript; charset=utf-8','text/css; charset=utf-8'])for(const accept of ['gzip','gzip;q=0','identity']){
  const original=Buffer.from('const 日本語 = "unchanged";\n'.repeat(100));let body,headers;
  await contentResponse({headers:{'accept-encoding':accept}},{writeHead(code,h){assert.equal(code,200);headers=h;},end(b){body=b;}},original,type);
  assert.equal(headers['Content-Type'],type);assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers.Vary,'Accept-Encoding');
  assert.deepEqual(accept==='gzip'?gunzipSync(body):body,original);
 }
});
