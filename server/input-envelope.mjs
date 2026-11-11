// ASCII token has no markup, quoting or whitespace for CLI paste processing to alter.
// It is an ownership correlation key, not authentication or permission to execute.
export const runMarker=id=>'ai-village-run-'+id;
export const markerContext=id=>'\n<ai-village-input>'+runMarker(id)+'</ai-village-input>';
export const matchesRunInput=(run,input)=>run.inputMarker===runMarker(run.id)&&typeof input.text==='string'&&input.text.split(/[^A-Za-z0-9-]+/).includes(run.inputMarker);

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
p.write_text(original+'\\n\\n'+body)
print(json.dumps({'installed':True,'hash':hashlib.sha256(body.encode()).hexdigest()}))
`;

// Read only: reinstalling a missing file cannot restore instructions in an
// already running/resumed CLI. Match the installed bytes, not today's rules.
export const verifyInstructionsScript=`import sys,json,re,hashlib
from pathlib import Path
ws,provider,expected=sys.argv[1:]
if not re.fullmatch(r'ws-[A-Za-z0-9_-]+',ws) or provider not in ('claude','codex') or not re.fullmatch(r'[a-f0-9]{64}',expected):raise ValueError('invalid instruction identity')
root=Path.home()/'.purplemux'/'workspaces'/ws
p=root/(provider+'-prompt.md')
if root.is_symlink() or p.is_symlink() or not p.is_file():raise ValueError('workspace prompt unavailable')
blocks=re.findall(rb'<ai-village-instructions version="1">.*?</ai-village-instructions>',p.read_bytes(),re.S)
print(json.dumps({'verified':any(hashlib.sha256(b).hexdigest()==expected for b in blocks)}))
`;
