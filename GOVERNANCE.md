# Governance

Mordris is the initial maintainer. This project develops publicly as a pre-alpha experiment. Visibility is separate from runtime qualification, supported releases, and deployment approval.

## Decisions

Material changes use a reviewable issue/PR or design decision with alternatives, authority implications, acceptance criteria, and evidence. Review code, instructions, and runtime policy together when their contracts change. The maintainer decides scope and accepts changes. Contributors are accountable for correctness and provenance regardless of their tools. Follow [community conduct](CODE_OF_CONDUCT.md).

## Initial review profile

Require PRs, linear history, resolved conversations, and observed successful required checks on `main`. Use squash merge. GitHub does not count self-approval: the solo bootstrap profile requires zero formal approving reviews and records maintainer review and independent technical evidence in the PR.

When an eligible independent maintainer joins, require at least one approving review, dismiss stale approvals, and require approval for the latest push. CODEOWNERS routes review; it does not create an independent reviewer or prove a security boundary. Neither profile permits missing evidence to pass.

Protect `main` and release tags from deletion and force updates. Require check names only after observing actual runs. Seed the initial branch before enabling protections. Exceptional recovery changes need a recorded reason, exact scope, and post-action verification.

## Automation

An approved factory task permits bounded internal work. Each agent-created push, PR, external message, release, and deployment needs exact operator approval. Dependency PR automation and auto-merge remain disabled until authorized; alerts and read-only analysis may be enabled.

Follow [RELEASING.md](RELEASING.md). No tag-triggered workflow publishes automatically. Maturity claims must refer to measured qualification and supported environments.
