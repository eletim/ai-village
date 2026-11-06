#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import {basename,extname} from 'node:path';
// Connect to the running village; never race its state writer by editing files.
const argv=process.argv.slice(2);
try {
  const authorization=process.env.VILLAGE_PUBLIC_ORIGIN ? {Authorization:'Basic '+Buffer.from((await readFile(process.env.VILLAGE_AUTH_FILE,'utf8')).trim()).toString('base64')} : {};
  if(argv[0]==='images'&&argv[1]==='upload'){
    if(argv.length!==3)throw Error('usage: images upload LOCAL_FILE');
    const file=argv[2],mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(file).toLowerCase()];
    if(!mime||!(await stat(file)).isFile())throw Error('PNG・JPEG・WebPのローカルファイルを指定してください');
    const url=new URL('/api/images',process.env.VILLAGE_URL||'http://127.0.0.1:5173');url.searchParams.set('name',basename(file));
    const response=await fetch(url,{method:'POST',headers:{...authorization,'Content-Type':mime},body:await readFile(file)});
    const record=await response.json();if(!response.ok)throw Error(record.error||'画像を保存できません');
    console.log(JSON.stringify({ok:true,operation:'images upload',result:record,reference:'!['+record.name.replace(/[\[\]\r\n]/g,' ')+'](village-image:'+record.id+')'},null,2));
  }else{
  const response=await fetch(new URL('/api/village',process.env.VILLAGE_URL||'http://127.0.0.1:5173'),{method:'POST',headers:{...authorization,'Content-Type':'application/json'},body:JSON.stringify({argv:argv.length?argv:['help']})});
  const result=await response.json();console.log(JSON.stringify(result,null,2));
  if(!response.ok||!result.ok)process.exitCode=1;
  }
} catch(error){console.error(error.message);process.exitCode=1;}
