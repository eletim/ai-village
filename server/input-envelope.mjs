// Legacy helpers for already-dispatched runs and historical fixtures only.
// New sends use full-input fingerprints below and append no correlation token.
export const runMarker=id=>'ai-village-run-'+id;
export const markerContext=id=>'\n<ai-village-input>'+runMarker(id)+'</ai-village-input>';
// Versioned fingerprints cover the entire delivered input, including the useful
// request runId. They are stored only in the village, never appended to the prompt.
import {createHash} from 'node:crypto';
const digest=text=>createHash('sha256').update(text).digest('hex');
export const inputCorrelation=(text,provider)=>({version:1,provider,digest:digest(text),...(provider==='claude'?{pastedDigest:digest(text.replaceAll('<pasted_content>','<\\pasted_content>'))}:{})});
export function matchesRunInput(run,input){
 if(typeof input.text!=='string')return false;
 if(run.inputCorrelation){
  const key=run.inputCorrelation;
  if(key.version!==1||!key.digest)return false;
  if(digest(input.text)===key.digest)return true;
  // Claude records a whole bracketed paste in this paired wrapper. Strip only
  // that outer framing; never trim/normalize the submitted body or search prose.
  // pastedDigest is the exact, precomputed literal-tag escaping observed in Claude.
  if(key.provider!=='claude'||!['claude-user','claude-queued'].includes(input.source))return false;
  // Claude 2.1.322 also escapes the literal tag without adding outer framing.
  if(digest(input.text)===key.pastedDigest)return true;
  const wrapped=input.text.match(/^\s*<pasted_content id="([^"\n]+)">\n([\s\S]*)\n<\/pasted_content id="\1">\s*$/);
  return !!wrapped&&[key.digest,key.pastedDigest].includes(digest(wrapped[2]));
 }
 // Previously dispatched runs retain their original matching contract.
 return run.inputMarker===runMarker(run.id)&&input.text.split(/[^A-Za-z0-9-]+/).includes(run.inputMarker);
}

// PurpleMux creates these private workspace prompts before any Agent is launched.
// Its Claude launcher uses --append-system-prompt-file; Codex reads the other file
// into -c developer_instructions. Never write instructions in the user's cwd.
export const installInstructionsScript=`import os,sys,json,re,hashlib
from pathlib import Path
ws,provider,body=sys.argv[1:]
if not re.fullmatch(r'ws-[A-Za-z0-9_-]+',ws) or provider not in ('claude','codex'):raise ValueError('workspace/provider')
root=Path.home()/'.purplemux'/'workspaces'/ws
p=root/(provider+'-prompt.md')
if root.is_symlink() or p.is_symlink() or not p.is_file():raise ValueError('workspace prompt missing')
original=p.read_text()
if '# purplemux context' not in original:raise ValueError('unsupported workspace prompt')
if '<ai-village-instructions' in original:raise ValueError('existing startup contract: fresh workspace required')
p.write_text(original+'\\n\\n'+body)
print(json.dumps({'installed':True,'hash':hashlib.sha256(body.encode()).hexdigest()}))
`;

// Verifies the startup contract of an Agent. The workspace prompt file is the primary evidence.
// PurpleMux may regenerate that file (2026-11-25 01:28 a restart dropped the village block from
// already-running workspaces). For Codex the launcher passes the prompt as the process argument
// developer_instructions, so the Codex process under this Agent's own tab (tmux session, never a
// workspace-wide search) is direct evidence of what the running CLI loaded. Claude reads the file
// by path at start; there is no such evidence for it, so Claude is verified by the file only.
// With argv[5]=='restore' and process evidence, the exact proven bytes are appended back to a file
// that has lost every village block, so a later relaunch keeps the same contract.
export const verifyInstructionsScript=`import sys,json,re,hashlib,subprocess,os
from pathlib import Path
ws,provider,expected=sys.argv[1:4]
session=sys.argv[4] if len(sys.argv)>4 else ''
restore=len(sys.argv)>5 and sys.argv[5]=='restore'
if not re.fullmatch(r'ws-[A-Za-z0-9_-]+',ws) or provider not in ('claude','codex') or not re.fullmatch(r'[a-f0-9]{64}',expected):raise ValueError('invalid instruction identity')
if session and not re.fullmatch(r'[A-Za-z0-9_.:-]+',session):raise ValueError('invalid session')
root=Path.home()/'.purplemux'/'workspaces'/ws
p=root/(provider+'-prompt.md')
if root.is_symlink() or p.is_symlink() or not p.is_file():raise ValueError('workspace prompt unavailable')
pattern=r'<ai-village-instructions version="[12]">.*?</ai-village-instructions>'
digest=lambda b:hashlib.sha256(b).hexdigest()
file_blocks=re.findall(pattern.encode(),p.read_bytes(),re.S)
if any(digest(b)==expected for b in file_blocks):
 print(json.dumps({'verified':True,'evidence':{'kind':'workspace-prompt'}}));sys.exit(0)
def process_evidence():
 if provider!='codex' or not session:return None
 r=subprocess.run(['tmux','-L','purple','display-message','-p','-t','='+session+':','#{pane_pid}'],capture_output=True,text=True,timeout=10)
 if r.returncode:return None
 rootpid=int(r.stdout.strip());parents={}
 for d in os.listdir('/proc'):
  if not d.isdigit():continue
  try:t=open('/proc/'+d+'/stat').read();parents[int(d)]=int(t[t.rfind(')')+2:].split()[1])
  except (OSError,ValueError):pass
 tree={rootpid}
 while True:
  grown=tree|{q for q,parent in parents.items() if parent in tree}
  if grown==tree:break
  tree=grown
 found=[]
 for pid in sorted(tree):
  try:args=open('/proc/'+str(pid)+'/cmdline','rb').read().split(b'\\0')
  except OSError:continue
  for a in args:
   if not a.startswith(b'developer_instructions='):continue
   # PurpleMux encodes this TOML basic string with JSON.stringify (codex/prompt.ts toTomlBasicString).
   try:text=json.loads(a[len(b'developer_instructions='):].decode())
   except Exception:return {'conflict':True}
   if not isinstance(text,str):return {'conflict':True}
   blocks=re.findall(pattern,text,re.S)
   found.append({'pid':pid,'start':open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19],'hashes':[digest(b.encode()) for b in blocks],'blocks':blocks})
 if not found:return None
 # Every Codex process in this tab must carry exactly the expected contract.
 if any([h for h in f['hashes']]!=[expected] for f in found):return {'conflict':True}
 return found
evidence=process_evidence()
if not evidence or isinstance(evidence,dict):
 print(json.dumps({'verified':False,'evidence':{'kind':'process-conflict'} if evidence else None}));sys.exit(0)
restored=False
if restore and not file_blocks:
 block=evidence[0]['blocks'][0]
 original=p.read_text()
 if '<ai-village-instructions' not in original and '# purplemux context' in original:
  p.write_text(original+'\\n\\n'+block);restored=True
print(json.dumps({'verified':True,'evidence':{'kind':'running-codex-arguments','processes':[{'pid':f['pid'],'start':f['start']} for f in evidence]},'fileRestored':restored}))
`;
