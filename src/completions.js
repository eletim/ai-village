// One identity per native turn (including the managed/native views of that turn).
// A legacy managed run without native identity is still identified by its run ID.
export function completionKey(agent,entry){
 if(entry.hiddenCompletion||entry.state!=='completed')return null;
 const session=entry.sessionId||entry.agentSessionId;
 const turn=entry.turnId||(entry.external?entry.id:null);
 if(session&&turn)return JSON.stringify([agent.id,agent.provider||'codex',session,turn]);
 return !entry.external&&entry.id?JSON.stringify([agent.id,'run',entry.id]):null;
}
export function agentEntries(state,agent){
 const runs=state.runs.filter(r=>r.agentId===agent.id);
 const external=(agent.nativeTurns||[]).map(t=>({...t,sessionId:t.sessionId||agent.observedSessionId,instruction:t.instruction,createdAt:t.startedAt,external:true})).filter(t=>!runs.some(r=>r.turnId===t.id&&(r.sessionId||r.agentSessionId)===t.sessionId));
 return [...runs,...external].filter(r=>!r.hideEntry).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
}
export function completedEntries(state){
 const found=new Map();
 for(const a of state.agents)for(const entry of agentEntries(state,a)){
  const key=completionKey(a,entry);if(key)found.set(key,{key,agentId:a.id});
 }
 return [...found.values()];
}
// The UI exposes one viewed/unviewed state per Agent, never per reply.
export function unreadByAgent(state){return new Map(Object.entries(state.reviews||{}).filter(([,r])=>r.unreviewed).map(([id])=>[id,true]));}
export function visualState(agent,entries=[]){
 if(agent.state!=='idle')return agent.state;
 // A previous completed turn cannot make a newer failed/interrupted session green.
 const current=agent.observedSessionId?(agent.nativeTurns||[]).filter(t=>(t.sessionId||agent.observedSessionId)===agent.observedSessionId):null;
 const latest=current?current.at(-1):entries.at(-1);
 return latest?.state==='completed'?'completed':agent.state;
}
export function faviconHref(unread){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${unread?'#f5bf64':'#587452'}"/><path d="M12 31L30 14L48 31V53H34V37H26V53H12Z" fill="${unread?'#172237':'#fffdf5'}"/>${unread?'<circle cx="49" cy="15" r="14" fill="#bb334b" stroke="#fff" stroke-width="3"/><path d="M49 7V16" stroke="white" stroke-width="4"/><circle cx="49" cy="22" r="2" fill="white"/>':''}</svg>`;
 return 'data:image/svg+xml,'+encodeURIComponent(svg);
}
