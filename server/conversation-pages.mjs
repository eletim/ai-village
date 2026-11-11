import {agentEntries} from '../src/completions.js';
const terminal=new Set(['completed','failed','interrupted','superseded','terminated']);
export const entryKey=r=>JSON.stringify([r.createdAt||'',r.external?'native':'run',r.external?(r.sessionId||r.agentSessionId||''):'',r.id]);
const fields='id requestId agentId humanRequestId workId origin phase state needsReview acceptance createdAt completedAt turnId sessionId agentSessionId instruction travelContexts attachments output finalOutput error errorCode attachmentError recovery notification queueCancelledAt dispatchAttemptedAt dispatchConfirmed inputId suppressUser hideEntry reportStatus hiddenCompletion collapsedHistory external'.split(' ');
const present=r=>Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const ordered=(view,a)=>agentEntries(view,a).sort((a,b)=>entryKey(a)<entryKey(b)?-1:entryKey(a)>entryKey(b)?1:0);
const cursor=(agentId,key)=>Buffer.from(JSON.stringify([agentId,key])).toString('base64url');
function decode(value,agentId){
 try{if(typeof value!=='string'||value.length>4096)throw Error();const x=JSON.parse(Buffer.from(value,'base64url'));if(!Array.isArray(x)||x.length!==2||x[0]!==agentId||typeof x[1]!=='string'||!Array.isArray(JSON.parse(x[1])))throw Error();return x[1];}
 catch{throw Object.assign(Error('Invalid history cursor'),{status:400});}
}
export function historyPage(view,agentId,before){
 const a=view.agents.find(a=>a.id===agentId);if(!a)throw Object.assign(Error('Agent not found'),{status:404});
 const all=ordered(view,a),bound=before?decode(before,agentId):null,older=bound?all.filter(r=>entryKey(r)<bound):all,entries=older.slice(-100);
 return {entries:entries.map(present),hasMore:older.length>entries.length,cursor:entries.length?cursor(agentId,entryKey(entries[0])):null};
}
// Call only on humanProjection, never on the raw request graph.
// focus: null/undefined keeps every agent's conversation body in the snapshot (legacy/API callers).
// An explicit array narrows bodies to just those agent IDs; every other agent still contributes its
// latest entry's control (no instruction/output) so list-wide status and unread tracking stay correct.
export function workspaceSnapshot(view,ranges={},focus=null){
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
  const entries=all.filter(r=>visible.has(r)||!r.external&&!terminal.has(r.state));
  entries.forEach(r=>{if(!r.external)included.add(r.id);});
  conversations[a.id]={entries:entries.map(present),hasMore:all.some(r=>window.length&&entryKey(r)<entryKey(window[0])),cursor:window.length?cursor(a.id,entryKey(window[0])):null};
 }
 const runs=view.runs.filter(r=>included.has(r.id));
 const agents=view.agents.map(a=>{const {nativeTurns,runtime,creationInput,ownedProcesses,processVerification,initialTabId,sessionName,...rest}=a;return {...rest,nativeTurns:(nativeTurns||[]).slice(-1).map(t=>({id:t.id,sessionId:t.sessionId,state:t.state}))};});
 const ids=new Set(runs.map(r=>r.humanRequestId));
 const requests=(view.requests||[]).filter(q=>ids.has(q.id)).map(q=>({id:q.id,status:q.status,revision:q.revision,works:q.works.map(w=>({id:w.id,currentRunId:w.currentRunId,parentWorkId:w.parentWorkId,finish:w.finish?{status:w.finish.status}:null}))}));
 // runs are referenced by controls, but their bodies are carried only once in conversations.
 const controlFields='id requestId agentId humanRequestId workId phase state turnId sessionId agentSessionId createdAt hiddenCompletion'.split(' ');
 const controls=runs.map(r=>Object.fromEntries(controlFields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));
 return {version:view.version,recoveryRequests:view.recoveryRequests||[],agents,workshops:view.workshops,projects:view.projects,capabilities:view.capabilities,reviews:view.reviews,notification:view.notification,requests,runs:controls,conversations};
}
