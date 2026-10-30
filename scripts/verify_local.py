#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Sequential current-source verification. Run inside the approved bounded wrapper."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def source_identity():
    rows = {}
    paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).split(b'\0')
    for name in sorted(set(paths)):
        if name:
            path = ROOT / name.decode()
            if path.is_symlink() or not path.is_file(): raise ValueError('Unsafe source entry')
            rows[name.decode()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return rows


def main():
    output = ROOT / '.factory/final-verification'; output.mkdir(parents=True, exist_ok=True)
    before = source_identity()
    commands = [[sys.executable, 'scripts/pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']]
    commands += [[sys.executable, 'scripts/pnpm', 'run', name] for name in ['check:versions', 'typecheck', 'lint', 'qualify:contracts']]
    commands += [[sys.executable, 'scripts/check_repository.py'], [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], [sys.executable, 'scripts/pnpm', 'run', 'test:core', '--coverage'], [sys.executable, 'scripts/check_mutations.py'], [sys.executable, 'scripts/check_install_policy.py'], [sys.executable, 'scripts/pnpm', 'run', 'test:acceptance']]
    results = []
    for index, argv in enumerate(commands):
        started = datetime.now(timezone.utc).isoformat()
        result = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=120)
        log = output / (str(index) + '.log'); log.write_text(result.stdout + result.stderr)
        results.append({'argv': argv, 'cwd': str(ROOT), 'started_at': started, 'exit_status': result.returncode, 'log': log.name, 'sha256': hashlib.sha256(log.read_bytes()).hexdigest()})
        print(json.dumps({'argv': argv, 'exit': result.returncode}), flush=True)
        (output / 'commands.json').write_text(json.dumps(results, indent=2) + '\n')
        if result.returncode: raise ValueError('Current-source verification failed; inspect ' + str(log))
    after = source_identity()
    if before != after: raise ValueError('Source changed during verification')
    (output / 'source.json').write_text(json.dumps(before, indent=2) + '\n')
    print(json.dumps({'checks': len(results), 'source_files': len(before), 'source_unchanged': True, 'live_qualification': 'not_run here; inspect separately authorized manual receipts'}))


if __name__ == '__main__': main()
