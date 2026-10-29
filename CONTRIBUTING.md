# Contributing

The project is in its repository-foundation stage. Runtime and dashboard work follow [the bounded milestones](docs/IMPLEMENTATION_PLAN.md); a design is not an implemented control.

## Scope the work

Read [AGENTS.md](AGENTS.md), the relevant design, existing issues/PRs, and nested instructions. Propose material scope, protocol, trust-boundary, dependency, or model-routing changes before implementation. Check current ownership. Small corrections can go directly to a focused PR.

Preserve unrelated changes and workspaces. Keep private data, credentials, transcripts, and local factory state out of commits and issues. Use synthetic fixtures. Discuss vulnerabilities through [the private process](SECURITY.md).

## Commits and PRs

Use Conventional Commit subjects: `type(scope): outcome`, with optional scope and `!` for breaking changes. Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Subjects are at most 100 characters. Describe a concrete result; use a `BREAKING CHANGE:` footer for a breaking contract or migration.

PR titles follow the same convention and become the squash-merge subject. Reviewers assess the final diff and evidence. Explain the problem, result, decisions, exact validation, and gaps using the PR template. Do not add generated-by or unsolicited co-author trailers.

Apply an appropriate type label and relevant area/status labels from [the catalog](.github/labels.json). Breaking changes also receive `breaking-change`. Labels do not waive checks.

## Foundation checks

Current tools use CPython 3.12 and PyYAML. CI installs hash-pinned wheels from [.github/requirements-ci.txt](.github/requirements-ci.txt). When that environment is available:

```sh
python3 scripts/check_repository.py
python3 -m unittest discover -s tests -p 'test_*.py'
```

These check repository policy, local document links, forms/configuration, workflow invariants, vendored assets, and tooling regressions. They do not run the planned application. CI additionally uses pinned actionlint, zizmor, and Gitleaks. See [CI.md](docs/CI.md).

Follow the operator's resource and installation constraints. Do not install tools or start services merely to satisfy this document. Record a blocked check when its environment is unavailable.

## Review and delivery

Failed, missing, stale, skipped, or canceled required checks block readiness. Tie evidence to the current snapshot and distinguish executed checks from reviewed reports. Review workflow, dependency, policy, and runner changes as security-sensitive code. New behavior needs tests that discriminate it from plausible wrong behavior; trivial docs edits do not need implementation-mirroring tests.

Changes to `main` use a PR and required checks. [GOVERNANCE.md](GOVERNANCE.md) explains the solo-maintainer profile. Agent-created pushes, PRs, external messages, and releases each need operator approval for the concrete action. Do not enable auto-merge, posting, or publishing through a contribution.

Contributions are provided under Apache-2.0. Retain third-party notices and record the origin and permitted use of imported material.
