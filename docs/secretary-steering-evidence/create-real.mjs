import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:15661';
const post=async(path,body)=>{const r=await fetch(base+'/api/direct'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const x=await r.json();if(!r.ok)throw Error(JSON.stringify(x));return x;};
const p=await post('/projects',{requestId:randomUUID(),name:'Disposable native steering verification'});
const w=await post('/workshops',{name:'Isolated steering',connectionType:'local',baseUrl:'http://127.0.0.1:'+String(await readFile('/home/eletim/.purplemux/port','utf8')).trim(),workplaces:['/tmp/secretary-steer-real-work']});
await writeFile('/tmp/secretary-steer-evidence/real-identities.json',JSON.stringify({project:p,workshop:w},null,2));
const a=await post('/agents',{requestId:randomUUID(),name:'Disposable steering Codex',workshopId:w.id,cwd:w.workplaces[0],provider:'codex',location:'mayor',projectId:p.id});
await writeFile('/tmp/secretary-steer-evidence/real-identities.json',JSON.stringify({project:p,workshop:w,agent:a},null,2));console.log(JSON.stringify({id:a.id,workspaceId:a.workspaceId,tabId:a.tabId,error:a.error}));
