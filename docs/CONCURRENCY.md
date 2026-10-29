# Concurrent missions and task scheduling

Status: core implementation requirement, not implemented behavior. Multiple operator objectives can run simultaneously, and each mission can contain parallel tasks. A single coordinator owns authoritative state; it can supervise many concurrent workers without giving them direct database access.

## Independent missions

Each mission has a stable run ID, approved plan/hash, task graph, workspace allocation, budget/reservations, evidence, message history, and exact action approvals. Headquarters can accept and discuss several missions. Conversation replies and decision cards carry the selected mission and plan revision; free text cannot silently switch scope. Cross-mission collaboration is an explicit brokered dependency, with separately validated authority.

Evidence and artifacts carry their producing mission, task, attempt, and exact source snapshot. A similarly named check from another mission cannot satisfy a gate. Approvals bind their destination and exact payload as well as mission/plan identity. A task cannot borrow another mission's publishing approval or remaining budget.

## Shared scheduling and resource limits

The scheduler dispatches compatible ready tasks in parallel, subject to all applicable operator, host, mission, provider/model, and descendant limits. Reserve resources transactionally before dispatch and release/reconcile reservations on completion, cancellation, or lease expiry. Account for retries and nested agents. A configured worker limit is a ceiling, not a target that must be filled.

Use bounded per-mission parallelism and fair scheduling across missions, with explicit priorities and starvation prevention. A long task must not indefinitely prevent an eligible small task from starting. Priority changes do not expand authority, bypass dependencies, or preempt another mission without the operator's configured policy. Rate limits and model availability can reduce concurrency; subscription access is not unlimited simultaneous capacity and does not authorize paid fallback.

Each claim has an ownership lease, attempt identity, coordinator epoch, fencing token, and heartbeat. Expired or superseded attempts cannot promote state or artifacts. Duplicate task delivery cannot start a second active attempt under the same reservation. Keep runtime/provider requests outside database transactions; the durable claim and outbox establish ownership before execution.

## Conflicting work

- Assign isolated writable workspaces to independent mutation tasks. Read-only research can share an immutable source snapshot. Never let unrelated missions concurrently mutate the same worktree, checkout, dependency environment, or generated artifact directory.
- Acquire leases for the actual contested resource: workspace, repository/ref, migration target, deployment environment, or external action destination. Filesystem path spelling alone is not a sufficient identity; resolve aliases and bind the repository and host.
- Tasks editing the same upstream branch can develop separately, but integration/delivery requires a serialized lease, expected-state check, and refreshed evidence/approval when the resulting snapshot changes. A merge conflict creates blocked/rework work; it does not authorize discarding another mission's changes.
- Global lock order, dependency-cycle detection, expiring claims, and bounded retries prevent deadlock or endless rework. A stale lock cannot simply be ignored while its original owner may still execute; reconcile/fence it first.
- Shared caches are scoped by trust and content identity. Untrusted task output cannot poison a privileged verification or delivery environment.

## Controls and observability

Headquarters can view all missions and drill into one. The graph supports an all-missions view, mission/host/lab grouping, cross-mission dependency edges, and visible filters. Show active, queued, waiting-for-resource, rate-limited, blocked, approval-pending, cancel-requested, and confirmed terminal states separately. Resource inspectors identify the holder and waiting tasks; secrets and unrelated private artifacts remain access-controlled.

Pause/cancel applies to the selected mission or task, with command IDs and acknowledgements. It stops only owned dispatch/process trees and releases only that mission's resources. Other missions keep progressing within their bounds. A global pause/stop is a distinct operator control. Disconnect does not turn a requested cancellation into a confirmed one.

## Required qualification

Phase 1 must exercise at least two simultaneous synthetic missions and parallel tasks within a mission:

- Eligible independent tasks overlap; shared limits are never exceeded, including descendants and retries.
- A small eligible mission progresses while another is busy; priority changes remain within policy.
- Same-workspace and same-delivery-target mutations serialize; separate workspaces can proceed.
- Duplicate claims, concurrent completion, expired leases, worker partitions, and coordinator restart do not double-dispatch, double-release reservations, or accept stale evidence.
- Canceling one mission leaves the other running; a late event cannot revive canceled work.
- Messages, artifacts, checks, and approvals cannot cross mission boundaries accidentally or through hostile content.

Phase 1b must demonstrate the simultaneous missions in the graph, queue/resource inspectors, event replay, and task list. Phase 2 must measure and enforce actual runtime/provider concurrency. These are future behavioral tests; the current foundation CI does not prove them.
