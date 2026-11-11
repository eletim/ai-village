// Drain both pipes and buffer UTF-8/chunk boundaries. A failed child must report
// its diagnostic output, not merely "exit"; timeout never leaves it running.
export function serverReady(child,{timeout=10000}={}){
 let output='';
 return new Promise((resolve,reject)=>{
  const append=chunk=>{output=(output+chunk).slice(-16000);};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stderr.on('data',append);
  const cleanup=()=>{clearTimeout(timer);child.off('exit',onExit);child.off('error',onError);child.stdout.off('data',onData);};
  const fail=message=>{cleanup();reject(Error(`${message}\n${output}`));};
  const onExit=(code,signal)=>fail(`Server exited (${code??signal}) before readiness`);
  const onError=error=>fail(error.message);
  const onData=chunk=>{append(chunk);if(output.includes('AI村 →')){cleanup();child.stdout.on('data',append);resolve();}};
  const timer=setTimeout(()=>{child.kill();fail('Server startup timeout');},timeout);
  child.once('exit',onExit);child.once('error',onError);child.stdout.on('data',onData);
 });
}
