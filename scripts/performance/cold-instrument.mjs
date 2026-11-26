// Optional fixture-only instrumentation. Never loaded by the normal server.
import {appendFileSync} from 'node:fs';
import {PartitionStore} from '../../server/partition-store.mjs';
import {DirectAgents} from '../../server/direct.mjs';
const emit=row=>appendFileSync(process.env.PERF_LOG,JSON.stringify({at:Date.now(),...row})+'\n');
const save=PartitionStore.prototype.save,commit=PartitionStore.prototype.commit;
PartitionStore.prototype.save=async function(...a){const t=performance.now();this.perfSaveStart=t;try{return await save.apply(this,a);}finally{emit({method:'storeSave',ms:performance.now()-t});}};
PartitionStore.prototype.commit=function(...a){emit({method:'prepare',ms:performance.now()-this.perfSaveStart});const t=performance.now();try{return commit.apply(this,a);}finally{emit({method:'commit',ms:performance.now()-t});}};
const directSave=DirectAgents.prototype.save;
DirectAgents.prototype.save=async function(...a){const t=performance.now();try{return await directSave.apply(this,a);}finally{emit({method:'directSave',ms:performance.now()-t});}};
