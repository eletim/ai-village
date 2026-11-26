import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const {agent:a}=JSON.parse(await readFile('/tmp/secretary-steer-evidence/real-identities.json','utf8')),base='http://127.0.0.1:15661';
const send=async instruction=>{const r=await fetch(base+'/api/direct/agents/'+a.id+'/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'conversation',requestId:randomUUID(),instruction})});const x=await r.json();if(!r.ok)throw Error(JSON.stringify(x));return x;};
const first=await send('隔離検証だけを行ってください。外部サービス、本番の村、リーダーへの依頼、通知は一切操作しません。/tmp/secretary-steer-real-work の中だけ使います。今から約60秒の無害な待機処理を実行し、その後 result.txt に BLUE と書いて最終報告してください。途中で人間から訂正が届いた場合は同じ作業への追加指示として反映してください。待機前に短い途中報告をしてください。');
await writeFile('/tmp/secretary-steer-evidence/real-runs.json',JSON.stringify({first},null,2));console.log('first',first.id);
for(let i=0;i<180;i++){
 const s=await (await fetch(base+'/api/direct')).json(),r=s.runs.find(r=>r.id===first.id),agent=s.agents.find(x=>x.id===a.id);
 if(r?.state==='running'&&agent.currentAction){
  const second=await send('訂正です。いま進めている同じ作業の result.txt は BLUE ではなく GREEN としてください。別作業を作らず、現在の待機と作業を継続して変更を反映してください。');
  await writeFile('/tmp/secretary-steer-evidence/real-runs.json',JSON.stringify({first:r,second,actionAtSend:agent.currentAction,sentAt:new Date().toISOString()},null,2));console.log('second',second.id,second.steerTarget);break;
 }
 await new Promise(r=>setTimeout(r,1000));
}
