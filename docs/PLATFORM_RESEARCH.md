# Claude Code platform research

Checked 29 October 2026. Installed CLI observed with `claude --version`: **2.1.302 (Claude Code)**. No live model run, plugin installation, native workflow, or agent team was started. Documentation statements below describe supported interfaces; they are not local behavioral qualification results.

The installed CLI was rechecked during repository-foundation work. `claude --help` lists JSON Schema output, output formats, permission modes, tool selection, and no-session-persistence options. Help also states that `--bare` does not read OAuth/keychain authentication; it must not be assumed compatible with the selected subscription access path. These are interface observations, not executed model/adapter tests. Existing sessions were not changed.

| Capability | Verified documentation | Design consequence |
| --- | --- | --- |
| Custom agents | Agent definitions support tool restrictions, model selection, effort, turn limits, skills, and worktree isolation. Unknown frontmatter may be ignored; plugin agents do not apply every project-agent field. [Reference](https://code.claude.com/docs/en/sub-agents) | Validate effective configuration in the adapter, rather than assuming YAML fields are enforced. |
| Nested delegation | Current documentation supports nested subagents with configurable depth/concurrency. [Reference](https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents) | Allow bounded specialist delegation; do not design around an outdated blanket assumption that nesting is impossible. |
| Scripted orchestration | Native JavaScript workflows coordinate agents and can be saved/reused. [Reference](https://code.claude.com/docs/en/workflows) | Evaluate native execution before building a replacement scheduler; retain factory-specific authority and evidence state. |
| Peer communication | Sessions can exchange messages subject to receiver permissions. [Reference](https://code.claude.com/docs/en/cross-session-messaging) | Internal lab communication is feasible. Record the authoritative task envelope independently of free-text messages. |
| Agent teams | Teams provide shared tasks and peer messaging, but are experimental with documented recovery/coordination limitations. [Reference](https://code.claude.com/docs/en/agent-teams) | Optional adapter strategy; not the sole foundation for durable completion. |
| Native packaging | Plugins package agents, skills, hooks, and other components. A root plugin CLAUDE.md is not automatically loaded. [Reference](https://code.claude.com/docs/en/plugins-reference#standard-layout) | Explicitly load the shared factory protocol and lab contract; avoid hidden instructions that never reach workers. |
| Skills and memory | Skills provide reusable workflows; project instruction loading has documented scope/version behavior. [Skills](https://code.claude.com/docs/en/skills), [memory](https://code.claude.com/docs/en/memory) | Package expertise separately from permanent project guidance and durable run state. |
| Structured CLI results | CLI programmatic mode supports JSON/streamed output and JSON Schema output; a result may lack structured output. [Reference](https://code.claude.com/docs/en/headless) | Validate result presence and meaning; process exit or valid JSON alone does not establish task success. |
| Policy hooks | Command/HTTP hooks can be configured to block on failures on supported versions; many failures otherwise allow the action to continue. [Reference](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails) | Test failure behavior and keep the stronger authority boundary outside worker control. |
| Model routing | Model aliases and availability vary; full IDs and provider-specific selections are supported. [Reference](https://code.claude.com/docs/en/model-config) | Discover capabilities and record resolved IDs. Avoid hard-coded prices and permanent assumptions about model families. |
| Permissions | Tool permissions and sandboxing are separate controls. [Reference](https://code.claude.com/docs/en/permissions) | Worktree isolation or a tool allowlist alone is insufficient to isolate arbitrary target-repository code. |
| Mods | Native mods can customize the Headquarters interface and tool events, but execute with user permissions and are not sandboxed. [Reference](https://code.claude.com/docs/en/plugins/mods/overview) | Defer the UI mod; never treat a mod as a worker sandbox. |
| Authentication | The Agent SDK documentation directs third-party products to supported API-key authentication instead of offering unapproved claude.ai login/rate-limit access. [Reference](https://code.claude.com/docs/en/agent-sdk/overview#get-started) | Separate a plugin used inside the operator's Claude Code session from any future independently hosted SDK product. Resolve authentication before implementation. |

## Observability research

Checked 29 October 2026:

- [Claude Desktop SSH](https://code.claude.com/docs/en/desktop#ssh-sessions) and [Remote Control](https://code.claude.com/docs/en/remote-control) have different execution locations. Explicit port forwarding and disconnected-session limitations must be qualified.
- [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage) provides telemetry and opt-in beta tracing with separate content gates. It supplements the factory event journal.
- [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) provides event IDs and reconnect; server replay, authorization, gap handling, and projections remain implementation work.
- [React Flow layout](https://reactflow.dev/learn/layouting/layouting) supports layout-engine integration. React Flow plus ELK remains a proposal, without an installed package or performance qualification.

## Qualification still required

Check the selected subscription's available models/features, effective plugin tool permissions, worktree starting revisions, hook failure modes, interruption/recovery behavior, native message delivery, output validation, and process cancellation. Research identifies interfaces; only executed qualification can establish that the adapter meets the factory contract.
