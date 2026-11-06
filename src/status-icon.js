import {defaultWorkshopPattern,validWorkshopPattern} from './workshop-pattern.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function registeredRole(agent){
 const role=['secretary','worker'].includes(agent.role)?agent.role:null;
 const location=agent.location==='mayor'?'secretary':agent.location==='workshop'?'worker':null;
 if(agent.role&&!role||role&&location&&role!==location)return 'unknown';
 return role||location||'unknown';
}
export const workshopPattern=defaultWorkshopPattern;
export function roleSVG(agent,workshops=[]){
 const role=registeredRole(agent);
 const shape=role==='secretary'?'<circle cx="8" cy="5" r="3"/><path d="M2 17v-3a6 6 0 0 1 12 0v3z"/><rect x="13" y="9" width="6" height="9" rx="1"/><path d="M15 12h2m-2 3h2"/>':role==='worker'?'<path d="M1 18V8l6-4v4l6-4v4h6v10zM15 8V2h3v6"/>':'<path d="m10 1 9 9-9 9-9-9zM8 7a2 2 0 1 1 3 2c-1 0-1 1-1 2m0 3v1"/>';
 const saved=workshops.find(w=>w.id===agent.workshopId)?.iconPattern;
 const pattern=validWorkshopPattern(saved)?saved:workshopPattern(agent.workshopId);
 const marks=role==='worker'?(pattern?pattern.map((cell,i)=>{
  const x=3.5+(i%4)*4.25,y=11+Math.floor(i/4)*4;
  return cell==='line'?`<path d="M${x-1.3} ${y}h2.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`:cell==='diamond'?`<path d="M${x} ${y-1.5}l1.5 1.5-1.5 1.5-1.5-1.5z"/>`:'';
 }).join(''):'<path d="m7 11 6 5m0-5-6 5" fill="none" stroke="currentColor"/>'):'';
 return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${shape}</g><g fill="currentColor">${marks}</g></svg>`;
}
export function iconLabel(agent,workshops,state,attention=false,unread=false){
 const role=registeredRole(agent),name=agent.name||'名前未登録';
 const workshop=agent.workshopId?(workshops||[]).find(w=>w.id===agent.workshopId):null;
 const place=agent.workshopId?(workshop?.name||agent.connection?.name||'工房名未登録'):'工房未登録';
 return [name,{secretary:'秘書',worker:'工房Agent',unknown:'役割不明'}[role],place,state||'状態不明',attention?'依頼完了・要確認':unread?'更新あり':''].filter(Boolean).join(' · ');
}
export function statusIcon(agent,{mode='dots',workshops=[],state='',stateLabel=state,attention=false,unread=false,sidebar=false}={}){
 const label=escape(iconLabel(agent,workshops,stateLabel,attention,unread));
 return `<span class="dot ${sidebar?'agent-dot':'header-status'}${mode==='roles'?' status-icon':''}" ${sidebar?`data-agent-dot="${escape(agent.id)}"`:''} data-state="${escape(state)}" data-unread="${!!unread}" data-attention="${!!attention}" role="img" title="${label}" aria-label="${label}">${mode==='roles'?roleSVG(agent,workshops):''}</span>`;
}
