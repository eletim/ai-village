import {orderedProjects} from '../src/board-state.js';
// Preserve the former visible order once, then discard the retired pin field.
export function migrateProjectOrder(projects){
 if(!projects.some(p=>Object.hasOwn(p,'pinned')))return false;
 const ordered=orderedProjects(projects.filter(p=>!p.deletedAt)).sort((a,b)=>Number(b.pinned===true)-Number(a.pinned===true));
 for(const [rank,p] of ordered.entries()){p.displayOrder=rank;p.revision=(p.revision||0)+1;}
 for(const p of projects)delete p.pinned;
 return true;
}
