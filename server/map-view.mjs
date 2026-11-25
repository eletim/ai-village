import {agentEntries} from '../src/completions.js';
// Village map transport (GET /api/direct?view=map). The map only needs registrations, Projects,
// review flags and, per Agent, the few latest entries that decide its colour. Everything else in
// the full snapshot (bodies, request graphs, history) is left out. villageModel() computes the
// same places/residents/status from this as from the full snapshot; tests/lean-fetch.test.js checks it.
const agentFields='id name role location workshopId projectId state connectionState lifecycle observedSessionId createdAt displayOrder provider'.split(' ');
const runFields='id agentId turnId sessionId agentSessionId state createdAt hideEntry'.split(' ');
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
const turnOf=t=>pick(t,['id','sessionId','state','startedAt']);
// Call only on humanProjection (DirectAgents.presentation()), never on the raw request graph.
export function mapSnapshot(view){
 const runs=[],agents=[];
 for(const a of view.agents){
  if(a.deletedAt)continue;
  const turns=a.nativeTurns||[],observed=a.observedSessionId,entries=agentEntries({runs:view.runs},a);
  const sessionOf=e=>e.sessionId||e.agentSessionId;
  // The entries villageModel()/visualState() read: the latest overall, the latest of the observed
  // session (entries and native turns), and the latest native turn the failure check looks at.
  const needed=new Set([entries.at(-1),observed?entries.filter(e=>sessionOf(e)===observed).at(-1):null].filter(Boolean));
  const keepTurns=new Set([
   turns.filter(t=>!observed||t.sessionId===observed).at(-1),
   observed?turns.filter(t=>(t.sessionId||observed)===observed).at(-1):null,
   ...[...needed].filter(e=>e.external).map(e=>turns.find(t=>t.id===e.id&&(t.sessionId||observed)===e.sessionId)),
  ].filter(Boolean));
  const keptTurns=turns.filter(t=>keepTurns.has(t));
  // Runs that own a kept native turn travel too, so the client de-duplicates exactly as before.
  const owns=(r,t)=>r.turnId===t.id&&sessionOf(r)===(t.sessionId||observed);
  for(const r of view.runs)if(r.agentId===a.id&&(needed.has(r)||keptTurns.some(t=>owns(r,t))))runs.push(pick(r,runFields));
  agents.push({...pick(a,agentFields),nativeTurns:keptTurns.map(turnOf)});
 }
 const reviews=Object.fromEntries(Object.entries(view.reviews||{}).map(([id,r])=>[id,{unreviewed:!!r.unreviewed,attention:r.attention===true}]));
 return {version:view.version,view:'map',agents,runs,workshops:view.workshops,projects:view.projects,reviews};
}
