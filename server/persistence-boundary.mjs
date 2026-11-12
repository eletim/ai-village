import {AsyncLocalStorage} from 'node:async_hooks';

// Retain object identities: callers can hold references to a run/work/Agent across
// a failed save. Replacing data with a JSON clone would leave those references live.
export function checkpoint(root){
 const objects=new Map();
 const visit=value=>{
  if(!value||typeof value!=='object'||objects.has(value))return;
  objects.set(value,Array.isArray(value)?[...value]:{...value});
  for(const child of Object.values(value))visit(child);
 };
 visit(root);
 return ()=>{for(const [object,saved] of objects){
  for(const key of Object.keys(object))delete object[key];
  if(Array.isArray(object))object.length=0;
  Object.assign(object,saved);
 }};
}

// Reentrant across nested model commits, exclusive across independent writers.
// Remote reads/effects stay outside: no second writer may persist a mutation
// awaiting its disk barrier, but slow connections must not block other Agents.
export class PersistenceBoundary {
 constructor(){this.context=new AsyncLocalStorage();this.tail=Promise.resolve();this.failure=null;}
 run(fn){
  if(this.failure)return Promise.reject(this.failure);
  if(this.context.getStore()?.active)return fn();
  const task=this.tail.catch(()=>{}).then(()=>{
   if(this.failure)throw this.failure;
   const scope={active:true};
   return this.context.run(scope,async()=>{try{return await fn();}finally{scope.active=false;}});
  });
  this.tail=task;return task;
 }
}
