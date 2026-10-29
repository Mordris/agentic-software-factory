# Instructions for developing the factory

Read README.md, docs/CHARTER.md, and the approved milestone before making changes. This file governs work **on this repository**. Instructions for factory workers and target repositories will be packaged separately; do not assume a plugin automatically loads this file.

## Current stage

Phase 0: repository foundation and public pre-alpha design. Foundation CI, policies, templates, licensed icon assets, and public documentation are authorized; runtime implementation still requires a bounded milestone. The plan is a proposal, not evidence that the engine or controls already exist. Do not start agent workers, install dependencies, launch services, or begin a target-repository pilot merely because this repository exists.

## Authority

- The operator talks to Headquarters. Internal coordination is authorized only within the approved task and budget.
- Every push, PR, external message, and deployment requires the operator's approval for the concrete action. Do not interpret plan approval as publication approval.
- Preserve other repositories, worktrees, and uncommitted changes. This repository is separate from the existing OSS workspace.
- Do not grant a worker authority to edit its policy, approvals, audit records, or runtime credentials.
- User instructions govern the requested scope. Read target-repository rules and surface material conflicts through Headquarters before submission; do not silently claim compliance.

## Engineering and evidence

- Distinguish proposed, implemented, executed, and independently verified behavior.
- Record evidence against the exact repository snapshot, command, environment, exit status, and artifact hashes. A model's statement or a PR checklist is not a test result.
- Verification must test observable requirements and realistic failure paths. Add checks proportionate to the change and broaden them when concrete failures justify it.
- Use native runtime features where they meet the contract. Keep factory state and policy portable across adapters.
- Keep role instructions concise and specific. Enforce critical invariants in code and execution boundaries, rather than relying on prompts alone.
- Keep credentials and local session data out of version control. Never reproduce private target-repository information in examples.
- Choose runtime and model capabilities from verified inventories. Record resolved model IDs; do not label an unavailable or weaker fallback equivalent.
- Select the latest stable release of each project technology from current official sources and pin exact versions. Keep shared project versions identical in local setup, CI, tests, and application output through canonical toolchain definitions, a shared workspace catalog, and one lockfile. Check actual runtime/SQLite identities and fail on drift. Report compatibility blockers; do not silently downgrade or use a moving version alias. See the proposed [Phase 1 version policy](docs/milestones/PHASE_1_CORE.md).

## Source control

Make focused, reviewable changes. Do not introduce AI co-author or generated-by trailers. Keep user-specific commit identity in local Git configuration rather than hard-coding it into the generic factory. Foundation commands: `python3 scripts/check_repository.py` and `python3 -m unittest discover -s tests -p 'test_*.py'`. These validate repository tooling, not the application. Respect the operator's resource limits; do not install dependencies or launch workloads without authorization for the relevant milestone.
