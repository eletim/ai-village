export const PAGE_SIZE=9;
export const placeOf=a=>a.location==='mayor'?'mayor':a.workshopId||'unassigned';
// Activity must never reorder pages. Created identities survive poll/reconnect.
export function orderedAgents(agents){return agents.filter(a=>a.state!=='terminated').slice().sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id,undefined,{numeric:true}));}
export function boardLayout(count,width,height){
 const preferred=count<=1?1:count<=4?2:3;
 const cols=Math.min(preferred,Math.max(1,Math.floor((width+8)/280)));
 const rows=Math.max(1,Math.ceil(count/cols));
 return {cols,rows,rowHeight:Math.max(Math.min(220,height),(height-8*(rows-1))/rows,1)};
}

// Explicit pins precede other projects; retain relative order within each group.
export function orderedProjects(projects){return [...projects].sort((a,b)=>Number(b.pinned===true)-Number(a.pinned===true));}
