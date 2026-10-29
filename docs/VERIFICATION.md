# Verification and authority

Status: requirements for implementation and qualification. None of these controls is claimed operational yet.

## Trust and enforcement

Prompts describe desired behavior; deterministic policy and execution boundaries constrain behavior. Do not rely on an agent promising to stay inside scope, a shell substring denylist, or a hook that may fail open.

Run target-repository code and tests as untrusted workloads in an isolated environment with explicit filesystem, network, credential, time, process, and memory limits. A Git worktree separates edits but does not sandbox processes. Required isolation is a capability to verify; unsupported execution must stop rather than silently run unrestricted.

The policy engine, approval authority, audit ledger, and delivery credentials live outside worker-writable paths. Workers receive no publishing credentials. Read-only research access and mutation authority are distinct. Repo scripts, issue text, model output, tool responses, and peer messages cannot grant authority or reconfigure the control plane. Test prompt-injection and delegation-based permission bypass attempts.

Protect existing clones and dirty worktrees. Record the starting branch, commit, tracked diff, and untracked state before any mutation. Own new workspaces explicitly and clean up only resources the run created. Never discard changes or kill unrelated machine processes to make a run green.

## Approval records

Plan approval binds scope, acceptance criteria, maximum resources, permitted local actions, and plan revision/hash. Material revisions invalidate downstream approvals that depended on them.

Each push, PR, external message, and deployment requires a distinct operator approval. Bind it to action type, destination, exact commit or payload digest, expected remote state where applicable, expiry, and a unique request ID. Workers and other labs cannot mint approvals. An action record is single use; ambiguous network outcomes require reconciliation before retrying.

The factory's internal messages are allowed within the approved plan. This does not authorize contacting maintainers, posting comments, sending mail, or communicating outside the factory.

Approval and execution are separate. Use a narrow action executor with constrained credentials, validate the current snapshot and gate results immediately before execution, record the outcome, then verify the resulting remote state. A changed diff or external payload requires a new approval.

## Evidence

A trusted runner records each check against the exact content snapshot:

- Repository and base/head revisions, working-tree/patch digest, and relevant input hashes.
- Requirement and check IDs, lab and attempt IDs, environment/toolchain/dependency identity.
- Exact argv, working directory, permitted environment description, start/end timestamps, termination reason, and exit status.
- Raw output/artifact references with hashes, plus safely redacted output for review.
- Result classification: passed, failed, skipped, blocked, or inconclusive; coverage limitations and rationale.

The producing model cannot self-certify a runner receipt. QA uses the recorded artifacts and independently executes the checks required by the acceptance contract. Record both reviewed evidence and newly executed evidence. Evidence becomes stale when its relevant inputs change; re-run affected checks, rather than indiscriminately repeating the full suite.

## Quality gates

1. **Entry:** approved plan, source snapshot, repo rules, ownership/overlap, resource and capability checks.
2. **Implementation:** scope compliance, focused diff, repository-required formatting/types/lint, developer checks, relevant docs and changelog.
3. **Independent QA:** requirement-level behavior, regression, integration, and E2E tests appropriate to the task. Bug regressions should demonstrate the original failure where feasible. Include controls that discriminate the intended behavior from the wrong implementation.
4. **Security:** required when the change affects relevant trust boundaries; otherwise record why the gate is not applicable. Do not manufacture an exhaustive security checklist for unrelated changes.
5. **Delivery:** exact snapshot and drafts, fresh upstream state, no secret leakage, no unsupported statements, and required operator approval.
6. **Post-action:** verify the actual remote result. CI success requires structured conclusions on the current revision; an approval-pending run is not a failed test or a pass.

Missing or failed required evidence blocks promotion. A model's confidence, a second model's agreement, or a large number of passing irrelevant tests is insufficient. Report what was not checked explicitly. “Production grade” is an acceptance target with bounded evidence, not a universal guarantee.

## Operational recovery

Exercise worker crashes, interrupted sessions, expired leases, duplicate/stale messages, task cancellation, rate limits, unsupported models, budget exhaustion, lost connectivity, changed upstream state, stale approvals, and missing test services. Stop owned worker process trees on cancellation and retain the audit trail. Cleanup must never target an arbitrary process name or unrelated user session.

Keep artifacts and model-visible context scoped to the project. Do not mix private code or secrets into public OSS outputs. Capture only the telemetry needed for operation and evaluation; local state is ignored by Git.

## Dashboard and remote observability

Treat logs, tool arguments, diffs, issue text, and agent messages as untrusted display content. Escape them; do not render agent-supplied HTML or let text create approval controls. The authenticated coordinator creates approval cards from protected records. Controls validate exact action identity, current version, gates, and operator authority server-side; a graph click carries no extra authority.

Record the last observation and telemetry coverage per source. Distinguish worker disconnect, viewer disconnect, expired lease, provider authentication expiry, pending permission, lost evidence, and an actual task failure. Delayed events preserve source sequence and timing; clock skew cannot reorder authoritative state. Replay is read-only. Sensitive data is redacted before telemetry persistence or export; content-bearing artifacts require explicit access and retention rules.

Qualify browser reconnect, worker spool recovery, out-of-order delivery, backpressure, coordinator restart, stale approval views, cross-machine cancellation, unauthorized subscriptions, and content injection. Worker fencing must prevent an expired attempt from promoting artifacts or executing restricted actions. An uncertain remote outcome is reconciled, not retried blindly. See [DASHBOARD.md](DASHBOARD.md) for the proposed transport and coverage contract.

## Improving the factory

Operations may propose changes to skills, model routing, or workflow policy from measured failures. Replay representative tasks and adversarial fixtures in isolation, compare against the current version, and require operator-approved rollout. A running worker cannot rewrite its own guardrails or promote an untested policy change.
