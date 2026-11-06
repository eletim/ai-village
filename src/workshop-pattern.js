export const patternCells=['none','line','diamond'];
export function validWorkshopPattern(value){return Array.isArray(value)&&value.length===8&&Array.from(value).every(cell=>patternCells.includes(cell));}
export function defaultWorkshopPattern(id){
 if(typeof id!=='string'||!id.trim())return null;
 let hash=2166136261;for(const char of id){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
 const cells=Array.from({length:8},(_,i)=>patternCells[(hash>>>(i*2))%3]);
 if(cells.every(cell=>cell==='none'))cells[0]='line';return cells;
}
