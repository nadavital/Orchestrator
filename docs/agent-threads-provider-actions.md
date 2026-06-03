# Agent Threads Provider Actions

This document records the provider-grounded Agent Threads foundation added for the workbench Agent Threads tab. The intent is a single Codex-adjacent Agent Threads surface, not a separate inspector fallback.

## Shared Shape

`AgentThreadGraph` is the renderer-facing model for agent rows. It is derived from normalized provider events and preserves:

- `identity`: provider id, parent session id, provider child thread/run id, parent thread id, provider item id, and child thread ids.
- `membership`: root Orchestrator session, parent agent id, parent thread id, and provider turn id.
- `progress`: status, timestamps, model, role, summary, and reasoning effort.
- `transcript`: one of `provider-thread`, `embedded-transcript`, `derived-summary`, or `unavailable`.
- `capabilities`: `open`, `openProviderThread`, `copyTranscript`, `addTranscriptToChat`, `stop`, and `resume`, each marked `available`, `planned`, `unavailable`, or `unknown`.
- `evidence`: whether the row came from a provider thread, provider event, SDK run, CLI session, message history, or tool heuristic.

`AGENT_THREAD_ADAPTER_CONTRACTS` is the provider-arbitration expansion point. It records the expected runtime lanes and default action support for Codex, Claude, Cursor, GitHub Copilot, and future Antigravity without adding a second UI surface.

The renderer still exposes `deriveSessionAgentNodes` for compatibility, but the Agent Threads tab, composer live-agent shelf, and sidebar tab gate now consume `deriveSessionAgentThreads` or the graph-backed helper first.

## Workbench UI Shape

The Agent Threads tab should read as a Codex-adjacent thread surface, not as the old Orchestrator Agent Activity inspector:

- The primary visible hierarchy is `Agent threads` summary, provider-backed thread rows, selected thread transcript, and compact transcript actions.
- Runtime/session diagnostics, transport snippets, recent events, event payloads, and selected-agent timeline stay behind disclosure controls. They remain useful evidence, but they should not be the first thing a user sees.
- The `openProviderThread` affordance is rendered only when the action is genuinely available for the provider adapter. Disabled provider-specific continuation buttons should not clutter the panel.
- Provider gaps are represented in the shared capability graph and docs, not as a second fallback UI mode.

## Open Thread Action

The Agent Threads tab now exposes one provider-neutral `openProviderThread` action, labeled `Open thread` in the UI. It does not create a second inspector-style fallback. It creates or reuses an Orchestrator session whose provider ids point at the native provider thread/session evidence that the row exposed:

- Codex rows open a provider-projectless session with `providerSessionId` set to the child thread id. This is the closest match to the Codex workbench experience because Codex app-server events expose the child provider thread directly.
- Claude rows preserve extracted agent ids and embedded transcripts. Rows with both a parent Claude SDK session id and an emitted subagent id expose `openProviderThread`; opening the row creates a focused Orchestrator thread that resumes the parent Claude session and routes follow-up messages through Claude's `SendMessage` tool to the stored agent id.
- Cursor, Copilot, and Antigravity rows use the same action contract, but should remain `planned` or `unknown` until their adapters expose native run/thread open semantics. They should still enter the same graph and UI, not a separate panel.

The June 1, 2026 live Claude check is the cautionary boundary: simply prompting a normal Claude session with `Resume agent <agentId>` failed because `SendMessage` was not available. The corrected path enables Claude agent teams for focused subagent shells, resumes the parent SDK session, auto-allows `SendMessage`, and wraps only the provider request so the visible Orchestrator chat remains the user's original message.

## Provider Mapping

### Codex App Server

Current support:

- `collabAgentToolCall` preserves `senderThreadId`, `receiverThreadIds`, `receiverThreads`, `turnId`, `reasoningEffort`, provider item id, and child provider thread id.
- Rows with a receiver thread id use transcript kind `provider-thread`.
- `openProviderThread` is marked `available` when the child thread id is present.
- Opening a row creates or reuses a provider-projectless Codex session keyed by the child thread id.

Remaining actions:

- `stop` is marked `planned` for live rows; provider-specific cancellation plumbing is not wired through the Agent Threads action contract yet.
- `resume` remains `planned` as a distinct follow-up action from opening the child thread.

### Claude SDK / Background Sessions

Current support:

- `Task` and `Agent` tool use/result events become provider-event backed agent rows.
- Claude system task lifecycle events preserve task ids when exposed and can become provider-thread rows if Claude emits a task/session id.
- Rows without provider thread ids use transcript kind `derived-summary` or `embedded-transcript`.
- Rows with hidden agent ids preserve that id in graph identity and keep embedded transcript text clean by stripping native metadata trailers.
- Rows with both `providerAgentId` and `parentThreadId` mark `openProviderThread` and `resume` as `available`.
- Opening one of those rows creates or reuses a provider-projectless Claude shell keyed by the parent SDK session id plus the subagent id. Follow-up provider requests keep `providerSessionId` set to the parent session, add `SendMessage` to the allowed tools, and set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` so the SDK exposes the continuation bridge.

Remaining actions:

- Claude does not get a direct Codex-style independent child-thread id from the local SDK path. The Orchestrator thread is a focused view over the parent Claude SDK session plus `SendMessage` routing to the subagent.
- `openProviderThread` is still `unavailable` for Claude rows that lack either the parent SDK session id or the emitted agent id.
- Claude transcript hydration from `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl` is still a follow-up; current rows use embedded transcript/result text unless provider events include richer transcript data.
- `stop` is `planned` for live rows pending a provider cancellation hook.

### Cursor CLI / SDK

Current support:

- Cursor SDK `Task`/`subagent` tool calls are annotated with `sdk-run` source, provider item id, parent agent id, and run id.
- Cursor SDK task messages map `agent_id` and `run_id` into graph identity so SDK-backed rows are not treated as generic tool heuristics.

Remaining actions:

- `openProviderThread` is `planned` when a Cursor SDK run id is present until a provider adapter implementation can open the Cursor-native run/session view.
- Local Cursor SDK live streaming remains separately live-proof blocked by the SDK HTTP/2 behavior already documented in runtime failures; the graph can represent rows emitted by the normalizer, but live proof depends on Cursor SDK transport behavior.
- `stop` and `resume` remain `planned` until Cursor-specific run controls are exposed through the adapter contract.

### GitHub Copilot SDK / Cloud Agent

Current support:

- The graph and action contract are provider-neutral and can represent Copilot cloud-agent rows once normalized events include provider agent id, cloud run/thread id, parent thread id, and transcript/summary evidence.
- `@github/copilot-sdk@1.0.0` is installed as the structured Copilot runtime dependency. Its public API exposes `CopilotClient`, `CopilotSession`, `createSession`, `resumeSession`, `listSessions`, `deleteSession`, `getEvents`, foreground session APIs, structured events, user input, elicitation, permissions, and `abort`.
- `npm run live:copilot-sdk-probe` performs a no-prompt SDK readiness check by starting the JSON-RPC runtime, reading status/auth/models, listing sessions, and stopping the runtime.
- Orchestrator now has a first Copilot SDK runtime manager. New Copilot sessions default to `runtime: "sdk"`, start/resume `CopilotSession`, stream common `SessionEvent` records into normalized RunEvents, and stop via `session.abort()` / `session.disconnect()` / `client.stop()`.
- Copilot SDK auth is subscription-compatible by default: the SDK uses the signed-in Copilot CLI/GitHub identity unless a BYOK provider config is supplied. Do not model this like Antigravity's API-key-only SDK path.
- Generic Copilot `agent.*` / `subagent.*` payloads already preserve `threadId`, `parentThreadId`, and `turnId` into graph rows.

Remaining actions:

- `openProviderThread`, provider-native Agent Threads `resume`, and response handlers for SDK permission/user-input/elicitation remain `planned` until live fixtures prove the exact pending-request RPC path.
- The UI should not add a fallback inspector; Copilot rows should enter the same Agent Threads graph once real provider evidence is available, then use SDK session IDs for native actions.

### Google Antigravity SDK

Current support:

- Google Antigravity is a first-class SDK provider definition and adapter. It launches a packaged Python bridge that imports `google-antigravity`, constructs `Agent(LocalAgentConfig)`, and streams `ChatResponse` chunks back as normalized Orchestrator events.
- The adapter no longer wraps the `agy` CLI. CLI documentation is only adjacent product evidence; Orchestrator's Antigravity runtime is SDK-first.
- The graph reserves no provider-specific assumptions, so Antigravity SDK events enter the same Agent Thread graph as Codex, Claude, Cursor, and Copilot.
- Fixture coverage proves normalization for SDK-style session start, assistant deltas, tool start/complete, usage metadata, agent started/completed, conversation id, child thread id, parent thread id, and provider turn id.
- Temporary Python 3.13 SDK inspection proved `Agent`, `LocalAgentConfig`, `CapabilitiesConfig`, `Conversation`, `ChatResponse`, `Step`, `ToolCall`, `ToolResult`, `UsageMetadata`, `BuiltinTools.START_SUBAGENT`, and policy helpers.

Remaining actions:

- Live Antigravity proof requires a Python 3.10+ interpreter with `google-antigravity` installed and provider credentials; `/usr/bin/python3` is too old on this machine, while a temp Python 3.13 venv import probe succeeded.
- `openProviderThread`, `resume`, and `stop` remain `planned` until SDK fixtures prove child subagent IDs, conversation resume semantics, and cancellation behavior.
- The SDK runtime should continue mapping native conversation/thread/run ids into `providerThreadId`, `parentThreadId`, and `providerTurnId` rather than inventing Orchestrator-only ids.

## Verification

Targeted tests cover:

- Codex app-server `collabAgentToolCall` child-thread preservation and graph projection.
- Claude `Task` agent event projection into the graph with unavailable provider-thread actions.
- Cursor SDK run/task identity projection into `sdk-run` graph rows.

Live proof:

- `CLAUDE_SDK_PROBE_SCENARIOS=subagent_resume npm run live:claude-sdk-probe` passed on June 1, 2026 with `claude-sonnet-4-6` and low effort. The probe spawned a subagent, extracted the emitted agent id, resumed the parent SDK session with agent teams enabled, allowed only `SendMessage`, and received `ORCHESTRATOR_SDK_SUBAGENT_RESUME_CONTINUED_OK`.
- The dev Electron app was launched from the `codex/agent-threads` worktree. In the Agent Threads tab for the live Claude smoke session, `Open thread` was visible for the Claude row with parent session id plus agent id. Opening it reused the focused agent thread, renamed the stale `Resume agent ...` shell to `Smoke test subagent`, and a new UI-sent follow-up returned `ORCHESTRATOR_UI_AGENT_THREAD_RESUME_POLISH_OK` after showing `Used 1 tool`, confirming the app path no longer fails with missing `SendMessage`.

Live proof is still required before claiming full provider parity for non-Claude provider-native open/resume/stop actions.
