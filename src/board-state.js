export const PAGE_SIZE=9;
export const placeOf=a=>a.location==='mayor'?'mayor':a.workshopId||'unassigned';
// Activity must never reorder pages. Created identities survive poll/reconnect.
export function orderedAgents(agents){return agents.filter(a=>!a.deletedAt&&a.state!=='terminated').slice().sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id,undefined,{numeric:true}));}
export function boardLayout(count,width,height){
 const preferred=count<=1?1:count<=4?2:3;
 const cols=Math.min(preferred,Math.max(1,Math.floor((width+8)/280)));
 const rows=Math.max(1,Math.ceil(count/cols));
 return {cols,rows,rowHeight:Math.max(Math.min(220,height),(height-8*(rows-1))/rows,1)};
}

// Unset ranks follow explicit ones; stable ties preserve the existing order.
const compareOrder=(a,b)=>{const x=Number.isSafeInteger(a.displayOrder)?a.displayOrder:null,y=Number.isSafeInteger(b.displayOrder)?b.displayOrder:null;return x===null?(y===null?0:1):y===null?-1:x-y;};
export function orderedProjectAgents(agents){return orderedAgents(agents).sort(compareOrder);}
// Project order has one source: displayOrder, with stable registration-order ties.
export function orderedProjects(projects){return [...projects].sort((a,b)=>compareOrder(a,b));}

// A display preference on explicit Project membership, never a process state.
export const isSuspended=(projects,agent)=>projects.some(p=>p.id===agent.projectId&&!p.deletedAt&&p.suspended===true);
export function suspensionSummary(agents,reviews={}){
 const count=predicate=>agents.filter(predicate).length;
 return [['作業中',count(a=>['busy','running','starting','creating','sending'].includes(a.state))],['確認待ち',count(a=>['waiting_input','awaiting_input','queued'].includes(a.state))],['更新',count(a=>reviews[a.id]?.unreviewed)],['要確認',count(a=>reviews[a.id]?.attention)],['エラー/不明',count(a=>['failed','interrupted','unknown','unavailable'].includes(a.state)||a.connectionState==='unknown')]].filter(([,n])=>n).map(([label,n])=>label+' '+n).join(' · ')||'更新・警告なし';
}
