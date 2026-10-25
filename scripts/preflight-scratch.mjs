// Must be run from the exact candidate checkout before the first legacy-worker apply.
import {readFile,realpath,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {Scratch} from '../server/scratch.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {scratchEnvironment} from './scratch-config.mjs';
const env={...scratchEnvironment(),VILLAGE_SCRATCH_REQUIRED:'1'};
try {
 if(!env.VILLAGE_SCRATCH_RUNTIME)throw Error('runtime is required');
 const root=await realpath(dirname(env.VILLAGE_SCRATCH_RUNTIME));
 const expected=JSON.parse(await readFile(new URL('./scratch-sources.json',import.meta.url),'utf8'));
 const sources=JSON.parse(await readFile(resolve(root,'sources.json'),'utf8'));
 if(JSON.stringify(sources)!==JSON.stringify(expected))throw Error('runtime source lock differs from candidate');
 const installed=JSON.parse(await readFile(resolve(root,'installed.json'),'utf8'));
 for(const required of ['bin/bwrap','fonts/NotoSansCJK-Regular.ttc','python/libseccomp.so.2'])if(!installed[required])throw Error('incomplete runtime');
 for(const [name,hash] of Object.entries(installed)) {
  const file=await realpath(resolve(root,name));
  if(!file.startsWith(root+sep))throw Error('runtime file escapes root');
  if(createHash('sha256').update(await readFile(file)).digest('hex')!==hash)throw Error('runtime checksum mismatch: '+name);
 }
 for(const [key,name] of [['VILLAGE_SCRATCH_RUNTIME','python'],['VILLAGE_SCRATCH_BWRAP','bin/bwrap'],['VILLAGE_SCRATCH_FONT','fonts/NotoSansCJK-Regular.ttc']]) {
  if(!env[key] || await realpath(env[key])!==await realpath(resolve(root,name)))throw Error('preflight requires matching installed '+key);
 }
 const version=spawnSync(env.VILLAGE_SCRATCH_BWRAP,['--version'],{env:{},encoding:'utf8'});
 if(version.status!==0 || version.stdout.trim()!=='bubblewrap 0.11.0')throw Error('unexpected bubblewrap version');
 const probeDir=await mkdtemp(resolve(tmpdir(),'scratch-version-'));
 try {
  const scratch=new Scratch(probeDir,null,env.VILLAGE_SCRATCH_RUNTIME);
  const result=await scratch.execute(randomUUID(),`import PIL,ctypes
assert PIL.__version__ == '12.3.0', PIL.__version__
class Version(ctypes.Structure):
 _fields_=[('major',ctypes.c_uint),('minor',ctypes.c_uint),('micro',ctypes.c_uint)]
lib=ctypes.CDLL('/runtime/libseccomp.so.2')
lib.seccomp_version.restype=ctypes.POINTER(Version)
v=lib.seccomp_version().contents
assert (v.major,v.minor,v.micro)==(2,5,5)
print('Pillow 12.3.0 + libseccomp 2.5.5')`);
  if(!result.ok)throw Error('isolated dependency versions failed: '+(result.reason || result.output));
  console.log(result.output.trim());
 }finally{await rm(probeDir,{recursive:true,force:true});}
 console.log('PASS pinned runtime integrity and versions');
 const result=spawnSync(process.execPath,['scripts/require-scratch.mjs'],{env,stdio:'inherit'});
 if(result.error || result.status!==0)throw Error('mandatory scratch verification failed');
 console.log('PASS mandatory real isolation preflight (not deployment approval)');
}catch(error){console.error(error.message);process.exitCode=1;}
