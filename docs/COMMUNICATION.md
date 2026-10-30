# Shared factory communication — v1

These are contracts for simulated workers. They do not establish malicious-process isolation or a supported live adapter.

The canonical executable schemas are in `packages/protocol/src/index.ts`: `PlanSchema`, `TaskSchema`, `EnvelopeSchema`, `EvidenceSchema` and `ActionSchema`. Unknown fields/versions, decoded duplicate JSON keys, oversized input and invalid graph references fail before dispatch. Input is bounded to 64 KiB and depth 32. Canonical hashes use sorted JSON keys and safe integers.

A worker gets only `send`, `heartbeat` and `inbox` bound to its captured mission/task/attempt/token/epoch/plan. Sender lab comes from the approved task. Operator and supervisor objects remain in trusted host code. This is a logical API boundary within one user process.

Messages carry schemaVersion, missionId, taskId, attemptId, planHash, token, producer sequence, kind, optional recipientTaskId/text/outputDigest. Supported kinds are accepted, finding, question, blocked, completed and canceled. The broker validates recipient existence in the same mission. The stable message identity is the producing attempt plus sequence; the journal cursor and task dependency input digests carry causality. The current API has no arbitrary correlation-ID or external-message transport.

Duplicate identical producer messages return the prior result; altered content conflicts. Gaps are persisted, visible and bounded to 256 messages and 8 KiB per producer. Completed reports cannot skip missing events. Only the most recent eight communications are cached in the projection; the journal retains accepted delivery history and recipient inbox replay. A future or foreign cursor fails explicitly.

The immutable plan hash, accepted version and expiry bind execution authority. A model cannot add capabilities, budget, tasks or approvals through a message. Material changes require a higher plan revision, quiescent work and fresh approval. Rework resets only the affected bounded graph; earlier attempts and failed evidence remain inspectable.

Required evidence binds target and producing attempts, independent assigned verifier, plan/input/environment/artifact digests, classification and actual fixture-function identifier/arguments. Missing, failed, skipped, blocked, canceled, inconclusive, stale or tampered receipts block delivery. No shell argv is fabricated for in-process evaluation.

All eight [lab contracts](../labs/headquarters/AGENTS.md) share this envelope. Headquarters owns operator communication. Delivery prepares exact actions; Phase 1 deliberately has no external executor. Remote authentication, model processes, skills and native agent packaging need later qualification.
