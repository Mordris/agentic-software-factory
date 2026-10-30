#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Fail before execution on canonical runtime, catalog, lockfile or CI drift."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import yaml
from check_repository import StrictLoader
from review_dependencies import locked_packages

ROOT = Path(__file__).resolve().parents[1]


def check_sources(root):
    manifest = json.loads((root / "toolchain.json").read_text())
    package = json.loads((root / "package.json").read_text())
    for runtime in ("node", "python"):
        if (root / ("." + runtime + "-version")).read_text().strip() != manifest[runtime]["version"]:
            raise ValueError(runtime + " version file drift")
    if package["engines"] != {"node": manifest["node"]["version"], "pnpm": manifest["pnpm"]["version"]} or package["packageManager"] != "pnpm@" + manifest["pnpm"]["version"]:
        raise ValueError("Package runtime drift")
    workspace = yaml.load((root / "pnpm-workspace.yaml").read_text(), Loader=StrictLoader)
    for flag in ("engineStrict", "saveExact", "ignoreScripts", "strictDepBuilds", "blockExoticSubdeps"):
        if workspace.get(flag) is not True:
            raise ValueError("Dependency execution policy drift: " + flag)
    documents, graph = locked_packages((root / "pnpm-lock.yaml").read_text())
    if len(documents) != 2 or documents[0]["importers"]["."]["packageManagerDependencies"]["pnpm"]["version"] != manifest["pnpm"]["version"]:
        raise ValueError("Package-manager lock drift")
    catalog = workspace["catalog"]
    locked = documents[1]["catalogs"]["default"]
    if set(catalog) != set(locked):
        raise ValueError("Catalog identity drift")
    for name, version in catalog.items():
        if not re.fullmatch(r"\d+\.\d+\.\d+", version) or locked[name] != {"specifier": version, "version": version} or (name, version) not in graph:
            raise ValueError("Catalog/lock drift: " + name)
    manifests = [root / "package.json", *root.glob("packages/*/package.json"), *root.glob("apps/*/package.json")]
    for path in manifests:
        data = json.loads(path.read_text()); importer = str(path.parent.relative_to(root))
        for group in ("dependencies", "devDependencies", "optionalDependencies"):
            for name, specifier in data.get(group, {}).items():
                resolved = documents[1]["importers"][importer][group][name]
                if specifier == "workspace:*":
                    if not resolved["version"].startswith("link:"):
                        raise ValueError("Workspace resolution drift")
                elif specifier != "catalog:" or name not in catalog or resolved["specifier"] != specifier or resolved["version"].split("(", 1)[0] != catalog[name]:
                    raise ValueError("Direct dependency drift: " + name)
    for path in root.glob(".github/workflows/*.yml"):
        workflow = yaml.load(path.read_text(), Loader=StrictLoader)
        for job in workflow["jobs"].values():
            if job["runs-on"] != manifest["ci"]["runner"]:
                raise ValueError("CI runner drift")
            for step in job.get("steps", []):
                if step.get("uses", "").startswith("github/codeql-action/init@") and step.get("with", {}).get("tools") != manifest["ci"]["codeql_bundle"]["file"]:
                    raise ValueError("CI CodeQL bundle drift")
                if step.get("uses", "").startswith("actions/setup-python@") and step.get("with", {}) != {"python-version-file": ".python-version"}:
                    raise ValueError("CI Python drift")
    requirements = (root / ".github/requirements-ci.txt").read_text()
    if "--hash=sha256:" + manifest["python"]["pyyaml_wheel_sha256"] not in requirements:
        raise ValueError("CI Python wheel hash drift")
    return manifest, catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--source-only", action="store_true"); args = parser.parse_args()
    manifest, catalog = check_sources(ROOT)
    if not args.source_only:
        node = ROOT / ".factory/tooling" / ("node-" + manifest["node"]["version"]) / "bin/node"
        pnpm = ROOT / ".factory/tooling" / ("pnpm-native-" + manifest["pnpm"]["version"]) / "pnpm"
        python = ROOT / ".factory/tooling" / ("python-" + manifest["python"]["version"]) / "bin/python3"
        if ".".join(map(str, sys.version_info[:3])) == manifest["python"]["version"]:
            python = Path(sys.executable)
        env = os.environ.copy(); private_lib = ROOT / ".factory/tooling" / ("python-" + manifest["python"]["version"]) / "lib"
        if private_lib.exists(): env["LD_LIBRARY_PATH"] = str(private_lib)
        for executable, argv, expected in [(node, ["-p", "process.versions.node"], manifest["node"]["version"]), (pnpm, ["--version"], manifest["pnpm"]["version"]), (python, ["-c", "import platform; print(platform.python_version())"], manifest["python"]["version"])]:
            if subprocess.check_output([str(executable), *argv], env=env, text=True, timeout=10).strip() != expected:
                raise ValueError("Executable version drift: " + str(executable))
        for name, version in catalog.items():
            if json.loads((ROOT / "node_modules" / name / "package.json").read_text())["version"] != version:
                raise ValueError("Installed package drift: " + name)
        subprocess.run([str(node), "--input-type=module", "-e", "const p=JSON.parse(process.argv[1]); const Database=(await import('better-sqlite3')).default; const db=new Database(':memory:',{nativeBinding:process.cwd()+'/.factory/native/sqlite-'+p.version+'/better_sqlite3.node'}); const r=db.prepare('select sqlite_version() version, sqlite_source_id() source').get(); if(r.version!==p.version||r.source!==p.source_id)throw Error('SQLITE_IDENTITY_MISMATCH'); db.close();", json.dumps(manifest["sqlite"])], check=True, timeout=10)
    print(json.dumps({"toolchain": "matched", "source_only": args.source_only, "catalog_packages": len(catalog)}))


if __name__ == "__main__":
    try: main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, yaml.YAMLError) as error:
        print("Toolchain blocked: " + str(error), file=sys.stderr); sys.exit(1)
