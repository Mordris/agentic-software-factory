# Local simulated core

This is a development qualification harness, not a supported installation or live factory. Read the approved milestone before starting workloads. Keep state inside a newly owned directory. No dashboard or live worker adapter is started.

The canonical pins are toolchain.json, pnpm-workspace.yaml and both documents of pnpm-lock.yaml. scripts/bootstrap_toolchain.py explicitly downloads private Node, pnpm-native and node-headers components. scripts/qualify_python.py uses the exact interpreter and reproduces the pinned PyYAML wheel; scripts/qualify_sqlite.py compiles and probes the exact SQLite source. Dependencies install with a frozen lockfile and lifecycle scripts disabled.

Run approved local workloads through scripts/run_bounded.py. Root commands exposed through scripts/pnpm are check:versions, typecheck, lint, build, test:core, test:controls and test:acceptance. The acceptance command creates owned ignored state and kills only its own fixture coordinator before resuming it. The live qualification script has consumed original and renewed live-run budgets and must not be repeated without new approval.

After building, `node apps/cli/dist/main.js help` lists commands. `versions` reports selected identities. `status --state PATH` and `events --state PATH --ledger-id ID --after CURSOR` open read-only SQLite connections. `plan-preview --file FILE` computes a plan digest without approving or dispatching it. Trusted local operator commands submit, approve-plan and cancel require explicit request IDs and expected versions. Unsupported commands, duplicate flags and foreign cursors return nonzero JSON errors.

The `demo --state NEW_OWNED_PATH` command executes only fixed synthetic functions. It exercises independent observations and bounded rework, then stops at the approval boundary. There is no external executor and no implicit model, shell, network, plugin or background service in the fixture worker API.

See [the current qualification record](milestones/PHASE_1_QUALIFICATION.md), [communication contracts](COMMUNICATION.md) and [the milestone](milestones/PHASE_1_CORE.md).
