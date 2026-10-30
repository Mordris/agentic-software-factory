# Phase 1 — Durable core with simulated workers

Status: bounded local implementation and the two-run live qualification were approved by the operator on 30 October 2026. Local implementation and fixture qualification are complete; see PHASE_1_QUALIFICATION.md for executed results and limits. Requirements below do not imply broader production qualification. Publication remains separately gated.

## Outcome and acceptance demonstration

Build a foreground CLI that coordinates two synthetic software missions through versioned lab contracts, a durable ledger, scoped approvals, bounded scheduling, and inspectable event history. This is the state the web Headquarters will later display.

Mission A exercises Research, Production, failed independent fixture verification, and bounded rework. Mission B progresses concurrently and is canceled while active. Kill and restart the owned coordinator at controlled points. Mission A resumes to `awaiting_action_approval`; Mission B remains canceled. No external action executor exists in this milestone.

The [acceptance matrix](PHASE_1_ACCEPTANCE.md) defines the required observations, failure controls, and evidence. A green demonstration alone does not replace the boundary and recovery tests.

Add an early, separately bounded real Claude Code qualification to reduce adapter risk before Phase 2. Core failure tests remain deterministic; the live trial checks the actual selected runtime, subscription authentication, observed model, structured event/result handling, and owned-process cancellation. The two approved live trials were executed and their budget is consumed; see the qualification record.

## Scope and authority

| Included after milestone approval | Deferred to a later milestone |
| --- | --- |
| Local TypeScript implementation, project-private tool/dependency setup, synthetic fixture repositories, bounded foreground checks | Full live agent orchestration, real OSS targets, API billing or subscription changes |
| At most two bounded real Claude Code qualification runs using fixed supplied input and no model-accessible tools | Model-controlled filesystem/shell/network tools, nested agents, plugin/skill execution, live production work |
| CLI, schemas, SQLite store/migrations, scheduling, evidence references, event/outbox replay | Web application, graph, HTTP/SSE servers, SSH transport, remote authentication |
| Eight canonical lab contracts and a shared communication contract | Native Claude plugin packaging, runtime skills, experimental Agent Teams |
| Local CI changes, source and license/advisory review, local commits and exact publication previews | Pushes, PRs, external messages, deployment, releases, repository-setting changes |

Work only in this repository and newly created, explicitly owned fixture/state directories. Preserve other repositories, worktrees, machine defaults, credentials, and existing user sessions. Do not change the system Node/Python, NVM defaults, Codex-managed runtimes, global package stores, or OS packages. No container or persistent background service is needed.

Approval of this milestone authorizes local work within the envelope below. Publication retains the separate approval boundary in [the charter](../CHARTER.md). A later web or adapter milestone needs its own bounded plan.

## Version policy and shared toolchain

The operator requires the latest stable technologies with exact pins and matching shared versions in CI and the application. Treat this as an implementation requirement:

1. Refresh official release/registry metadata at implementation entry. Select the newest stable release, including major updates; exclude alpha, beta, RC, nightly, and moving version aliases. A channel named `latest` is discovery input, never a committed dependency specification.
2. Commit one canonical project toolchain definition for Node, Python foundation tooling, package managers, SQLite engine/source, and native build inputs. Local setup, CI, test subprocesses, and CLI startup consume or verify it. Generate convenience version files from it and reject stale copies.
3. Use one pnpm workspace catalog for direct package versions and one committed lockfile for the entire workspace. Shared runtime/test/build packages resolve identically wherever used. Transitive dependencies are locked to their resolved versions; incompatible transitive majors are not forced outside upstream constraints to manufacture a claim of universal freshness.
4. Assert actual runtime and executable versions, manifest/catalog agreement, lockfile consistency, and SQLite engine/source identity before checks or execution. The CLI fails with a useful version mismatch rather than running on a different Node or SQLite engine.
5. After initial resolution and review, CI installs with a frozen lockfile, reviewed registry sources, integrity checking, and lifecycle scripts disabled. Native compilation is a separate explicit step. Never run an implicit `npx` download, an unrestricted install hook, or a moving package-manager/runtime bootstrap.
6. Resolve Actions releases to full commit SHAs and validate workflows against their versioned pin catalog. Retain checksums for downloaded tooling and source archives. Record the hosted runner image identity; a hosted OS label is not an immutable image digest.
7. Recheck freshness before the implementation is presented for publication. Later upgrades update canonical pins and lockfiles together and rerun affected qualification. No unattended dependency PRs, auto-merge, or silent downgrade is authorized.

The [candidate inventory](phase-1-dependencies.json) records metadata checked on 30 October 2026, exact versions, integrity values, sources, and qualification gaps. It is a planning inventory, not an installed environment or transitive lockfile.

| Layer | Latest stable candidate checked for this brief | Qualification requirement |
| --- | --- | --- |
| Node | 26.13.0 | Same exact release in local setup, CI, checks, and CLI; record binary digest. |
| Package manager / language | pnpm 12.16.1 / TypeScript 7.0.2 | Verify native compiler/platform packages and all lockfile documents. |
| JSON boundary | TypeBox `typebox` 1.4.3 / Ajv 8.20.0 | Export JSON-only schemas; test selected dialect, static types, and strict runtime rejection together. |
| Store / migrations | better-sqlite3 prepared SQL / explicit reviewed SQL migrations | The thin Drizzle ORM wrapper was removed after its declarations failed the strict TypeScript 7 build; no library checks were disabled. The optional latest Drizzle Kit generator was omitted during entry review: its esbuild 0.18.20 dependency has GHSA-67mh-4wv8-2f99. No advisory waiver or incompatible override is used. |
| SQLite | better-sqlite3 13.0.3; target engine 3.54.1 | The driver bundles 3.53.4. Qualify a controlled build against pinned official 3.54.1 sources before adopting it. |
| Tests / formatting | Vitest and coverage-v8 5.0.5, Vite 8.3.5, fast-check 4.10.2, Biome 2.6.4 | Run production ESM output and compatible type/property/coverage checks under the selected Node. |
| Foundation tooling | CPython 3.15.2, pip 26.2.2, PyYAML 6.0.3 | No CPython 3.15 wheel is listed for PyYAML. Qualify an isolated, reproducible wheel build with pinned build dependencies. |

### Entry qualification: resolve the real compatibility gaps

The default SQLite engine inside better-sqlite3 is older than the independently selected latest SQLite release. Node's built-in SQLite also does not establish the required engine version. Do not accept the driver package version as proof of engine freshness. Review the driver's custom-amalgamation build path, compile against the pinned SQLite archive without enabling dependency lifecycle hooks, and verify `sqlite_version()`, `sqlite_source_id()`, compile options, and the loaded binary path/digest in CI and the CLI. Keep one reviewed build recipe and forbid fallback to a bundled or system library. If this fails within the envelope, return the incompatibility and options through Headquarters before implementing the store.

Migrate the existing Python 3.12 foundation profile to the exact selected Python release only after its isolated dependency build and all foundation checks pass. Pin the wheel-building inputs, disable unreviewed build dependency resolution, and record the built wheel's digest and target interpreter. If the latest Python/PyYAML combination cannot be qualified, report it; silently retaining the old interpreter does not meet the requested policy.

Review the newest available explicit hosted runner image (`ubuntu-26.04` at research time), native compiler identity, platform libraries, and Python distribution availability. Qualify it before replacing the existing `ubuntu-24.04` workflow/validator contract. Local and CI must share the selected project versions; different host OS/compiler observations remain visible. Do not claim a hermetic build or upgrade the operator's OS.

These are entry gates, not assurances that custom compilation or dependency compatibility already works. Stop on an unavailable latest release, missing provenance, incompatible schema/compiler APIs, failed advisory review, or required resource enforcement that cannot be established. Refresh pins and show any material change to scope, resources, or technology before proceeding beyond it.

### Early real Claude Code qualification

Use the operator's existing authorized Claude Code subscription. Read-only checks on 30 October observed installed CLI 2.1.302; official npm metadata reported latest stable 2.1.312. Refresh before setup and pin the selected latest release in project-private tooling. Do not update the existing installation, change its settings/login, attach to or stop existing sessions, copy OAuth credentials, or switch to an API key/provider/paid extra usage path.

First prepare the exact argv, controlled session settings, prompt/input digest, JSON output schema, model ID, process ownership, and cancellation harness. Review effective hooks, plugins, MCP, memory, background-task and settings discovery before any model request. The no-tools probe must not start inherited executables/services. If effective behavior cannot be established without changing the operator's environment, stop and report the concrete blocker. Do not use `--bare` as a shortcut: current official documentation says it bypasses subscription OAuth/keychain authentication. Do not bypass permissions.

The first live run receives a short synthetic Research task entirely through supplied input, with model-accessible tools and delegation disabled. Require a schema-valid factual result and record raw supported events, requested/observed model identity, runtime version, termination status, usage when reported, and coverage gaps. External validation checks the result against fixture facts. Do not infer tool-event coverage from a run that intentionally offers no tools.

The second run is reserved for bounded owned-process cancellation if needed; omit it when the first run's evidence already exercises the required cancellation case. Use one eligible model with an exact resolved ID, one live process at a time, at most three agentic turns and 180 seconds per run, and at most two runs total. Confirm the actual CLI accepts/enforces turn bounds; the external supervisor owns the wall-time/process limit. Authentication/rate-limit/model/usage uncertainty produces a blocked result and no automatic retry or billing fallback. Subscription usage is reported without inventing dollar costs or treating an API budget flag as proof of subscription limits.

Keep raw authentication information private and redact sensitive metadata from receipts. This is a manual, local qualification with no subscription credentials or live model calls in GitHub CI. It does not qualify a reusable Claude adapter, worker sandbox, arbitrary tool permissions, live inter-agent messaging, remote execution, model quality generally, or independent agent QA; those remain Phase 2 and later requirements.

## Deliverables and package boundaries

Create packages only when they contain working code:

| Location | Owns | Dependency boundary |
| --- | --- | --- |
| `packages/protocol` | Versioned JSON schemas, static types, IDs, bounded message/event/command shapes | No database, execution, environment access, or provider SDK. |
| `packages/core` | State transitions, plan/gate policy, broker, scheduler, budgets, lease/fencing rules | Depends on protocol and injected store/clock/adapter interfaces. |
| `packages/store-sqlite` | Schema, explicit transactions, migrations, outbox, deduplication, replay and artifact references | Only the trusted coordinator opens writable state. |
| `apps/cli` | Trusted operator commands, finite simulation, status, trace/evidence inspection, safe JSON output | Supplies operator identity from the entry point, never worker text. |
| `evals/core` | Fixed fake adapter scripts, independent fixture evaluator, process-crash harness, acceptance scenarios | Cannot load arbitrary repository commands, plugins, or model output as code. |
| `labs/<lab>/AGENTS.md` | Headquarters, Research, Architecture, Production, QA, Security, Delivery, Operations | Concise role contracts with inputs, deliverables, capabilities, handoffs, and escalation criteria. |

The shared lab protocol describes the factory organization, sender/receiver identity, task acceptance/decline, questions, findings, artifacts, rework, blocking, and completion. Each role names the versioned output schema and required evidence. Native skills and agent packaging follow in Phase 2 when the actual loader and permission behavior can be tested. This milestone does not spawn eight agents to validate eight documents.

## Core behavior

### Plans, commands, and authority

An immutable plan revision binds mission, target snapshot, task graph, writable fixture allocations, capabilities, acceptance/check IDs, budgets, and allowed transitions. Specify and test deterministic serialization before hashing. Reject unsupported JSON values, ambiguous input, unknown fields, and unsupported protocol versions. Changing bound inputs invalidates dependent plan/action approvals and evidence.

Only the trusted local operator CLI can record approval. The engine obtains the principal from the command boundary; strings such as `role: headquarters` or an `approved: true` message cannot grant authority. Fake workers have a narrow broker interface with no approval, policy-edit, ledger, or credential capability. Approval records include mission/plan identity, exact action/payload/destination, expected state, expiry, and unique single-use request ID. Test their validation without providing a live external executor.

Model the CLI commands for initialization, plan preview/approval, simulation, mission/task status, cancellation, event cursor inspection, and evidence verification. Every mutating command is version checked and idempotent. Invalid input exits nonzero with a stable machine-readable reason. Replay and status commands cannot dispatch work. Simulation requires an explicitly approved synthetic plan; initializing an empty ledger grants nothing.

### Task state, scheduling, and cancellation

Tasks distinguish planned, ready, running, resource-waiting, blocked, verification/rework, and terminal outcomes. Attempts carry their own identity, epoch, lease, fencing token, producer sequence, and reservation. Mission readiness is a projection of approved requirements and current evidence, never an arbitrary worker-supplied success flag.

Enforce dependencies and cycle rejection; capability/scope checks; global, per-host, per-provider, per-mission and descendant limits; retry/fan-out/depth limits; and transactional reservation before dispatch. Use a deterministic fair mission queue: round-robin among eligible missions of equal priority, FIFO within each priority, and bounded aging for lower priorities. Test progress under bounded task durations rather than promising preemption of arbitrary work.

Resolve fixture resource identities against a trusted root and actual host/repository allocation. Serialize conflicting writes, including path aliases. Use an explicit lock order. A task's completion, timeout, cancellation, or supersession releases its own reservations once. Do not reclaim a live writer's allocation merely because a wall clock or heartbeat is uncertain.

Cancellation is a request followed by acknowledgment/reconciliation. Stop new descendant dispatch as soon as the request commits; retain held resources until owned attempts are fenced and quiescent. Late events cannot revive canceled tasks. Canceling one mission leaves the other progressing. The fake adapter can acknowledge or deliberately delay cancellation so both states are exercised.

### Durable state, events, and recovery

Use coordinator-local SQLite with one designated authority, short explicit transactions, foreign keys, reviewed indexes/constraints, WAL, and `synchronous=FULL`. Read back effective settings. Claim authority through transactional leases/epochs and reject a second live coordinator; expired epochs cannot write. A production worker boundary remains a Phase 2 requirement.

Commit the state change, audit event, resource changes, and outbox entry atomically. Deliver outbox records at least once; deduplicate by stable IDs and producer sequences. A gap is a visible incomplete projection; bounded buffering or explicit resynchronization prevents silent reordering. Timestamps are observations; committed sequence/cursor defines authoritative ordering. Use coordinator-owned time for leases, monotonic elapsed time within a process, and conservative reconciliation after restart or a detected wall-clock jump; worker timestamps cannot expire another owner's lease.

Create snapshots with their matching committed cursor in a consistent read transaction. Replay from that cursor must converge to the same projection, including after duplicate delivery and restart. Record stream/version identity so an old cursor cannot attach to a different ledger unnoticed. CLI replay is sufficient here; SSE and remote buffering follow in Phase 1b.

Exercise kills immediately before/after transaction commit and outbox publication. Inject busy/full-disk/I/O faults through a storage seam and label them as injected; supplement with real SQLite contention, real subprocess death, reopening, integrity checks, backup/restore, and migration tests. Do not fill the operator's actual filesystem. Process-crash tests do not prove power-loss or hardware durability.

### Evidence and quality gates

Trusted fixture evaluation records mission/task/attempt, plan revision, exact fixture snapshot/input digest, required check ID, environment/toolchain, exact invocation, start/end, exit/termination status, result classification, and artifact digest. Preserve producer provenance and distinguish a worker claim from an independently executed fixture check. This logical separation in a local test harness does not establish isolation against malicious same-user code.

Content-addressed artifacts are size limited and written inside owned storage: temporary write, digest check, file flush, atomic rename/directory flush, then database reference commit. A crash may leave an unreferenced artifact, never a trusted reference to incomplete bytes. Reject traversal, unsafe links, missing files, tampering, and cross-mission receipt substitution. Retain failed evidence. No implicit deletion of unrelated or operator-owned data is permitted.

Every required current check must be `passed` for the matching inputs. Failed, missing, skipped, blocked, canceled, inconclusive, wrong-snapshot, or stale results prevent readiness. Required QA failure creates bounded, explicit rework with failed criteria; a later valid check supersedes it with history retained. Readiness stops at the exact delivery preview/approval boundary.

## Threat boundary for this milestone

| Threat | Required control and evidence | Qualification limit |
| --- | --- | --- |
| Worker message impersonates operator or edits scope | Trusted principal binding, narrow broker, immutable plan revisions; rejection tests | Same-user filesystem compromise is outside this fake-worker boundary. |
| Work/evidence/approval leaks between missions | Mission-scoped references, destination/digest checks, isolated allocations | No multi-user or remote authentication claim. |
| Duplicate, delayed, or stale worker outcome advances state | Transactional deduplication, sequence handling, lease/epoch fencing | No live remote process fencing claim. |
| Crash loses event or releases capacity twice | Atomic state/outbox/reservation changes and process recovery tests | No hardware power-failure claim. |
| False verification promotes delivery | Trusted fixture receipts, input digests, fail-closed gates, deliberate wrong implementations | Independent live agent QA follows in later phases. |
| Artifact or fixture escapes its root | Owned paths, safe resolution/write policy, link and tamper tests | No arbitrary target-repository execution or sandbox certification. |
| Dependency or native build changes versions/authority | Exact shared pins, reviewed sources/scripts, explicit build, full lockfile advisory/license inventory | Metadata and advisory absence do not prove safe code. |

## Approved resource envelope

| Resource | Ceiling / policy |
| --- | --- |
| Factory-initiated model work / paid APIs | At most two approved standalone Claude Code qualification runs, one at a time, at most three agentic turns and 180 seconds each; no tools/delegation. All core tests use fake workers. No API billing, paid extra usage, or billing change. |
| Test/build CPU and memory | At most two CPU equivalents and 4 GiB aggregate for owned work; at most two test workers. Establish and observe process-group limits before workloads. A V8 heap flag alone is insufficient. |
| Fixture scheduler | At most two missions, three active fake attempts globally/host/provider, two per mission; descendants and retries share these limits. |
| Work graph | At most 64 tasks per mission, fan-out 4, delegation depth 2, two attempts per task; rework consumes the same bounded graph/attempt budget. |
| Automated execution time | At most 15 minutes per install/build/check invocation and 60 minutes cumulative before review; a subprocess-crash case has a 120-second timeout. No watch mode, soak test, automatic endless retries, or benchmark service. |
| Storage | At most 4 GiB new project tooling/dependencies/state; require 10 GiB free before setup. Monitor owned footprint and stop growth at the budget. No claimed filesystem quota without an enforced quota. |
| Event/artifact bounds | At most 64 KiB per message/event, 100,000 events per mission, 256 buffered gap events per producer, 8 MiB per artifact, 128 MiB evidence per mission. Reject before accepting oversized inputs. |
| Network | Setup/review: approved upstream registries, release/source/checksum endpoints, and advisory services. The approved live trial additionally needs native Claude authentication/inference endpoints. The fake adapter exposes no application network operation. This is not an OS sandbox claim. No optional telemetry export or publishing. |
| State/evidence retention | Ignored, operator-owned `.factory/` state. Preserve final review/failure evidence; clean only explicitly owned temporary files. No automatic retention service. |

Latest Python and SQLite source builds may need toolchain work. Read-only preflight must confirm the compiler, headers, native libraries, interpreter distribution, and resource controls needed for the exact recipe. If an OS package, privileged change, container, additional service, wider network access, or larger budget is needed, return that concrete change for review. Do not alter existing user workloads to make capacity.

## Implementation order and CI

| Increment | Reviewable result | Exit before moving on |
| --- | --- | --- |
| 1. Shared versions and entry qualification | Canonical toolchain/catalog, exact lockfile, latest-version source/build receipts, foundation migration | Latest runtime/engine combination works locally; dependency/build policy and resource checks pass. |
| 1a. Early real Claude qualification | Exact live probe recipe and local evidence from at most two bounded calls | Authorized subscription path, observed model/output, and owned cancellation are checked; incompatible or unavailable behavior is reported before adapter work. |
| 2. Contracts and authority | Protocol, lab documents, approved plan/command/gate rules | Schema, impersonation, scope and cross-mission negative tests pass. |
| 3. Durable ledger and recovery | Migrations, transactions, outbox, receipts, consistent replay | Real SQLite/process-crash and injected failure controls pass. |
| 4. Scheduler and fake adapter | Reservations, fairness, conflict handling, cancellation, finite CLI | All concurrency and stale-attempt requirements pass. |
| 5. Acceptance and delivery preparation | Two-mission demo, evidence index, local checks, exact change/publication preview | Every applicable acceptance ID has evidence; gaps prevent completion. |

Extend current CI with mandatory `Core quality`, `Core qualification`, and `Dependency review` jobs. Quality runs shared-version/lockfile checks, strict types, Biome, and production build. Qualification runs fixed acceptance cases, bounded property tests, coverage reporting, real database/process recovery, and the production CLI demonstration. Dependency review covers the resolved graph, licenses, explicit native builds, and advisories; an unavailable scanner or unparsed lockfile is a blocked gate. pnpm 12 can use a multi-document lockfile: prove the scanner reads the complete graph with a known-finding fixture, rather than accepting an empty report.

Add all mandatory jobs to the fail-closed `CI gate` and test all success/failure/skipped/canceled combinations. Extend CodeQL to `javascript-typescript` while retaining Python/Actions analysis; pin the selected CodeQL bundle as well as the Action. Preserve empty default token permissions, GitHub-hosted runners, full-SHA Actions, bounded jobs, no persisted credentials or privileged PR triggers/caches, and no publishing secrets. Disable setup-node's implicit package-manager caching. Changes to runner/version validation are security-sensitive and require their own regressions.

Run the same root commands in local verification and CI: planned `pnpm check:versions`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:core`, and `pnpm test:acceptance`. Implement and document these commands before claiming they exist. Record toolchain/lock/source identities, exact argv, exit statuses, resource observations, test counts/seeds, failed controls, and artifact hashes. Coverage is supporting evidence, not a substitute for required failure scenarios.

Local completion ends with a reviewed diff, precise validation record, documented limitations, and an exact push/PR preview. Hosted CI and branch-protection changes can be qualified only after separate approval for publication/admin changes; do not report them executed from local results.

## Sources and current verification limits

Checked: official [Node release index](https://nodejs.org/dist/index.json) and [26.13.0 release](https://nodejs.org/en/blog/release/v26.13.0); [Python 3.15.2](https://www.python.org/downloads/release/python-3152/) and [PyYAML files](https://pypi.org/pypi/PyYAML/6.0.3/json); version-specific npm metadata in the candidate inventory; [better-sqlite3 build guidance](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/compilation.md); [SQLite 3.54.1](https://sqlite.org/releaselog/3_54_1.html); [pnpm installation](https://pnpm.io/cli/install) and [supply-chain controls](https://pnpm.io/supply-chain-security); [Vitest requirements](https://vitest.dev/guide/); and [hosted image inventory](https://github.com/actions/runner-images#available-images).

The live-probe proposal additionally checks the installed CLI's version/help, [official programmatic CLI guidance](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference), and [version-specific Claude Code registry metadata](https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.312). Documentation and help are not evidence of effective local authentication, limits, or permission enforcement.

Registry metadata, declared licenses, integrity strings, and direct-package advisory responses were inspected. This paragraph described the planning snapshot. Implementation now uses toolchain.json, the workspace catalog and both lockfile documents. Actual results and remaining gaps are tracked in PHASE_1_QUALIFICATION.md; the candidate inventory remains dated research.
