#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Explicitly compile the pinned driver against the pinned latest SQLite source."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

from bootstrap_toolchain import download

ROOT = Path(__file__).resolve().parents[1]


def main():
    lock = json.loads((ROOT / "toolchain.json").read_text())
    engine = lock["sqlite"]
    version = engine["version"]
    node = ROOT / ".factory/tooling" / ("node-" + lock["node"]["version"]) / "bin/node"
    python = ROOT / ".factory/tooling" / ("python-" + lock["python"]["version"]) / "bin/python3"
    if ".".join(str(x) for x in sys.version_info[:3]) == lock["python"]["version"]:
        python = Path(sys.executable)
    headers = ROOT / ".factory/tooling" / ("node-headers-" + lock["node"]["version"])
    if not headers.exists():
        subprocess.run([sys.executable, str(ROOT / "scripts/bootstrap_toolchain.py"), "node-headers"], check=True, timeout=120)
    directory = ROOT / ".factory/native" / ("sqlite-" + version)
    source = directory / "source"
    source.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = download(engine["archive"], engine["sha3_256"], "sha3_256")
    source_hashes = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for name in ["sqlite3.c", "sqlite3.h"]:
            matches = [x for x in archive.infolist() if Path(x.filename).name == name]
            if len(matches) != 1 or matches[0].file_size > 16 * 1024 * 1024:
                raise ValueError("Unexpected SQLite source archive")
            value = archive.read(matches[0])
            source_hashes[name] = hashlib.sha256(value).hexdigest()
            (source / name).write_bytes(value)
    header = (source / "sqlite3.h").read_text()
    if f'#define SQLITE_VERSION        "{version}"' not in header:
        raise ValueError("SQLite archive/header version mismatch")
    source_id = re.search(r'#define SQLITE_SOURCE_ID\s+"([^"]+)"', header)[1]
    if source_id != engine["source_id"]:
        raise ValueError("SQLite source identity differs from the canonical pin")
    definitions = engine["definitions"]
    prefix = "".join(f"#define {name} {value}\n" for name, value in definitions.items()).encode()
    c = source / "sqlite3.c"
    c.write_bytes(prefix + c.read_bytes())
    driver = (ROOT / "node_modules/better-sqlite3").resolve()
    if not driver.is_relative_to(ROOT) or not (driver / "binding.gyp").is_file():
        raise ValueError("Driver is not installed in the owned project")
    env = os.environ.copy()
    env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "/usr/bin:/bin")
    env["SOURCE_DATE_EPOCH"] = "1700000000"
    argv = [str(node), str(ROOT / "node_modules/node-gyp/bin/node-gyp.js"), "rebuild", "--directory=" + str(driver), "--nodedir=" + str(headers), "--python=" + str(python), "--jobs=2", "--sqlite3=" + str(source), "--force_build=1"]
    subprocess.run(argv, cwd=ROOT, env=env, check=True, timeout=600)
    binary = directory / "better_sqlite3.node"
    shutil.copyfile(driver / "build/Release/better_sqlite3.node", binary)
    binary.chmod(0o700)
    probe = directory / "probe.mjs"
    probe.write_text('''import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
const [binding, filename, expectedVersion, expectedSource, output] = process.argv.slice(2);
const db = new Database(filename, { nativeBinding: binding, timeout: 250 });
const identity = db.prepare('select sqlite_version() as version, sqlite_source_id() as source').get();
assert.equal(identity.version, expectedVersion);
assert.equal(identity.source, expectedSource);
assert.equal(db.pragma('journal_mode = WAL', { simple: true }), 'wal');
db.pragma('synchronous = FULL'); db.pragma('foreign_keys = ON');
assert.equal(db.pragma('synchronous', { simple: true }), 2);
assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
db.exec('create table if not exists qualification (id integer primary key); begin immediate; insert into qualification default values; rollback;');
assert.equal(db.prepare('select count(*) as count from qualification').get().count, 0);
const result = { ...identity, node: process.version, compileOptions: db.pragma('compile_options'), journalMode: db.pragma('journal_mode', {simple: true}), synchronous: db.pragma('synchronous', {simple: true}), foreignKeys: db.pragma('foreign_keys', {simple: true}) };
writeFileSync(output, JSON.stringify(result, null, 2) + '\\n');
db.close(); console.log(JSON.stringify(result));
''')
    output = directory / "engine.json"
    subprocess.run([str(node), str(probe), str(binary), str(directory / "qualification.sqlite"), version, source_id, str(output)], cwd=ROOT, env=env, check=True, timeout=30)
    record = {"version": version, "source_id": source_id, "node": lock["node"]["version"], "driver": json.loads((driver / "package.json").read_text())["version"], "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "original_sources_sha256": source_hashes, "patched_c_sha256": hashlib.sha256(c.read_bytes()).hexdigest(), "definitions": definitions, "argv": argv, "compiler": subprocess.check_output(["gcc", "--version"], text=True).splitlines()[0], "engine": json.loads(output.read_text())}
    (directory / "qualification.json").write_text(json.dumps(record, indent=2) + "\n")


if __name__ == "__main__":
    main()
