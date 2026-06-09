# Codex Agent Threads vs Orchestrator Agents Tab

Date: 2026-06-01

## Purpose

This doc is a product and implementation spike for making Orchestrator's agent experience much closer to Codex's agent-thread experience while keeping Orchestrator provider agnostic.

The important correction: Codex does expose agent threads in the workbench. The Codex experience is not a standalone "Agents diagnostics" tab. It is a child-thread-first model where background agents are real conversations with parent-thread metadata, compact composer-adjacent progress, and workbench navigation into the child thread.

Orchestrator's current `Agents` tab is useful, but it is mostly an event inspector and runtime diagnostics surface derived from normalized events. That difference is why it feels weird beside Codex.

This is not a final parity certificate. The findings below come from static inspection of the installed Codex app bundle/binary and Orchestrator source. Live Codex screenshot and interaction proof is still needed before closing visual parity.

## Evidence Map

Codex evidence inspected:

- Installed app: `/Applications/Codex.app`
- Version metadata: `CFBundleShortVersionString=26.527.60818`, bundle version `3437`
- Extracted renderer bundle: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/codex-asar-17LUnO`
- Key renderer chunks:
  - `webview/assets/is-subagent-conversation-Tg4-cSB_.js`
  - `webview/assets/use-is-background-subagents-enabled-B-qVM3aT.js`
  - `webview/assets/app-server-manager-signals-Bpaj8VHp.js`
  - `webview/assets/composer-CwxGJF3C.js`
  - `webview/assets/local-conversation-page-HMTXjHzD.js`
  - `webview/assets/local-conversation-thread-CEeZyOcp.js`
  - `webview/assets/thread-side-panel-tabs-0taJBXa6.js`
  - `webview/assets/thread-side-panel-tabs-CsbLKllS.js`
  - `webview/assets/agent-settings-JQpLrZ9i.js`
  - `webview/assets/external-agent-import-step-CGZp2Ny8.js`
- Codex binary strings:
  - `core/src/tools/handlers/multi_agents/close_agent.rs`
  - `core/src/tools/handlers/multi_agents/resume_agent.rs`
  - `core/src/tools/handlers/multi_agents/wait.rs`
  - `core/src/tools/handlers/multi_agents/spawn.rs`
  - `core/src/tools/handlers/multi_agents_v2/assign_task.rs`
  - `core/src/tools/handlers/multi_agents_v2/list_agents.rs`
  - `core/src/tools/handlers/multi_agents_v2/send_message.rs`
  - `thread_spawn_edges`
  - `parent_thread_id`, `child_thread_id`, `agent_nickname`, `agent_role`

Orchestrator evidence inspected:

- `src/renderer/src/components/Session/ContextSidebar.tsx`
- `src/renderer/src/components/Session/EventInspectorPanel.tsx`
- `src/renderer/src/components/Session/RunningAgentsStrip.tsx`
- `src/types/activityView.ts`
- `src/main/providers.ts`
- Existing docs:
  - `docs/codex-side-panel-ui-parity-audit.md`
  - `docs/codex-appserver-support-matrix.md`
  - `docs/orchestrator-source-of-truth.md`

Confidence labels used below:

- Confirmed from Codex renderer: directly observed in extracted minified renderer chunks.
- Confirmed from Codex binary: directly observed in binary strings. It proves shipped concepts and field names, but not exact live UI behavior.
- Confirmed from Orchestrator source: directly observed in current repository source.
- Inferred: likely behavior from nearby minified flow, requiring live proof.

Target provider surfaces for this design:

- Codex app-server.
- Claude Agent SDK and Claude Code background sessions.
- Cursor CLI and Cursor SDK.
- GitHub Copilot SDK and Copilot cloud agent.
- Google Antigravity SDK once an Orchestrator adapter is added.
- Future provider SDKs/CLIs that can expose sessions, runs, subagents, tasks, or stream events.

## Executive Summary

Codex treats background agents as child conversations.

- A subagent conversation is identified by `source.subAgent.thread_spawn` metadata with `parentThreadId`, `depth`, `agentNickname`, and `agentRole`.
- Parent turns contain `collabAgentToolCall` items that reference receiver child thread ids and agent states.
- The composer can show a compact background-agent summary, expand rows, show status labels, show diff stats, stop all subagents, and open a child thread.
- The conversation page and thread model can open those background agents as real workbench threads, not just inspect event payloads.

Orchestrator treats agents as derived activity nodes.

- The `Agents` workbench tab appears when event UI is active or live/open agent nodes exist.
- It derives `AgentNode` objects from normalized events, historical messages, and a heuristic that marks tool names containing `agent`, `subtask`, or exactly `task`.
- The panel is titled `Agent Activity` and spends a lot of its first screen on session context, runtime issues, raw transport log snippets, recent events, event detail JSON, and copy/add-to-chat actions.
- There is a small composer-adjacent `RunningAgentsStrip`, but it only shows live derived pills and does not model Codex-like background child threads.

Target direction:

- Keep Codex as the interaction reference: compact progress near the composer, agent rows that open real child work, and a workbench view centered on child threads.
- Do not make the data model Codex-only. Build a provider-neutral Agent Thread Graph that Codex, Claude, Cursor, Copilot, and future providers can all project into.
- Preserve the current diagnostics only as an advanced/details mode on the same Agent Threads surface. They are useful, but they should stop being the main agent experience.
- Avoid a permanent in-between UI. The product should have one clean Agent Threads experience, with provider adapters deciding which thread, status, transcript, and action fields can be populated.

## Codex Model

### Primary Object: Child Thread

Status: Confirmed from Codex renderer and binary.

Codex's renderer identifies a subagent conversation from thread source metadata. The key shape is:

```ts
source.subAgent.thread_spawn = {
  parentThreadId,
  depth,
  agentNickname,
  agentRole
}
```

The helper in `is-subagent-conversation-Tg4-cSB_.js` checks whether a conversation source has a non-null `parentThreadId`. In other words, a Codex agent is not just a tool card or an event. It is a conversation whose source points back to a parent thread.

The binary also contains persistence and event strings for:

- `thread_spawn_edges`
- `parent_thread_id`
- `child_thread_id`
- `agent_nickname`
- `agent_role`

That strongly indicates the parent-child graph is durable state, not a renderer-only decoration.

### Parent Turn Membership

Status: Confirmed from Codex renderer.

Codex maps `collabAgentToolCall` items with fields including:

- `id`
- `tool`
- `status`
- `senderThreadId`
- `receiverThreadIds`
- `receiverThreads`
- `prompt`
- `model`
- `reasoningEffort`
- `agentsStates`

The renderer updates conversation state when receiver thread data arrives. Parent turns are therefore linked to one or more child thread ids, and child thread details may arrive incrementally.

### Composer Background Agents Panel

Status: Confirmed from Codex renderer, exact visual layout needs live proof.

Codex's composer chunk contains a background-subagents surface with strings and behavior for:

- Summary count: `{count, plural, one {# background agent} other {# background agents}}`
- Hint text: `(@ to tag agents)`
- Expand/collapse controls
- Stop-all tooltip: `Stop all subagents in this chat`
- Status labels:
  - `is working`
  - `is awaiting instruction`
  - `is done`
- Per-agent rows that can open a thread via `onOpenThread`
- Diff stats through `linesAdded` and `linesRemoved`
- Agent membership built from `collabAgentToolCall`, `receiverThreadIds`, `agentsStates`, spawn model, parent turn key, and child conversation status

This is the closest Codex analogue to Orchestrator's `RunningAgentsStrip`, but Codex's version has richer graph semantics and actions.

### Workbench Navigation

Status: Confirmed from Codex renderer, exact UI route needs live proof.

Codex's local conversation page passes `onOpenBackgroundAgent` through the summary panel. The child thread can be opened from the parent conversation's agent row.

The child conversation header/title also uses subagent metadata:

- Agent nickname
- Agent role
- Model
- Reasoning effort
- Parent thread relationship

This makes the child-agent identity visible in the conversation itself, not only in a diagnostic side panel.

### Recursion And Child Discovery

Status: Confirmed from Codex renderer.

Codex recursively finds child threads using:

- `thread/list`
- `source.parentThreadId`
- `collabAgentToolCall.receiverThreadIds`

It builds child memberships and statuses from both parent and child conversations plus `agentsStates`. This matters because a robust Orchestrator implementation should not rely only on the parent event stream when a provider has a real child-thread list/read API.

### Native Multi-Agent Actions

Status: Confirmed from Codex binary strings, live behavior needs proof.

The Codex binary contains handlers and events for both older and v2 multi-agent flows:

- Spawn
- Wait
- Close
- Resume
- Assign task
- List agents
- Send message

It also includes configuration strings for:

- `features.multi_agent_v2.max_concurrent_threads_per_session`
- `agents.max_threads`
- `agents.max_depth`
- multi-agent wait timeouts

Observable event names include:

- `CollabAgentSpawnBegin`
- `CollabAgentSpawnEnd`
- `CollabAgentInteractionBegin`
- `CollabAgentInteractionEnd`
- `CollabWaitingBegin`
- `CollabWaitingEnd`
- `CollabCloseBegin`
- `CollabCloseEnd`
- `CollabResumeBegin`
- `CollabResumeEnd`

Observable field names include:

- `new_thread_id`
- `new_agent_nickname`
- `new_agent_role`
- `receiver_thread_ids`
- `receiver_agents`
- `receiver_thread_id`
- `receiver_agent_nickname`
- `receiver_agent_role`
- `agent_statuses`
- `active_transcript`

Orchestrator should model these as optional capabilities. Providers that cannot stop/resume/wait/send to child agents should still show the thread graph, but actions must render as unavailable with a reason.

## Orchestrator Today

### Agents Tab Availability

Status: Confirmed from Orchestrator source.

In `ContextSidebar.tsx`, the `Agents` tab is available when any of these are true:

- `ui?.showEvents`
- `hasOpenAgent`
- `hasLiveAgent`

The tab uses label `Agents`, icon `agents`, count `agents.length`, and a shimmering state when a live agent exists.

The tab body renders:

```tsx
<EventInspectorPanel session={session} embedded activeAgentId={ui?.activeAgentId ?? null} />
```

### Event Inspector Shape

Status: Confirmed from Orchestrator source.

`EventInspectorPanel.tsx` computes:

- `events` from `eventBuffers[session.id]`
- `rawLog` from `rawBuffers[session.id]`
- `agents` from `deriveSessionAgentNodes(session, events)`
- `visibleAgents` from open/pinned agent ids or all agents
- `selectedAgent` from active id or latest visible agent
- `stats` from `agentStats(agents)`

When not embedded, it titles the panel:

- Title: `Agent Activity`
- Subtitle: `Subagents, side tasks, and transcript handoffs.`

In the workbench embedded path it still renders the same inspector content, just without the outer header.

Major sections today:

- Agent overview stats: active, waiting, done, failed
- Session context with provider/model/workdir/status/message/event/agent metrics
- Copy session context
- Add session context to chat
- Runtime issues
- Runtime failure grouping
- Copy failure group
- Add failure group to chat
- Transport log snippets from raw buffers
- Copy transport log
- Add transport log to chat
- Recent activity search and filters
- Event detail
- Copy raw event payload
- Add event payload to chat
- Open approval/question in chat
- Selected agent transcript
- Selected agent timeline

This is solid operations tooling. It is not yet a Codex-like agent-thread workbench.

### Derived Agent Model

Status: Confirmed from Orchestrator source.

`src/types/activityView.ts` derives `AgentNode[]` from:

- `agent.started`
- `agent.updated`
- `agent.completed`
- `agent.failed`
- `agent.text.delta`
- `agent.text.completed`
- `tool.started` if the tool name looks agent-like
- `tool.completed` if the tool id already belongs to a derived agent
- `run.failed`, which fails any active derived agents

It also derives historical agents from `tool_use` and `tool_result` messages.

The current heuristic:

```ts
normalized.includes('agent') || normalized.includes('subtask') || normalized === 'task'
```

This is provider-friendly in the sense that it catches generic agent tools, but it is not a thread graph. It cannot faithfully represent Codex child conversations, parent turn membership, or provider-native child thread actions unless those are added to the normalized model.

### Current Codex Parser Gap

Status: Confirmed from Orchestrator source.

`src/main/providers.ts` handles Codex `collabAgentToolCall`, but currently collapses it into a single agent lifecycle event:

```ts
agent: {
  id,
  providerId: 'codex',
  sessionId: stringValue(item.senderThreadId) ?? '',
  name: stringValue(asRecord(item.tool)?.type, item.tool),
  role: stringValue(item.prompt),
  status,
  model: stringValue(item.model)
}
```

Important Codex fields that are not preserved in the normalized agent event today:

- `receiverThreadIds`
- `receiverThreads`
- `agentsStates`
- `reasoningEffort`
- `senderThreadId` as parent-thread identity rather than just session id
- `source.subAgent.thread_spawn` child metadata
- `agentNickname`
- `agentRole`
- `depth`
- parent turn key
- diff stats
- native action capability hints

This is the main data-model reason Orchestrator cannot yet feel like Codex's agent thread experience.

### Composer Live Strip

Status: Confirmed from Orchestrator source.

`RunningAgentsStrip.tsx` renders when derived agents have one of:

- `queued`
- `running`
- `waiting`
- `blocked`

It shows:

- A `Live` label
- One pill per live agent
- Status dot
- Agent name
- Status text
- Active selection state

This is a good starting affordance, but it differs from Codex in important ways:

- It only shows live statuses, not done child threads.
- It does not summarize background agents with Codex-style count and `@` hint.
- It does not show diff stats.
- It does not have Stop all.
- It selects a derived node in the inspector instead of opening a real child thread.
- It depends on `AgentNode` derivation rather than an agent-thread graph.

## Difference Matrix

| Area | Codex | Orchestrator today | Desired Orchestrator direction |
| --- | --- | --- | --- |
| Primary object | Child conversation/thread with parent metadata | Derived `AgentNode` from events/messages/tools | Provider-neutral `AgentThread` backed by provider thread ids when available |
| Primary surface | Composer background-agent panel plus child thread navigation | Right workbench `Agents` event inspector | Composer panel plus workbench `Agent Threads` view |
| Mental model | "These background agents are working in child threads" | "Here is runtime activity involving agents" | "These are linked agent threads; details are available when needed" |
| Parent-child graph | `parentThreadId`, depth, spawn edges, receiver thread ids | Optional `parentAgentId`, mostly local derivation | Durable `AgentThreadGraph` with parent session/thread/turn edges |
| Parent turn linkage | `collabAgentToolCall` links receiver threads and states | Collapsed to one agent lifecycle event | Preserve parent turn key, provider item id, receiver memberships |
| Child open action | Rows can open background agent thread | Agent tabs select local derived node | Rows open child thread or preview if provider lacks thread read |
| Status | Built from child status and `agentsStates` | Derived lifecycle/status from events | Normalized status plus provider status detail |
| Done agents | Still represented as child threads | Mainly visible in inspector, strip hides completed agents | Show completed child threads in workbench, compact composer may keep recent done agents |
| Waiting state | `is awaiting instruction` | `waiting`/`blocked` status if emitted or inferred | Show provider-neutral waiting reason and action if reply/send supported |
| Diff stats | Rows can show `linesAdded`/`linesRemoved` | No first-class per-agent diff stats in Agents tab | Add optional `diffStats` to `AgentThreadProgress` |
| Stop controls | Stop all subagents exists in renderer | Stop/interrupt is session/turn oriented, not per-agent graph | Capability-gated stop all and stop agent actions |
| Resume/wait/send | Native concepts exist in Codex binary | Not modeled as agent-thread capabilities | Capability-gated actions per provider |
| Header identity | Child conversation shows nickname/role/model/effort | Agent tab/name/role in inspector only | Child thread header/title suffix and row metadata |
| Persistence | Parent-child spawn edges appear durable | Events/raw buffers/session messages | Store normalized graph and provider raw payload links |
| Discovery | Agent panel near composer, thread graph from provider list/source | Agents tab appears on live/open/showEvents | Always discoverable Agent Threads entry, with empty/provider-unavailable states |
| Diagnostics | Raw details are not the default agent UX | Raw details are central | Diagnostics as `Details`/`Runtime` disclosure inside the same Agent Threads view |
| Provider fit | Codex-specific protocol and UI | Provider-neutral event model but shallow Codex projection | Provider-neutral graph plus provider adapters |
| Accessibility | Needs live audit | Some controls have labels, filters, status regions | Preserve labels, keyboard nav, unavailable action reasons, live regions |
| Verification | Bundle/binary inspected, live UI proof pending | Source inspected, local smokes exist for older inspector | Fixture replay, UI smoke, provider live proof, screenshot comparison |

## Provider Grounding

The implementation should be grounded in what each provider can actually emit or control. The important product decision is that Orchestrator should still render one Agent Threads surface. Provider differences belong in adapter data and capability flags, not separate backup UIs.

Required first-class adapters:

- `codex-app-server`
- `claude-agent-sdk`
- `cursor-cli`
- `cursor-sdk`
- `github-copilot-sdk`
- `google-antigravity-sdk`

Adapters can ship at different depths, but they should all target the same `AgentThreadGraph` contract.

### Claude Code / Claude Agent SDK

Status: strong fit for Agent Threads.

Official sources:

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude agent view](https://code.claude.com/docs/en/agent-view)
- [Claude agent teams](https://code.claude.com/docs/en/agent-teams)
- [Claude headless/programmatic usage](https://code.claude.com/docs/en/headless)

What we can ground in official docs:

- The Agent SDK exposes the same tools, agent loop, and context management that power Claude Code, available in Python and TypeScript.
- SDK subagents can be defined programmatically with per-agent prompts, tools, model, and isolated context. Claude invokes subagents through the `Agent` tool.
- Claude subagents are own-context workers that return results to the main agent. They are not always separate background sessions.
- Claude Code also has `claude agents`, a background-session view for many full Claude Code sessions. Each background session is a full conversation that can keep running detached, be peeked, replied to, attached, stopped, respawned, removed, and listed as JSON.
- `claude agents --json` prints live background sessions with process/session fields such as `pid`, `cwd`, `kind`, `startedAt`, `sessionId`, `name`, and `status` when set.
- Agent view groups sessions by state such as needs input, working, completed, failed, stopped, and ready for review. It supports pinning, renaming, reordering, stopping, deleting, peeking, replying, attaching, and dispatching.
- Claude agent teams are experimental but closer to Codex multi-agent threads: separate Claude instances with own context, direct inter-agent messaging, task assignment, teammate shutdown, and centralized management.

Adapter implication:

- Claude should not be treated as only tool-derived activity. It has two real agent shapes:
  - `claude-background-session`: a first-class session/thread row with attach/peek/reply/stop/logs and durable local state.
  - `claude-subagent`: an in-session child worker with own context and `Agent` tool identity. It can be shown as an Agent Thread row, but its transcript/action depth depends on what the SDK stream exposes for that invocation.
- Claude agent teams can become richer child-thread/team rows behind an experimental capability once Orchestrator intentionally supports that mode.

Minimum useful fields:

- Identity: session id or `Agent` tool call id; name/agent name; cwd; kind.
- Status: working, needs input, completed, failed, stopped, idle where available.
- Transcript handle: attach/logs for background sessions; embedded result/progress for subagents.
- Actions: attach/open, peek/reply, stop, respawn, remove for background sessions; selected/completed/failed visibility for SDK subagents; team actions only when experimental mode is enabled and proven.

### GitHub Copilot SDK / Copilot Cloud Agent

Status: strong fit for in-session subagent tree; separate fit for hosted cloud-agent sessions.

Official sources:

- [Copilot SDK custom agents and sub-agent orchestration](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents)
- [Copilot SDK and CLI compatibility](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/sdk-and-cli-compatibility)
- [Copilot cloud agent overview](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- [Copilot cloud agent how-tos](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent)

What we can ground in official docs:

- Copilot SDK custom agents are attached to a session with their own prompt, tool restrictions, and optional MCP servers.
- The Copilot runtime can auto-delegate to a subagent based on intent, run it in isolated context, stream lifecycle events back to the parent session, and integrate its result.
- Official event types include `subagent.selected`, `subagent.started`, `subagent.completed`, `subagent.failed`, and `subagent.deselected`.
- Subagent events include `toolCallId`, `agentName`, `agentDisplayName`, `agentDescription`, tools, and error details. GitHub's docs explicitly show building an agent tree UI from these events.
- Copilot SDK supports session management, session history, streaming, abort, permission hooks, model switching, reasoning effort, custom agents, and experimental `session.rpc.agent.*` management plus fleet mode.
- Copilot cloud agent is a hosted background agent that can research, plan, make branch changes, iterate, and create pull requests. GitHub exposes agents panel entry points, IDE entry points, REST/API management, GitHub CLI, and MCP-server entry points.

Adapter implication:

- Copilot SDK can power a real Agent Threads tree for in-session subagents. The identity should key from `toolCallId`, not a made-up thread id.
- Copilot cloud agent sessions should map to hosted agent-session rows when Orchestrator is connected to GitHub task/session APIs. They are not the same transport as SDK subagents, but they belong in the same Agent Threads UI.
- Copilot actions should separate local SDK session controls from cloud-agent task controls:
  - SDK: open parent session, show subagent tree, abort parent session, inspect history, maybe select/deselect/list current agent through experimental RPC once proven.
  - Cloud: open GitHub session/PR, show branch/PR/check status, start/manage task through supported REST/CLI/MCP paths once integrated.

Minimum useful fields:

- Identity: SDK `toolCallId` for subagents; cloud task/session id or PR/branch id for cloud agent.
- Status: selected/started/completed/failed/deselected for SDK subagents; task/PR/check state for cloud.
- Transcript handle: parent session event history for SDK; GitHub session/PR timeline for cloud.
- Actions: abort/session controls for SDK; open/manage GitHub cloud session for cloud; experimental agent/fleet controls only after live proof.

### Cursor CLI / Cursor SDK

Status: good fit for session/run-level Agent Threads; SDK looks stronger than CLI for durable programmatic runs. Public docs/changelog indicate subagents exist in Cursor's agent harness, but the exact SDK event schema still needs local fixture proof before we claim child-thread parity.

Official sources:

- [Cursor CLI overview](https://docs.cursor.com/en/cli/overview)
- [Cursor CLI using guide](https://docs.cursor.com/en/cli/using)
- [Cursor CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)
- [Cursor CLI output format](https://docs.cursor.com/en/cli/reference/output-format)
- [Cursor SDK release](https://cursor.com/changelog/sdk-release)
- [Cursor subagents release](https://cursor.com/changelog/2-4)

What we can ground in official docs:

- `cursor-agent` supports interactive sessions, non-interactive print mode, `ls`, `resume`, and resuming a specific conversation.
- The CLI can emit `json`, `stream-json`, or `text` with `--output-format` in print mode. The documented default for print/inferred print is `stream-json`.
- JSON output includes final result metadata such as `type`, `subtype`, `is_error`, duration fields, result text, `session_id`, and optional request id.
- Stream JSON emits newline-delimited real-time events. The docs describe a system initialization event with `cwd`, `session_id`, model, and permission mode; implementation notes say tool call ids can correlate start/completion events and session ids remain consistent for a single execution.
- Cursor CLI reads `.cursor/rules`, `AGENTS.md`, and `CLAUDE.md` as context/rules.
- Cursor's SDK release introduces `@cursor/sdk`, `Agent.create`, `agent.send`, and `run.stream()` for programmatic agents using the same runtime, harness, and models that power Cursor. It can run locally or in Cursor cloud.
- Cursor's SDK release also mentions Cloud Agents API changes around durable agents, per-prompt runs, status, streaming, cancellation, SSE reconnect, terminal states, and explicit agent lifecycle controls such as archive, unarchive, and permanent delete.
- Cursor's subagents release says subagents are independent agents for discrete parts of a parent agent's task, run in parallel, use their own context, and can have custom prompts, tool access, and models. It also says default subagents improve conversations in the editor and Cursor CLI.

Adapter implication:

- Cursor CLI can support the same Agent Threads UI at the session/run level from `session_id`, structured progress, tool start/completion correlation, and resume/list commands.
- Cursor SDK should be the preferred adapter once available in Orchestrator because it exposes durable agents/runs, streaming, cancellation, and lifecycle controls more directly than CLI parsing.
- Cursor subagent rows should only be enabled once a CLI or SDK fixture proves the event identity and parent relation. The product can plan for subagent rows, but the adapter must not invent them from generic tool calls.
- Cursor rows should look like normal Agent Thread rows, with provider-supplied capabilities coming from CLI sessions or SDK agents/runs.

Minimum useful fields:

- Identity: Cursor `session_id` for CLI, or SDK `agent`/`run` ids when using `@cursor/sdk`.
- Status: init/running/completed/failed from stream/result and process state.
- Transcript handle: CLI session resume/history or Orchestrator-captured stream; SDK run stream/history when available.
- Actions: open/resume session, stop process or cancel run, show stream/progress, archive/unarchive/delete for SDK/cloud agents when proven, copy/add context. Child-thread open/send should only appear if Cursor exposes a real child session relation.

### Google Antigravity SDK

Status: planned adapter target. Official docs now describe a Python SDK, but Orchestrator does not have an adapter yet.

Official sources:

- [Antigravity SDK overview](https://antigravity.google/docs/sdk-overview)
- [Antigravity SDK product page](https://antigravity.google/product/antigravity-sdk)

What we can ground in official docs:

- Antigravity SDK is described as a Python framework for building, testing, and running autonomous AI agents.
- The SDK extends the same core agent harness that powers Antigravity CLI and Antigravity 2.0.
- It uses `google.antigravity` with `Agent` and `LocalAgentConfig` in official examples.
- The SDK says it decouples agent logic from where it runs, with the SDK handling how and where execution happens.
- The product page says it provides built-in filesystem and terminal tools, custom Python callables, MCP servers, reusable skills, state management, tool execution, and backend communication.

Adapter implication:

- Antigravity should be added as `google-antigravity-sdk`, not as a special UI.
- The adapter should map Antigravity agents/runs to the same Agent Threads rows once we can inspect the actual Python event stream, run state, cancellation semantics, and transcript/history APIs.
- Because the public docs are less specific about subagent lifecycle events than Codex/Copilot/Claude, Antigravity child/subagent rows should wait for live SDK fixture proof.

Minimum useful fields:

- Identity: SDK agent id/run id/session id if exposed, otherwise Orchestrator-generated run id tied to the SDK object lifecycle.
- Status: running/completed/failed/cancelled from SDK run lifecycle.
- Transcript handle: SDK chat/run stream and captured messages.
- Actions: open run, cancel/stop if exposed, show stream/progress, copy/add context. Subagent/team actions only after the SDK exposes stable event identity and parent relation.

## One Product Surface, Not A Backup UI

The old wording in this doc allowed a second-class backup UI path. That is not the intended product.

Orchestrator should have one Agent Threads experience:

- Same composer-adjacent background-agent panel.
- Same workbench Agent Threads tab.
- Same row structure.
- Same grouping and status language.
- Same details drawer.
- Same copy/add/open/stop/reply action positions.

Provider adapters fill that surface with different evidence:

- Codex fills it with child thread ids, parent thread ids, receiver memberships, child status, and native multi-agent actions.
- Claude fills it with background sessions, SDK subagents, and eventually agent teams.
- Copilot fills it with SDK subagent lifecycle trees and cloud-agent task/session rows.
- Cursor fills it with CLI session ids, SDK agent/run ids, stream progress, cloud-agent lifecycle, and correlated tool activity until official child-agent relations are fixture-proven.
- Antigravity fills it with SDK agent/run state and stream evidence once the adapter lands.

Unsupported data should create quiet empty fields or disabled actions, not extra panels. For example, if Cursor does not expose child-thread open, the row still lives in Agent Threads; the `Open child thread` action is absent or disabled with a tooltip. The user should not be sent to an Event Inspector just because the provider is less rich.

## Target Provider-Agnostic Model

Orchestrator should introduce an agent-thread graph that is independent from Codex but rich enough to express Codex faithfully.

### `AgentThreadIdentity`

Core identity for a child agent thread or thread-like task:

```ts
interface AgentThreadIdentity {
  providerId: string
  sessionId: string
  agentThreadId: string
  providerThreadId?: string
  parentSessionId?: string
  parentThreadId?: string
  parentTurnId?: string
  parentEventId?: string
  depth: number
  displayName?: string
  nickname?: string
  role?: string
  prompt?: string
  model?: string
  reasoningEffort?: string
}
```

Mapping examples:

- Codex: `agentThreadId` from receiver thread id when present, otherwise `collabAgentToolCall.id`; parent from `senderThreadId` and `source.subAgent.thread_spawn.parentThreadId`; nickname/role from spawn metadata.
- Claude: `agentThreadId` from background session id for `claude agents` rows, or `Agent` tool/subagent invocation id for SDK subagents; parent from the dispatching session/turn when applicable.
- Copilot SDK: `agentThreadId` from subagent `toolCallId`; parent from the Copilot SDK session and turn/event id.
- Copilot cloud agent: `agentThreadId` from GitHub task/session/PR/branch identity; parent from the Orchestrator session or GitHub issue/PR/source that launched it.
- Cursor CLI: `agentThreadId` from Cursor `session_id` plus request/run id where available; tool-call ids become activity children inside the row, not fake child threads.
- Cursor SDK: `agentThreadId` from SDK agent/run ids; subagent ids only if `@cursor/sdk` exposes stable parent-child event identity in fixtures.
- Antigravity SDK: `agentThreadId` from SDK agent/run/session ids once exposed by the adapter; subagent ids only after live SDK proof.
- Future providers: must map to a real provider session/task/subagent identity before appearing as an Agent Thread. Generic tool activity can enrich a row's timeline, but should not create a separate pseudo-thread unless the provider supplies a durable identity.

### `AgentThreadMembership`

Edge between parent work and child work:

```ts
interface AgentThreadMembership {
  id: string
  providerId: string
  parentSessionId: string
  parentThreadId?: string
  parentTurnId?: string
  parentEventId?: string
  childSessionId?: string
  childThreadId: string
  providerAgentId?: string
  providerItemId?: string
  source: 'provider-thread' | 'provider-event' | 'tool-heuristic' | 'message-history'
}
```

This lets Orchestrator distinguish a true provider child thread from a local derived tool task.

### `AgentThreadProgress`

Status and summary for rows:

```ts
interface AgentThreadProgress {
  status: 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  statusText?: string
  activeSummary?: string
  waitingReason?: string
  startedAt?: number
  updatedAt?: number
  completedAt?: number
  elapsedMs?: number
  diffStats?: {
    filesChanged?: number
    linesAdded?: number
    linesRemoved?: number
  }
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}
```

Codex can populate status from `agentsStates`, child conversation status, and binary/app-server events. Other providers can populate only what they know.

### `AgentThreadTranscriptHandle`

Transcript access should be separate from identity because not every provider has child thread read APIs:

```ts
interface AgentThreadTranscriptHandle {
  kind: 'provider-thread' | 'embedded-transcript' | 'derived-summary' | 'unavailable'
  threadId?: string
  sessionId?: string
  messageIds?: string[]
  summary?: string
  unavailableReason?: string
}
```

This keeps Codex's "open child thread" experience available when supported without forcing every provider to fake child-thread depth.

Provider expectations:

- Codex child threads should use provider thread read/list where available.
- Claude background sessions should use attach/logs/resume state; Claude SDK subagents can use embedded stream/result evidence unless the SDK exposes a richer transcript handle.
- Copilot SDK subagents should use parent session event history keyed by `toolCallId`; cloud agent rows should link to GitHub session/PR/timeline data.
- Cursor CLI should use Orchestrator-captured stream data and session resume/list support.
- Cursor SDK should use SDK run streams, status, and lifecycle APIs.
- Antigravity SDK should use SDK run streams, chat history, and lifecycle APIs once its adapter exists.

### `AgentThreadCapabilities`

Actions should be explicit and provider-gated:

```ts
interface AgentThreadCapabilities {
  open: Capability
  stop: Capability
  stopAllSiblings: Capability
  wait: Capability
  resume: Capability
  sendMessage: Capability
  close: Capability
  copyContext: Capability
  addContextToChat: Capability
}

interface Capability {
  available: boolean
  reason?: string
}
```

The UI can then render Codex-adjacent actions without pretending every provider can do every action.

### Raw Provider Payloads

Keep current diagnostics by linking raw payloads, not by making them the main model:

```ts
interface AgentThreadRawEvidence {
  providerId: string
  eventId?: string
  rawLogOffset?: number
  payload?: unknown
}
```

The existing Event Inspector behavior can read this evidence under a `Details` or `Runtime` disclosure.

## Desired UX

### Composer Background-Agent Surface

Orchestrator should replace or evolve `RunningAgentsStrip` into a Codex-adjacent panel:

- Compact summary row near the composer.
- Count text like `1 background agent` / `3 background agents`.
- Optional hint text when the provider supports mentions or agent tagging.
- Expand/collapse.
- Rows with:
  - Agent nickname/name
  - Role or compact task summary
  - Status label
  - Model/effort if useful and not noisy
  - Diff stats when available
  - Open child thread action
  - Stop action when provider supports it
- Stop all when any sibling supports stop.
- Done rows should not disappear immediately. Codex keeps background agents legible as work products, not only live activity.

For providers without child threads, row actions should say what is unavailable:

- `Open thread unavailable: provider only emitted a tool result`
- `Stop unavailable: provider does not expose per-agent stop`
- `Send unavailable: child transcript is read-only`

Those unavailable states should appear inside the same row/action area. They should not route users into a separate backup inspector.

### Workbench Agent Threads View

The right workbench tab can still be called `Agents`, but its content should become child-thread-first.

Recommended structure:

1. Header:
   - `Agent Threads`
   - Count active/done/waiting
   - Provider capability summary only if needed
2. Primary list/tree:
   - Group by current parent turn or parent thread.
   - Show nested depth.
   - Show rows with status, role/name, summary, diff stats, last activity.
3. Selected thread preview:
   - Transcript preview if available.
   - Open full thread button when supported.
   - Add context to chat and Copy context.
   - Provider action buttons gated by capabilities.
4. Details disclosure:
   - Runtime issues.
   - Raw event payloads.
   - Transport log.
   - Event search/filter.

This preserves the useful operational tools, but makes the default screen answer "what are my agents doing?" instead of "what events happened?"

Provider-specific row treatments:

- Codex row: child-thread identity, parent turn, role/nickname, status, diff stats, open child thread, native action buttons when proven.
- Claude background row: background session status, cwd/worktree/PR if known, peek/reply/open/attach/stop actions.
- Claude subagent row: agent name, description, tool restrictions/model when known, progress/result, parent session open action.
- Copilot SDK row: subagent display name, `toolCallId`, selected/running/completed/failed status, parent session history.
- Copilot cloud row: hosted task/session, branch/PR/check state, open GitHub session/PR action.
- Cursor CLI row: session/run status, model/cwd, streamed tool progress, resume/open/stop process actions.
- Cursor SDK row: agent/run status, local/cloud runtime, streamed events, cancel/archive lifecycle actions when proven.
- Antigravity SDK row: agent/run status, local/remote runtime if exposed, streamed events, cancel/open actions when proven.

### Sidebar And Thread List Integration

Codex child agents are conversations. Orchestrator should reflect that in its chat/thread model when a provider exposes real child thread ids.

Desired behavior:

- Child agent threads can appear as linked/nested rows under the parent session where appropriate.
- Parent sessions show a compact indicator when background agent threads exist.
- Opening a child thread should keep parent context visible in the header or route state.
- Archiving/renaming/pinning semantics should stay provider-gated and should not assume Codex supports every mutation through the current app-server.

### Header Identity For Child Threads

When viewing a child agent thread, the header should show:

- Child thread title or nickname
- Agent role
- Parent thread link/back affordance
- Model/effort when provided
- Status

This should feel like a real conversation with provenance, not an inspector subview.

### Diagnostics As Advanced Mode

Keep these current Orchestrator strengths:

- Failure grouping.
- Event filters.
- Payload copy.
- Transport log redaction/summary.
- Add-to-chat context generation.
- Approval/question focus handoff.
- Focused smoke hooks.
- Provider-neutral event language.

But demote them from the first screen into `Details`, `Runtime`, or `Evidence` sections on the selected agent thread.

## Implementation Plan

### Phase 0: Preserve Codex Agent Data

Goal: stop losing Codex thread graph information at parse time.

Tasks:

- Extend normalized events or introduce parallel `agent.thread.*` events.
- Preserve these `collabAgentToolCall` fields:
  - `senderThreadId`
  - `receiverThreadIds`
  - `receiverThreads`
  - `agentsStates`
  - `reasoningEffort`
  - `prompt`
  - `model`
  - raw provider item id
- Preserve `source.subAgent.thread_spawn` metadata when Codex thread/list/read data is available:
  - `parentThreadId`
  - `depth`
  - `agentNickname`
  - `agentRole`
- Add Codex fixtures for:
  - Spawn with receiver thread ids.
  - Receiver thread details arriving later.
  - Waiting agent.
  - Completed agent with diff stats.
  - Failed/cancelled agent.
  - Nested agent depth.

Expected result:

- Existing `AgentNode` behavior continues to work.
- New graph data is available without relying on raw JSON in the UI.
- The user-facing product is still headed toward one Agent Threads UI, not an Event Inspector backup path.

### Phase 1: Add Provider-Neutral Agent Thread Graph

Goal: create a shared model that can represent Codex faithfully and degrade cleanly for everyone else.

Tasks:

- Add `AgentThreadIdentity`, `AgentThreadMembership`, `AgentThreadProgress`, `AgentThreadTranscriptHandle`, and `AgentThreadCapabilities`.
- Build `deriveAgentThreadGraph(session, events, messages, providerThreadMetadata)` beside the existing `deriveSessionAgentNodes`.
- Feed Codex parser data into the graph.
- Feed Claude background session state, Claude SDK subagent invocations, Copilot SDK subagent events, Copilot cloud task/session state, Cursor CLI session streams, Cursor SDK agent/runs, and Antigravity SDK agent/runs into the graph as first-class provider projections.
- Keep generic tool-derived activity as row timeline enrichment only. It should not create a standalone pseudo-agent thread unless no better provider identity exists and the provider explicitly represents the tool call as an agent/task.
- Add unit tests for graph merging:
  - Parent event before child thread metadata.
  - Child thread metadata before parent event.
  - Multiple receiver thread ids.
  - Missing provider thread read.
  - Provider action unavailable reasons.
  - Claude background session row.
  - Claude SDK subagent row.
  - Copilot SDK subagent lifecycle row.
  - Copilot cloud agent task row.
  - Cursor stream-json session row.
  - Cursor SDK agent/run row.
  - Antigravity SDK agent/run row once the adapter exists.

Expected result:

- Orchestrator can render the same graph shape for Codex and non-Codex providers.
- Codex gets true child-thread identities.
- Claude, Copilot, Cursor, and Antigravity get real provider-grounded Agent Threads rows without a separate inspector path.

### Phase 2: Build Codex-Adjacent Composer Surface

Goal: replace the current live-pill-only strip with a background-agent panel.

Tasks:

- Use the Agent Thread Graph instead of `deriveSessionAgentNodes` directly.
- Render count summary, expand/collapse, rows, status, diff stats, open action, and capability-gated stop actions.
- Keep the panel compact and near the composer.
- When a row cannot open a child transcript, keep the row in place and show the best available transcript/progress preview in the Agent Threads tab.
- Add focused UI smoke for:
  - No agents.
  - One running agent.
  - Multiple agents.
  - Waiting agent.
  - Completed agent with diff stats.
  - Unsupported stop/open actions.
  - Stop all available/unavailable.

Expected result:

- The first visible agent affordance feels much more like Codex.

### Phase 3: Rework Workbench `Agents` Tab

Goal: make the workbench tab child-thread-first and diagnostics-second.

Tasks:

- Rename panel title internally to `Agent Threads` even if tab label remains `Agents`.
- Add list/tree grouped by parent turn/thread.
- Add selected agent-thread preview.
- Add `Open thread`, `Copy context`, `Add context to chat`, and provider action buttons.
- Move existing `Session context`, `Runtime issues`, `Transport log`, `Recent activity`, and `Event detail` under details/diagnostics.
- Keep current test ids or add migration aliases where smoke coverage depends on them.

Expected result:

- The tab becomes a work surface for agent child threads, not mostly a runtime log.

### Phase 4: Provider Actions And Thread Reads

Goal: wire real child-thread actions where providers expose them.

Tasks:

- Codex:
  - Read/list child threads through proven app-server surfaces where available.
  - Open child thread from `receiverThreadIds`/source metadata.
  - Gate stop/wait/resume/send/close behind live proof of app-server/tool support.
- Claude:
  - Map `claude agents --json`, attach/logs/stop/respawn/remove, and background-session state into Agent Threads.
  - Map SDK `Agent` subagents into in-session child rows with own-context identity and embedded progress/result.
  - Treat agent teams as an experimental richer mode only after a deliberate integration.
- Copilot SDK:
  - Map `subagent.selected/started/completed/failed/deselected` into rows keyed by `toolCallId`.
  - Use session history and experimental `session.rpc.agent.*` only after live proof against our runtime.
- Copilot cloud agent:
  - Map GitHub hosted task/session/PR state into rows when REST/CLI/MCP integration is wired.
- Cursor:
  - Map `cursor-agent` session ids and stream-json progress into session-level rows.
  - Map `@cursor/sdk` agent/run ids, streams, status, cancellation, and lifecycle controls into SDK-backed rows.
  - Use tool-call ids as activity children inside the row.
  - Do not invent nested child threads unless Cursor exposes a real subagent/session relation.
- Antigravity SDK:
  - Add `google-antigravity-sdk` as a planned adapter.
  - Map SDK agent/run/session ids, streams, lifecycle status, and stop/cancel actions once locally proven.
  - Do not expose subagent/team rows until the SDK provides stable parent-child event identity.

Expected result:

- Codex feels adjacent to native Codex.
- Other providers get the same Orchestrator Agent Threads UX populated from their real SDK/CLI surfaces.

### Phase 5: Verification And Live Proof

Goal: avoid another static-inspection-only parity claim.

Required checks:

- Parser unit tests for Codex agent fields.
- Graph unit tests for provider-neutral merging and capability boundaries.
- Focused UI smoke for composer background agents.
- Focused UI smoke for Workbench Agent Threads.
- Fixture replay for Codex, Claude background sessions, Claude SDK subagents, Copilot SDK subagents, Copilot cloud tasks, Cursor stream-json sessions, Cursor SDK runs, and Antigravity SDK runs.
- Live Codex multi-agent fixture when feasible.
- Live Claude `claude agents --json` fixture if available locally.
- Live Copilot SDK subagent fixture if auth/runtime is available.
- Live Cursor stream-json fixture if Cursor CLI is available locally.
- Live Cursor SDK fixture if `@cursor/sdk` auth/runtime is available.
- Live Antigravity SDK fixture once `google-antigravity-sdk` is installed and authenticated.
- Live screenshot comparison against Codex when screen capture or manual evidence is available.

## What To Keep From The Current Agents Tab

The current tab has several good Orchestrator-native ideas that Codex does not need to dictate:

- Provider-neutral diagnostics.
- Runtime issue grouping.
- Failure group copy/add-to-chat.
- Session context copy/add-to-chat.
- Raw transport log visibility.
- Event search and filtering.
- Event payload copy.
- "Open approval/question in chat" handoff.
- Smoke-testable data attributes.

These should remain, but they should serve the selected agent thread instead of defining the entire agent experience.

## Anti-Goals

- Do not make Orchestrator's agent model Codex-only.
- Do not hide unsupported provider actions. Render unavailable capabilities with reasons.
- Do not pretend a tool-derived task is a provider child thread unless a provider gives us child-thread identity.
- Do not keep a separate weird in-between inspector as the agent product. Diagnostics belong behind details in Agent Threads.
- Do not claim live Codex parity from static bundle/binary inspection.
- Do not block non-Codex providers on Codex-specific fields like `receiverThreadIds`; map them through neutral graph concepts.

## Open Questions

- What is the exact current Codex visual layout for expanded background agents in build `26.527.60818`? Static strings and flow are clear, but pixel/layout proof is still pending.
- Does the current app-server expose a safe public route for all child-thread actions implied by the binary strings, or are some only internal tool handlers?
- Should the workbench tab label stay `Agents` for familiarity, or change to `Agent Threads` once the child-thread-first UI lands?
- Should child agent threads appear in the left chat sidebar by default, or only inside the parent thread unless pinned/opened?
- How should nested agents display when depth grows beyond two levels?
- How much completed-agent history should the composer panel retain before collapsing to the workbench view?
- Which non-Codex providers expose true child-thread ids versus only tool/task result payloads?

## Recommended Next Slice

The highest-leverage first slice is provider-grounded data preservation plus the graph model:

1. Preserve Codex `collabAgentToolCall` child-thread fields in normalized events.
2. Add a provider-neutral Agent Thread Graph with capability boundaries.
3. Add fixtures for Claude background sessions, Claude SDK subagents, Copilot SDK subagents, Copilot cloud task/session rows, Cursor stream-json sessions, Cursor SDK runs, and Antigravity SDK runs once available.
4. Replace the current `Agents` tab content with the Agent Threads view once the graph fixtures are green.
5. Move the existing event inspector sections into the selected-row details drawer.

This sequence avoids a UI-only rewrite, avoids permanent clutter, and makes the Codex-like experience available to every provider according to the real surfaces each provider exposes.
