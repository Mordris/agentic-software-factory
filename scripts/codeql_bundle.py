#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""CI-only bundle download. Verify the canonical digest before CodeQL sees bytes."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def verified_stream(source, output, expected, max_bytes=1024 * 1024 * 1024):
    if not re.fullmatch(r'[a-f0-9]{64}', expected): raise ValueError('Invalid bundle digest')
    checksum = hashlib.sha256(); count = 0; started = time.monotonic()
    while True:
        chunk = source.read(1024 * 1024)
        if not chunk: break
        count += len(chunk)
        if count > max_bytes or time.monotonic() - started > 180: raise ValueError('CodeQL download budget exceeded')
        checksum.update(chunk); output.write(chunk)
    if checksum.hexdigest() != expected: raise ValueError('CodeQL bundle checksum mismatch')
    return count


def main():
    item = json.loads((ROOT / 'toolchain.json').read_text())['ci']['codeql_bundle']
    prefix = 'https://github.com/github/codeql-action/releases/download/codeql-bundle-v' + item['version'] + '/'
    if not item['url'].startswith(prefix) or item['file'] != '.factory/codeql/bundle.tar.zst': raise ValueError('Unreviewed bundle origin/path')
    target = ROOT / item['file']; target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            with urllib.request.urlopen(item['url'], timeout=30) as response: count = verified_stream(response, output, item['sha256'])
            output.flush(); os.fsync(output.fileno()); temporary.replace(target)
        finally: temporary.unlink(missing_ok=True)
    print(json.dumps({'bundle': item['version'], 'sha256': item['sha256'], 'bytes': count, 'path': item['file']}))


if __name__ == '__main__': main()
