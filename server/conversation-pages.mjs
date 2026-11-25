import {requestProgress} from '../src/request-progress.js';
import {agentEntries} from '../src/completions.js';
import {isHumanInput,isVisibleAnswer,entryIdentity} from '../src/run-groups.js';
import {createHash} from 'node:crypto';
const terminal=new Set(['completed','failed','interrupted','superseded','terminated']);
export const entryKey=r=>JSON.stringify([r.createdAt||'',r.external?'native':'run',r.external?(r.sessionId||r.agentSessionId||''):'',r.id]);
const fields='answerJobs conversationLifecycle queuedReason displayMode notificationSuppressed conversationAnswer conversationId conversationSequence conversationSource conversationStatus id inputReceipt inputSource inputStatus targetLabel requestId agentId humanRequestId workId origin phase state needsReview runModel createdAt completedAt turnId sessionId agentSessionId instruction travelContexts attachments output finalOutput error errorCode attachmentError recovery notification queueCancelledAt dispatchAttemptedAt inputId suppressUser hideEntry reportStatus hiddenCompletion collapsedHistory external'.split(' ');
const present=(r,view)=>({...Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])),...(r.workId?{requestProgress:requestProgress(view.requests?.find(q=>q.id===r.humanRequestId),r.workId,view.agents)}:{})});
// Lean transport (docs/lean-fetch.md, stage 2): the body of a side the chat shows folded
// (Agent-to-Agent input, non-public output) is fetched when the fold is opened, through
// entryBody(). The predicates mirror src/direct.js entryHTML(); outputs are deferred only once
// settled, so running progress keeps streaming through sync. `v` identifies the body version.
const version=parts=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,16);
const bodyOf={input:e=>({instruction:e.instruction||''}),output:e=>({output:e.output||'',finalOutput:e.finalOutput||''})};
function foldedSides(e,view){
 if(e.inputReceipt)return ['program','agent'].includes(e.inputSource?.actor)&&e.instruction?['input']:[];
 const sides=[];
 if(!(isHumanInput(e)&&!e.suppressUser)&&e.instruction)sides.push('input');
 const q=view.requests?.find(q=>q.id===e.humanRequestId),published=q?.status==='completed'&&q.finalRunId===e.id;
 if((e.output||e.finalOutput)&&terminal.has(e.state)&&!(published||isVisibleAnswer(e)))sides.push('output');
 return sides;
}
function deferBodies(e,view){
 const sides=foldedSides(e,view);if(!sides.length)return e;
 const lean={...e,bodyDeferred:{}};
 for(const side of sides){
  const body=bodyOf[side](e);for(const k of Object.keys(body))delete lean[k];
  lean.bodyDeferred[side]={v:version(Object.values(body)),...(side==='output'?{final:!!e.finalOutput}:{})};
 }
 return lean;
}
// The body of one folded side, for the fold the human just opened.
export function entryBody(view,agentId,identity,side){
 const a=view.agents.find(a=>a.id===agentId);if(!a)throw Object.assign(Error('Agent not found'),{status:404});
 if(!Object.hasOwn(bodyOf,side)||typeof identity!=='string'||identity.length>1000)throw Object.assign(Error('Invalid entry body request'),{status:400});
 const r=ordered(view,a).find(r=>entryIdentity(r)===identity);if(!r)throw Object.assign(Error('Entry not found'),{status:404});
 const e=present(r,view),body=bodyOf[side](e);
 return {side,v:version(Object.values(body)),...body};
}
const ordered=(view,a)=>agentEntries(view,a).sort((a,b)=>entryKey(a)<entryKey(b)?-1:entryKey(a)>entryKey(b)?1:0);
const cursor=(agentId,key)=>Buffer.from(JSON.stringify([agentId,key])).toString('base64url');
function decode(value,agentId){
 try{if(typeof value!=='string'||value.length>4096)throw Error();const x=JSON.parse(Buffer.from(value,'base64url'));if(!Array.isArray(x)||x.length!==2||x[0]!==agentId||typeof x[1]!=='string'||!Array.isArray(JSON.parse(x[1])))throw Error();return x[1];}
 catch{throw Object.assign(Error('Invalid history cursor'),{status:400});}
}
export function historyPage(view,agentId,before,{lean=false}={}){
 const a=view.agents.find(a=>a.id===agentId);if(!a)throw Object.assign(Error('Agent not found'),{status:404});
 const all=ordered(view,a),bound=before?decode(before,agentId):null,older=bound?all.filter(r=>entryKey(r)<bound):all,entries=older.slice(-100);
 return {entries:entries.map(r=>{const e=present(r,view);return lean?deferBodies(e,view):e;}),hasMore:older.length>entries.length,cursor:entries.length?cursor(agentId,entryKey(entries[0])):null};
}
// Call only on humanProjection, never on the raw request graph.
// focus: null/undefined keeps every agent's conversation body in the snapshot (legacy/API callers).
// An explicit array narrows bodies to just those agent IDs; every other agent still contributes its
// latest entry's control (no instruction/output) so list-wide status and unread tracking stay correct.
// lean (default for the UI route): leave out Agent audit material the Workspace never renders —
// secretaryHandover, and all but the latest runtime migration's legacyRetirement (runtime-migration.js
// reads only runtimeMigrations.at(-1).legacyRetirement). The full records stay in GET /api/direct.
const leanAgent=({secretaryHandover,runtimeMigrations,...rest})=>{
 const latest=runtimeMigrations?.at(-1);
 return runtimeMigrations?{...rest,runtimeMigrations:latest?[latest.legacyRetirement?{at:latest.at,legacyRetirement:latest.legacyRetirement}:{at:latest.at}]:[]}:rest;
};
export function workspaceSnapshot(view,ranges={},focus=null,{lean=false}={}){
 if(!ranges||typeof ranges!=='object'||Array.isArray(ranges)||Object.keys(ranges).length>1000)throw Object.assign(Error('Invalid history ranges'),{status:400});
 let focusIds=null;
 if(focus!=null){
  if(!Array.isArray(focus)||focus.length>200||focus.some(id=>typeof id!=='string'||id.length>200))throw Object.assign(Error('Invalid focus agents'),{status:400});
  focusIds=new Set(focus);
 }
 const conversations={},included=new Set();
 for(const a of view.agents){
  const all=ordered(view,a);
  if(focusIds&&!focusIds.has(a.id)){
   const latest=all.at(-1);
   if(latest&&!latest.external)included.add(latest.id);
   continue;
  }
  const from=ranges[a.id]?decode(ranges[a.id],a.id):null;
  const window=from?all.filter(r=>entryKey(r)>=from):all.slice(-100),visible=new Set(window);
  // Keep unsent/uncertain/running controls reachable even when older than the window.
  const entries=all.filter(r=>visible.has(r)||!r.inputReceipt&&!r.external&&!terminal.has(r.state));
  entries.forEach(r=>{if(!r.external)included.add(r.id);});
  conversations[a.id]={entries:entries.map(r=>{const e=present(r,view);return lean?deferBodies(e,view):e;}),hasMore:all.some(r=>window.length&&entryKey(r)<entryKey(window[0])),cursor:window.length?cursor(a.id,entryKey(window[0])):null};
 }
 const runs=view.runs.filter(r=>included.has(r.id));
 const agents=view.agents.map(a=>{const {nativeTurns,runtime,creationInput,ownedProcesses,processVerification,initialTabId,sessionName,...rest}=a;const agent={...rest,nativeTurns:(nativeTurns||[]).slice(-1).map(t=>({id:t.id,sessionId:t.sessionId,state:t.state}))};return lean?leanAgent(agent):agent;});
 const ids=new Set(runs.map(r=>r.humanRequestId));
 const requests=(view.requests||[]).filter(q=>ids.has(q.id)||q.status==='active'&&q.requestGraph?.nodes.some(n=>!focusIds||focusIds.has(n.assignee))).map(q=>({id:q.id,conversationId:q.conversationId,purposeStatus:q.purposeStatus,returnDelivery:q.returnDelivery,instruction:q.inputProtocol===1?(q.instruction||'').slice(0,100):'',status:q.status,finalRunId:q.finalRunId,revision:q.revision,needsReview:q.needsReview,waiting:q.waiting,requestGraph:q.requestGraph?{rootId:q.requestGraph.rootId,nodes:q.requestGraph.nodes.map(n=>({id:n.id,assignee:n.assignee,metadata:{instruction:(n.metadata?.instruction||'').slice(0,100),...(n.metadata?.reporting?{reporting:{completionAt:n.metadata.reporting.completionAt,reportAt:n.metadata.reporting.reportAt,reportReceivedAt:n.metadata.reporting.reportReceivedAt,expired:n.metadata.reporting.expired,latestReport:n.metadata.reporting.reports?.at(-1)}}:{})},inbox:(!focusIds||focusIds.has(n.assignee))?(n.inbox||[]).filter(i=>i.kind==='supplement').map(i=>({id:i.id,operationId:i.operationId})):[],currentRunId:n.currentRunId,parentId:n.parentId,state:n.state}))}:undefined}));
 // runs are referenced by controls, but their bodies are carried only once in conversations.
 const controlFields='id requestId agentId humanRequestId workId phase state turnId sessionId agentSessionId createdAt hiddenCompletion'.split(' ');
 const controls=runs.map(r=>Object.fromEntries(controlFields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));
 return {version:view.version,recoveryRequests:view.recoveryRequests||[],agents,workshops:view.workshops,projects:view.projects,capabilities:view.capabilities,reviews:view.reviews,notification:view.notification,requests,runs:controls,conversations};
}
