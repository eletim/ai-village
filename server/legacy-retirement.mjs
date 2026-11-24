import {createHash} from 'node:crypto';
import {launchProfileReady} from './launch-profile.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const retirementIdentity=a=>structuredClone({provider:a.provider,workspaceId:a.workspaceId,tabId:a.tabId,sessionName:a.sessionName,sessionId:a.runtime?.agentSessionId,profile:a.launchProfile||null,contract:a.inputEnvelope});
const fail=message=>{throw Object.assign(Error(message),{status:409});};
export function retirementOption(x){
 if(x===undefined)return;
 if(!x||Object.keys(x).sort().join(',')!=='acknowledgement,mode,version'||x.version!==1||x.mode!=='new-work-only'||typeof x.acknowledgement!=='string'||!x.acknowledgement.trim()||x.acknowledgement.length>4000)fail('retireLegacyHistoryにはversion:1、mode:new-work-only、過去の結果不明を保持し再送しない限定操作専用acknowledgementが必要です');
}
export function retirementSnapshot(data,a){
 const runs=data.runs.filter(r=>r.agentId===a.id);
 if(runs.some(r=>r.runModel?.state?.kind!=='ended'||r.unknownSince&&!r.unknownResolvedAt||r.runModel?.facts?.some(f=>f.type==='dispatch')&&!r.runModel.facts.some(f=>['transport-ack','input'].includes(f.type))))fail('退役にはqueued・追跡中・未分類・通信受付不明がないことが必要です');
 const works=data.requests.flatMap(q=>(q.requestGraph?.nodes||[]).filter(w=>w.assignee===a.id).map(w=>({q,w})));
 if(works.some(({w})=>!['completed','withdrawn'].includes(w.state?.kind)||(w.inbox||[]).some(i=>!i.handledBy&&!i.retiredBy)||['scheduled','delivered'].includes(w.selfResume?.current?.status)||(w.declarations||[]).some(d=>!d.invalidated&&!data.runs.some(r=>r.id===d.runId&&r.runModel?.state?.kind==='ended'&&r.runModel.state.outcome==='normal'))))fail('退役には旧仕事・未処理入力・予約・未確定申告の解消が必要です');
 if(works.some(({w})=>(w.claims||[]).some(c=>!c.invalidated&&!(w.invalidatedRuns||[]).includes(c.actorRunId)&&!(w.handling||[]).some(h=>h.operationId===c.operationId&&h.resultId===c.resultId))||(w.inputClaims||[]).some(c=>!(w.invalidatedRuns||[]).includes(c.runId)&&c.ids.some(id=>!(w.inbox||[]).some(i=>i.id===id&&(i.handledBy||i.retiredBy))))))fail('未確定の入力・成果採否申告が残っています');
 const conversations=(data.conversations||[]).filter(c=>c.agentId===a.id);
 if(data.requests.some(q=>conversations.some(c=>c.id===q.conversationId)&&(q.requestGraph?.nodes||[]).some(w=>!['completed','withdrawn'].includes(w.state?.kind))))fail('旧会話の仕事が未解決です');
 return {oldRuns:runs.map(r=>({id:r.id,digest:digest(r),outcome:r.runModel.state.outcome,reason:r.runModel.state.reason||null})),oldWorks:works.map(({q,w})=>({humanRequestId:q.id,workId:w.id})),oldRequestIds:data.requests.map(q=>q.id)};
}
export function retirementRecord(data,a,b,option){
 retirementOption(option);
 if(a.agentModel?.intent!=='stop'||a.runtimeUpgrade?.state!=='prepared')fail('限定退役には正式停止と切替準備が必要です');
 if(b.provider==='claude'&&(!b.launchProfile||!launchProfileReady(b)))fail('新Claudeには明示profileと起動観測が必要です');
 return {version:1,mode:'new-work-only',acknowledgement:option.acknowledgement,...retirementSnapshot(data,a),newIdentity:retirementIdentity(b),startupEvent:structuredClone(b.runtime?.lastEvent||null)};
}
export const latestRetirement=a=>a.runtimeMigrations?.at(-1)?.legacyRetirement;
export function retirementIntact(data,a){
 const p=latestRetirement(a);if(!p)return true;
 const receipt=a.runtimeMigrations.at(-1);
 if(p.version!==1||p.mode!=='new-work-only'||receipt.agentId!==a.id||JSON.stringify(retirementIdentity({provider:p.newIdentity.provider,...receipt.newRuntime}))!==JSON.stringify(p.newIdentity))return false;
 if(JSON.stringify(retirementIdentity(a))!==JSON.stringify(p.newIdentity))return false;
 const m=a.runtimeMigrations.at(-1);
 if(data.runs.some(r=>r.agentId===a.id&&!p.oldRuns.some(v=>v.id===r.id)&&((!Number.isFinite(Date.parse(r.createdAt))||Date.parse(r.createdAt)<Date.parse(m.at))||((r.dispatchAttemptedAt||r.runModel?.facts?.some(f=>f.type==='dispatch'))&&(r.agentSessionId!==p.newIdentity.sessionId||r.baselineRuntime?.sessionId!==p.newIdentity.sessionId)))))return false;
 return p.oldRuns.every(v=>{const r=data.runs.find(r=>r.id===v.id);return r?.agentId===a.id&&digest(r)===v.digest;});
}
export function retirementRunAllowed(data,a,r){
 const m=a.runtimeMigrations?.at(-1),p=m?.legacyRetirement;if(!p)return true;
 if(p.oldRuns.some(v=>v.id===r.id)||(!Number.isFinite(Date.parse(r.createdAt))||Date.parse(r.createdAt)<Date.parse(m.at)))return false;
 if(r.conversationId){return r.conversationSource?.kind==='human'||!!r.conversationSource?.humanRequestId&&!p.oldRequestIds.includes(r.conversationSource.humanRequestId)&&data.requests.some(q=>q.id===r.conversationSource.humanRequestId&&Date.parse(q.createdAt)>=Date.parse(m.at));}
 const q=data.requests.find(q=>q.id===r.humanRequestId);
 return !!q&&!p.oldRequestIds.includes(q.id)&&Date.parse(q.createdAt)>=Date.parse(m.at);
}
export function retiredFreshSession(a,runs,status,snapshot,contractHash){
 const p=latestRetirement(a);if(!p)return false;
 if(!retirementIntact({runs}, {...a,runtime:status})||a.inputEnvelope?.mode!=='startup-v2'||a.inputEnvelope.hash!==contractHash||!launchProfileReady({...a,runtime:status}))return false;
 if(JSON.stringify(status.lastEvent)!==JSON.stringify(p.startupEvent)||!snapshot.unrecorded||snapshot.inputs.length||snapshot.turns.length||snapshot.incompleteTail||status.permissionRequest||a.setupRequired||!status.alive||status.cliState!=='idle'||status.lastEvent?.name!=='session-start'||status.lastUserMessage)return false;
 return runs.filter(r=>r.agentId===a.id&&!p.oldRuns.some(v=>v.id===r.id)).every(r=>r.runModel?.state?.kind==='queued'&&!r.dispatchAttemptedAt&&!r.runModel?.facts?.some(f=>f.type==='dispatch'));
}
