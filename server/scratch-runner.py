import os, sys, json, base64, resource, ctypes, io, contextlib, stat
request = json.load(sys.stdin)
os.chdir('/work')
for name, value in request['files'].items():
    with open(name, 'wb') as f: f.write(base64.b64decode(value))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_AS, (512*1024*1024,)*2)
resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
resource.setrlimit(resource.RLIMIT_FSIZE, (8*1024*1024,)*2)
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
# Fail closed before evaluating code. No processes/threads, new namespaces,
# network sockets, ptrace or filesystem mounts can be created by user code.
lib = ctypes.CDLL('/runtime/libseccomp.so.2' if os.path.isfile('/runtime/libseccomp.so.2') else 'libseccomp.so.2')
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
lib.seccomp_load.argtypes = [ctypes.c_void_p]
ctx = lib.seccomp_init(0x7fff0000)
if not ctx: raise RuntimeError('seccomp unavailable')
for name in ['clone','clone3','fork','vfork','execve','execveat','socket','socketpair','ptrace','mount','umount2','unshare','setns','bpf','io_uring_setup','keyctl','add_key','request_key','perf_event_open','process_vm_readv','process_vm_writev','open_by_handle_at','name_to_handle_at','pidfd_getfd','userfaultfd','memfd_create','shmget','shmat','msgget','msgsnd','pipe','pipe2']:
    nr = lib.seccomp_syscall_resolve_name(name.encode())
    if nr >= 0 and lib.seccomp_rule_add(ctx, 0x50001, nr, 0): raise RuntimeError('seccomp rule')
if lib.seccomp_load(ctx): raise RuntimeError('seccomp load')
class Output(io.StringIO):
    def write(self, text):
        if self.tell() + len(text) > 16000: raise RuntimeError('output limit')
        return super().write(text)
output = Output()
ok = True
with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
    try: exec(request['code'], {'__name__':'__main__'})
    except BaseException as e:
        ok = False
        output.seek(0); output.truncate(); output.write(type(e).__name__ + ': ' + str(e)[:1000])
files = {}
for name in os.listdir('.'):
    info = os.lstat(name)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1: raise RuntimeError('regular files only')
    with open(name,'rb') as f: files[name] = base64.b64encode(f.read(8*1024*1024+1)).decode()
print(json.dumps({'ok':ok,'output':output.getvalue(),'files':files}))
