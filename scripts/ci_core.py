#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Credential-free hosted core jobs, using the same recipes and root commands as local checks."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(*argv):
    subprocess.run(argv, cwd=ROOT, check=True, timeout=900)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("job", choices=["quality", "qualification", "dependencies"]); args = parser.parse_args()
    manifest = json.loads((ROOT / "toolchain.json").read_text())
    if ".".join(map(str, sys.version_info[:3])) != manifest["python"]["version"]:
        raise ValueError("CI Python mismatch")
    print(json.dumps({"hosted_image": {name: os.environ.get(name, "unreported") for name in ["ImageOS", "ImageVersion", "RUNNER_ARCH", "RUNNER_OS"]}, "python": sys.version, "host": os.uname().release}), flush=True)
    for component in ["node", "pnpm-native", "node-headers"]: run(sys.executable, "scripts/bootstrap_toolchain.py", component)
    os.environ["PATH"] = str(ROOT / ".factory/tooling" / ("node-" + manifest["node"]["version"]) / "bin") + os.pathsep + os.environ["PATH"]
    run(sys.executable, "scripts/qualify_python.py")
    run(sys.executable, "scripts/pnpm", "install", "--frozen-lockfile", "--ignore-scripts")
    run(sys.executable, "scripts/qualify_sqlite.py")
    run(sys.executable, "scripts/pnpm", "run", "check:versions")
    if args.job == "quality":
        for name in ["typecheck", "lint", "build", "qualify:contracts"]: run(sys.executable, "scripts/pnpm", "run", name)
    elif args.job == "qualification":
        run(sys.executable, "scripts/pnpm", "run", "build")
        run(sys.executable, "scripts/pnpm", "run", "test:core", "--coverage")
        run(sys.executable, "scripts/pnpm", "run", "test:controls")
        run(sys.executable, "scripts/check_install_policy.py")
        run(sys.executable, "scripts/pnpm", "run", "test:acceptance")
    else: run(sys.executable, "scripts/review_dependencies.py")


if __name__ == "__main__": main()
