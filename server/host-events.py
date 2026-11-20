"""Linux host adapter. One authenticated stdio connection, no periodic reads.

Events invalidate observations, never assert task completion. Native durable logs
remain the source of truth. Watch before the initial snapshot; reconnect or watch
overflow requires a complete reconciliation. Command responses are not replayed.
"""
import ctypes
import json
import os
from pathlib import Path
import selectors
import struct
import subprocess
import sys
import threading
import queue
from concurrent.futures import ThreadPoolExecutor

write_lock = threading.Lock()
seq = 0
def emit(value):
    global seq
    with write_lock:
        seq += 1
        value['seq'] = seq
        sys.stdout.write(json.dumps(value, ensure_ascii=True) + '\n')
        sys.stdout.flush()

libc = ctypes.CDLL(None, use_errno=True)
fd = libc.inotify_init1(os.O_CLOEXEC | os.O_NONBLOCK)
if fd < 0:
    raise OSError(ctypes.get_errno(), 'inotify required')
sel = selectors.DefaultSelector()
sel.register(fd, selectors.EVENT_READ, 'files')
control_read, control_write = os.pipe2(os.O_NONBLOCK | os.O_CLOEXEC)
sel.register(control_read, selectors.EVENT_READ, 'control')
controls = queue.SimpleQueue()
processes = {}
watches = {}
paths = set()
mask = 0x2 | 0x8 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800  # modify/close/move/create/delete
home = Path.home()
roots = [Path(os.environ.get('CODEX_HOME', home / '.codex')) / 'sessions', home / '.claude/projects', home / '.purplemux/workspaces']
layouts = {}
def layout_changed(path):
    def relevant(value):
        if isinstance(value, list):
            return [relevant(v) for v in value]
        if not isinstance(value, dict):
            return value
        return {k: relevant(v) for k, v in value.items() if k in ('root', 'children', 'tabs', 'id', 'sessionName', 'panelType', 'agentSessionId', 'sessionId', 'providerId', 'claudeSessionId', 'codexSessionId', 'cliState', 'agentState', 'activeTabId', 'first', 'second')}
    try:
        value = relevant(json.loads(path.read_text()))
    except (OSError, ValueError):
        value = None
    key = str(path)
    changed = key not in layouts or layouts[key] != value
    layouts[key] = value
    return changed

def add(path, recursive=True):
    path = Path(path)
    if not path.is_dir() or path in paths:
        return
    wd = libc.inotify_add_watch(fd, os.fsencode(path), mask)
    if wd < 0:
        raise OSError(ctypes.get_errno(), 'cannot watch ' + str(path))
    watches[wd] = path
    paths.add(path)
    if recursive:
        for item in path.iterdir():
            if item.is_dir() and not item.is_symlink():
                add(item)

# Watch ancestors too so roots created or replaced after startup are detected.
for root in roots:
    for parent in reversed(root.parents):
        if parent == home or home in parent.parents:
            add(parent, False)
    add(root)
for path in roots[-1].glob('*/layout.json'):
    layout_changed(path)
if not hasattr(os, 'pidfd_open'):
    raise RuntimeError('Linux pidfd support is required')

def execute(message):
    try:
        args = message['args']
        if not isinstance(args, list) or not args or not all(isinstance(a, str) for a in args):
            raise ValueError('argv required')
        result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=60, text=True)
        if len(result.stdout) > 16000000:
            raise ValueError('command output limit')
        emit({'type': 'response', 'id': message['id'], 'output': result.stdout,
              'error': None if result.returncode == 0 else (result.stderr[-2000:] or 'command failed')})
    except Exception as error:
        emit({'type': 'response', 'id': message.get('id'), 'error': str(error)})

pool = ThreadPoolExecutor(max_workers=2)
def receive():
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if message.get('type') == 'command':
                pool.submit(execute, message)
            elif message.get('type') == 'ping':
                emit({'type': 'pong'})
            elif message.get('type') == 'watch-process':
                controls.put(message)
                os.write(control_write, b'1')
        except Exception as error:
            emit({'type': 'error', 'error': str(error)})
    os._exit(0)

threading.Thread(target=receive, daemon=True).start()
emit({'type': 'ready', 'protocol': 1})
while True:
    for key, _ in sel.select():
        if key.data == 'control':
            os.read(control_read, 65536)
            while not controls.empty():
                message = controls.get()
                try:
                    agent_alive = False
                    result = subprocess.run(['tmux', '-L', 'purple', 'list-panes', '-t', message['sessionName'], '-F', '#{pane_pid}'], capture_output=True, text=True, timeout=5)
                    pending = [(int(p), True) for p in result.stdout.split()]
                    pane_alive = bool(pending)
                    while pending:
                        pid, pane = pending.pop()
                        try:
                            proc = Path('/proc') / str(pid)
                            children = (proc / 'task' / str(pid) / 'children').read_text().split()
                            pending.extend((int(p), False) for p in children)
                            exe = (proc / 'exe').resolve().name
                            argv = (proc / 'cmdline').read_bytes().split(b'\0')[:2]
                            agent = exe in ('codex', 'claude') or Path(os.fsdecode(argv[0])).name in ('codex', 'claude') or (exe == 'node' and any(b'/codex' in a or b'/claude' in a for a in argv))
                            agent_alive = agent_alive or agent
                            if (pane or agent) and pid not in processes:
                                pfd = os.pidfd_open(pid)
                                processes[pid] = pfd
                                sel.register(pfd, selectors.EVENT_READ, ('exit', pid, message['agentId']))
                        except (FileNotFoundError, ProcessLookupError):
                            pass
                    if message.get('id'):
                        emit({'type': 'response', 'id': message['id'], 'output': json.dumps({'paneAlive': pane_alive, 'agentAlive': agent_alive})})
                except Exception as error:
                    emit({'type': 'response', 'id': message.get('id'), 'error': 'process watcher: ' + str(error)})
            continue
        if isinstance(key.data, tuple):
            _, pid, agent = key.data
            sel.unregister(key.fd)
            os.close(key.fd)
            processes.pop(pid, None)
            emit({'type': 'changed', 'agentIds': [agent]})
            continue
        data = os.read(fd, 262144)
        offset = 0
        changed = set()
        resync = False
        while offset < len(data):
            wd, flags, cookie, size = struct.unpack_from('iIII', data, offset)
            name = os.fsdecode(data[offset+16:offset+16+size].split(b'\0')[0])
            offset += 16 + size
            if flags & 0x4000:  # queue overflow: connection restart reinstalls all watches
                emit({'type': 'resync'})
                sys.exit(2)
            parent = watches.get(wd)
            if parent is None:
                continue
            path = parent / name if name else parent
            if flags & 0x8000:
                paths.discard(parent)
                watches.pop(wd, None)
            if flags & (0x100 | 0x80) and path.is_dir():
                for root in roots:
                    if path == root or root in path.parents:
                        add(path)
                        resync = True  # files may precede installation of their directory watch
                    elif path in root.parents:
                        add(path, False)
                        add(root)
            relevant = any(path == root or root in path.parents for root in roots)
            if relevant and (path.suffix == '.jsonl' or path.name == 'layout.json' and flags & (0x8 | 0x80 | 0x200) and layout_changed(path) or flags & (0x400 | 0x800)):
                changed.add(str(path))
        if changed or resync:
            emit({'type': 'changed', 'paths': sorted(changed), 'all': resync})
