// PurpleMux's managed socket was verified in its installed tmux-target.ts.
// Track descendants before tab close: Codex tools can start a new process group
// which survives PurpleMux's pane-group kill. PID + Linux starttime prevent reuse.
const common = `import os,json,sys,subprocess,signal,time

def info(pid):
 try:
  text=open('/proc/'+str(pid)+'/stat').read(); tail=text[text.rfind(')')+2:].split()
  return {'pid':int(pid),'parent':int(tail[1]),'start':tail[19],'state':tail[0]}
 except (OSError,ValueError): return None

def inventory():
 return {int(p):v for p in os.listdir('/proc') if p.isdigit() and (v:=info(p))}

def tree(root,items):
 found={root}
 while True:
  expanded=found|{p for p,v in items.items() if v['parent'] in found}
  if expanded==found:return found
  found=expanded

def pane(session):
 result=subprocess.run(['tmux','-L','purple','display-message','-p','-t','='+session+':','#{pane_pid}'],capture_output=True,text=True,timeout=10)
 if result.returncode:raise RuntimeError('対象セッションのPIDを確認できません: '+session)
 return int(result.stdout.strip())

def alive(record):
 current=info(record['pid'])
 return current and current['start']==record['start'] and current['state'] not in ('Z','X')

def send(record,kind):
 if not alive(record):return
 try:
  fd=os.pidfd_open(record['pid'])
  try:
   if alive(record):signal.pidfd_send_signal(fd,kind)
  finally:os.close(fd)
 except ProcessLookupError:pass

`;
export const captureProcessesScript = common + `
root=pane(sys.argv[1]);known={}
for attempt in range(10):
 items=inventory()
 if root not in items:raise RuntimeError('Agentのプロセスが見つかりません')
 expanded={p:items[p] for p in tree(root,items) if p in items}
 for record in expanded.values():send(record,signal.SIGSTOP)
 if expanded.keys()==known.keys():break
 known=expanded
else:raise RuntimeError('Agentの子プロセスを安定して特定できません')
print(json.dumps(list(expanded.values())))
`;
export const stopProcessesScript = common + `
owned=json.loads(sys.argv[1]);root=os.path.realpath(sys.argv[2]);others=json.loads(sys.argv[3])

# Freeze captured processes and discover children still attached to them. Never
# signal a process just because its cwd happens to be inside a job directory.
known={v['pid']:v for v in owned}
for attempt in range(5):
 for record in list(known.values()):send(record,signal.SIGSTOP)
 items=inventory();expanded=dict(known)
 for record in known.values():
  if alive(record):
   for pid in tree(record['pid'],items):
    if pid in items:expanded[pid]=items[pid]
 if len(expanded)==len(known):break
 known=expanded
else:raise RuntimeError('子プロセスが増え続けており、停止は未確認です')
for record in known.values():
 send(record,signal.SIGTERM);send(record,signal.SIGCONT)
time.sleep(0.2)
for record in known.values():send(record,signal.SIGKILL)
for attempt in range(20):
 remaining=[v for v in known.values() if alive(v)]
 if not remaining:break
 time.sleep(0.05)
if remaining:raise RuntimeError('対象の子プロセスがまだ残っています')

# Other tabs and all their descendants are read-only exclusions, never targets.
items=inventory();excluded=set()
for session in others:
 excluded |= tree(pane(session),items)
untracked=[]
for pid,record in items.items():
 if pid in excluded or record['state'] in ('Z','X'):continue
 try:cwd=os.path.realpath(os.readlink('/proc/'+str(pid)+'/cwd'))
 except FileNotFoundError:continue
 except PermissionError:continue
 if cwd==root or cwd.startswith(root+'/'):untracked.append(pid)
if untracked:raise RuntimeError('作業場所に所有関係未確認のプロセスが残っています。推測で停止しません: '+str(untracked))
print(json.dumps({'trackedProcesses':len(known),'remainingOwned':0,'untrackedInDirectory':0}))
`;
