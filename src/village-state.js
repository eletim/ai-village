import { personActivity } from './live.js';
export function placedAgents(live) {
  const jobs = new Map((live.jobs || []).map(job=>[job.id,job]));
  if(live.job)jobs.set(live.job.id,live.job);
  return [...jobs.values()].filter(job=>job.tabId && job.releaseState!=='released');
}
export function agentState(job, online=true) {
  const activity=personActivity('レン',job,online);
  const label=!online?'接続未確認':job.releaseState==='failed'?'解放失敗':job.releaseState==='releasing'?'解放中':job.cancelRequestedAt?'停止確認中':job.connectionError?'接続不能':job.permissionRequest?'許可待ち':activity.active?'作業中':job.phase==='awaiting_review'?'確認待ち':'状態確認中';
  return {...activity,active:label==='作業中',label};
}
export function workshopAgents(workshop, agents) {
  return agents.filter(job=>job.workshopDocument ? job.workshopDocument===workshop.document : job.workshopName===workshop.name);
}
