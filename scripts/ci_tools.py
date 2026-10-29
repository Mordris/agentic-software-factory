#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run a reviewed, checksum-pinned Linux CI tool without a global install."""

import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024


def verified_binary(payload, expected_digest, executable):
    if not re.fullmatch(r"[a-z][a-z0-9-]*", executable):
        raise ValueError("Invalid executable name")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        raise ValueError("Invalid SHA-256")
    if hashlib.sha256(payload).hexdigest() != expected_digest:
        raise ValueError("CI tool checksum mismatch")
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        matches = [m for m in archive.getmembers()
                   if m.isfile() and Path(m.name).name == executable]
        if len(matches) != 1 or matches[0].size > MAX_ARCHIVE_BYTES:
            raise ValueError("Archive must contain one bounded regular executable")
        # Read bytes only. Never extract upstream paths, links, or permissions.
        with archive.extractfile(matches[0]) as source:
            return source.read(MAX_ARCHIVE_BYTES + 1)


def main(argv):
    lock = json.loads((ROOT / ".github/ci-tools.json").read_text())
    if not argv or argv[0] not in lock["tools"]:
        raise ValueError("Choose one tool from .github/ci-tools.json")
    tool = lock["tools"][argv[0]]
    if argv[1:] == ["--describe"]:
        print(json.dumps(tool, indent=2))
        return 0
    url = urllib.parse.urlsplit(tool["url"])
    prefix = f"/{tool['repository']}/releases/download/"
    if url.scheme != "https" or url.netloc != "github.com" or not url.path.startswith(prefix):
        raise ValueError("Tool URL must identify the reviewed upstream release")
    request = urllib.request.Request(tool["url"], headers={"User-Agent": "factory-ci"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise ValueError("CI tool archive is too large")
    binary = verified_binary(payload, tool["sha256"], tool["executable"])
    with tempfile.TemporaryDirectory(prefix="factory-ci-tool-") as directory:
        target = Path(directory) / tool["executable"]
        target.write_bytes(binary)
        target.chmod(0o700)
        result = subprocess.run([str(target), *argv[1:]], cwd=ROOT,
                                check=False, timeout=300)
        return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, OSError, tarfile.TarError, subprocess.TimeoutExpired) as error:
        print(f"CI tool failed: {error}", file=sys.stderr)
        sys.exit(1)
