import {createHash} from 'node:crypto';
import {launchProfileReady} from './launch-profile.mjs';
const json=x=>JSON.stringify(x);
const digest=x=>createHash('sha256').update(json(x)).digest('hex');
const sent=r=>!!r.dispatchAttemptedAt||r.runModel?.facts?.some(f=>f.type==='dispatch');
const unclassified=(a,runs)=>runs.some(r=>r.agentId===a.id&&!sent(r)&&r.runModel?.state?.kind!=='queued');
const sends=(a,runs)=>runs.filter(r=>r.agentId===a.id&&sent(r));
const identity=a=>structuredClone({workspaceId:a.workspaceId,tabId:a.tabId,sessionName:a.sessionName,sessionId:a.runtime?.agentSessionId,profile:a.launchProfile,contract:a.inputEnvelope});
const record=r=>Object.fromEntries(['id','agentId','requestId','conversationId','workId','humanRequestId','instruction','runModel','dispatchAttemptedAt','baselineRuntime','agentSessionId','sessionId','turnId','inputId','acceptedAt','completedAt','completionEvent','completionOffset','output','finalOutput'].map(k=>[k,r[k]]));
const normal=(r,sid)=>!!sid&&r.sessionId===sid&&r.agentSessionId===sid&&r.baselineRuntime?.sessionId===sid&&!!r.acceptedAt&&!!r.completedAt&&!!r.inputId&&!!r.turnId&&r.runModel?.state?.kind==='ended'&&r.runModel.state.outcome==='normal'&&Array.isArray(r.runModel.facts)&&r.runModel.facts.filter(f=>f.type==='dispatch').length===1&&r.runModel.facts.filter(f=>['dispatch','input','terminal'].includes(f.type)).every(f=>f.sessionId===sid)&&r.runModel.facts.some(f=>f.type==='input'&&f.sessionId===sid&&f.turnId===r.turnId&&f.inputId===r.inputId)&&r.runModel.facts.some(f=>f.type==='terminal'&&f.sessionId===sid&&f.turnId===r.turnId&&f.outcome==='normal');
/** Optional proof only: no new permission for adoption or profile-less runtimes. */
export function adoptionFreshProof(a,b,runs,snapshot){
 if(!a.launchProfile||!b.launchProfile||!launchProfileReady(b)||!snapshot.available)return null;
 const sid=a.runtime?.agentSessionId,old=sends(a,runs);
 if(unclassified(a,runs)||!sid||snapshot.sessionId!==sid||sid===b.runtime?.agentSessionId||!old.length||old.some(r=>!normal(r,sid)||!snapshot.turns.some(t=>t.id===r.turnId&&t.state==='completed')||!snapshot.inputs.some(i=>i.id===r.inputId&&i.turnId===r.turnId)))return null;
 return {version:1,oldIdentity:identity(a),newIdentity:identity(b),oldSends:old.map(r=>({id:r.id,digest:digest(record(r))})),startupEvent:structuredClone(b.runtime.lastEvent)};
}
export function noCurrentRuntimeSends(a,runs,status,snapshot,contractHash){
 const old=sends(a,runs),m=a.runtimeMigrations?.at(-1),p=m?.freshProof;
 if(!old.length&&!p)return true; // unchanged ordinary fresh-session rule
 if(unclassified(a,runs)||!a.launchProfile||!p||p.version!==1||m.agentId!==a.id||!launchProfileReady({...a,runtime:status})||a.inputEnvelope?.mode!=='startup-v2'||a.inputEnvelope.hash!==contractHash)return false;
 if(json(identity({...a,runtime:status}))!==json(p.newIdentity)||json(identity(m.newRuntime))!==json(p.newIdentity)||json(identity(m.oldRuntime))!==json(p.oldIdentity)||json(status.lastEvent)!==json(p.startupEvent))return false;
 if(!snapshot.unrecorded||snapshot.inputs.length||snapshot.turns.length||snapshot.incompleteTail||status.permissionRequest||a.setupRequired||!status.alive||status.cliState!=='idle'||status.lastEvent?.name!=='session-start'||status.lastUserMessage)return false;
 return old.length===p.oldSends.length&&old.every(r=>normal(r,p.oldIdentity.sessionId)&&p.oldSends.some(s=>s.id===r.id&&s.digest===digest(record(r))));
}
