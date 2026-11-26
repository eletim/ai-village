import {readFile,writeFile} from 'node:fs/promises';
const x=await (await fetch('http://127.0.0.1:15661/api/direct')).json();
await writeFile('/tmp/secretary-steer-evidence/real-snapshot.json',JSON.stringify(x,null,2));
const runs=JSON.parse(await readFile('/tmp/secretary-steer-evidence/real-runs.json','utf8'));
const first=x.runs.find(r=>r.id===runs.first.id),last=x.runs.find(r=>r.id===runs.second.id);
const sample={model:x.agents[0].modelInfo,first:{id:first.id,state:first.state,sessionId:first.sessionId,turnId:first.turnId,dispatchAttemptedAt:first.dispatchAttemptedAt,acceptedAt:first.acceptedAt,output:first.output},addition:{id:last.id,state:last.state,sessionId:last.sessionId,turnId:last.turnId,dispatchAttemptedAt:last.dispatchAttemptedAt,acceptedAt:last.acceptedAt,completedAt:last.completedAt,output:last.output,notification:last.notification,notificationSuppressed:last.notificationSuppressed},file:await readFile('/tmp/secretary-steer-real-work/result.txt','utf8'),actionAtSend:runs.actionAtSend};
await writeFile('/tmp/secretary-steer-evidence/real-summary.json',JSON.stringify(sample,null,2));console.log(JSON.stringify(sample,null,2));
