#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Read current official metadata. Report drift; never install or widen live-run budgets."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
import yaml
from check_repository import StrictLoader

ROOT = Path(__file__).resolve().parents[1]


def fetch(url, as_json=True):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'factory-qualification'}), timeout=30) as response:
        body = response.read(32 * 1024 * 1024)
    return json.loads(body) if as_json else body.decode()


def main():
    pins = json.loads((ROOT / 'toolchain.json').read_text())
    catalog = yaml.load((ROOT / 'pnpm-workspace.yaml').read_text(), Loader=StrictLoader)['catalog']
    choices = {**catalog, 'pnpm': pins['pnpm']['version'], pins['claude_probe']['package']: pins['claude_probe']['version']}
    def npm(item):
        name, expected = item; url = 'https://registry.npmjs.org/' + urllib.parse.quote(name, safe='@/') + '/latest'
        current = fetch(url)['version']; return {'name': name, 'expected': expected, 'current': current, 'source': url, 'matched': current == expected}
    with ThreadPoolExecutor(max_workers=6) as pool: results = list(pool.map(npm, choices.items()))
    node_url = 'https://nodejs.org/dist/index.json'
    stable = [item['version'].lstrip('v') for item in fetch(node_url) if re.fullmatch(r'v\d+\.\d+\.\d+', item['version'])]
    current = max(stable, key=lambda value: tuple(map(int, value.split('.'))))
    results.append({'name': 'Node', 'expected': pins['node']['version'], 'current': current, 'source': node_url, 'matched': current == pins['node']['version']})
    for package in pins['python_packages']:
        url = 'https://pypi.org/pypi/' + package['package'] + '/json'; current = fetch(url)['info']['version']
        results.append({'name': package['package'], 'expected': package['version'], 'current': current, 'source': url, 'matched': current == package['version']})
    python_url = 'https://www.python.org/downloads/'
    versions = re.findall(r'Python (3\.\d+\.\d+)(?![a-zA-Z0-9.])', fetch(python_url, False))
    stable = [version for version in versions if version]
    if not stable: raise ValueError('Python stable release metadata unparsed')
    current = max(stable, key=lambda value: tuple(map(int, value.split('.'))))
    results.append({'name': 'Python', 'expected': pins['python']['version'], 'current': current, 'source': python_url, 'matched': current == pins['python']['version']})
    directory = ROOT / '.factory/dependency-review'; directory.mkdir(parents=True, exist_ok=True)
    (directory / 'freshness.json').write_text(json.dumps({'checked_at': datetime.now(timezone.utc).isoformat(), 'results': results}, indent=2) + '\n')
    drift = [result for result in results if not result['matched']]
    print(json.dumps({'checked': len(results), 'drift': drift}))
    if drift: raise ValueError('Release drift requires reviewed pin updates and affected requalification; no automatic live trial')


if __name__ == '__main__': main()
