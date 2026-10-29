# Technology stack proposal

Status: recommendation for the first implementation, researched 29 October 2026. No packages have been installed, compatibility tests run, or services deployed. Exact versions and the database driver remain subject to qualification and a committed lockfile.

## Recommended stack

| Layer | Choice | Purpose in this factory |
| --- | --- | --- |
| Language and workspace | Strict TypeScript, supported Node.js LTS, pnpm workspaces | Share contracts across the browser, coordinator, CLI, and worker supervisor while keeping package boundaries explicit. |
| Web application | React, Vite, TanStack Router | Build the interactive Headquarters with nested mission pages and typed record links. Serve the built assets from the gateway in production. |
| Visual system | Tailwind CSS, Radix Primitives, selected shadcn/ui source components, Lobe Icons | Own the product's tokens and component styling; use accessible control primitives as a foundation. |
| Motion | Motion for React and CSS | Animate observed activity, panel transitions, and deliberate graph layout changes; respect reduced motion and preserve inspection. |
| Graph | React Flow with custom nodes/edges, elkjs layout in a Web Worker | Build expandable lab/task/tool views, graph navigation, and layered layout without putting layout computation on the main UI thread. |
| Client state | Zustand with normalized records and selector subscriptions | Maintain one snapshot/event projection and separate local selection, camera, filter, and replay state. |
| Gateway | Fastify on a persistent Node process | Serve UI assets, authenticated HTTP commands, artifact reads, live subscriptions, and worker transport. |
| Boundary contracts | TypeBox, JSON Schema, Ajv, shared versioned protocol package | Derive TypeScript types from canonical schemas and validate untrusted requests, events, and worker outputs at runtime. |
| Durable storage | SQLite on coordinator-local disk, explicit transactions, Drizzle schema/migrations | Store task state, approvals, evidence references, audit events, and the transactional outbox. |
| Artifact storage | Protected local content-addressed files | Retain logs, diffs, test outputs, and other evidence with access controls and digests. |
| Live transport | SSE to the browser; authenticated HTTP commands; bidirectional worker channel through SSH initially | Separate replayable observation from authorized commands. Preserve command IDs, acknowledgement states, and event cursors. |
| Agent execution | Native Claude Code plugin and qualified CLI/session/workflow interfaces | Use the operator's eligible subscription models; keep runtime-specific execution behind an adapter. |
| Observability | Durable factory event journal, OpenTelemetry export, structured correlated logs | Preserve workflow truth independently of supplemental runtime diagnostics. |
| Verification | Vitest, fast-check, Playwright, Storybook | Exercise core invariants, recovery/remote fault scenarios, browser journeys, and component/page states. |

These are implementation choices to qualify, not evidence of performance, security, accessibility, or runtime compatibility. The browser application is an authenticated interactive client; a persistent coordinator owns streams, leases, state, and recovery. This is the reason for the Vite client and dedicated gateway architecture.

## Design and graph implementation

Use shadcn/ui selectively as editable source components and Radix for control behavior. Use Lobe Icons for model/provider identities, retaining the MIT notices and pinned provenance of vendored assets; add the React package only with the approved frontend milestone. Define our own typography, spacing, surfaces, state language, graph nodes, trace timeline, evidence receipts, and approval presentation. Components still require keyboard, focus, contrast, and responsive review after customization.

React Flow owns graph interaction and rendering. ELK computes candidate node positions in a browser worker; reconcile those positions with pinned nodes, selection, expanded groups, and camera state. Re-layout only affected structure where feasible; a token or heartbeat must not trigger a full scene rearrangement. Keep Motion from competing with React Flow's viewport/node transform ownership. Profile a representative collapsed and expanded fixture before committing to graph-size limits.

The coordinator remains authoritative. A single deterministic event reducer updates normalized browser records from a consistent snapshot and ordered stream. Graph, list, communications, and trace views select those same records. Local presentation state cannot advance tasks or authorize an action. Stream replay and idempotency are factory responsibilities, not guarantees supplied by a UI library.

## Storage and execution qualification

SQLite lives only on the coordinator's local filesystem, with bounded transactions and one designated writer authority. Workers access it through the gateway. Qualify WAL settings, busy handling, checkpoints, backup/restore, full-disk failures, and transactional state/outbox writes. Drizzle supplies schema/query/migration tooling; it does not enforce the workflow's authorization or consistency invariants automatically.

Check the actual SQLite engine bundled by the selected driver, not just the JavaScript package version. SQLite documents a WAL-reset fix in 3.51.3 and later, with selected backports. Require an engine carrying that fix and inspect subsequent release notes before pinning. [SQLite WAL documentation](https://sqlite.org/wal.html).

Keep process execution in a separately qualified isolated worker environment. TypeScript, a worktree, a plugin tool allowlist, and a remote connection do not establish a sandbox. Authentication, process survival, filesystem/network boundaries, cancellation, and supported native telemetry must pass the adapter qualification before a live task.

Start with one coordinator. PostgreSQL or external object storage can be evaluated when a concrete concurrency, retention, availability, or deployment requirement warrants the additional service. That change requires explicit migration and recovery testing; it is not an assumed drop-in replacement.

## Verification and packaging

Use Vitest for core and integration behavior; fast-check for transition, message-order, lease, and approval invariants; and Playwright for mission journeys, graph interactions, reconnect/replay, and browser evidence. Storybook holds realistic component/page states for visual and interaction review. Bound test processes and resources in the approved milestone; creating this plan starts none of them.

Use a pnpm workspace with distinct web, coordinator, worker, CLI, core, protocol, and UI packages as implementation makes them necessary. Share runtime-neutral JSON contracts with the Claude adapter. Add only packages required by the current milestone; do not create empty packages to satisfy a directory diagram.

Pin supported compatible releases and record the Node runtime, lockfile, SQLite engine, browser versions, and installed Claude runtime during qualification. Review licenses and retain required notices for the exact distributed artifacts. React Flow's core is MIT licensed; elkjs carries an EPL-2.0 license. Paid examples, hosted services, or additional billing paths are separate choices.

## Primary references checked

- [Vite backend integration](https://vite.dev/guide/backend-integration.html) and [TanStack Router](https://tanstack.com/router/latest/docs/overview).
- [Tailwind theme variables](https://tailwindcss.com/docs/theme), [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction), [shadcn/ui](https://ui.shadcn.com/docs), and [Motion for React](https://motion.dev/docs/react).
- [React Flow core](https://reactflow.dev/), [built-in graph controls](https://reactflow.dev/learn/concepts/built-in-components), [elkjs worker usage](https://github.com/kieler/elkjs#usage), and [elkjs license](https://github.com/kieler/elkjs/blob/master/LICENSE.md).
- [Zustand](https://github.com/pmndrs/zustand), [Fastify type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/), and [validation/serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
- [Drizzle SQLite](https://orm.drizzle.team/docs/sqlite/get-started-sqlite) and [SQLite WAL](https://sqlite.org/wal.html).
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/), [Vitest](https://vitest.dev/guide/), [fast-check](https://fast-check.dev/docs/introduction/), [Playwright](https://playwright.dev/docs/intro), [Storybook](https://storybook.js.org/docs), and [pnpm workspaces](https://pnpm.io/workspaces).

Claude runtime/authentication research and its remaining qualification requirements are recorded in [PLATFORM_RESEARCH.md](PLATFORM_RESEARCH.md). Remote topology and protocol semantics are specified in [DASHBOARD.md](DASHBOARD.md).
