import {orderedAgents,isSuspended,orderedProjects} from './board-state.js';
import {registeredRole} from './status-icon.js';
import {visualState,agentEntries} from './completions.js';
const labels={busy:'作業中',running:'作業中',idle:'待機',completed:'応答完了',waiting_input:'確認待ち',failed:'失敗',interrupted:'中断',unknown:'状態不明',unavailable:'接続不可',stopping:'終了処理中',stop_unknown:'終了未確認',starting:'起動中',queued:'待機中'};
export function villageModel(snapshot={},online=true){
 const workshops=(snapshot.workshops||[]).filter(w=>!w.deletedAt),projects=(snapshot.projects||[]).filter(p=>!p.deletedAt);
 const places=[{id:'mayor',name:'村長の家',kind:'mayor',residents:[]},...workshops.map(w=>({id:'workshop:'+w.id,name:w.name,kind:'workshop',workshop:w,residents:[]}))];
 const residents=orderedAgents(snapshot.agents||[]).filter(a=>!a.deletedAt).map(a=>{
  const place=a.location==='mayor'?places[0]:a.location==='workshop'?places.find(p=>p.workshop?.id===a.workshopId):null;
  let status=!online||['unknown','disconnected'].includes(a.connectionState)||['unknown','unavailable'].includes(a.lifecycle)?'unknown':a.state;
  if(status==='idle'){const entries=agentEntries({runs:snapshot.runs||[]},a),latest=(a.nativeTurns||[]).filter(t=>!a.observedSessionId||t.sessionId===a.observedSessionId).at(-1)||entries.at(-1);status=['failed','interrupted'].includes(latest?.state)?latest.state:visualState(a,entries);}
  const attention=snapshot.reviews?.[a.id]?.attention===true;
  const r={id:a.id,name:a.name||'名前未登録',role:({secretary:'秘書',worker:'工房Agent',unknown:'役割不明'})[registeredRole(a)],placeId:place?.id||'unassigned',project:projects.find(p=>p.id===a.projectId)?.name||(a.projectId?'Project未確認':'Project未所属'),status:labels[status]?status:'unknown',label:labels[status]||'状態不明',attention,source:a};
  if(!place&&!places.some(p=>p.id==='unassigned'))places.push({id:'unassigned',name:'所属確認の広場',kind:'unknown',residents:[]});
  places.find(p=>p.id===r.placeId).residents.push(r);return r;
 });
 const count=list=>({total:list.length,busy:list.filter(r=>['busy','running'].includes(r.status)).length,attention:list.filter(r=>r.attention).length,unknown:list.filter(r=>['unknown','unavailable','stop_unknown'].includes(r.status)).length});
 const resting=residents.filter(r=>isSuspended(projects,r.source)),active=residents.filter(r=>!isSuspended(projects,r.source));
 for(const p of places){p.residents=p.residents.filter(r=>!isSuspended(projects,r.source));p.count=count(p.residents);}
 const suspendedProjects=orderedProjects(projects.filter(p=>p.suspended===true)).map(p=>({...p,residents:resting.filter(r=>r.source.projectId===p.id)}));
 return {places,residents:active,workshops,count:count(active),suspendedProjects,suspendedCount:count(resting),online};
}
export function reconcileSelection(model,selection){
 const resident=model.residents.find(r=>r.id===selection.resident);
 return {resident:resident?.id||null,place:resident?.placeId||(model.places.some(p=>p.id===selection.place)?selection.place:null)};
}
export const workspaceLink=id=>'/agents#agent-'+encodeURIComponent(id);
