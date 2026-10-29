# Implementation plan for review

This is the proposed plan, revised to include a live dashboard and remote execution from the first usable release. Public visibility and preparing this design do not approve the runtime implementation milestones below. All milestones retain separate approval for pushes, PRs, external messages, and deployments.

## Phase 0 — Repository foundation and public development

Deliver the charter, architecture, authority/verification requirements, platform research, and phased plan. Establish honest pre-alpha documentation, Apache-2.0 licensing, contribution/release/security policies, issue and PR templates, labels/settings, protected branches/tags, and hardened foundation CI. Qualify the CI on its actual pushed revision before claiming it operational. Model access is selected: the operator's Claude Code subscription and its available authorized Claude models. Confirm resource limits and which isolation environment can be used after machine cleanup. Review the plan through Headquarters.

Exit: the operator approves a bounded first implementation milestone and its resource envelope. Current state: the public foundation and visual documentation are published and qualified on their revisions. The [Phase 1 implementation brief](milestones/PHASE_1_CORE.md), [acceptance matrix](milestones/PHASE_1_ACCEPTANCE.md), and [candidate dependency inventory](milestones/phase-1-dependencies.json) are prepared for review. Runtime implementation approval is pending.

## Phase 1 — Core contracts and durable state

Review the [bounded Phase 1 brief](milestones/PHASE_1_CORE.md) before implementation. It defines the shared latest-stable version policy, compatibility entry gates, resource envelope, staged work, and a two-mission restart/cancellation/rework demonstration. Its [acceptance matrix](milestones/PHASE_1_ACCEPTANCE.md) makes the exit criteria below testable. The brief is not an approval or a qualification result.

Implement the smallest useful CLI and persistent task ledger: plans, tasks, lab identities, dependencies, message envelopes, leases, idempotency, cancellation, approvals, evidence references, and audit events. Include stable machine/attempt identities, producer sequences, a transactional event outbox, and snapshot/cursor replay. Define the eight lab contracts and the shared protocol, with actual inputs, deliverables, capability limits, and escalation criteria. Version the boundary schemas.

Start with a fake execution adapter and synthetic repositories. No live model calls or external mutations are necessary to establish core behavior.

The bounded brief also proposes an early real Claude Code qualification using at most two fixed-input, no-tools runs through the operator's authorized subscription. This checks integration assumptions early while preserving deterministic core tests. It needs the brief's explicit live-run budget approval; it does not enable the full Phase 2 adapter or put subscription credentials in CI.

Exit criteria:

- A task cannot execute without an approved matching plan.
- A crash/restart preserves state; duplicate completion cannot advance a task twice.
- Invalid transitions, stale leases, forged approvals, scope escalation, and cyclic dependencies are rejected.
- A required failed, skipped, missing, or stale check prevents delivery readiness.
- Canceled work does not dispatch more tasks; budget and concurrency limits apply across descendants.
- Two simultaneous missions and parallel subtasks respect global/per-host/provider limits, fair scheduling, conflict leases, and mission-scoped evidence/approvals. Canceling one leaves the other progressing; stale attempts cannot retain or double-release reservations. See [concurrency qualification](CONCURRENCY.md).
- State and audit events commit atomically; duplicate, missing, and delayed producer events cannot silently corrupt the projection.
- Boundary and recovery tests demonstrate these behaviors; test commands are documented.

## Phase 1b — Visual Headquarters and remote transport

Build the local web interface against the fake adapter before connecting live agents. Deliver a navigable graph, task/attempt/tool details, communication envelopes, evidence receipts, approval previews, machine health, and trace replay. Build graph and list views over the same projection. Implement authenticated SSE snapshot/replay, a protected command API, worker event buffering, and bounded lease-based control acknowledgements. Preserve the existing operator approval boundary.

Develop it as a cohesive web application: visual identity, shared design tokens/components, connected mission pages, stable record links, and consistent selection across graph, trace, communications, and evidence. Refine the end-to-end operator journey with realistic fixture states; the initial inline concept does not settle the final visual design.

Exit criteria:

- A fixture run can be inspected from machine → lab → task → attempt → tool call → evidence, and every internal message is linked to sender, receiver, and causal task.
- Graph pan/zoom/fit, filtering, grouping, expansion, selection, and time replay work without losing selected identities or concealing active filters.
- The all-missions graph, mission filters, resource queues/holders, and inspectors show simultaneous work without mixing identities or authority.
- Disconnect, reconnect, restart, duplicate delivery, clock skew, stale controls, and telemetry gaps produce correct, explicit states. A cancel request is not displayed as completed cancellation before acknowledgement.
- A viewer on another approved machine receives the same state through an SSH tunnel. No public dashboard port or automatic deployment is needed. Test transport loss before any live remote pilot.
- Under a documented local fixture load, target p95 committed-event-to-render latency below one second. Report measured remote latency separately; never imply real-time visibility during a partition.
- Keyboard navigation, a graph-equivalent task list, reduced motion, readable themes, and responsive layouts are checked.
- The connected operator journey and its empty, loading, failure/rework, approval, disconnected, and partial-coverage states receive visual and interaction review. Motion reflects observed activity and respects inspection and accessibility preferences.

## Phase 2 — Claude Code adapter and execution boundary

Package lab agents and skills through a native plugin. Add a single Headquarters entry point, structured worker outputs, model/capability discovery, cancellation and usage accounting. Evaluate native workflows, subagents, and cross-session messaging against the adapter contract. Keep experimental Agent Teams optional.

Integrate the isolated command runner and trusted evidence writer before allowing workers to execute repository code. Keep external credentials outside worker environments. Qualify the installed runtime and actual permission behavior; do not equate a valid config file with enforced controls.

Exit criteria:

- Headquarters can dispatch a bounded Research task and receive a durable artifact; another lab can request clarification through the broker.
- Unsupported capabilities, invalid structured output, unavailable models, or policy-hook failures produce a blocked/failed attempt with a useful reason.
- Attempts to write outside the workspace, reach disallowed network destinations, obtain delivery credentials, or alter the control plane are prevented in the selected environment.
- Model identity and observed usage are recorded; enforced runtime limits stop owned work.
- The dashboard follows a bounded live attempt, including tool start/end, native permission waits, messages, evidence, and coverage limitations. Remote process/authentication survival and required Desktop-connected tools are qualified for the chosen topology.
- Native package validation and at least one explicitly authorized live, bounded agent run pass. No claims of broader provider/platform support are made.

## Phase 3 — One complete OSS workflow

Implement the OSS mode with repository instruction discovery, current availability/ownership checks, baseline reproduction, scoped implementation, independent QA, and delivery previews. Demonstrate it first against a local fixture repository with deliberate bugs and contribution rules.

Exit criteria:

- One operator request produces a plan, research dossier, patch, relevant independent test evidence, and exact PR/push previews.
- QA detects a deliberately wrong implementation and sends a bounded rework task without operator relaying.
- Repo-specific prerequisites and human approvals cannot be bypassed by another lab or by untrusted instructions.
- No push, PR, external message, or deployment occurs without the corresponding exact approval.
- Interrupt/resume and ambiguous external-outcome simulations do not duplicate actions.

Only then propose a bounded real OSS pilot. Refresh issue/PR availability, contributor ownership, and repository rules before selection, implementation, and delivery.

## Phase 4 — Generic mode and model qualification

Add a second mode, such as a feature request in a fixture application, without embedding OSS-specific checks in core. Benchmark model profiles on representative research, implementation, and review tasks. Compare quality, rework, completion time, observed usage, and cost when measurable.

Exit: both modes work through the same contracts; a model selection change has measured support; capability and permission limits remain intact. A second runtime adapter is optional until there is a real use case and access to qualify it.

## Phase 5 — Qualified preview and production-readiness review

Run a small, operator-approved set of real tasks and publish no automatic maintainer messages. Keep a results ledger covering successful tasks, rejected approaches, escaped defects, flaky verification, operator intervention, and resource usage. Resolve findings and re-run affected evaluations.

An executable supported release requires a reviewed threat model, repeatable setup, recovery and boundary tests, dashboard/remote fault qualification, a supported-environment matrix, evidence of the two operating modes, documented limitations, artifact provenance, and explicit publication approval. The repository develops publicly from the foundation stage; notices do not waive these release criteria. Do not choose an arbitrary number of successful tasks as a substitute for assessing these criteria.

## Decisions still needed

- Actual model availability and feature access within the selected Claude Code subscription; no paid extra usage without authorization.
- Initial maximum spend/usage, concurrent workers, wall time, test resource limits, and artifact retention.
- Available execution isolation once machine cleanup is complete.
- Coordinator/worker machines, SSH access and forwarding policy, session lifetime, and the approved service lifecycle for the first remote run.
- Approval of the bounded Phase 1 brief, shared technology pins/qualification gates, and resource envelope. Later phases require their own bounded rollout plans.
