// Optional isolated-fixture instrumentation; never imported by the normal server.
import './cold-instrument.mjs';
import {appendFileSync} from 'node:fs';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {DirectAgents} from '../../server/direct.mjs';
const emit=row=>appendFileSync(process.env.PERF_LOG,JSON.stringify({at:Date.now(),...row})+'\n');
const presentation=DirectAgents.prototype.presentation;
DirectAgents.prototype.presentation=function(...args){const start=performance.now();try{return presentation.apply(this,args);}finally{emit({method:'presentation',ms:performance.now()-start});}};
const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();
setInterval(()=>{emit({method:'eventLoop',maxMs:histogram.max/1e6,meanMs:histogram.mean/1e6});histogram.reset();},1000).unref();
