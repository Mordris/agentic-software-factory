#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run one foreground, owned Linux workload with observed cgroup limits and receipts."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".factory/execution"


def owned_storage():
    total = 0
    for directory in [ROOT / ".factory", ROOT / "node_modules"]:
        if directory.exists():
            for base, _, files in os.walk(directory, followlinks=False):
                for name in files:
                    try: total += (Path(base) / name).lstat().st_size
                    except FileNotFoundError: pass  # concurrently removed owned temporary file
    return total


def write_json(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n")
    temporary.replace(path)


def child(receipt, command):
    limits = json.loads((ROOT / "toolchain.json").read_text())["limits"]
    relative = Path("/proc/self/cgroup").read_text().strip().split(":", 2)[2]
    group = Path("/sys/fs/cgroup" + relative)
    cpu = (group / "cpu.max").read_text().strip().split()
    memory = (group / "memory.max").read_text().strip()
    pids = (group / "pids.max").read_text().strip()
    if cpu[0] == "max" or int(cpu[0]) / int(cpu[1]) > limits["cpu_quota_percent"] / 100:
        raise ValueError("CPU quota is not enforced")
    if memory == "max" or int(memory) > limits["memory_bytes"]:
        raise ValueError("Memory limit is not enforced")
    if pids == "max" or int(pids) > limits["pids"]:
        raise ValueError("Process limit is not enforced")
    write_json(Path(receipt), {"cgroup": relative, "cpu_max": cpu, "memory_max": memory, "pids_max": pids})
    os.execvpe(command[0], command, os.environ)


def main(argv):
    if argv[:1] == ["--child"]:
        child(argv[1], argv[3:])
        return 1
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=900)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("An explicit command is required")
    limits = json.loads((ROOT / "toolchain.json").read_text())["limits"]
    if not 1 <= args.seconds <= limits["command_seconds"]:
        raise ValueError("Command exceeds its approved time envelope")
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / "budget.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        budget_path = STATE / "budget.json"
        budget = json.loads(budget_path.read_text()) if budget_path.exists() else {"used_seconds": 0, "runs": 0}
        remaining = limits["cumulative_seconds"] - budget["used_seconds"]
        if remaining < 1:
            raise ValueError("Cumulative approved execution budget exhausted")
        if shutil.disk_usage(ROOT).free < limits["minimum_free_bytes"]:
            raise ValueError("Insufficient free disk for approved workload")
        owned_bytes = owned_storage()
        if owned_bytes >= limits["owned_disk_bytes"]:
            raise ValueError("Owned storage budget exhausted")
        seconds = min(args.seconds, max(1, int(remaining)))
        run_id = uuid.uuid4().hex
        unit = "asf-phase1-" + run_id + ".scope"
        metadata = STATE / (run_id + ".limits.json")
        env_names = {"HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "TERM", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"}
        env = {key: value for key, value in os.environ.items() if key in env_names}
        node = json.loads((ROOT / "toolchain.json").read_text())["node"]["version"]
        private_bin = ROOT / ".factory/tooling" / ("node-" + node) / "bin"
        env["PATH"] = str(private_bin) + os.pathsep + "/usr/local/bin:/usr/bin:/bin"
        python = json.loads((ROOT / "toolchain.json").read_text())["python"]["version"]
        private_python_lib = ROOT / ".factory/tooling" / ("python-" + python) / "lib"
        if private_python_lib.is_dir():
            env["LD_LIBRARY_PATH"] = str(private_python_lib)
            env["PATH"] = str(private_bin) + os.pathsep + str(private_python_lib.parent / "bin") + os.pathsep + "/usr/local/bin:/usr/bin:/bin"
        invocation = ["systemd-run", "--user", "--scope", "--quiet", "--unit=" + unit,
                      "--property=CPUQuota=" + str(limits["cpu_quota_percent"]) + "%",
                      "--property=MemoryMax=" + str(limits["memory_bytes"]),
                      "--property=TasksMax=" + str(limits["pids"]),
                      "--property=RuntimeMaxSec=" + str(seconds + 5) + "s",
                      "timeout", "--signal=TERM", "--kill-after=5", str(seconds),
                      sys.executable, str(Path(__file__).resolve()), "--child", str(metadata), "--", *command]
        start = time.monotonic()
        peak_bytes = owned_bytes
        stop_reason = None
        process = subprocess.Popen(invocation, cwd=ROOT, env=env)
        def stop_owned():
            subprocess.run(["systemctl", "--user", "kill", "--kill-whom=all", "--signal=KILL", unit], check=False, env=env, timeout=10)
            if process.poll() is None: process.kill()
            process.wait(timeout=10)
        try:
            while process.poll() is None:
                try: process.wait(timeout=2)
                except subprocess.TimeoutExpired: pass
                peak_bytes = max(peak_bytes, owned_storage())
                if peak_bytes >= limits["owned_disk_bytes"] or shutil.disk_usage(ROOT).free < limits["minimum_free_bytes"]:
                    stop_reason = 'observed_storage_limit'; stop_owned(); break
                if time.monotonic() - start > seconds + 20:
                    stop_reason = 'external_timeout'; stop_owned(); break
            code = process.returncode if stop_reason is None else 124
        except KeyboardInterrupt:
            stop_reason = 'operator_interrupt'; stop_owned(); code = 130
        except (OSError, ValueError):
            stop_owned()
            raise
        elapsed = time.monotonic() - start
        budget["used_seconds"] += elapsed
        budget["runs"] += 1
        write_json(budget_path, budget)
        record = {"id": run_id, "argv": command, "cwd": str(ROOT), "exit_status": code,
                  "elapsed_seconds": elapsed, "wall_limit_seconds": seconds,
                  "owned_bytes_before": owned_bytes, "cumulative_seconds": budget["used_seconds"],
                  "owned_bytes_peak_observed": peak_bytes, "storage_poll_seconds": 2, "stop_reason": stop_reason,
                  "limits": json.loads(metadata.read_text()) if metadata.exists() else None}
        write_json(STATE / (run_id + ".json"), record)
        print(json.dumps({"receipt": str(STATE / (run_id + ".json")), "exit": code, "seconds": round(elapsed, 2)}))
        return code


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, OSError, KeyError) as error:
        print("Bounded workload blocked: " + str(error), file=sys.stderr)
        sys.exit(1)
