#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Manual bounded no-tools CLI qualification; never runs in credential-free CI."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / ".factory/claude-qualification"
MODEL = "claude-haiku-5-5"
PROMPT = """Read-only synthetic research fixture. Use only the supplied data. Return one JSON object, no Markdown.
A mission is ready only if its plan is approved and all required checks passed.
Mission A: approved plan; required checks lint=passed and tests=failed.
Mission B: plan not approved; required checks lint=passed and tests=passed.
Return exactly this structure with your decisions: {"A":{"ready":boolean,"reason":"failed_check" or "missing_approval" or "ready"},"B":{"ready":boolean,"reason":"failed_check" or "missing_approval" or "ready"}}.
Do not use tools, delegate, inspect files, or request more data."""
EXPECTED = {"A": {"ready": False, "reason": "failed_check"}, "B": {"ready": False, "reason": "missing_approval"}}


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def terminate_owned(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


def run(mode):
    lock = json.loads((ROOT / "toolchain.json").read_text())
    target = lock["claude_probe"]
    binary = ROOT / ".factory/tooling" / ("claude-native-" + target["version"]) / "claude"
    if not binary.is_file():
        raise ValueError("Exact private Claude CLI is missing")
    authorization = json.loads((DIRECTORY / "authorization.json").read_text())
    if authorization.get("approved") is not True or authorization.get("paid_extra_usage_disabled") is not True:
        raise ValueError("Explicit trial/subscription boundary confirmation is missing")
    if Path("/etc/claude-code").exists():
        raise ValueError("Managed policy needs explicit discovery review before a live trial")
    env = os.environ.copy()
    for name in list(env):
        if name.startswith(("ANTHROPIC_", "CLAUDE_CODE_USE_", "AWS_", "AZURE_", "GOOGLE_")):
            del env[name]
    env.update({"DISABLE_AUTOUPDATER": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"})
    if subprocess.check_output([str(binary), "--version"], env=env, text=True).strip() != target["version"] + " (Claude Code)":
        raise ValueError("Claude CLI version drift")
    auth = subprocess.run([str(binary), "--safe-mode", "auth", "status"], cwd=DIRECTORY, env=env, text=True, capture_output=True, timeout=30)
    details = json.loads(auth.stdout)
    if auth.returncode or details.get("loggedIn") is not True or details.get("authMethod") != "claude.ai" or details.get("apiProvider") != "firstParty":
        raise ValueError("Qualified first-party subscription authentication is absent")
    settings = json.dumps({"disableAllHooks": True, "permissions": {"defaultMode": "dontAsk"}, "enabledPlugins": {}, "autoMemoryEnabled": False})
    argv = [str(binary), "--safe-mode", "--print", "--model", MODEL, "--effort", "low", "--tools", "", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--settings", settings, "--no-chrome", "--disable-slash-commands", "--no-session-persistence", "--prompt-suggestions", "false", "--max-turns", "3", "--output-format", "stream-json", "--verbose", "--include-partial-messages", PROMPT]
    budget_path = DIRECTORY / "live-budget.json"
    with (DIRECTORY / "live-budget.lock").open("a") as budget_lock:
        fcntl.flock(budget_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        budget = json.loads(budget_path.read_text()) if budget_path.exists() else {"started_runs": 0}
        if budget["started_runs"] >= min(2, target["limits"]["runs"]):
            raise ValueError("Approved live-run budget exhausted")
        budget["started_runs"] += 1
        budget_path.write_text(json.dumps(budget, indent=2) + "\n")
        run_id = uuid.uuid4().hex
        output = DIRECTORY / run_id
        output.mkdir(mode=0o700)
        (output / "recipe.json").write_text(json.dumps({"argv": argv, "model": MODEL, "effort": "low", "prompt_sha256": hashlib.sha256(PROMPT.encode()).hexdigest(), "mode": mode, "limit_seconds": 180, "turn_limit": 3, "subscription_auth": details["authMethod"]}, indent=2) + "\n")
        started = time.monotonic()
        process = subprocess.Popen(argv, cwd=DIRECTORY, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        buffers = {"stdout": b"", "stderr": b""}
        sizes = {"stdout": 0, "stderr": 0}
        events = []
        canceled = False
        result = None
        init = None
        error = None
        try:
            with (output / "stdout.jsonl").open("wb") as stdout, (output / "stderr.txt").open("wb") as stderr:
                files = {"stdout": stdout, "stderr": stderr}
                while selector.get_map():
                    if time.monotonic() - started > 180:
                        raise ValueError("Live trial wall deadline exceeded")
                    for key, _ in selector.select(timeout=0.2):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        channel = key.data
                        sizes[channel] += len(chunk)
                        if sizes[channel] > 8 * 1024 * 1024:
                            raise ValueError("Live evidence size limit exceeded")
                        files[channel].write(chunk)
                        if channel != "stdout":
                            continue
                        buffers[channel] += chunk
                        if len(buffers[channel]) > 65536 and b"\n" not in buffers[channel]:
                            raise ValueError("Oversized live event")
                        while b"\n" in buffers[channel]:
                            line, buffers[channel] = buffers[channel].split(b"\n", 1)
                            event = json.loads(line)
                            events.append(event)
                            if event.get("type") == "system" and event.get("subtype") == "init":
                                init = event
                                if event.get("tools") or event.get("mcp_servers") or event.get("model") != MODEL:
                                    raise ValueError("Live initialization violates approved capabilities/model")
                            if event.get("type") == "assistant":
                                message = event.get("message", {})
                                if message.get("model") != MODEL or any(x.get("type") == "tool_use" for x in message.get("content", [])):
                                    raise ValueError("Unexpected model/tool activity")
                            if event.get("type") == "result":
                                result = event
                            if mode == "cancel" and event.get("type") == "stream_event" and event.get("event", {}).get("type") == "content_block_delta" and process.poll() is None:
                                terminate_owned(process)
                                canceled = True
                code = process.wait(timeout=5)
            if not init:
                raise ValueError("No supported initialization event observed")
            if mode == "result":
                if code or not result or result.get("is_error") or result.get("subtype") != "success":
                    raise ValueError("Native result failed or is missing; inspect private receipt")
                if result.get("num_turns", 4) > 3:
                    raise ValueError("Native reported turn count exceeded approval")
                value = json.loads(result["result"], object_pairs_hook=no_duplicates)
                if value != EXPECTED:
                    raise ValueError("Independent fixture evaluation failed")
            elif not canceled or code == 0:
                raise ValueError("Owned-process cancellation was not demonstrated")
        except Exception as caught:
            error = str(caught)
        finally:
            terminate_owned(process)
            selector.close()
        record = {"id": run_id, "mode": mode, "success": error is None, "error": error, "elapsed_seconds": time.monotonic() - started, "exit_status": process.returncode, "requested_model": MODEL, "observed_model": init.get("model") if init else None, "claude_version": target["version"], "canceled": canceled, "tools": init.get("tools") if init else None, "mcp_servers": init.get("mcp_servers") if init else None, "event_types": sorted({str(e.get("type")) for e in events}), "reported_turns": result.get("num_turns") if result else None, "reported_usage": result.get("usage") if result else None, "coverage_limits": ["No tool, delegation, remote, worker sandbox or model-quality qualification", "Native turn-limit exhaustion is not exercised", "Local cancellation does not prove provider-side cancellation or billing outcome"], "artifacts": {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in ["stdout.jsonl", "stderr.txt", "recipe.json"]}}
        (output / "receipt.json").write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record, indent=2))
        if error:
            raise ValueError(error)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["result", "cancel"])
    run(parser.parse_args().mode)
