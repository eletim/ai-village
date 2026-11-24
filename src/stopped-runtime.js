// Eligibility from durable evidence only; never substitutes for fresh server checks.
export function stoppedRuntimeEvidence(a){
 const p=a?.ownedProcesses,v=a?.processVerification,o=a?.agentModel?.observation;
 return a?.agentModel?.intent==='stop'&&Number.isFinite(Date.parse(a?.terminatedAt))&&!!a?.workspaceId&&!!a?.tabId&&!!a?.sessionName&&
  o?.connected===true&&o.process==='absent'&&Array.isArray(p)&&p.length>0&&
  p.every(r=>Number.isSafeInteger(r?.pid)&&r.pid>0&&typeof r.start==='string'&&/^\d+$/.test(r.start))&&new Set(p.map(r=>r.pid)).size===p.length&&
  v?.remainingOwned===0&&Number.isSafeInteger(v.trackedProcesses)&&v.trackedProcesses===p.length;
}
