# Claude Agent SDK Spike

Date: 2026-05-27
Status: replacement implemented and installed-app smoke proven

## Live Probe Update

After adding `@anthropic-ai/claude-agent-sdk@0.3.152`, the repo now has live SDK probes:

- Command: `npm run live:claude-sdk-probe`
- Script: `scripts/claude-sdk-live-probe.mjs`
- Latest artifact: `tmp/claude-sdk-live-probe/result.json`
- Runtime smoke command: `npm run live:claude-sdk-runtime`
- Runtime smoke script: `scripts/claude-sdk-runtime-live-smoke.mjs`
- Latest normal-network run result: all probe scenarios passed, and the Orchestrator SDK runtime produced assistant text plus `run.completed`.
- Runtime smoke scenarios now passed for `basic`, `user_question_resume`, `browser_tool`, `permission_allow`, `permission_deny`, and `stop`.
- `CLAUDE_SDK_RUNTIME_SMOKE_SCENARIO=user_question_resume npm run live:claude-sdk-runtime`: passed. The SDK runtime emitted `user_input.requested`, resumed with the captured provider session id after a simulated answer, and returned `SDK_QUESTION_RESUME_OK ALPHA_SDK_QUESTION`.
- `CLAUDE_SDK_RUNTIME_SMOKE_SCENARIO=browser_tool npm run live:claude-sdk-runtime`: passed. The SDK runtime exposed the app-owned Browser tool bridge as an SDK-local MCP server and Claude called `mcp__orchestrator__browser_read`.
- `CLAUDE_SDK_RUNTIME_SMOKE_SCENARIO=permission_allow npm run live:claude-sdk-runtime`: passed. The SDK runtime paused on Bash, Orchestrator approved through `approvalBroker`, and the tool executed.
- `CLAUDE_SDK_RUNTIME_SMOKE_SCENARIO=permission_deny npm run live:claude-sdk-runtime`: passed. The SDK runtime paused on Bash, Orchestrator denied through `approvalBroker`, and the file was not written.
- `CLAUDE_SDK_RUNTIME_SMOKE_SCENARIO=stop npm run live:claude-sdk-runtime`: passed. Orchestrator stopped an active SDK run through `AbortController`.
- `ORCHESTRATOR_AUTOMATED_UI_SMOKE_TIMEOUT_MS=240000 npm run smoke:ui:auto -- --installed --claude-browser-live`: passed. The installed `/Applications/Orchestrator.app` opened a real Browser webview, Claude SDK called `mcp__orchestrator__browser_read` exactly once through the SDK-local MCP bridge, the tool result included title `Orchestrator Browser Smoke` and `Target button`, and Claude returned `CLAUDE_SDK_INSTALLED_BROWSER_OK`; evidence `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-claude-browser-live-1779914938045.json`.

Note: these live checks must run with normal network access. In the default Codex sandbox, the SDK can initialize from local auth but then produce repeated `system`/`api_retry` messages with `error: "unknown"` because the child Claude process cannot reach the API. That is a test-environment artifact, not a Claude SDK runtime failure.

The probe uses the same local Claude settings environment path as the current CLI adapter by merging string env values from `~/.claude/settings.json` into the SDK subprocess environment. In the latest run, SDK init reported `apiKeySource: "apiKeyHelper"` and `claudeCodeVersion: "2.1.152"`, which means the SDK can use the same local auth helper flow available to the current Claude CLI integration in this environment.

Passed scenarios:

- `plain`: no-tool assistant response with `system`, `stream_event`, `assistant`, and `result` SDK messages.
- `partial`: `includePartialMessages: true` emitted stream events.
- `message_input`: async `SDKUserMessage` input completed successfully; this is the input mode used for SDK provider file attachments.
- `host_tool`: SDK-local MCP server via `createSdkMcpServer` exposed `mcp__orchestrator__get_context`; Claude called it exactly once and received the tool marker.
- `permission_deny`: `canUseTool` intercepted a dangerous Bash request and denied it without running the command.
- `plan`: `permissionMode: "plan"` completed a plan-mode turn.
- `resume`: captured a session id from the first turn and resumed it through SDK `resume`.
- `subagent`: a programmatic SDK subagent used the `Agent` tool and forwarded child text with enough structure for Orchestrator's agent/sidebar model.

Local verification after the SDK probe:

- `npx tsc -p tsconfig.node.json --noEmit`: passed.
- `npm run test:providers`: passed, 289 tests.
- `npx tsc -p tsconfig.web.json --noEmit`: passed.
- `npm run build`: passed.
- `npm run smoke:ui:auto -- --settings-providers`: passed.
- `npm run pack:mac`: passed.
- `npm run install:mac`: passed and installed `dist/mac-arm64/Orchestrator.app` to `/Applications/Orchestrator.app`.
- `npm run smoke:ui:auto -- --installed --settings-providers`: passed; evidence `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-settings-providers-1779915028446.json`.
- `npm run smoke:ui:auto -- --installed --browser`: passed; evidence `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-browser-1779915041110.json`.
- `npm run smoke:ui:auto -- --installed --claude-browser-live`: passed after packaging the SDK native binary outside `app.asar`; evidence `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-claude-browser-live-1779914938045.json`.

This evidence moves the SDK from "promising" to "ready to replace the Claude runtime on this branch." The old structured CLI launch path has been removed; the Claude parser/normalizer remains because SDK messages are still normalized through the existing Orchestrator event pipeline.

## Decision

Use the Claude Agent SDK runtime as the replacement candidate, but do not make it a Codex app-server clone.

The SDK looks valuable because it gives us a library-shaped Claude Code agent loop with structured messages, permissions, custom tools, sessions, subagents, hooks, and partial streaming. Codex app-server is a JSON-RPC thread server with explicit `thread/start`, `turn/start`, dynamic tool calls, approval messages, and provider notifications. They can share Orchestrator's normalized event and host-tool contracts, but they should not share a transport implementation.

The right product shape is:

- Make `claude` + `sdk` the only Claude chat runtime on this branch.
- Normalize SDK messages into the existing `RunEvent` model instead of building a separate Claude UI path.
- Build provider-neutral host tools once, then adapt them to Codex app-server dynamic tools and Claude SDK MCP/custom tools separately.
- Treat side chats and side panels as Orchestrator-owned UX. Let Claude expose subagents and nested transcripts, but do not let provider-specific agent mechanics own the app's side-chat model.

## Current Orchestrator Baseline

The previous Claude path was a structured CLI subprocess:

- `src/main/providers.ts` built provider commands and parsed stream JSON lines.
- `src/main/providerRuntime.ts` launched the runtime, handled Claude approval setup, and routed parsed events into sessions.
- `src/types/index.ts` already has `ProviderRuntimeKind = 'headless' | 'interactive' | 'app-server' | 'sdk'`.
- `src/main/__tests__/providers.test.ts` already covers Claude `AskUserQuestion`, `Task`, `Agent`, task progress, sidechain-style transcripts, `TodoWrite`, `ExitPlanMode`, and permission denials.

That means the SDK should mostly replace the brittle transport/parser boundary, not the product model. The app already has good normalized concepts for assistant text, user input, permissions, plans, tools, agents, diffs, and workspace/session metadata.

## What The SDK Can Do

Based on the current official Claude docs:

- Agent loop as a library: `query()` streams `SDKMessage` objects from a Claude Code-powered agent loop, with built-in file, shell, search, edit, and question tools.
- Structured messages: the TypeScript SDK reference includes message variants for assistant, user, result, system, partial stream events, hook events, tool progress, auth status, and task lifecycle messages.
- Partial streaming: setting `includePartialMessages: true` yields `SDKPartialAssistantMessage` with raw Claude API stream events for token/tool-call streaming.
- Permissions and questions: SDK permission evaluation runs hooks, deny rules, permission mode, allow rules, then `canUseTool`; `AskUserQuestion` also reaches the same callback and can be answered by returning structured answers.
- Custom host tools: in-process MCP servers can be created with `createSdkMcpServer` and `tool()`, passed through `mcpServers`, and gated via `allowedTools`.
- External MCP: the SDK can connect to stdio, HTTP/SSE, and SDK-local MCP servers. MCP tool names follow `mcp__server__tool`.
- Sessions: the SDK supports continuing the most recent TypeScript session with `continue: true`, and resuming/forking by captured session id.
- Subagents: subagents are invoked through the `Agent` tool; messages from subagent contexts include `parent_tool_use_id`; current docs note the old `Task` name still appears in some surfaces and should be checked alongside `Agent`.
- Subagent persistence: subagent transcripts persist separately from main conversation compaction and can be resumed through the parent session flow.
- Hooks and observability: hooks can validate, log, block, or transform behavior around tool use and session lifecycle.
- Checkpointing, todo lists, slash commands, skills, plugins, and filesystem-based `.claude` configuration are also SDK-exposed concepts.

Sources:

- https://code.claude.com/docs/en/agent-sdk/overview
- https://platform.claude.com/docs/en/agent-sdk/typescript
- https://code.claude.com/docs/en/agent-sdk/user-input
- https://code.claude.com/docs/en/agent-sdk/permissions
- https://code.claude.com/docs/en/agent-sdk/custom-tools
- https://code.claude.com/docs/en/agent-sdk/mcp
- https://code.claude.com/docs/en/agent-sdk/subagents
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/streaming-output

## SDK Versus Codex App-server

| Area | Codex app-server | Claude Agent SDK | Orchestrator recommendation |
| --- | --- | --- | --- |
| Transport | Stdio JSON-RPC server | TypeScript library around Claude Code agent loop | Separate runtime managers |
| Unit of work | Thread and turn APIs | `query()` calls with session options | Normalize both to session/run/turn events |
| Host tools | `dynamicTools` advertised on `thread/start`, fulfilled through `item/tool/call` | SDK MCP/custom tools registered in `mcpServers` | Shared host tool registry, per-provider adapter |
| Browser bridge | Existing Codex dynamic browser tools | Possible via SDK MCP/custom tools or external Playwright MCP | Reuse app-owned browser bridge, not provider-native browser assumptions |
| Approvals | Protocol approval messages | `canUseTool`, hooks, permission modes/rules | Shared permission UI, provider-specific resolver |
| User questions | App-server elicitation/user input | `AskUserQuestion` through `canUseTool` | Keep separate from generic permission UI |
| Subagents | Provider events/tool calls normalized to agent events | `Agent` tool plus `parent_tool_use_id` and persisted transcripts | Preserve `AgentNode` model, add SDK object normalizer |
| Side chats | App-owned tabs/side panels | No direct equivalent as an app UX primitive | Keep app-owned; expose explicit tools only if product needs model-created side chats |
| Resume | App-server thread resume | `continue`, `resume`, fork/session APIs | Store provider session id and runtime metadata |

The SDK is closer to "Claude Code as an embeddable agent loop" than "Claude app-server." That is still highly relevant. It may be the cleanest way to reduce string-line parser fragility and make Claude host-tool integration first class.

## Recommended Architecture

### 1. Add a Claude SDK runtime manager

Create a `ClaudeSdkRuntimeManager` beside the Codex app-server runtime instead of embedding SDK behavior into `providers.ts`.

Responsibilities:

- Start a `query()` call for a run.
- Apply cwd, model, permission mode, allowed/disallowed tools, session resume, environment, and `.claude` setting-source policy.
- Stream `SDKMessage` objects to a normalizer.
- Own cancellation/interrupt behavior.
- Resolve tool approvals and `AskUserQuestion` through the existing app UI.
- Record provider diagnostics and raw SDK message samples under the same diagnostics discipline as app-server.

### 2. Split Claude parsing into object normalization

Current Claude parsing is valuable, but it is shaped around JSON lines. Refactor toward two layers:

- `normalizeClaudeMessageObject(message, context): RunEvent[]`
- `parseAnthropicStyleLine(line): RunEvent[]` as a thin JSON parse wrapper around the object normalizer

This lets the CLI and SDK share semantics for:

- assistant text
- partial stream deltas
- tool calls/results
- `AskUserQuestion`
- `TodoWrite` and plan updates
- `Task`/`Agent`/subagent lifecycle
- sidechain/nested transcript records
- result usage/cost/session metadata
- permission denial fallback events

### 3. Build a provider-neutral host tool bridge

Codex currently has Codex-specific dynamic tool wiring for browser tools. The SDK should not import that transport. Instead add a neutral registry, for example:

```ts
interface ProviderHostToolBridge {
  listTools(context: ProviderRunContext): ProviderHostToolSpec[]
  invoke(toolName: string, input: unknown, context: ProviderToolContext): Promise<ProviderHostToolResult>
}
```

Then implement transport adapters:

- Codex app-server: advertise specs as `dynamicTools`; answer `item/tool/call`.
- Claude SDK: wrap specs as an SDK-local MCP server with `createSdkMcpServer` and `tool()`, then allow selected `mcp__orchestrator__*` tools.

Good first SDK host tools:

- `orchestrator_get_context`: read-only app/session context proof.
- `orchestrator_browser_read`: read current Browser tab state only.
- `orchestrator_browser_screenshot`: capture app-owned Browser screenshot if the user has enabled it.

Defer mutating browser actions until approvals and visibility are proven end-to-end.

### 4. Keep side chats app-owned

Claude SDK subagents matter for our Agents panel and sidechain parsing. They should not automatically become Orchestrator side chats.

Use this boundary:

- Subagents: provider-owned execution units, normalized into `AgentNode`.
- Side chat tabs: Orchestrator-owned user/workflow surfaces.
- Model-created side chats: only through an explicit host tool such as `orchestrator_side_chat_create`, and only after we decide that is desirable UX.

This keeps "Claude delegated work to a subagent" separate from "the app opened another conversation lane for the user."

## Implemented Runtime Shape

The branch now includes `ClaudeSdkRuntimeManager` in `src/main/claudeSdkRuntime.ts` and routes Claude sessions with `runtime: "sdk"` through it. Claude's provider manifest exposes only `sdk` for chat runtime selection.

Implemented:

- SDK `query()` start/stream/stop flow with AbortController cancellation.
- Object-level Claude SDK normalization through `normalizeClaudeMessageObject`, with the older JSON-line parser kept as a thin wrapper for fixture and compatibility coverage.
- Environment parity through `providerSpawnEnv('claude')`, preserving local Claude helper auth and settings env behavior.
- Permission-mode mapping for default, auto, accept edits, don't ask, plan, and bypass modes.
- `canUseTool` bridge into Orchestrator's existing approval broker.
- `AskUserQuestion` bridge into the existing `user_input.requested` event path.
- Provider-neutral host-tool bridge in `src/main/providerHostTools.ts`, adapted to Codex app-server dynamic tools and to a Claude SDK-local MCP server named `orchestrator`.
- SDK-local MCP server exposes Browser client dynamic tools through the app-owned Browser bridge; live `browser_tool` smoke proves a model-initiated Browser read request reaches the bridge.
- Claude provider file-resource attachments converted into async SDK user-message content blocks with file-backed document/image sources.
- Resume, selected agent, effort, model, allowed/disallowed tools, available tools, and additional directory options.
- Live `AskUserQuestion` answer/resume path through the SDK runtime.
- Live approval allow/deny path through the SDK `canUseTool` callback. Important SDK quirk: an allow response must echo `updatedInput`; omitting it currently fails SDK validation even though the TypeScript declaration marks it optional.
- Installed-app Claude Browser proof through `--claude-browser-live`; the packaged app resolves the SDK native Claude binary from `app.asar.unpacked` via `pathToClaudeCodeExecutable`.

Remaining SDK hardening:

- Decide whether approved SDK permissions should ever persist beyond the current run. The replacement currently keeps approval memory session-scoped.

## Open Risks

- Authentication and product terms: official docs say third-party products should use API-key authentication methods, not claude.ai login/rate limits, unless previously approved.
- Packaging: the TypeScript SDK bundles a native Claude Code binary as an optional dependency. Local Electron packaging is proven by `--claude-browser-live`; notarized distribution still needs release-specific validation.
- ESM/CJS and bundling: the SDK may require dynamic import or main-process-only packaging treatment.
- Permission persistence parity: session-scoped allow/deny is live-proven; any "always allow" UX still needs an explicit persistence policy to avoid unwanted `.claude/settings.local.json` writes.
- Tool security: SDK MCP tools can touch app internals, so the shared host-tool registry needs per-tool approvals and read/write classification.
- Event drift: docs explicitly mention `Task`/`Agent` naming drift, so the normalizer must accept both.
- Session storage: SDK sessions and subagent transcripts live in Claude's storage model; we need to decide what to mirror in Orchestrator and what to reference by provider id.

## Recommendation

The SDK replacement is ready on this branch. Follow-up cleanup should:

1. keep SDK fixture capture current as Claude Code event schemas change,
2. decide whether permission persistence beyond one run belongs in Orchestrator UX.

The old Claude CLI chat runtime should not be reintroduced as a fallback unless the SDK loses a capability that is both essential and not recoverable through the host-tool bridge.
