# SPDX-License-Identifier: Apache-2.0
import base64
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from bootstrap_toolchain import download, safe_unpack
from check_repository import load_yaml
from check_toolchain import check_sources
from review_dependencies import advisory_findings, locked_packages
import run_bounded
from codeql_bundle import verified_stream

ROOT = Path(__file__).resolve().parents[1]


class CoreBoundaries(unittest.TestCase):
    def test_bundle_checksum_and_download_budget_fail_before_use(self):
        payload = b'owned synthetic bundle'
        expected = hashlib.sha256(payload).hexdigest()
        output = io.BytesIO(); self.assertEqual(verified_stream(io.BytesIO(payload), output, expected), len(payload))
        for digest, maximum in [('0' * 64, 100), (expected, 1)]:
            with self.assertRaises(ValueError): verified_stream(io.BytesIO(payload), io.BytesIO(), digest, maximum)
    def test_missing_kernel_enforcement_blocks_before_command(self):
        original = Path.read_text
        for invalid in ['cpu.max', 'memory.max', 'pids.max']:
            def read(path, *args, **kwargs):
                if path.name == 'cgroup': return '0::/fake-owned-scope'
                if path.name in {'cpu.max', 'memory.max', 'pids.max'}:
                    if path.name == invalid: return 'max 100000' if invalid == 'cpu.max' else 'max'
                    return {'cpu.max': '200000 100000', 'memory.max': '4294967296', 'pids.max': '128'}[path.name]
                return original(path, *args, **kwargs)
            with patch.object(Path, 'read_text', read), patch('os.execvpe') as execute:
                with self.assertRaises(ValueError): run_bounded.child('unused', ['must-never-run'])
                execute.assert_not_called()

    def test_scans_second_document_and_fails_on_missing_advisory_data(self):
        integrity = "sha512-" + base64.b64encode(bytes(64)).decode()
        source = "---\nlockfileVersion: '9.0'\npackages:\n  manager@1.0.0:\n    resolution: {integrity: " + integrity + "}\n---\nlockfileVersion: '9.0'\npackages:\n  vulnerable@2.0.0:\n    resolution: {integrity: " + integrity + "}\n"
        documents, rows = locked_packages(source)
        self.assertEqual(len(documents), 2)
        findings = advisory_findings(rows, {"results": [{}, {"vulns": [{"id": "known-adverse-fixture"}]}]})
        self.assertEqual(findings[0]["package"], "vulnerable")
        for response in [{}, {"results": [{}]}, {"results": [{}, {"next_page_token": "more"}]}, {"results": [{}, {"vulns": "invalid"}]}]:
            with self.assertRaises(ValueError): advisory_findings(rows, response)
        for changed in [source.replace(integrity, 'sha512-invalid'), "lockfileVersion: '9.0'\npackages: {}"]:
            with self.assertRaises(ValueError): locked_packages(changed)

    def test_version_drift_controls(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            for item in ["toolchain.json", "package.json", ".node-version", ".python-version", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".github/requirements-ci.txt", ".github/workflows/ci.yml", ".github/workflows/codeql.yml"]:
                target = root / item; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / item, target)
            for parent in ["packages", "apps"]:
                for path in (ROOT / parent).glob('*/package.json'):
                    target = root / path.relative_to(ROOT); target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(path, target)
            check_sources(root)
            changes = [(".node-version", "0.0.0"), ("pnpm-workspace.yaml", (root / "pnpm-workspace.yaml").read_text().replace('"7.0.2"', '"7.0.1"')), (".github/workflows/ci.yml", (root / ".github/workflows/ci.yml").read_text().replace('python-version-file: .python-version', "python-version: '3.12'"))]
            for name, replacement in changes:
                target = root / name; original = target.read_text(); target.write_text(replacement)
                with self.assertRaises(ValueError): check_sources(root)
                target.write_text(original)

    def test_archive_rejects_paths_links_and_special_files(self):
        for name, kind, link in [("../escape", tarfile.REGTYPE, ''), ("/absolute", tarfile.REGTYPE, ''), ("link", tarfile.SYMTYPE, "/etc/passwd"), ("device", tarfile.CHRTYPE, '')]:
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                entry = tarfile.TarInfo(name); entry.type = kind; entry.linkname = link; archive.addfile(entry, io.BytesIO())
            with tempfile.TemporaryDirectory() as parent:
                target = Path(parent) / "tool"
                with self.assertRaises(ValueError): safe_unpack(stream.getvalue(), target)
                self.assertFalse(target.exists())
        with self.assertRaises(ValueError): download("https://unreviewed.invalid/tool", "0" * 64)
        with patch('urllib.request.urlopen') as opened:
            opened.return_value.__enter__.return_value.read.return_value = b'wrong archive'
            with self.assertRaises(ValueError): download("https://nodejs.org/tool", "0" * 64)

    def test_lock_loader_keeps_both_documents_strict(self):
        self.assertEqual(len(load_yaml(ROOT / "pnpm-lock.yaml")), 2)
        with tempfile.TemporaryDirectory() as parent:
            target = Path(parent) / 'pnpm-lock.yaml'
            target.write_text('---\na: 1\n---\na: 1\na: 2\n')
            with self.assertRaises(ValueError): load_yaml(target)
