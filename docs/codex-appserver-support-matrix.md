# Codex App-Server Support Matrix

Last checked: 2026-05-14  
Local Codex CLI: `codex-cli 0.128.0`

## Research Basis

- Official Codex app-server README: `codex app-server` is the rich-interface API used by Codex clients. It is bidirectional JSON-RPC over JSONL stdio by default, with websocket/unix transports also documented.
- Official app-server schema generated locally with:
  - `codex app-server generate-ts --out /private/tmp/orchestrator-codex-app-ts`
  - `codex app-server generate-json-schema --out /private/tmp/orchestrator-codex-app-schema`
- Current Orchestrator implementation:
  - `src/main/codexAppServerRuntime.ts`
  - `src/main/providerRuntime.ts`
  - `src/main/providers.ts`
  - `src/main/sessions.ts`
  - `src/main/runEvents.ts`
  - `src/main/__tests__/codexAppServerRuntime.test.ts`
  - `src/main/__tests__/providers.test.ts`

## Status Legend

| Status | Meaning |
| --- | --- |
| Supported | Runtime, parser, and user-facing Orchestrator path exist. |
| Parsed | Orchestrator parses the app-server event/request, but UI may be generic or minimal. |
| Partial | Some equivalent behavior exists, but not the native app-server feature end to end. |
| Not wired | Present in app-server schema/docs, but Orchestrator does not call or surface it yet. |
| External | Handled by existing Orchestrator/non-app-server path instead of Codex app-server. |

## Executive Summary

| Capability area | Orchestrator status | Notes |
| --- | --- | --- |
| App-server stdio transport | Supported | Starts `codex app-server --listen stdio://`, sends `initialize`, then `initialized`. |
| Core chat loop | Supported | Starts/resumes thread and starts turns through app-server. |
| Follow-up while running | Supported | Uses `turn/steer` when an app-server turn is active. |
| Stop/interrupt | Supported | Uses `turn/interrupt` when a Codex app-server turn id is known. |
| Command/file/permission approvals | Supported | Handles `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and `item/permissions/requestApproval`; maps allow once/session/deny back to app-server responses. |
| User questions | Supported | Handles `item/tool/requestUserInput` and sends structured answers. |
| MCP elicitation | Supported | Handles `mcpServer/elicitation/request` and sends accept response. |
| Assistant streaming | Supported | Handles `item/agentMessage/delta` and suppresses duplicate final text. |
| Tool items | Parsed | Handles command, file change, MCP tool, dynamic tool, web search, image view/generation, review-mode, reasoning, hook, and compaction item shapes through existing generic cards/status messages. |
| Plan mode / plan updates | Supported | Handles `turn/plan/updated`; renders through existing plan state/UI path. |
| Goal updates | Parsed | Handles `thread/goal/updated` and `thread/goal/cleared` as status messages. No persistent goal panel yet. |
| Subagents / multi-agent | Parsed | Handles `collabAgentToolCall` as `agent.started/completed/failed`. Agent transcript depth still depends on emitted items we map. |
| Token usage | Partial | `thread/tokenUsage/updated` is currently a status message, not a full `UsageSummary` rollup. |
| Diff updates | Parsed | App-server `turn/diff/updated` becomes a `diff.updated` event/status. Orchestrator Diff panel still reads workspace git diff. |
| Side questions | External | `/btw` exists as Orchestrator-owned detached side question. It is not a Codex app-server same-thread side channel. |
| Review mode | Parsed | `enteredReviewMode` and `exitedReviewMode` render as status messages; `review/start` is not productized. Existing `/review` still uses Codex headless review. |
| Skills/plugins/apps browsers | Partial | Read-only app-server settings surfaces list skills, hooks, plugins, and apps. Read/install/configuration UI is still missing. |
| Account/model/config/filesystem/MCP management | Partial | Read-only app-server settings surfaces cover models, model-provider capabilities, auth/account/rate limits, config, config requirements, MCP status, external agent config detection, and thread lists. Filesystem and mutating management APIs are still not productized. |
| Realtime/audio | Parsed | Realtime/audio notifications are consumed as generic status/delta events. There is no voice/realtime UI. |
| Remote/unix/ws transports | Not wired | Orchestrator uses stdio only. |

## Client Request Methods

| App-server method group | Methods | Orchestrator support |
| --- | --- | --- |
| Initialization | `initialize` plus client `initialized` notification | Supported. |
| Thread create/resume | `thread/start`, `thread/resume` | Supported for normal Codex sessions. |
| Thread fork/history/list/read | `thread/fork`, `thread/list`, `thread/loaded/list`, `thread/read`, `thread/turns/list` | Partial. `thread/list` and `thread/loaded/list` are exposed as read-only settings surfaces; fork/read/turn listing are not productized. |
| Thread metadata/lifecycle | `thread/archive`, `thread/unarchive`, `thread/unsubscribe`, `thread/name/set`, `thread/metadata/update` | Not wired. |
| Thread context operations | `thread/compact/start`, `thread/rollback`, `thread/inject_items` | Not wired. |
| Thread shell command | `thread/shellCommand` | Not wired. Existing terminal/shell surfaces are Orchestrator-owned. |
| Guardian denied action | `thread/approveGuardianDeniedAction` | Not wired. |
| Turn execution | `turn/start`, `turn/steer`, `turn/interrupt` | Supported. |
| Review | `review/start` | Not wired. Review-mode items are parsed, but the app-server review starter is not productized. |
| Skills/hooks | `skills/list`, `skills/config/write`, `hooks/list` | Partial. `skills/list` and `hooks/list` are exposed as read-only settings surfaces; config write is not wired. |
| Plugin marketplace | `marketplace/add`, `marketplace/remove`, `marketplace/upgrade` | Not wired. |
| Plugins | `plugin/list`, `plugin/read`, `plugin/install`, `plugin/uninstall` | Partial. `plugin/list` is exposed as a read-only settings surface; read/install/uninstall are not wired. |
| Apps/connectors | `app/list` | Partial. `app/list` is exposed as a read-only settings surface. Mention input supports local attachments/files only; no app connector invocation UI. |
| Device key | `device/key/create`, `device/key/public`, `device/key/sign` | Not wired. |
| Filesystem | `fs/readFile`, `fs/writeFile`, `fs/createDirectory`, `fs/getMetadata`, `fs/readDirectory`, `fs/remove`, `fs/copy`, `fs/watch`, `fs/unwatch` | Not wired. Orchestrator uses its own filesystem/git paths where needed. |
| Model/provider info | `model/list`, `modelProvider/capabilities/read` | Supported as read-only app-server settings surfaces. Current composer model picker is still static/provider config. |
| Feature flags | `experimentalFeature/list`, `experimentalFeature/enablement/set` | Partial. Feature listing is exposed as a read-only settings surface; enablement mutation is not wired. |
| MCP management | `mcpServer/oauth/login`, `config/mcpServer/reload`, `mcpServerStatus/list`, `mcpServer/resource/read`, `mcpServer/tool/call` | Partial. `mcpServerStatus/list` is exposed as a read-only settings surface and runtime MCP tool calls are parsed; OAuth/reload/resource/tool-call management is not surfaced. |
| Windows sandbox | `windowsSandbox/setupStart` | Not wired. |
| Account/auth | `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`, `account/sendAddCreditsNudgeEmail`, `account/read`, legacy `getAuthStatus` | Partial. Account read, rate limits, and auth status are exposed as read-only settings surfaces; login/logout and credit nudge flows are not wired. |
| Feedback | `feedback/upload` | Not wired. |
| Command execution utility | `command/exec`, `command/exec/write`, `command/exec/terminate`, `command/exec/resize` | Not wired. Orchestrator provider runtime still owns process execution outside this utility API. |
| Config | `config/read`, `config/value/write`, `config/batchWrite`, `configRequirements/read` | Partial. Config read and config requirements are exposed as read-only settings surfaces; writes are not wired. |
| External agent config | `externalAgentConfig/detect`, `externalAgentConfig/import` | Partial. Detection is exposed as a read-only settings surface; import is not wired. |
| Conversation summary | `getConversationSummary` | Not wired. |
| Git diff helper | `gitDiffToRemote` | Not wired. |
| Fuzzy file search | `fuzzyFileSearch` | Not wired. |

## Server-Initiated Requests

| App-server server request | Orchestrator support | Notes |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | Supported | Maps to permission card; responds `accept`, `acceptForSession`, or `decline`. |
| `item/fileChange/requestApproval` | Supported | Maps to permission card; responds `accept`, `acceptForSession`, or `decline`. |
| `item/permissions/requestApproval` | Supported | Maps to permission card; on allow echoes requested profile with turn/session scope. |
| `item/tool/requestUserInput` | Supported | Maps to Answer Required card; responds with per-question answers. |
| `mcpServer/elicitation/request` | Supported | Maps to Answer Required card; responds with `accept` and content. |
| `item/tool/call` | Parsed/blocked | Orchestrator responds with a structured JSON-RPC unsupported-tool error instead of leaving the server request hanging. |
| `account/chatgptAuthTokens/refresh` | Parsed/blocked | Orchestrator responds with a structured unsupported-auth-refresh error because it relies on Codex CLI-managed auth. |
| `applyPatchApproval` | Supported | Legacy approval request maps to the existing permission card and responds `approved`, `approved_for_session`, or `denied`. |
| `execCommandApproval` | Supported | Legacy approval request maps to the existing permission card and responds `approved`, `approved_for_session`, or `denied`. |

## Notifications And Events

| App-server notification group | Notifications | Orchestrator support |
| --- | --- | --- |
| Errors | `error` | Supported as `run.failed`. |
| Thread start | `thread/started` | Supported as `session.started`. |
| Thread status/name/archive/closed | `thread/status/changed`, `thread/archived`, `thread/unarchived`, `thread/closed`, `thread/name/updated` | Parsed as generic status messages. |
| Goal | `thread/goal/updated`, `thread/goal/cleared` | Parsed into status messages. No dedicated goal UI. |
| Token usage | `thread/tokenUsage/updated` | Partial; status message only. |
| Turn lifecycle | `turn/started`, `turn/completed` | Supported/parsed. `turn/completed` drives run completion/failure; `turn/started` is a status message. |
| Plans | `turn/plan/updated`, `item/plan/delta` | `turn/plan/updated` supported. `item/plan/delta` currently streams text-like deltas. |
| Diff | `turn/diff/updated` | Parsed as `diff.updated`; existing Diff panel reads git diff separately. |
| Hook lifecycle | `hook/started`, `hook/completed` | Parsed as generic status messages. |
| Items | `item/started`, `item/completed` | Parsed for supported item types. |
| Assistant message streaming | `item/agentMessage/delta` | Supported. |
| Command output | `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `command/exec/outputDelta` | Output deltas are parsed as text deltas; terminal-interaction details are not productized. Completed command item output is parsed when included in the completed item. |
| File change output | `item/fileChange/outputDelta`, `item/fileChange/patchUpdated` | Output deltas and patch updates are parsed generically. Completed file change item is parsed generically. |
| MCP tool progress | `item/mcpToolCall/progress` | Parsed as a generic status message. Started/completed MCP tool items are parsed. |
| Auto-review/guardian | `item/autoApprovalReview/started`, `item/autoApprovalReview/completed`, `guardianWarning` | Parsed as generic status messages. |
| Server request resolution | `serverRequest/resolved` | Parsed as a generic status message. |
| Account/app/config/model updates | `account/updated`, `account/rateLimits/updated`, `app/list/updated`, `configWarning`, `model/rerouted`, `model/verification` | Parsed as generic status messages. |
| MCP/oauth/status updates | `mcpServer/oauthLogin/completed`, `mcpServer/startupStatus/updated` | Parsed as generic status messages. |
| External agent config import | `externalAgentConfig/import/completed` | Parsed as a generic status message. |
| Filesystem watch | `fs/changed` | Parsed as a generic status message. |
| Reasoning | `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, `item/reasoning/textDelta`, `rawResponseItem/completed` | Parsed as text deltas or generic status messages. No dedicated reasoning panel. |
| Compaction | `thread/compacted` | Parsed as a generic status message. |
| Warnings/deprecation | `warning`, `deprecationNotice`, `windows/worldWritableWarning` | Parsed as generic status messages. |
| Fuzzy file search | `fuzzyFileSearch/sessionUpdated`, `fuzzyFileSearch/sessionCompleted` | Parsed as generic status messages. |
| Realtime/audio | `thread/realtime/started`, `thread/realtime/itemAdded`, `thread/realtime/transcript/delta`, `thread/realtime/transcript/done`, `thread/realtime/outputAudio/delta`, `thread/realtime/sdp`, `thread/realtime/error`, `thread/realtime/closed` | Parsed as text deltas/status messages. No realtime/audio UI. |
| Windows sandbox | `windowsSandbox/setupCompleted` | Parsed as a generic status message. |
| Login completed | `account/login/completed` | Parsed as a generic status message. |

## Thread Item Types

| App-server item type | Orchestrator support | Notes |
| --- | --- | --- |
| `userMessage` | Not surfaced from notifications | User messages are already owned by Orchestrator when sent. |
| `hookPrompt` | Parsed | Renders through generic hook tool/status messages. No hook-specific UI. |
| `agentMessage` | Supported | Completed text and streamed deltas map to assistant messages. |
| `plan` | Partial | Plan deltas map as assistant deltas; structured plan state uses `turn/plan/updated`. |
| `reasoning` | Parsed | Reasoning summaries/content render as generic status/delta messages. No reasoning panel. |
| `commandExecution` | Parsed | Generic shell tool card on start/complete; output deltas are parsed as generic text deltas. |
| `fileChange` | Parsed | Generic `apply_patch` tool card on start/complete; patch/output notifications are parsed generically. |
| `mcpToolCall` | Parsed | Generic tool card on start/complete; progress notifications are parsed generically. |
| `dynamicToolCall` | Parsed | Generic tool card on start/complete. Server-initiated dynamic calls receive a structured unsupported response. |
| `collabAgentToolCall` | Parsed | Maps to agent lifecycle events. |
| `webSearch` | Parsed | Generic web search tool card on start/complete. |
| `imageView` | Parsed | Generic image-view tool card on start/complete. No dedicated viewer path. |
| `imageGeneration` | Parsed | Generic image-generation tool card on start/complete. No dedicated gallery/viewer path. |
| `enteredReviewMode` / `exitedReviewMode` | Parsed | Generic review-mode status messages. App-server review mode is not productized. |
| `contextCompaction` | Parsed | Generic compaction status message. |

## Feature-Specific Verdicts

| User-facing Codex feature | Current support | What works now | Missing for first-class parity |
| --- | --- | --- | --- |
| Goal | Parsed | `thread/goal/updated` and `thread/goal/cleared` become status messages. | Goal panel, set/get/clear commands, budget/progress controls. |
| Plan mode | Supported | `turn/plan/updated` feeds existing plan UI. | Real live fixture for Codex plan-producing turn. |
| Subagents | Parsed | `collabAgentToolCall` maps to agent lifecycle and existing Agents sidebar path. | Rich child transcript capture if Codex emits child-thread items separately; live multi-agent fixture. |
| Side questions | External | `/btw` side question exists as Orchestrator-owned detached provider call. | App-server-native same-thread side channel, if product wants Codex parity with Mac app behavior. |
| Approvals | Supported | Command/file/permission requests round-trip through app-server. | Live approval-producing Codex UI smoke and auto-review/guardian details. |
| MCP elicitation | Supported | Request maps to user input and responds through JSON-RPC. | Live MCP form fixture and structured schema-aware form UI. |
| Apps/connectors | Partial | `app/list` is available as a read-only app-server settings surface. | Browser/mention insertion with `app://...` and connector invocation UI. |
| Skills | Partial | `skills/list` and `hooks/list` are available as read-only app-server settings surfaces. Prompt can still mention `$skill`. | `skills/config/write`, skill picker, and native `skill` input items. |
| Plugins | Partial | `plugin/list` is available as a read-only app-server settings surface. | Marketplace/plugin read/install/uninstall UI and `plugin://...` mention insertion. |
| Review | Partial/external | Existing provider command surface can use headless review command; review-mode items are parsed. | `review/start` inline/detached app-server flow and review mode item UI. |
| Model/account/settings | Partial | Read-only settings surfaces cover models, model-provider capabilities, account/auth/rate limits, config, config requirements, and feature flags. | Promote app-server model/account data into primary settings controls and add safe write flows where needed. |
| Filesystem/search | External | Orchestrator has its own file refs/git diff paths. | App-server `fs/*`, `fs/watch`, fuzzy file search integration. |
| Realtime/audio | Parsed | Realtime transcript/audio lifecycle notifications are parsed as generic deltas/status. | Full realtime session and audio UI. |

## Recommended Next Implementation Slices

1. Codex Goal UI:
   - Keep `/goal ...` routed through the app-server turn and render the resulting `thread/goal/updated` state persistently.
   - Render a small Goal panel with objective, status, token budget, tokens used, and clear action.

2. Codex App/Skill/Plugin Browser:
   - Promote the read-only settings surfaces into a real browser/picker.
   - Add `plugin/read`, safe install/uninstall flows, and composer insertion for native `skill` and `mention` input items.

3. Codex Review Mode:
   - Add `review/start` for uncommitted/base/commit/custom targets.
   - Parse `enteredReviewMode` and `exitedReviewMode` into a review card/sidebar section.

4. Native App-Server Diff:
   - Feed `diff.updated` into the existing Diff panel or a Codex turn-diff card.
   - Decide how it coexists with the current workspace git-diff panel.

5. Rich Progress:
   - Replace generic command/file/MCP/reasoning status messages with dedicated progress UI where the product needs it.
   - Keep the generic parser coverage as the fallback for unknown app-server notifications.

6. Live Fixture Pack:
   - Capture real Codex app-server transcripts for plan, goal, subagent, approval, MCP elicitation, review, app mention, skill mention, and plugin mention flows.
