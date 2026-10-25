import{readFile,writeFile,rename}from'node:fs/promises';import{spawn}from'node:child_process';
const file=process.argv[2],record=JSON.parse(await readFile(file));const save=async()=>{await writeFile(file+'.tmp',JSON.stringify(record),{mode:0o600});await rename(file+'.tmp',file);};
record.pid=process.pid;record.phase='running';await save();let stdout='',stderr='',reason=null;
const child=spawn('/bin/bash',['--noprofile','--norc','-c',record.script],{cwd:record.cwd,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',HOME:record.cwd,TMPDIR:record.tmp},detached:true,stdio:['ignore','pipe','pipe']});
const stop=why=>{reason ||= why;try{process.kill(-child.pid,'SIGKILL');}catch{}};const timer=setTimeout(()=>stop('timeout'),record.timeoutMs);
for(const key of ['stdout','stderr'])child[key].on('data',chunk=>{if(key==='stdout')stdout+=chunk;else stderr+=chunk;if(stdout.length+stderr.length>64000)stop('output_limit');});
const result=await new Promise(resolve=>{child.on('error',error=>resolve({error:error.code}));child.on('exit',(exitCode,signal)=>resolve({exitCode,signal}));});clearTimeout(timer);stop('finished');Object.assign(record,result,{phase:reason==='finished'&&!result.error&&result.exitCode===0?'completed':'failed',reason,stdout:stdout.slice(0,32000),stderr:stderr.slice(0,32000),finishedAt:new Date().toISOString()});await save();
