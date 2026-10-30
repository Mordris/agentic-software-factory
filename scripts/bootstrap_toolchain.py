#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Download reviewed private toolchain archives; never run install scripts or change defaults."""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".factory/tooling"
MAX_DOWNLOAD = 256 * 1024 * 1024
MAX_UNPACKED = 1024 * 1024 * 1024


def download(url, digest, algorithm="sha256"):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc not in {"nodejs.org", "registry.npmjs.org", "github.com", "sqlite.org", "files.pythonhosted.org"}:
        raise ValueError("Unreviewed archive origin")
    request = urllib.request.Request(url, headers={"User-Agent": "factory-toolchain"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read(MAX_DOWNLOAD + 1)
    if len(payload) > MAX_DOWNLOAD:
        raise ValueError("Archive download exceeds budget")
    actual = hashlib.new(algorithm, payload).hexdigest()
    if actual != digest:
        raise ValueError("Toolchain archive integrity mismatch")
    return payload


def safe_unpack(payload, destination, strip_first=False):
    """Create regular files first; validate every link and never traverse archive links."""
    if destination.exists():
        raise ValueError("Refusing to overwrite an existing toolchain directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="unpack-", dir=destination.parent) as temp:
        root = Path(temp)
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:*") as archive:
            members = archive.getmembers()
            if len(members) > 50000 or sum(member.size for member in members) > MAX_UNPACKED:
                raise ValueError("Archive expansion exceeds budget")
            seen = set()
            links = []
            for member in members:
                original = PurePosixPath(member.name)
                if original.is_absolute() or ".." in original.parts or "\\" in member.name:
                    raise ValueError("Unsafe archive path")
                parts = original.parts[1:] if strip_first else original.parts
                if not parts:
                    continue
                relative = Path(*parts)
                if relative in seen:
                    raise ValueError("Duplicate archive path")
                seen.add(relative)
                target = root / relative
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as stream:
                        target.write_bytes(stream.read(member.size + 1))
                    target.chmod(0o755 if member.mode & 0o111 else 0o644)
                elif member.issym() or member.islnk():
                    links.append((member, target))
                else:
                    raise ValueError("Unsupported archive special file")
            for member, target in links:
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists() or target.is_symlink():
                    raise ValueError("Archive link collides with a path")
                if member.issym():
                    if Path(member.linkname).is_absolute():
                        raise ValueError("Absolute archive symlink")
                    resolved = (target.parent / member.linkname).resolve()
                else:
                    original = PurePosixPath(member.linkname)
                    parts = original.parts[1:] if strip_first else original.parts
                    resolved = (root / Path(*parts)).resolve()
                if not resolved.is_relative_to(root.resolve()) or not resolved.exists():
                    raise ValueError("Archive link escapes or has a missing target")
                if member.issym():
                    target.symlink_to(member.linkname)
                else:
                    os.link(resolved, target)
            for _, target in links:
                if not target.resolve().is_relative_to(root.resolve()):
                    raise ValueError("Archive link chain escapes destination")
        root.rename(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=["node", "node-headers", "pnpm", "pnpm-native", "python", "claude-native"])
    args = parser.parse_args()
    manifest = json.loads((ROOT / "toolchain.json").read_text())
    item = manifest["node" if args.component == "node-headers" else "pnpm" if args.component == "pnpm-native" else "claude_probe" if args.component == "claude-native" else args.component]
    if args.component in {"pnpm-native", "claude-native"}:
        item = item["native"]
    destination = TOOLS / (args.component + "-" + item["version"])
    if destination.exists():
        print("Private component already exists: " + str(destination))
        return
    if args.component == "python":
        item = next(x for x in item["artifacts"] if "24.04-x64.tar.gz" in x["name"])
    if args.component == "node-headers":
        url, digest, algorithm = item["headers_url"], item["headers_sha256"], "sha256"
    elif "integrity" in item:
        algorithm, encoded = item["integrity"].split("-", 1)
        url, digest = item["url"], base64.b64decode(encoded).hex()
    else:
        url, digest, algorithm = item["url"], item["sha256"], "sha256"
    payload = download(url, digest, algorithm)
    safe_unpack(payload, destination, strip_first=args.component in {"node", "node-headers", "pnpm", "pnpm-native", "claude-native"})
    print("Verified private toolchain: " + str(destination))


if __name__ == "__main__":
    main()
