#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import {MAX_UPLOAD_BYTES,UPLOAD_SIZE_MESSAGE} from '../src/upload-limits.js';
import {basename,extname} from 'node:path';
// Connect to the running village; never race its state writer by editing files.
const argv=process.argv.slice(2);
try {
  const check=argv[0]==='--connection-check';if(check)argv.shift();
  if(process.env.VILLAGE_AGENT_ID&&argv[0]==='rules'&&argv[1]==='get')argv.push('--agent',process.env.VILLAGE_AGENT_ID);
  const target=new URL(process.env.VILLAGE_URL||'http://127.0.0.1:5173');
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('VILLAGE_URLは資格情報を含まないHTTP(S) URLで指定してください');
  const authorization=(process.env.VILLAGE_AUTH_FILE||process.env.VILLAGE_PUBLIC_ORIGIN) ? {Authorization:'Basic '+Buffer.from((await readFile(process.env.VILLAGE_AUTH_FILE,'utf8')).trim()).toString('base64')} : {};
  if(argv[0]==='images'&&argv[1]==='upload'){
    if(argv.length!==3)throw Error('usage: images upload LOCAL_FILE');
    const file=argv[2],mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(file).toLowerCase()];
    if(!mime||!(await stat(file)).isFile())throw Error('PNG・JPEG・WebPのローカルファイルを指定してください');
    if((await stat(file)).size>MAX_UPLOAD_BYTES)throw Error(UPLOAD_SIZE_MESSAGE);
    const url=new URL('/api/images',process.env.VILLAGE_URL||'http://127.0.0.1:5173');url.searchParams.set('name',basename(file));
    const response=await fetch(url,{method:'POST',redirect:'error',signal:check?AbortSignal.timeout(15000):undefined,headers:{...authorization,'Content-Type':mime},body:await readFile(file)});
    if(!response.ok)throw Error('画像API接続エラー HTTP '+response.status+'。URL・認証設定を確認してください（自動再送しません）');
    const record=await response.json();
    console.log(JSON.stringify({ok:true,operation:'images upload',result:record,reference:'!['+record.name.replace(/[\[\]\r\n]/g,' ')+'](village-image:'+record.id+')'},null,2));
  }else{
  const response=await fetch(new URL('/api/village',process.env.VILLAGE_URL||'http://127.0.0.1:5173'),{method:'POST',redirect:'error',signal:check?AbortSignal.timeout(15000):undefined,headers:{...authorization,'Content-Type':'application/json'},body:JSON.stringify({argv:argv.length?argv:['help']})});
  if(!response.ok)throw Error('村API接続エラー HTTP '+response.status+'。URL・認証設定を確認してください（自動再送しません）');
  const result=await response.json();if(check)result.clientConnectionVersion=1;console.log(JSON.stringify(result,null,2));
  if(!response.ok||!result.ok)process.exitCode=1;
  }
} catch(error){console.error(error.name==='TimeoutError'||error.message==='fetch failed'?'村APIへの接続が失敗または時間切れです。VILLAGE_URLとネットワークを確認してください。送信した操作は受付不明のため自動再送しないでください。':error.message);process.exitCode=1;}
