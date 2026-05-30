# Provider Integration Runbook

Last updated: 2026-05-30

Use this when adding or deepening Claude, Codex, Cursor, Copilot, or a future coding-agent provider. The durable rule is: provider-specific behavior belongs at the adapter/runtime boundary; UI should consume shared Orchestrator events, capabilities, and metadata whenever possible.

## Core Map

| Concern | Primary files | Notes |
| --- | --- | --- |
| Provider definitions, capabilities, command surfaces, output parsers | `src/main/providers.ts` | Start here for provider-specific CLI flags, supported features, and normalized `RunEvent` parsing. |
| Runtime launch and lifecycle routing | `src/main/providerRuntime.ts` | Chooses Codex app-server vs headless/interactive CLI runtimes, starts processes, and forwards parsed events into sessions. |
| Codex app-server transport | `src/main/codexAppServerRuntime.ts` | Codex-only JSON-RPC client for thread start/resume, turn start/steer/interrupt, approvals, user input, and app-server notifications. |
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
| `npm run live:claude-capabilities` | Claude capability/resource behavior. | Refreshed 2026-05-30: current environment is unavailable for structured Claude proof. `claude --version` reports `2.1.51`, `auth status`, MCP, plugin, and agents probes pass, but `claude auto-mode defaults` returns API 401 invalid credentials, so the harness skips quota-using structured scenarios. Artifact: `/Users/nadav/Desktop/Orchestrator/tmp/claude-live-capabilities/_summary/summary.json`. |
| `npm run live:codex-appserver` | Basic Codex app-server thread/turn completion. | Proves the app-server transport can run a turn. |
| `npm run live:codex-browser-appserver` | Whether live Codex app-server exposes browser-use events/tools to this client. | Refreshed 2026-05-30: still blocked at this stdio client boundary. The live turn completed with `session.started`, assistant deltas, tool started/completed items, and `run.completed`, but emitted 0 browser-use events, sent 0 browser/tool server requests, and replied `CODEX_BROWSER_LIVE_NO_BROWSER`. Artifact: `/Users/nadav/Desktop/Orchestrator/tmp/codex-browser-appserver-live-proof/result.json`. |
| `npm run live:codex-pinned-threads` | Codex sidebar thread-list and pinned-thread mutation boundary. | Refreshed 2026-05-30: proves `thread/list` is supported through the live app-server while `list-pinned-threads`, `set-thread-pinned`, and `set-pinned-threads-order` currently return unknown-variant errors. Orchestrator must keep provider-projected pin actions read-only until a supported mutation route exists. Artifact: `/Users/nadav/Desktop/Orchestrator/tmp/codex-pinned-threads-live-proof/result.json`. |
| `npm run live:codex-review-appserver` | Live Codex `turn/diff/updated` and `thread/rollback` behavior. | Refreshed 2026-05-30: emits provider session/turn diff events with no checkpoint id; `thread/rollback` rolls back thread history but not workspace git diff. Artifact: `/Users/nadav/Desktop/Orchestrator/tmp/codex-review-appserver-live-proof/result.json`. |
| `pnpm run live:codex-review-start` | Native Codex app-server `review/start` behavior. | Proves uncommitted inline, base-branch inline, commit inline, and custom-instruction inline review targets start real review turns and emit typed `review.mode.changed` events. Use only for Review slices, not routine UI smoke; normal UI checks should use the focused Review smoke. |

Provider Settings should surface auth failures from any safe no-quota probe, not only a provider's explicit auth command. For Claude, `auto-mode defaults` is a no-quota readiness probe; API 401 invalid credentials there should make the Auth row show an error before the user starts a run.

## Claude Integration Notes

Claude is currently a headless CLI provider in Orchestrator. Its special handling lives mostly in:

- `src/main/providers.ts` for command construction, capabilities, command surfaces, and output parsing.
- `src/main/providerRuntime.ts` for Claude approval broker preparation before headless runs.
- `src/main/approvalBroker.ts` for safe approval routing.
- `src/main/__fixtures__/providers/claude/` and `src/main/__tests__/providers.test.ts` for parser coverage.
- `docs/claude-code-support-test-matrix.md` and `docs/claude-cli-map.md` for current Claude-specific support.

When adding Claude parity for a Codex-style surface, do not copy Codex app-server assumptions. First ask:

- Does Claude emit equivalent runtime data, or do we need a Claude-specific command surface?
- Can that data normalize into an existing `RunEvent`, file metadata model, permission request, or resource row?
- Is this live-proven, fixture-proven, or just an intended adapter gap?
- Should the UI show the same control as enabled, disabled with an explicit reason, or absent for Claude?

## Provider Undo Boundary

Do not enable provider Last turn Undo unless the provider can restore the workspace changes, not just conversation history.

Current Codex evidence:

- Live `turn/diff/updated` events include provider session id and turn id.
- They do not include a checkpoint id.
- `thread/rollback` accepts `{ threadId, numTurns: 1 }` for persisted threads.
- That rollback removes turns from Codex thread history but leaves the edited workspace file and git diff unchanged.
- Latest evidence: elevated `npm run live:codex-review-appserver` on 2026-05-30 produced 3 normalized diff events, `checkpointIds=[]`, a successful `numTurns:1` rollback attempt, and confirmed the proof file plus git diff were still edited after rollback.

Current Orchestrator fallback:

- Last turn Review can reverse-apply the exact provider unified diff locally with `git apply --reverse`.
- This restores workspace files only when the patch still applies cleanly and refuses unsafe paths.
- It does not rewrite provider thread history and must not be described as provider checkpoint rollback.

Therefore provider-history checkpoint Undo remains disabled unless a future provider API restores both provider history and workspace changes. The local reverse-patch action is a workspace fallback for daily coding, not a provider rollback adapter.

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
