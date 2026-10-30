#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Review every lockfile document; missing graph/advisory data fails closed."""

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import urllib.request
import urllib.parse

import yaml
from check_repository import StrictLoader

ROOT = Path(__file__).resolve().parents[1]


def locked_packages(source):
    documents = list(yaml.load_all(source, Loader=StrictLoader))
    if not 1 <= len(documents) <= 2 or any(not isinstance(x, dict) for x in documents):
        raise ValueError("Unsupported/empty lockfile document structure")
    rows = {}
    for document in documents:
        if document.get("lockfileVersion") != "9.0":
            raise ValueError("Unqualified lockfile version")
        for key, item in document.get("packages", {}).items():
            match = re.fullmatch(r"(@[^/]+/[^@]+|[^@]+)@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)", key)
            if not match:
                raise ValueError("Unparsed/exotic package identity: " + key)
            resolution = item.get("resolution", {})
            integrity = resolution.get("integrity", "")
            try:
                algorithm, encoded = integrity.split("-", 1)
                valid = algorithm == "sha512" and len(base64.b64decode(encoded, validate=True)) == 64
            except ValueError:
                valid = False
            if not valid or set(resolution) - {"integrity"}:
                raise ValueError("Missing integrity or non-registry resolution: " + key)
            identity = (match[1], match[2])
            if identity in rows and rows[identity] != integrity:
                raise ValueError("Conflicting integrity across lockfile documents")
            rows[identity] = integrity
    if len(documents) == 2 and not documents[1].get("packages"):
        raise ValueError("Application graph is absent from the second document")
    if not rows:
        raise ValueError("Dependency graph is empty")
    return documents, rows


def advisory_findings(rows, result):
    if not isinstance(result, dict) or len(result.get("results", [])) != len(rows):
        raise ValueError("Incomplete advisory response")
    if any(not isinstance(entry, dict) or set(entry) - {"vulns"} or ("vulns" in entry and not isinstance(entry["vulns"], list)) for entry in result["results"]):
        raise ValueError("Advisory pagination/error requires explicit reconciliation")
    return [{"package": name, "version": version, "records": entry["vulns"]}
            for (name, version), entry in zip(rows, result["results"]) if entry.get("vulns")]


def package_license(entry):
    (name, version), integrity = entry
    url = "https://registry.npmjs.org/" + urllib.parse.quote(name, safe="@/") + "/" + version
    with urllib.request.urlopen(url, timeout=25) as response:
        data = json.load(response)
    if data.get("name") != name or data.get("version") != version or data.get("dist", {}).get("integrity") != integrity:
        raise ValueError("Registry identity/integrity mismatch: " + name)
    license_id = data.get("license")
    if not isinstance(license_id, str) or license_id not in {"MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "0BSD", "BlueOak-1.0.0", "(MIT OR CC0-1.0)", "(MIT AND Zlib)", "Python-2.0", "MIT OR Apache-2.0", "MPL-2.0"}:
        raise ValueError("License requires explicit review: " + name + " " + repr(license_id))
    return {"name": name, "version": version, "integrity": integrity, "declared_license": license_id, "source": url}


def main():
    documents, rows = locked_packages((ROOT / "pnpm-lock.yaml").read_text())
    request = {"queries": [{"package": {"name": name, "ecosystem": "npm"}, "version": version} for name, version in rows]}
    req = urllib.request.Request("https://api.osv.dev/v1/querybatch", data=json.dumps(request).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.load(response)
    findings = advisory_findings(rows, result)
    directory = ROOT / ".factory/dependency-review"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "advisories.json").write_text(json.dumps({"documents": len(documents), "packages": len(rows), "request": request, "response": result, "findings": findings}, indent=2) + "\n")
    print(json.dumps({"documents": len(documents), "packages": len(rows), "advisory_findings": findings}))
    if findings:
        raise ValueError("Dependency advisory review failed")
    with ThreadPoolExecutor(max_workers=6) as pool:
        licenses = list(pool.map(package_license, rows.items()))
    if len(licenses) != len(rows):
        raise ValueError("Incomplete license inventory")
    (directory / "licenses.json").write_text(json.dumps({"checked_at": datetime.now(timezone.utc).isoformat(), "documents": len(documents), "packages": len(rows), "inventory": licenses, "scope": "Declared registry licenses, not legal advice or a source-code license audit"}, indent=2) + "\n")
    print(json.dumps({"license_records": len(licenses)}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, yaml.YAMLError) as error:
        print("Dependency review blocked: " + str(error), file=sys.stderr)
        sys.exit(1)
