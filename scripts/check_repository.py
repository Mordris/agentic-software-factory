#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Bounded foundation checks; this is not an application/security certification."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse
import xml.etree.ElementTree as ET

import yaml

ROOT = Path(__file__).resolve().parents[1]
SUBJECT = re.compile(r"(?:feat|fix|docs|refactor|perf|test|build|ci|chore|revert)"
                     r"(?:\([a-z0-9][a-z0-9/_-]*\))?!?: [^\r\n]{3,}")
ACTION = re.compile(r"([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?:/[A-Za-z0-9_./-]+)?@([0-9a-f]{40})")


def require(condition, message):
    if not condition:
        raise ValueError(message)


class StrictLoader(yaml.SafeLoader):
    def compose_node(self, parent, index):
        if self.check_event(yaml.AliasEvent):
            raise ValueError("YAML aliases are not allowed in foundation configuration")
        return super().compose_node(parent, index)


def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        require(key not in result, f"Duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node)
    return result


# GitHub treats `on` as a string; retain booleans only for true/false.
StrictLoader.yaml_implicit_resolvers = {
    key: [(tag, pattern) for tag, pattern in values
          if tag != "tag:yaml.org,2002:bool"]
    for key, values in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
StrictLoader.add_implicit_resolver("tag:yaml.org,2002:bool",
                                 re.compile(r"^(?:true|false)$", re.I), list("tTfF"))
StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def load_yaml(path):
    return yaml.load(path.read_text(), Loader=StrictLoader)


def valid_subject(subject):
    return len(subject) <= 100 and SUBJECT.fullmatch(subject) is not None


def check_workflow(workflow, pins, name):
    require(workflow.get("permissions") == {}, f"{name}: default permissions must be empty")
    triggers = workflow.get("on", {})
    require(isinstance(triggers, dict), f"{name}: explicit event mapping required")
    require(not {"pull_request_target", "workflow_run"} & triggers.keys(),
            f"{name}: privileged indirect PR triggers are prohibited")
    for event in ("push", "pull_request"):
        if event in triggers and isinstance(triggers[event], dict):
            require(not {"paths", "paths-ignore"} & triggers[event].keys(),
                    f"{name}: required checks must not use path filtering")
    require("concurrency" in workflow, f"{name}: concurrency group required")
    for job_id, job in workflow["jobs"].items():
        require(job.get("runs-on") == "ubuntu-24.04", f"{name}/{job_id}: reviewed hosted runner required")
        require(1 <= job.get("timeout-minutes", 0) <= 30, f"{name}/{job_id}: bounded timeout required")
        require(not job.get("continue-on-error", False), f"{name}/{job_id}: failures must propagate")
        permissions = job.get("permissions", {})
        for permission, level in permissions.items():
            require(level == "read" or (name == "codeql.yml" and permission == "security-events" and level == "write"),
                    f"{name}/{job_id}: unjustified token permission {permission}:{level}")
        for step in job.get("steps", []):
            require(not step.get("continue-on-error", False), f"{name}: step failures must propagate")
            require("${{" not in step.get("run", ""), f"{name}: expressions belong in environment/input fields")
            if "uses" in step:
                match = ACTION.fullmatch(step["uses"])
                require(match is not None, f"{name}: action must have a full commit SHA")
                repository, sha = match.groups()
                require(pins.get(repository) == sha, f"{name}: action SHA missing from reviewed pins")
                if repository == "actions/checkout":
                    require(step.get("with", {}).get("persist-credentials") is False,
                            f"{name}: checkout must not persist credentials")


def safe_local_target(root, source, target):
    parsed = urllib.parse.urlsplit(target.strip("<>"))
    if parsed.scheme or parsed.netloc or not parsed.path:
        return
    path = (source.parent / urllib.parse.unquote(parsed.path)).resolve()
    require(path.is_relative_to(root.resolve()), f"{source}: local link escapes repository")
    require(path.exists(), f"{source}: missing local target {target}")


def check_repository(root):
    files = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root).split(b"\0")
    paths = sorted({os.fsdecode(value) for value in files if value})
    for name in paths:
        path = root / name
        require(not path.is_symlink(), f"{name}: symlinks require a policy review")
        require(path.stat().st_size <= 2 * 1024 * 1024, f"{name}: oversized tracked file")
        if path.suffix == ".md":
            text = path.read_text()
            require(not re.search(r"/(?:home|Users)/[A-Za-z0-9_.-]+/", text), f"{name}: operator-specific absolute path")
            for target in re.findall(r"\]\(([^)]+)\)", text):
                safe_local_target(root, path, target)
        if path.suffix in {".yml", ".yaml"}:
            load_yaml(path)
        if path.suffix == ".json":
            json.loads(path.read_text())
    for required in ["LICENSE", "NOTICE", "README.md", "SECURITY.md", "CONTRIBUTING.md", "GOVERNANCE.md", "RELEASING.md", ".github/CODEOWNERS"]:
        require((root / required).is_file(), f"Missing foundation file: {required}")
    labels = json.loads((root / ".github/labels.json").read_text())
    names = {item["name"] for item in labels}
    require(len(names) == len(labels), "Duplicate label name")
    for label in labels:
        require(re.fullmatch(r"[0-9a-f]{6}", label["color"]) is not None, "Invalid label color")
        require(0 < len(label["name"]) <= 50 and len(label["description"]) <= 100, "Invalid label length")
    for form in (root / ".github/ISSUE_TEMPLATE").glob("*.yml"):
        data = load_yaml(form)
        if form.name == "config.yml":
            continue
        require(data.get("name") and data.get("description") and data.get("body"), f"{form}: incomplete issue form")
        require(set(data.get("labels", [])) <= names, f"{form}: undefined label")
        fields = [field["id"] for field in data["body"] if field["type"] != "markdown"]
        require(len(set(fields)) == len(fields), f"{form}: duplicate field ID")
        for field in data["body"]:
            if field["type"] != "markdown":
                require(field.get("attributes", {}).get("label"), f"{form}: field label missing")
    for category in load_yaml(root / ".github/release.yml")["changelog"]["categories"]:
        require(set(category["labels"]) <= names | {"*"}, "Undefined changelog label")
    manifest = json.loads((root / ".github/action-pins.json").read_text())
    pins = {entry["repository"]: entry["commit"] for entry in manifest["actions"]}
    for workflow in (root / ".github/workflows").glob("*.yml"):
        check_workflow(load_yaml(workflow), pins, workflow.name)
    tools = json.loads((root / ".github/ci-tools.json").read_text())["tools"]
    for name, tool in tools.items():
        require(re.fullmatch(r"[0-9a-f]{64}", tool["sha256"]) is not None, f"{name}: missing tool checksum")
        require(tool["url"].startswith(f"https://github.com/{tool['repository']}/releases/download/"), f"{name}: invalid upstream URL")
    vendor = root / "docs/assets/lobe"
    provenance = json.loads((vendor / "SOURCES.json").read_text())
    require(re.fullmatch(r"[0-9a-f]{40}", provenance["commit"]) is not None, "Icon source must be pinned")
    for entry in provenance["assets"]:
        path = vendor / entry["file"]
        require(path.resolve().is_relative_to(vendor.resolve()), "Icon path escapes vendor directory")
        require(hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], f"{path}: asset hash mismatch")
        if path.suffix == ".svg":
            for element in ET.fromstring(path.read_text()).iter():
                tag = element.tag.rsplit("}", 1)[-1].lower()
                require(tag not in {"script", "foreignobject", "image"}, f"{path}: active SVG content")
                for key, value in element.attrib.items():
                    require(not key.lower().startswith("on"), f"{path}: SVG event handler")
                    if key.rsplit("}", 1)[-1] == "href":
                        require(value.startswith("#"), f"{path}: external SVG reference")
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if os.environ.get("GITHUB_EVENT_NAME") == "pull_request" and event_path:
        title = json.loads(Path(event_path).read_text())["pull_request"]["title"]
        require(valid_subject(title), "PR title must follow Conventional Commits, <=100 characters")
    print(f"Foundation checks passed: {len(paths)} files; {len(labels)} labels; no runtime qualification implied.")


if __name__ == "__main__":
    try:
        check_repository(ROOT)
    except (ValueError, OSError, KeyError, TypeError, yaml.YAMLError, ET.ParseError) as error:
        print(f"Foundation check failed: {error}", file=sys.stderr)
        sys.exit(1)
