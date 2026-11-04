#!/usr/bin/env python3
"""Prepare Notify settings; optionally read a replacement token from a private TTY."""
import argparse
import getpass
import os
from pathlib import Path
import re
import shlex
import stat
import sys
import tempfile
import warnings


def configure(path, token=None):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError('Symlink config is not supported')
    if path.exists() and (path.stat().st_uid != os.getuid() or not stat.S_ISREG(path.stat().st_mode)):
        raise ValueError('Config must be a regular file owned by the current user')
    text = path.read_text() if path.exists() else ''
    updates = {'NOTIFY_SERVER': 'https://eletim.jp/ntfy', 'NOTIFY_TOPIC': 'agents'}
    if token is not None:
        if not token or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in token):
            raise ValueError('Token must be nonempty and contain no whitespace or control characters')
        updates['NOTIFY_TOKEN'] = token
    elif not re.search(r'^\s*(?:export\s+)?NOTIFY_TOKEN=', text, re.M):
        updates['NOTIFY_TOKEN'] = ''
    # Never source the configuration or print its contents. Preserve existing token
    # assignments byte-for-byte unless the user explicitly provides a replacement.
    lines = text.splitlines(keepends=True)
    for key, value in updates.items():
        pattern = re.compile(r'^\s*(?:export\s+)?' + key + '=')
        lines = [line for line in lines if not pattern.match(line)]
        if lines and not lines[-1].endswith('\n'):
            lines[-1] += '\n'
        lines.append(key + '=' + shlex.quote(value) + '\n')
    fd, temporary = tempfile.mkstemp(prefix='.notify-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(''.join(lines))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(Path.home() / '.config/notify/config'))
    parser.add_argument('--set-token', action='store_true')
    args = parser.parse_args()
    token = None
    if args.set_token:
        if not sys.stdin.isatty():
            raise ValueError('Run in an interactive terminal; token arguments and pipes are not accepted')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            token = getpass.getpass('Notify token (hidden): ')
    configure(args.config, token)
    print('Notify configuration saved with mode 600. Token value was not displayed.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, EOFError, KeyboardInterrupt, getpass.GetPassWarning):
        print('Configuration not saved. Check file access and use a nonempty token in an interactive terminal.', file=sys.stderr)
        sys.exit(1)
