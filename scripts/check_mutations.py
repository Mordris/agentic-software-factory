#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Bounded adverse controls in isolated copies. Never mutate the working source/build."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / 'toolchain.json').read_text())
    node = ROOT / '.factory/tooling' / ('node-' + manifest['node']['version']) / 'bin/node'
    directory = ROOT / '.factory/mutation-controls'; directory.mkdir(parents=True, exist_ok=True)
    controls = [
        ('plan-hash', 'packages/core/dist/coordinator.js', "ensure(hash === mission.planHash, 'APPROVAL_HASH_MISMATCH');", "ensure(true, 'APPROVAL_HASH_MISMATCH');", 'authority'),
        ('mission-scope', 'packages/core/dist/coordinator.js', 'envelope.missionId === lease.missionId &&', 'true &&', 'authority'),
        ('artifact-receipt', 'packages/core/dist/coordinator.js', 'this.#options.verifyArtifact(lease, outputDigest, task.spec.lab)', 'true', 'authority'),
        ('required-check', 'packages/core/dist/policy.js', "check?.result === 'passed'", 'true', 'authority'),
        ('epoch-fencing', 'packages/core/dist/coordinator.js', 'lease.epoch === this.#ledger.epoch', 'true', 'store'),
        ('transaction-coupling', 'packages/store-sqlite/dist/index.js', "this.#db.exec('COMMIT');", "this.#db.exec('ROLLBACK');", 'store'),
    ]
    results = []
    for name, file, original, replacement, suite in controls:
        with tempfile.TemporaryDirectory(prefix=name + '-', dir=directory) as temporary:
            target = Path(temporary)
            for file_name in ['package.json', 'toolchain.json', 'vitest.config.ts']:
                shutil.copyfile(ROOT / file_name, target / file_name)
            for folder in ['packages', 'apps']:
                for package in (ROOT / folder).iterdir():
                    if not package.is_dir(): continue
                    destination = target / folder / package.name; destination.mkdir(parents=True)
                    shutil.copyfile(package / 'package.json', destination / 'package.json')
                    if (package / 'dist').exists(): shutil.copytree(package / 'dist', destination / 'dist')
            shutil.copytree(ROOT / 'tests/core', target / 'tests/core')
            shutil.copytree(ROOT / 'evals/core', target / 'evals/core')
            modules = target / 'node_modules'; modules.mkdir()
            for entry in (ROOT / 'node_modules').iterdir():
                if entry.name != '@asf': (modules / entry.name).symlink_to(entry.resolve(), target_is_directory=entry.is_dir())
            (modules / '@asf').mkdir()
            for entry in (target / 'packages').iterdir(): (modules / '@asf' / entry.name).symlink_to(entry, target_is_directory=True)
            (target / '.factory').mkdir(); (target / '.factory/native').symlink_to(ROOT / '.factory/native', target_is_directory=True)
            changed = target / file; text = changed.read_text()
            if original not in text: raise ValueError('Adverse control anchor disappeared: ' + name)
            changed.write_text(text.replace(original, replacement, 1))
            command = [str(node), str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', 'tests/core/' + suite + '.test.ts']
            result = subprocess.run(command, cwd=target, capture_output=True, text=True, timeout=30)
            (directory / (name + '.log')).write_text(result.stdout + result.stderr)
            if result.returncode == 0 or 'Tests' not in result.stdout or 'failed' not in result.stdout:
                raise ValueError('Control survived or failed outside assertions: ' + name)
            results.append({'control': name, 'exit': result.returncode, 'detected': True, 'argv': command})
    (directory / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps({'detected_controls': len(results), 'working_source_modified': False}))


if __name__ == '__main__': main()
