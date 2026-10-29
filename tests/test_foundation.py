# SPDX-License-Identifier: Apache-2.0
import copy
import hashlib
import io
from pathlib import Path
import sys
import subprocess
import tarfile
import tempfile
import unittest

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_repository import LocalImageLinks, StrictLoader, check_workflow, safe_local_target, valid_subject
from ci_tools import verified_binary


class FoundationBoundaries(unittest.TestCase):
    def test_subject_rejects_unstructured_and_multiline_titles(self):
        for subject in ["fix(core): reject stale approval", "feat!: change task protocol", "docs: explain replay"]:
            self.assertTrue(valid_subject(subject))
        for subject in ["Update stuff", "fix: a", "fix: first\nsecond", "fix: " + "x" * 100]:
            self.assertFalse(valid_subject(subject))

    def test_yaml_on_is_a_string_and_permissions_false_is_boolean(self):
        data = yaml.load("on: {push: {}}\npersist-credentials: false", Loader=StrictLoader)
        self.assertIn("on", data)
        self.assertIs(data["persist-credentials"], False)

    def test_yaml_rejects_duplicate_keys_and_aliases(self):
        for source in ["a: 1\na: 2", "a: &alias 1\nb: *alias"]:
            with self.assertRaises(ValueError):
                yaml.load(source, Loader=StrictLoader)

    def test_ci_gate_rejects_failed_skipped_and_canceled_jobs(self):
        source = Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml"
        workflow = yaml.load(source.read_text(), Loader=StrictLoader)
        gate = workflow["jobs"]["gate"]
        self.assertEqual(set(gate["needs"]), {"foundation", "workflow-security"})
        script = gate["steps"][0]["run"]
        for first in ["success", "failure", "cancelled", "skipped"]:
            for second in ["success", "failure", "cancelled", "skipped"]:
                result = subprocess.run(["bash", "-eo", "pipefail", "-c", script],
                                        env={"FOUNDATION_RESULT": first, "SECURITY_RESULT": second},
                                        capture_output=True, timeout=2)
                self.assertEqual(result.returncode == 0, first == second == "success")

    def test_links_reject_missing_files_and_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "README.md"
            source.write_text("fixture")
            safe_local_target(root, source, "README.md#section")
            for target in ["missing.md", "../outside.md", "/etc/passwd"]:
                with self.assertRaises(ValueError):
                    safe_local_target(root, source, target)

    def test_picture_checks_theme_sources_not_only_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "README.md"
            (root / "light.svg").write_text("fixture")
            LocalImageLinks(root, source).feed('<picture><img src="light.svg"></picture>')
            with self.assertRaises(ValueError):
                LocalImageLinks(root, source).feed('<picture><source srcset="missing-dark.svg"><img src="light.svg"></picture>')

    def test_workflow_rejects_privilege_and_injection_regressions(self):
        sha = "a" * 40
        workflow = {"permissions": {}, "on": {"pull_request": {}}, "concurrency": "fixture",
                    "jobs": {"check": {"runs-on": "ubuntu-24.04", "timeout-minutes": 2,
                                       "permissions": {"contents": "read"},
                                       "steps": [{"uses": "actions/checkout@" + sha,
                                                  "with": {"persist-credentials": False}}]}}}
        pins = {"actions/checkout": sha}
        check_workflow(workflow, pins, "ci.yml")
        mutations = [
            lambda w: w["on"].update({"pull_request_target": {}}),
            lambda w: w["jobs"]["check"]["permissions"].update({"contents": "write"}),
            lambda w: w["jobs"]["check"].update({"continue-on-error": True}),
            lambda w: w["jobs"]["check"]["steps"][0].update({"uses": "actions/checkout@main"}),
            lambda w: w["jobs"]["check"]["steps"][0]["with"].update({"persist-credentials": True}),
            lambda w: w["jobs"]["check"]["steps"].append({"run": "echo ${{ github.event.pull_request.title }}"}),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                candidate = copy.deepcopy(workflow)
                mutate(candidate)
                with self.assertRaises(ValueError):
                    check_workflow(candidate, pins, "ci.yml")

    @staticmethod
    def archive(name="nested/actionlint", link=False):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            entry = tarfile.TarInfo(name)
            if link:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "/etc/passwd"
                archive.addfile(entry)
            else:
                payload = b"synthetic executable bytes"
                entry.size = len(payload)
                archive.addfile(entry, io.BytesIO(payload))
        return output.getvalue()

    def test_tool_checksum_and_archive_boundary(self):
        archive = self.archive("../../actionlint")
        digest = hashlib.sha256(archive).hexdigest()
        # Archive paths are never extracted; only verified regular-file bytes leave it.
        self.assertEqual(verified_binary(archive, digest, "actionlint"), b"synthetic executable bytes")
        with self.assertRaises(ValueError):
            verified_binary(archive, "0" * 64, "actionlint")
        symlink = self.archive(link=True)
        with self.assertRaises(ValueError):
            verified_binary(symlink, hashlib.sha256(symlink).hexdigest(), "actionlint")
        with self.assertRaises(ValueError):
            verified_binary(archive, digest, "../actionlint")


if __name__ == "__main__":
    unittest.main()
