#!/usr/bin/env node
// Connect to the running village; never race its state writer by editing files.
const argv=process.argv.slice(2);
try {
  const response=await fetch(new URL('/api/village',process.env.VILLAGE_URL||'http://127.0.0.1:5173'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:argv.length?argv:['help']})});
  const result=await response.json();console.log(JSON.stringify(result,null,2));
  if(!response.ok||!result.ok)process.exitCode=1;
} catch(error){console.error(error.message);process.exitCode=1;}
