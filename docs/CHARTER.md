# Factory charter

Status: proposal for operator review. Created 29 October 2026.

## Product

Build a professional, agentic development organization that accepts a software objective, researches it, implements an approved plan, and returns a verified, reviewable result. The operator communicates with Headquarters instead of managing every specialist. The system must support different kinds of software work; OSS contribution rules belong to a mode, not to the core engine.

Autonomy means choosing and completing useful steps inside an explicit scope. It does not mean unlimited permissions, continuous spending, invisible side effects, or guaranteed correctness. Completion is assessed against concrete acceptance criteria with evidence and stated coverage gaps.

## Required behavior

1. Headquarters translates the request into outcomes, exclusions, acceptance criteria, resource bounds, and an approval boundary. The operator approves this plan before lab execution.
2. Research establishes facts, uncertainties, current source state, project conventions, and reproductions where permitted. It can invalidate a plan's premise.
3. Labs delegate bounded subtasks and communicate findings without asking the operator to relay messages. Decisions and accepted artifacts persist outside conversation context.
4. Production changes only its allocated workspace. Independent QA evaluates the resulting behavior and returns failures to Production. Required failures prevent promotion.
5. The factory selects models according to required capabilities, uncertainty, change impact, observed performance, availability, and budget. It records why it selected or changed a model.
6. Headquarters presents delivery evidence and a concrete action for approval. Each push, PR, external message, and deployment requires its own approval.
7. Interrupted work can resume without losing task ownership, forgetting decisions, reusing stale verification, or duplicating external actions.
8. Maturity is demonstrated through controlled runs, failure tests, and measured outcomes before broader autonomy or public release.
9. The operator can observe the whole managed factory live from a Headquarters dashboard, including remote execution. Every supported task, tool invocation, internal communication, approval, and evidence transition is traceable. Missing coverage or connectivity is visible; the interface never invents current status.
10. Headquarters can coordinate multiple concurrent missions and parallel tasks within each mission. Plans, workspaces, evidence, messages, and approvals remain scoped; shared budgets, resource limits, fairness, and conflict leases constrain dispatch. Canceling one mission must not disrupt another.

## Initial decisions

| Decision | State |
| --- | --- |
| Repository | `Mordris/agentic-software-factory`, public pre-alpha |
| First runtime | Claude Code |
| First mode | OSS contribution |
| Human interface | Headquarters conversation and live dashboard; no need to manage individual labs |
| Execution topology | Local or remote; a designated coordinator owns durable state independently of the viewer |
| Execution authority | Approved plan permits autonomous local work |
| External authority | Separate approval for every push, PR, external message, and deployment |
| Model authentication | Operator's Claude Code subscription; select among its available, authorized Claude models |
| Initial spend and resource limits | To be set before the first live agent run |
| Distribution/license | Public development; Apache-2.0 |

## Communication

Headquarters reports decisions, meaningful changes, blockers with options, and completed results. It should not ask the operator to approve routine reversible steps already covered by the plan. Other labs do not independently contact the operator or external maintainers.

An internal request is not new authority. It carries the originating task's scope, plan revision, permissions, and remaining budget. Requests beyond those bounds return to Headquarters. Material changes to scope, acceptance criteria, cost, or external effects require a revised plan.

## Modes and extensions

Modes supply domain-specific stages, evidence requirements, and playbooks. Initial examples are OSS contribution, application feature, maintenance, and incident investigation. Start by implementing OSS mode only, then demonstrate a second mode without changing the core authority model.

Extensions can add specialist skills, repository integrations, or interface features. The native web dashboard is the primary visual interface. Claude Code mods can later expose a compact view of the same state. Extensions must declare capabilities and cannot quietly weaken policy or inherit delivery credentials.

## Initial exclusions

Do not start with a hosted multi-tenant service, a marketplace, automatic public posting, unrestricted self-modification, or unsolicited continuous background activity. These are separate product decisions. The first release includes a dependable workflow and visual Headquarters. Remote runtimes and monitoring services are started only in an approved environment and resource envelope.
