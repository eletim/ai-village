#!/usr/bin/env python3
"""Unprivileged, pinned build. No system install, shell profile edits or activation."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tarfile, urllib.request
source = pathlib.Path(__file__).resolve().parent
if len(sys.argv) != 2 or not pathlib.Path(sys.argv[1]).is_absolute():
    sys.exit('usage: python3 scripts/bootstrap-scratch.py /absolute/persistent/runtime')
root = pathlib.Path(sys.argv[1]).resolve()
if root.exists():
    sys.exit('runtime already exists; use a new versioned directory (partial installs are never activated)')
lock = json.loads((source / 'scratch-sources.json').read_text())
root.mkdir(mode=0o700, parents=True)
for name in ['downloads', 'src', 'bin', 'fonts', 'python', 'build-tools', 'libcap/lib/pkgconfig', 'libcap/include/sys']:
    (root / name).mkdir(parents=True, exist_ok=True)
def run(args, **kw):
    subprocess.run([str(a) for a in args], check=True, **kw)
def download(name):
    entry = lock[name]
    target = root / 'downloads' / name
    with urllib.request.urlopen(entry['url'], timeout=120) as response:
        target.write_bytes(response.read())
    if hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
        sys.exit('checksum mismatch: ' + name)
    return target
def extract(name):
    path = download(name)
    with tarfile.open(path) as archive:
        for member in archive.getmembers():
            if member.name.startswith('/') or '..' in pathlib.PurePosixPath(member.name).parts or member.islnk():
                sys.exit('unsafe source archive')
        # The pinned bubblewrap archive contains LICENSE -> COPYING. Materialize it, never extract links.
        for member in archive.getmembers():
            if member.issym():
                if member.linkname != 'COPYING':
                    sys.exit('unexpected source symlink')
                continue
            archive.extract(member, root / 'src')
        return root / 'src' / archive.getmembers()[0].name.split('/')[0]
for names, target in [(['Pillow'], 'python'), (['meson', 'ninja'], 'build-tools')]:
    req = root / ('requirements-' + target + '.txt')
    req.write_text('\n'.join(n+'=='+lock[n]['version']+' '+ ' '.join('--hash=sha256:'+h for h in lock[n]['hashes']) for n in names)+'\n')
    run([sys.executable, '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple', '--require-hashes', '--only-binary=:all:', '--no-deps', '--target', root / target, '-r', req])
cap = extract('libcap')
run(['make', '-C', cap / 'libcap', 'libcap.a', 'BUILD_CC=gcc', 'CC=gcc', 'PAM_CAP=no', 'GOLANG=no'])
shutil.copy2(cap / 'libcap/libcap.a', root / 'libcap/lib/libcap.a')
shutil.copy2(cap / 'libcap/include/sys/capability.h', root / 'libcap/include/sys/capability.h')
(root / 'libcap/lib/pkgconfig/libcap.pc').write_text(f'prefix={root}/libcap\nlibdir=${{prefix}}/lib\nincludedir=${{prefix}}/include\nName: libcap\nDescription: Local static libcap\nVersion: 2.76\nLibs: -L${{libdir}} -lcap\nCflags: -I${{includedir}}\n')
seccomp = extract('libseccomp')
# Release tarball ships generated syscall tables. Never silently regenerate without gperf.
run(['sh', seccomp / 'configure', '--disable-static', '--disable-tests', '--disable-tools'], cwd=seccomp, env=dict(os.environ, GPERF='/bin/false'))
for generated in ['syscalls.perf', 'syscalls.perf.c']:
    os.utime(seccomp / 'src' / generated, None)
run(['make', '-C', seccomp, '-j2'])
shutil.copy2(seccomp / 'src/.libs/libseccomp.so.2', root / 'python/libseccomp.so.2')
bwrap = extract('bubblewrap')
env = dict(os.environ, PYTHONPATH=str(root / 'build-tools'), PATH=str(root / 'build-tools/bin')+':'+os.environ['PATH'], PKG_CONFIG_LIBDIR=str(root / 'libcap/lib/pkgconfig'), PKG_CONFIG_PATH='')
run([sys.executable, '-m', 'mesonbuild.mesonmain', 'setup', bwrap / 'build', bwrap, '-Dman=disabled', '-Dtests=false', '-Dselinux=disabled'], env=env)
run([sys.executable, '-m', 'mesonbuild.mesonmain', 'compile', '-C', bwrap / 'build'], env=env)
shutil.copy2(bwrap / 'build/bwrap', root / 'bin/bwrap')
shutil.copy2(download('font'), root / 'fonts/NotoSansCJK-Regular.ttc')
shutil.copy2(download('font-license'), root / 'fonts/LICENSE')
run([root / 'bin/bwrap', '--version'])
(root / 'sources.json').write_text(json.dumps(lock, indent=2)+'\n')
# Completion marker records built artifacts as well as downloaded source hashes.
files = [p for sub in ['bin','fonts','python'] for p in (root/sub).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
(root / 'installed.json').write_text(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, indent=2)+'\n')
print('Built, NOT activated. Run mandatory preflight using config:')
print(json.dumps({'version':1,'runtimeRoot':str(root)}))
