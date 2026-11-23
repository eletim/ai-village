import {randomUUID} from 'node:crypto';
import {deadline} from './request-reports.mjs';
import {closeSelfResume} from './state/self-resume.ts';
import {applyGraph} from './unified-requests.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:409});};
export async function selfResume(flow,x){return flow.d.locked('request-graph',()=>flow.d.persist(async()=>{
 const q=flow.root(x.humanRequestId),w=flow.work(q,x.workId);
 if(typeof x.operationId!=='string'||!/^[\w-]{8,100}$/.test(x.operationId))fail('operationIdが必要です');
 const r=await flow.actor(q,w,x.actorRunId);
 if(r.runModel.state.kind!=='running'||r.phase==='report')fail('現在の作業runだけ予約を操作できます');
 const payload=JSON.stringify({type:'selfResume',workId:w.id,actorRunId:r.id,expectedVersion:x.expectedVersion,at:x.at,text:x.text});
 const old=q.requestGraph.operations.find(o=>o.id===x.operationId);
 if(old){if(old.payload!==payload)fail('operationIdの再利用です');return structuredClone(old.receipt);}
 flow.active(q);if(q.report||w.state.kind!=='active'||!w.inbox)fail('入力対応中の作業だけ予約できます');
 const s=w.selfResume||{version:0,history:[]};
 if(!Number.isInteger(x.expectedVersion)||x.expectedVersion!==s.version)fail('予約versionが変わっています。requests getで再確認してください');
 if(x.at!==null){
  if(w.declarations.some(d=>d.runId===r.id&&!d.invalidated))fail('finish申告後には予約できません。待機する回はrespondを使ってください');
  const at=deadline(x.at);if(!at||Date.parse(at)<=flow.reporting.clock())fail('未来のタイムゾーン付き日時を指定してください');
  if(typeof x.text!=='string'||!x.text.trim()||x.text.length>4000)fail('確認内容を1〜4000文字で指定してください');
  w.selfResume=s;closeSelfResume(w,'replaced',r.id);
  s.version++;s.current={id:randomUUID(),at,text:x.text,actorRunId:r.id,status:'scheduled'};
  s.history.push({kind:'scheduled',version:s.version,reservation:{...s.current},actorRunId:r.id});
 }else{
  w.selfResume=s;const previous=s.version;closeSelfResume(w,'agent-cancelled',r.id);if(s.version===previous)s.version++;
 }
 const receipt=structuredClone(s);q.requestGraph.operations.push({id:x.operationId,payload,receipt});q.revision++;await flow.d.save();return receipt;
}));}
export function fireSelfResume(flow,q,w,version){
 const s=w.selfResume,c=s?.current;if(!s||s.version!==version||c?.status!=='scheduled'||w.state.kind!=='active')return;
 c.status='delivered';s.version++;s.history.push({kind:'delivered',version:s.version,reservation:{...c}});
 applyGraph(flow.d.data,q,{type:'supplement',actor:'program',requestId:w.id,input:{id:c.id,kind:'supplement',text:'自分で予約した確認の時刻になりました。これは人間からの追加指示や期限延長ではありません。\n'+JSON.stringify({reservationId:c.id,scheduledAt:c.at,createdByRunId:c.actorRunId,text:c.text}),createdAt:new Date(flow.reporting.clock()).toISOString(),attempts:[]}});
}
