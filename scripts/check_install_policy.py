#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Adverse frozen-lockfile controls; no hooks, network or global package store."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    pins = json.loads((ROOT / 'toolchain.json').read_text())
    pnpm = ROOT / '.factory/tooling' / ('pnpm-native-' + pins['pnpm']['version']) / 'pnpm'
    parent = ROOT / '.factory/install-controls'; parent.mkdir(parents=True, exist_ok=True)
    results = []
    for name in ['stale-lock', 'changed-integrity']:
        with tempfile.TemporaryDirectory(prefix=name + '-', dir=parent) as temporary:
            root = Path(temporary)
            for file in ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']:
                shutil.copyfile(ROOT / file, root / file)
            for pattern in ['packages/*/package.json', 'apps/*/package.json']:
                for source in ROOT.glob(pattern):
                    target = root / source.relative_to(ROOT); target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
            if name == 'stale-lock':
                target = root / 'package.json'; value = json.loads(target.read_text()); value['dependencies']['ajv'] = '8.19.0'; target.write_text(json.dumps(value))
            else:
                target = root / 'pnpm-lock.yaml'; text = target.read_text(); position = text.index('---', 4); head, application = text[:position], text[position:]
                import re
                application = re.sub(r'sha512-[A-Za-z0-9+/=]+', 'sha512-' + 'A' * 86 + '==', application)
                target.write_text(head + application)
            argv = [str(pnpm), 'install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir=' + str(root / 'store')]
            result = subprocess.run(argv, cwd=root, capture_output=True, text=True, timeout=30)
            (parent / (name + '.log')).write_text(result.stdout + result.stderr)
            expected = 'OUTDATED_LOCKFILE' if name == 'stale-lock' else 'OFFLINE'
            if result.returncode == 0 or expected not in result.stdout + result.stderr:
                raise ValueError('Install adverse control did not reach expected failure: ' + name)
            results.append({'control': name, 'exit': result.returncode, 'expected_failure': expected})
    (parent / 'results.json').write_text(json.dumps({'controls': results, 'integrity_limit': 'Changed valid SRI cannot resolve from an empty offline store. Download checksum rejection is separately tested by the archive boundary tests; this does not emulate an npm registry attack.'}, indent=2) + '\n')
    print(json.dumps({'install_controls_detected': len(results)}))


if __name__ == '__main__': main()
