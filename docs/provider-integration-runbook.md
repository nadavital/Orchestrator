# Provider Integration Runbook

Last updated: 2026-05-27

Use this when adding or deepening Claude, Codex, Cursor, Copilot, or a future coding-agent provider. The durable rule is: provider-specific behavior belongs at the adapter/runtime boundary; UI should consume shared Orchestrator events, capabilities, and metadata whenever possible.

## Core Map

| Concern | Primary files | Notes |
| --- | --- | --- |
| Provider definitions, capabilities, command surfaces, output parsers | `src/main/providers.ts` | Start here for provider-specific CLI flags, supported features, and normalized `RunEvent` parsing. |
| Runtime launch and lifecycle routing | `src/main/providerRuntime.ts` | Chooses Codex app-server vs headless/interactive CLI runtimes, starts processes, and forwards parsed events into sessions. |
| Codex app-server transport | `src/main/codexAppServerRuntime.ts` | Codex-only JSON-RPC client for thread start/resume, turn start/steer/interrupt, approvals, user input, and app-server notifications. |
| Claude SDK transport | `src/main/claudeSdkRuntime.ts` | Claude-only SDK runtime for query/resume/stop, SDK object normalization, permissions, user questions, attachments, and SDK-local MCP host tools. |
| Provider host tools | `src/main/providerHostTools.ts` | Provider-neutral host-tool bridge adapted to Codex dynamic tools and Claude SDK-local MCP tools. |
| Provider manifests exposed to UI | `src/main/providerManifest.ts` | Converts adapters into runtime/capability manifests for renderer-visible provider state. |
| Shared event/message contract | `src/types/index.ts`, `src/main/runEvents.ts` | Add shared `RunEvent` fields here only when multiple surfaces can consume them. Keep provider-only details optional. |
| Sessions and sidebar metadata sync | `src/main/sessions.ts`, `src/main/providerSidebarSync.ts` | Handles persisted sessions, Codex thread-list metadata, after-run refresh, and recurring sidebar refresh. |
| Runtime diagnostics | `src/main/providerRuntimeDiagnostics.ts` | Use for live-provider debugging and supportability, especially app-server or reconnect work. |
| Provider resources/capabilities UI | `src/main/providerResources.ts`, `src/main/capabilitySync.ts`, `src/renderer/src/components/Session/ExtensionsPanel.tsx` | Shared skills/plugins/MCP/apps inventory and portable resource sync. |

## Implementation Order

1. Define the provider fact.
   Decide whether the feature is a real provider capability, a command surface, a normalized runtime event, a resource inventory item, or an Orchestrator-local UI affordance.

2. Wire the adapter first.
   Add provider-specific parsing or command construction in `src/main/providers.ts`. Prefer emitting existing shared `RunEvent` shapes. If a new event field is needed, make it optional and provider-neutral in `src/types/index.ts`.

3. Route through runtime/session boundaries.
   If the feature needs live runtime control, update `src/main/providerRuntime.ts` or the provider-specific runtime, such as `src/main/codexAppServerRuntime.ts`. Do not call provider APIs directly from renderer components.

4. Expose capability honestly.
   Update `ProviderCapabilities`, `ProviderCapabilityKey`, and `providerManifest` only after the provider path is actually wired or explicitly marked unavailable. Avoid using UI presence as proof of provider support.

5. Add focused tests.
   Add fixture parser tests in `src/main/__tests__/providers.test.ts`; runtime transport tests in provider runtime tests; and shared type/helper tests where the behavior is provider-neutral.

6. Add live proof when semantics matter.
   Use live scripts for provider behavior that fixtures cannot prove, especially app-server events, rollback/undo, browser-use, approvals, thread metadata, and resource inventory. Keep live proof artifacts under `tmp/` and document the result.

7. Update the durable docs.
   Update `docs/orchestrator-source-of-truth.md` for current state, provider-specific matrices for exact support, and `docs/codex-side-panel-live-comparison.md` when parity claims depend on live vs fixture evidence.

## Current Live-Proof Commands

| Command | What it proves | Current result |
| --- | --- | --- |
| `npm run live:providers` | General live provider smoke path. | Use when checking installed provider availability and basic runtime health. |
| `npm run live:claude-sdk-probe` | Claude Agent SDK capability/resource behavior. | Passed for plain, partial, message input, host tool, permission deny, plan, resume, and subagent scenarios. |
| `npm run live:claude-sdk-runtime` | Orchestrator Claude SDK runtime path. | Passed for basic completion. Also run `CLAUDE_SDK_RUNTIME_SMOKE_SCENARIO=user_question_resume`, `browser_tool`, `permission_allow`, `permission_deny`, and `stop` before claiming replacement parity. |
| `npm run smoke:ui:auto -- --installed --claude-browser-live` | Installed-app Claude SDK plus real Browser webview bridge. | Passed with Claude calling `mcp__orchestrator__browser_read` through the SDK-local MCP server and reading `Orchestrator Browser Smoke`; latest evidence `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-claude-browser-live-1779914938045.json`. |
| `npm run live:codex-appserver` | Basic Codex app-server thread/turn completion. | Proves the app-server transport can run a turn. |
| `npm run live:codex-browser-appserver` | Whether live Codex app-server exposes browser-use events/tools to this client. | Currently blocked at this stdio client boundary; no browser-use surface is exposed. |
| `npm run live:codex-review-appserver` | Live Codex `turn/diff/updated` and `thread/rollback` behavior. | Emits provider session/turn diff events with no checkpoint id; `thread/rollback` rolls back thread history but not workspace git diff. |

## Claude Integration Notes

Claude is currently an SDK provider in Orchestrator. Its special handling lives mostly in:

- `src/main/claudeSdkRuntime.ts` for SDK start/stream/stop, permissions, user questions, attachments, and host-tool bridging.
- `src/main/providerHostTools.ts` for shared Browser host-tool specs/calls used by both Claude SDK and Codex app-server adapters.
- `src/main/providers.ts` for policy mapping, capabilities, command surfaces, and output parsing.
- `src/main/providerRuntime.ts` for dispatching Claude runs to the SDK runtime.
- `src/main/approvalBroker.ts` for safe approval routing.
- `src/main/__fixtures__/providers/claude/` and `src/main/__tests__/providers.test.ts` for parser coverage.
- `docs/claude-code-support-test-matrix.md` and `docs/claude-cli-map.md` for current Claude-specific support.

When adding Claude parity for a Codex-style surface, do not copy Codex app-server assumptions. First ask:

- Does Claude emit equivalent runtime data, or do we need a Claude-specific command surface?
- Can that data normalize into an existing `RunEvent`, file metadata model, permission request, or resource row?
- Is this live-proven, fixture-proven, or just an intended adapter gap?
- Should the UI show the same control as enabled, disabled with an explicit reason, or absent for Claude?

Claude SDK `canUseTool` note: live testing showed an allowed SDK permission response must include `updatedInput` echoing the original tool input. Returning only `{ behavior: "allow" }` fails SDK validation even though the declaration file marks `updatedInput` optional.

Claude SDK packaging note: packaged Electron runs must pass `pathToClaudeCodeExecutable` pointing at the SDK native binary under `app.asar.unpacked`. Letting the SDK resolve an `app.asar` path can fail at spawn time with `ENOTDIR`.

## Provider Undo Boundary

Do not enable provider Last turn Undo unless the provider can restore the workspace changes, not just conversation history.

Current Codex evidence:

- Live `turn/diff/updated` events include provider session id and turn id.
- They do not include a checkpoint id.
- `thread/rollback` accepts `{ threadId, numTurns: 1 }` for persisted threads.
- That rollback removes turns from Codex thread history but leaves the edited workspace file and git diff unchanged.

Therefore Review Last turn Undo must remain disabled for provider diffs unless a future provider API restores the working tree or Orchestrator intentionally pairs provider-history rollback with a local git discard over exact provider diff paths.

## Verification Ladder

Use the narrowest useful check first, then widen only when the changed surface crosses boundaries.

1. Parser/type changes: `pnpm exec tsc --noEmit`, `npm run test:providers`, `git diff --check`.
2. Provider runtime changes: add/re-run provider runtime tests and the relevant `npm run live:*` proof if credentials/runtime are available.
3. UI parity changes: run the focused smoke for that surface.
4. Side-panel parity claims: run `npm run compare:codex-side-panels -- --no-fail`; run `--run-smoke --full` only when a stable slice needs the full screenshot inventory refreshed.
5. Shell/app-wide changes: run `npm run build` and the relevant right-panel/sidebar/browser/terminal/settings smokes.

## Documentation Rule

Every provider integration slice should leave one of these states in docs:

- `Live-proven`: backed by a live provider command/artifact.
- `Fixture-proven`: adapter/parser/UI behavior is covered, but live provider emission is not proven.
- `Unavailable`: provider or runtime does not expose the needed signal/API.
- `Product decision`: implementation is technically possible but needs an explicit UX/safety decision.
