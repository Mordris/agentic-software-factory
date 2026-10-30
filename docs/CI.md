# CI scope and trust boundaries

The initial public foundation at `b9aafe2f5f0e43e6fad46071721d48ef4abcdaf6` passed [Repository CI](https://github.com/Mordris/agentic-software-factory/actions/runs/40929419275) and [CodeQL](https://github.com/Mordris/agentic-software-factory/actions/runs/40929419212). Its uploaded analyses reported zero findings; the main/tag rulesets were applied and read back. Every later revision must pass its own checks. This qualifies the repository foundation, not the factory runtime.

## Foundation and staged core pipeline

| Check | Scope |
| --- | --- |
| Foundation | Local document/image/theme-source paths, deterministic documentation artwork, safe YAML/JSON parsing, forms/labels, action/permission invariants, PR-title convention, icon provenance and SVG restrictions. |
| Tooling regressions | Invalid titles, duplicate/aliased YAML, escaping/missing paths, workflow privilege/injection regressions, checksum and archive extraction boundaries. |
| Workflow audit | actionlint validates Actions syntax/expressions; offline pedantic zizmor inspects workflow security. |
| Secret audit | Gitleaks scans all history available to the checked-out public source and redacts findings. |
| CodeQL | Static analysis of Python tooling, GitHub Actions and JavaScript/TypeScript in the staged core workflow. No target-repository code or build is executed. |
| CI gate | Runs after mandatory jobs and succeeds only when every result is `success`; failure, cancellation, and skipping do not pass. |

PRs, pushes to `main`, manual requests, and bounded weekly schedules trigger checks. Required jobs have no path filters or success fallbacks. Configure protections using actual observed `CI gate`, `Analyze (actions)`, `Analyze (python)` and `Analyze (javascript-typescript)` contexts, verified against GitHub's structured run/check results.

This pipeline does not establish factory approval enforcement, sandbox isolation, model quality, remote recovery, E2E application behavior, or release artifact integrity. The simulated core has local evidence; hosted core qualification and live execution boundaries remain unverified.

## Supply chain and credentials

- Third-party Actions use full commit SHAs, resolved from their official repositories and recorded in [action-pins.json](../.github/action-pins.json). Pinning identifies code; it is not proof that upstream code is safe.
- Audit CLI versions, official release URLs, and SHA-256 digests are in [ci-tools.json](../.github/ci-tools.json). The runner verifies bytes before reading the one regular executable; it never extracts upstream paths or links. Tools run in a temporary directory and are not globally installed.
- The staged pipeline selects exact CPython 3.15.2 through .python-version and reproducibly builds PyYAML 6.0.3 against a canonical wheel digest. The explicit Ubuntu 26.04 hosted label is checked independently of actionlint's stale built-in inventory. Hosted image/compiler identities still need execution evidence; record observed versions in actual runs rather than claiming a hermetic build.
- Default token permissions are empty. Read-only jobs receive only `contents: read`; CodeQL additionally receives `security-events: write` to upload static analysis. Checkout does not persist credentials. No project secret or publishing token is used.
- Do not run untrusted PR code on self-hosted runners, use privileged indirect PR triggers, interpolate PR text into shell scripts, share writable caches with privileged jobs, or consume untrusted artifacts in a publishing job.
- No caches, auto-merge, tag-triggered publishing, or deployment credentials are present. Dependency PR automation is disabled in the staged Dependabot configuration to preserve the operator's per-PR approval boundary. Alerts and read-only analysis are separate settings.

Review workflow, policy, downloader, and tool-pin changes as security-sensitive. A new dependency or SHA requires source/provenance, license, advisory, and regression review. Offline zizmor cannot establish current online advisory status. Scheduled runs complement, rather than replace, maintainer dependency review.

## Local validation

With an existing CPython/PyYAML environment:

```sh
python3 scripts/check_repository.py
python3 -m unittest discover -s tests -p 'test_*.py'
```

In an approved Linux x86-64 environment, audit tools can be run without global installation:

```sh
python3 scripts/ci_tools.py actionlint -color
python3 scripts/ci_tools.py zizmor --offline --no-progress --strict-collection --persona pedantic .github/workflows
python3 scripts/ci_tools.py gitleaks git --redact=100 --no-banner --exit-code=1 .
```

These last commands download and execute reviewed tool binaries. They require explicit authorization under the current operator's installation/workload constraints. No check may report success merely because its tool was unavailable.

## Core gates with executable features

CodeQL receives only a locally downloaded tarball whose canonical SHA-256 is verified before initialization. The downloader's checksum and byte-budget adverse controls run in foundation tests; the full bundle is downloaded only in approved hosted CI.

The staged core jobs are Core quality, Core qualification and Dependency review, implemented through scripts/ci_core.py. All five mandatory job results must succeed; foundation tests enumerate 3,125 combinations including absent results. The shared recipes explicitly install frozen pnpm dependencies with hooks disabled, build the exact SQLite engine, validate runtime/catalog/lock parity, check strict production/test types, enforce Biome formatting, and run actual core tests and the process restart demonstration. Full lockfile advisory/license review fails closed on missing graph or service results.

The first hosted run is recorded in the Phase 1 qualification report: all CodeQL analysis jobs completed, JavaScript reported two patch-key findings, and the repository gate rejected a reproducible wheel-permission mismatch. The local follow-up fixes remain subject to a new approved push and hosted run. Ruleset updates still require separate admin approval and actual context readback. No live model, subscription credential or Claude trial runs in CI.

The narrow actionlint filter covers only its unknown Ubuntu 26.04 diagnostic. GitHub's official image list was checked on 30 October 2026; the repository validator still rejects any different runner label, including self-hosted runners. No security audit finding is ignored.

The selected Biome 2.6.4 release was newer than the standard pnpm minimum release age at entry. Its exact packages alone are listed as age exceptions in the workspace file; integrity/graph/license/advisory checks remain active. This exception does not allow other new packages or lifecycle scripts.

## Later gates

The core milestone adds strict TypeScript checks, lint/format, invariant/property tests, database migrations, recovery and fault injection. The web milestone adds component states, accessibility, Playwright journeys, visual regressions, graph-size/update-rate budgets, and real two-machine reconnect tests. The adapter milestone adds actual runtime/model inventory, permission waits, isolated execution, cancellation, and auth/transport failures.

Before publishing any executable artifact, implement clean reproducible build inputs, an SBOM, verified provenance/digests, artifact-installation tests, scoped publishing credentials, human action approval, and rollback procedures as required by [RELEASING.md](../RELEASING.md). Do not pre-create passing placeholder jobs for these future checks.

## Repository setup and publication

Desired settings, description/topics, labels, and branch/tag rulesets are versioned in `.github`. Files do not apply GitHub settings by themselves. Verify the public repository, push only the exact approved initial commit, observe real CI, then apply and read back protections. Keep the solo-maintainer review profile explicit; requiring an unavailable independent approver would deadlock development.

Before the first push, review the entire candidate tree and its reachable history. A clean public bootstrap commit may exclude local planning history while preserving those local refs. Record the exact tree/commit and per-action approvals in private operator notes. Never force-push away existing remote work to seed the project.

## Primary references

- [GitHub secure Actions guidance](https://docs.github.com/en/actions/reference/security/secure-use).
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets).
- [CodeQL workflow configuration](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options).
- [zizmor](https://docs.zizmor.sh/usage/), [actionlint](https://github.com/rhysd/actionlint), and [Gitleaks](https://github.com/gitleaks/gitleaks).
