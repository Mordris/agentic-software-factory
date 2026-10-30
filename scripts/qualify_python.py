#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Build a hash-pinned, reproducible pure-Python PyYAML wheel with exact private tooling."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

from bootstrap_toolchain import download, safe_unpack

ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / "toolchain.json").read_text())
    expected = manifest["python"]["version"]
    current = ".".join(str(x) for x in sys.version_info[:3])
    python = Path(sys.executable) if current == expected else ROOT / ".factory/tooling" / ("python-" + expected) / "bin/python3"
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = str(ROOT / ".factory/tooling" / ("python-" + expected) / "lib")
    env["SOURCE_DATE_EPOCH"] = manifest["python"]["source_date_epoch"]
    env["PYYAML_FORCE_LIBYAML"] = "0"
    actual = subprocess.check_output([str(python), "-c", "import platform; print(platform.python_version())"], env=env, text=True).strip()
    if actual != expected:
        raise ValueError("Python runtime version mismatch")
    directory = ROOT / ".factory/python-build"
    directory.mkdir(parents=True, exist_ok=True)
    pip_item = next(item for item in manifest["python_packages"] if item["package"] == "pip")
    pip_wheel = pip_item["bootstrap_wheel"]
    pip_path = directory / pip_wheel["file"]
    pip_path.write_bytes(download(pip_wheel["url"], pip_wheel["sha256"]))
    subprocess.run([str(python), "-m", "pip", "--isolated", "--disable-pip-version-check", "install", "--no-deps", "--no-index", "--no-cache-dir", str(pip_path)], env=env, check=True, timeout=60)
    subprocess.run([str(python), "-c", "import pip; assert pip.__version__ == " + repr(pip_item["version"])], env=env, check=True, timeout=10)
    query = {"queries": [{"package": {"name": item["package"], "ecosystem": "PyPI"}, "version": item["version"]} for item in manifest["python_packages"]]}
    request = urllib.request.Request("https://api.osv.dev/v1/querybatch", data=json.dumps(query).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        advisory = json.load(response)
    if len(advisory.get("results", [])) != len(query["queries"]) or any(entry for entry in advisory["results"]):
        raise ValueError("Python build dependency advisory review is incomplete or has findings")
    (directory / "advisories.json").write_text(json.dumps({"request": query, "response": advisory}, indent=2) + "\n")
    wheels = []
    for package in manifest["python_packages"]:
        if package["package"] in {"pip", "PyYAML"}:
            continue
        item = package["bootstrap_wheel"]
        target = directory / item["file"]
        target.write_bytes(download(item["url"], item["sha256"]))
        wheels.append(str(target))
    common = [str(python), "-m", "pip", "--isolated", "--disable-pip-version-check"]
    subprocess.run([*common, "install", "--no-deps", "--no-index", "--no-cache-dir", *wheels], env=env, check=True, timeout=180)
    package = next(x for x in manifest["python_packages"] if x["package"] == "PyYAML")
    source = next(x for x in package["artifacts"] if x["type"] == "sdist")
    source_path = directory / "source"
    if not source_path.exists():
        safe_unpack(download(source["url"], source["sha256"]), source_path, strip_first=True)
    setup = (source_path / "setup.py").read_text()
    if "PYYAML_FORCE_{0}" not in setup or "ext.feature_name.upper()" not in setup or "'libyaml'" not in setup:
        raise ValueError("Reviewed pure-Python build switch is absent")
    results = []
    for name in ["first", "second"]:
        output = directory / name
        subprocess.run([*common, "wheel", "--no-deps", "--no-index", "--no-build-isolation", "--no-cache-dir", "--wheel-dir", str(output), str(source_path)], env=env, check=True, timeout=180)
        candidates = list(output.glob("*py3-none-any.whl"))
        if len(candidates) != 1:
            raise ValueError("Expected one pure-Python wheel")
        results.append((candidates[0], hashlib.sha256(candidates[0].read_bytes()).hexdigest()))
    if results[0][1] != results[1][1]:
        raise ValueError("PyYAML wheel build is not reproducible")
    if results[0][1] != manifest["python"]["pyyaml_wheel_sha256"]:
        raise ValueError("PyYAML wheel differs from reviewed canonical hash")
    subprocess.run([*common, "install", "--no-deps", "--no-index", "--no-cache-dir", str(results[0][0])], env=env, check=True, timeout=60)
    subprocess.run([*common, "check"], env=env, check=True, timeout=60)
    subprocess.run([str(python), "-c", "import yaml; assert yaml.__version__ == '6.0.3'; assert not yaml.__with_libyaml__; print('Exact pure-Python PyYAML qualified')"], env=env, check=True, timeout=30)
    record = {"python": actual, "wheel": results[0][0].name, "sha256": results[0][1], "reproduced": True, "source_date_epoch": env["SOURCE_DATE_EPOCH"], "libyaml": False}
    (directory / "qualification.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record))


if __name__ == "__main__":
    main()
