// ASCII token has no markup, quoting or whitespace for CLI paste processing to alter.
// It is an ownership correlation key, not authentication or permission to execute.
export const runMarker=id=>'ai-village-run-'+id;
export const markerContext=id=>'\n<ai-village-input>'+runMarker(id)+'</ai-village-input>';
export const matchesRunInput=(run,input)=>run.inputMarker
 ? typeof input.text==='string'&&input.text.split(/[^A-Za-z0-9-]+/).includes(run.inputMarker)
 : input.hash===run.inputHash;

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
