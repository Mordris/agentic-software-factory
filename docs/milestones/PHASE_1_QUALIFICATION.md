# Phase 1 qualification — working record

Date: 30 October 2026. Local implementation and fixture qualification are complete within the scope below. Publication and hosted qualification remain separately gated.

## Executed locally

- Strict TypeScript 7 production and test-source build, with library declarations checked.
- 47 core tests on real SQLite, including four owned subprocess SIGKILL boundaries, real contention, replay/outbox, migrations, backup/restore, artifact faults, scoped authority, ordered messages and concurrency.
- 100 generated interleavings (at most 200 commands each), plus canonical JSON/patch properties, seed 20261030.
- Six isolated deliberate invariant mutations detected. The working source/build was not mutated.
- 14 foundation/tooling tests, including all 3,125 aggregate-job result combinations.
- Complete two-mission restart demonstration: A has failed then passed independent fixture evidence, two production attempts and ends awaiting_action_approval; B ends canceled; old B epoch rejected; replay verified; zero external actions.
- Full graph: two lockfile documents, 178 packages, 178 declared-license records reconciled; OSV returned no advisory records for the resolved versions. This is metadata/advisory review, not proof of safe source or legal compliance.
- Exact executable/catalog/lockfile/CI version guard, with negative Node/catalog/CI Python controls.
- Python 3.15.2/PyYAML 6.0.3 pure wheel reproduced twice and matched the canonical SHA-256. Explicit latest SQLite source build and actual engine identity were qualified; the revised prepared-SQL probe also passed on the final canonical build recipe.
- Two authorized no-tools subscription trials using private CLI 2.1.312 and observed claude-haiku-5-5: fixed Research result independently accepted; owned cancellation exited 143. The two-run model budget is exhausted. Provider-side cancellation/billing, turn-limit exhaustion, live tool isolation and full live orchestration were not qualified.

Core V8 coverage observed 97.76% statements, 93.17% branches and 98.71% lines. Coverage includes built ESM remapped to source. It is supporting evidence; it cannot waive an unmet requirement. Uncovered paths include rare storage read errors and defensive integrity branches; same-user hostile code and real worker fencing remain outside this phase.

## Requirement evidence map

| Requirements | Main executable evidence |
| --- | --- |
| P1-01, P1-02 | check_toolchain.py; review_dependencies.py; qualify_python.py; qualify_sqlite.py; test_core_boundaries.py |
| P1-03 through P1-06, P1-15 | authority.test.ts; protocol.test.ts; isolated mutation controls |
| P1-07 through P1-09, P1-16, P1-17 | store.test.ts; concurrency.test.ts; crash-worker.mjs; artifact/ledger integrity checks |
| P1-10 through P1-14 | concurrency.test.ts; state-property.test.ts; run_bounded.py receipts |
| P1-18 | cli.test.ts; built CLI foreground subprocesses |
| P1-19 | test_foundation.py aggregate enumeration; check_mutations.py; shared CI job recipes |
| P1-20 | evals/core/run.mjs and per-run acceptance.json |
| P1-21 | qualify_claude.py and the two private trial receipts; no repeated model calls |

Private receipts live under the ignored .factory directory. Each bounded workload receipt retains argv, cwd, elapsed time, exit status, actual cgroup caps and storage observations. Native/Python receipts retain source/build identities. The private evidence index retains source/lock/recipe hashes and current receipt pointers; receipts and raw subscription output are intentionally not published.

## Live refresh qualification

Fresh metadata reported Claude Code 2.1.314 after the initial 2.1.312 trials. The operator explicitly approved two additional runs under the same no-tools, three-turn and 180-second limits. Both passed: the fixed-input result matched independently checked facts in one turn, and the owned cancellation exited 143. Requested and observed model was claude-haiku-5-5; tool and MCP inventories were empty. The original budget/receipts and unchanged probe source are preserved; the renewed runs use a separate version/source-bound approval and ledger. All four authorized runs are now consumed.

## Completion boundary

Local checks include workflow syntax/security, source secrets, current release metadata, the final native source build, explicit missing-enforcement and owned-timeout controls, frozen-install adverse controls and version parity. The matrix is qualified only for the recorded local fixture boundary. All remaining hosted and product boundaries are listed below.

Hosted Ubuntu 26.04 image/compiler compatibility, CodeQL results and required-check/ruleset updates have not been executed for this branch. No push, PR, message, deployment or repository-setting change is authorized. Remote transport, the browser dashboard, live workers, arbitrary repository execution, malicious-process isolation and production readiness are deferred.

Storage is polled every two seconds for owned project tooling/state. It is not a filesystem quota and may overshoot between observations. CPU/memory/process caps are kernel cgroup limits for local bounded workloads. Injected full-disk/I/O exceptions are labeled simulations; real write contention and process kills supplement them. No hardware power-loss claim is made.


The event allowance counts claimed attempts and accepted worker data/heartbeats. Trusted operator and supervisor control records remain available for cancellation/reconciliation. The artifact quota counts logical file bytes; its exhaustion test uses an owned sparse file and does not fill the machine's filesystem.

The frozen-lockfile adverse controls reject a stale importer and resolution from an empty offline store after SRI changes. This checks fail-closed resolution, not an npm registry compromise. Separate download-boundary tests reject changed bytes against a pinned digest.
