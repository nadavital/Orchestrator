# Streaming Performance Efficiency Spike

Date: 2026-06-16

## Goal

Make Orchestrator stay responsive while one or more provider runs stream in the background and the user is reading, scrolling, typing, resizing panels, or moving the window in another thread.

This spike focuses on provider-agnostic bottlenecks. Claude exposed the pain most clearly, but the risky surfaces are shared by Codex app-server, Claude SDK, Copilot SDK, Cursor, and generic headless providers once their events enter Orchestrator.

## Current Fixes Already Landed

- Main-process streaming assistant text persistence is buffered through `activeStreamingMessages` in `src/main/sessions.ts`.
- Main-process raw/event IPC is batched through `pendingRunEvents` and `pendingRunRaw` in `src/main/sessions.ts`.
- Inactive renderer stream updates are buffered in `src/renderer/src/App.tsx`.
- Renderer diagnostic stream buffers now live in `src/renderer/src/store/streamBuffers.ts` instead of the broad Zustand session store, so raw/event diagnostics are scoped to per-session subscribers.
- The `--background-streaming-typing` smoke verifies frame gaps, typing timer drift, input dispatch, commit counts, and hidden background stream text.
- The `--background-streaming-scroll` smoke verifies active-thread scroll responsiveness while another thread streams, including renderer frame gaps, scroll frame cadence, scroll dispatch time, commit counts, main-process event-loop lag, and IPC counts.
- Provider streaming text deltas are coalesced before `sessionManager.applyRunEvents()` on the live provider path, while lifecycle, tool, permission, user-input, and completion events flush immediately.
- Active streaming message overlays now live in per-session external subscriptions in `src/renderer/src/store/streamBuffers.ts` instead of broad Zustand session state.
- Thinking trace cleanup is stateful and immediately no-ops for sessions that do not contain thinking trace messages.
- Transcript scroll metric state updates are throttled to reduce React work during active scrolling while native scroll remains responsive.
- Raw diagnostics are renderer visibility-aware: active-session raw data is buffered while the events/agents panel is closed and only published to the raw-log store when the panel is visible.
- Every durable `store.set('sessions', ...)` path in `src/main/sessions.ts` is routed through `setSessionsStore()` with reason metadata, including low-frequency pinning, worktree, permission, settings, and review metadata writes.

## Completion Status

The required items for the current responsiveness parity target are complete as of 2026-06-16. The remaining entries in this document are marked as either `Done` or `Deferred`. Deferred items are larger architecture bets or environment-dependent experiments, not unhandled required work for the current pass.

Verification evidence for the completed pass:

- `npm run build` passed.
- `npm run test:providers` passed with `365/365` tests.
- `node scripts/run-automated-ui-smoke.mjs --background-streaming-scroll` passed after the scroll/controller tranche.
- Latest focused scroll smoke passed with `ChatView` commits at `24`, max frame gap `58.4ms`, p95 scroll frame delta `34.5ms`, p95 scroll dispatch `0.1ms`, and main-process event-loop lag p95 `11.2ms`.

## Lessons From The Local Codex App

The packaged Codex app points to several useful architecture choices:

- Thread state is split into narrower signal/query surfaces instead of one broad session store.
- Sidebar rows derive small per-thread fields from signal selectors, reducing unrelated row wakeups.
- Thread rendering has dedicated virtualizer and scroll-controller modules.
- App-server/runtime/FS work is brokered through worker/main RPC and query invalidation rather than direct broad renderer state mutation.
- Non-hot data uses query-cache semantics: pinned threads, worktrees, git branch, PR status, approvals, open targets, and similar state are loaded and invalidated separately from live transcript rendering.
- The app appears to benefit from generated React memoization in compiled assets. That is useful context, but it should not outrank state-boundary and virtualization work.
- The app carries process-level choices such as `MallocNanoZone=0`, native execution, and graphics switching support in its bundle metadata. `MallocNanoZone=0` is worth A/B testing, not assuming.

We should copy the principles, not the implementation details: narrow subscriptions, bounded work per frame, virtualization, worker boundaries, and explicit perf gates.

## Highest-Impact Backlog

### 1. Add A Background Streaming Scroll Smoke - Done

The current background smoke proves typing responsiveness, but the user-reported failure is also reading and scrolling an idle thread while another thread streams.

Add a smoke variant that:

- Opens an idle active thread with a long transcript.
- Starts high-frequency background `sessionManager.applyRunEvents` on another thread.
- Repeatedly scrolls the active transcript container while the background stream runs.
- Measures max frame gap, scroll dispatch duration, scrollTop progress, dropped scroll samples, and active-thread commit counts.
- Runs with right panel open and closed.

Likely files:

- `src/main/index.ts`
- `scripts/run-automated-ui-smoke.mjs`
- `src/renderer/src/components/Session/ChatView.tsx`

Success gate proposal:

- `maxFrameGapMs < 120`
- `p95ScrollDispatchMs < 24`
- `mainEventLoopDelayP95Ms < 50`
- active transcript scroll position changes on every sampled burst
- active `ChatView`, `SessionPane`, `Sidebar`, and `App` commits stay bounded

Follow-on variants deferred:

- `--background-streaming-drag`: same background `applyRunEvents` flood while exercising titlebar/window drag.
- right-panel/bottom-panel matrix: closed, agents/events tab open, bottom terminal open, both open.
- installed-app run: verify the same path in `/Applications/Orchestrator.app`, not only dev server.

### 2. Add A Main-Process Run Event Coalescer - Done

All providers feed the same hot path: provider event, main-process normalization, `sessionManager.applyRunEvents()`, session persistence/IPC, renderer state. This is no longer Claude-specific.

Completed path:

- Added provider-agnostic `coalesceRunEvents()` in `src/main/runEventCoalescer.ts`.
- Added an 80 ms live-provider text-delta queue in `sessionManager.startProviderRun()` before `applyRunEvents()`.
- Flushes lifecycle, tool, permission, user-input, and completion events immediately.
- Records `incomingEvents` and `coalescedDeltas` in `session.applyRunEvents` telemetry.
- Added focused coalescer tests for adjacent deltas, replacement semantics, and ordering boundaries.

Likely files:

- `src/main/sessions.ts`
- `src/main/providerRuntime.ts`
- `src/main/claudeSdkRuntime.ts`
- `src/main/copilotSdkRuntime.ts`
- `src/main/cursorSdkRuntime.ts`
- `src/main/codexAppServerRuntime.ts`

### 3. Make Thinking Cleanup Stateful - Done

The thinking trace UI was removed/disabled as a likely efficiency risk, but cleanup can still scan active streaming records and session messages on common events. If no thinking-trace messages exist for a session, this should be an immediate no-op.

Completed path:

- Tracks `sessionsWithThinkingTraceMessages` per session.
- `clearThinkingTraceMessages()` returns immediately when no thinking trace messages exist.
- Clears the session flag after cleanup.
- Covered by `npm run test:providers`; a narrower white-box scan-count test remains unnecessary unless this code is extracted to a pure helper.

Likely files:

- `src/main/sessions.ts`

### 4. Move Active Streaming Message Overlays Out Of Broad Zustand - Done

The recent `streamBuffers` fix moved raw/event diagnostics out of the broad session store. Active `streamingMessages` still lives in `useSessionStore`, so high-frequency active stream overlays can still wake subscribers that do not need them.

Completed path:

- Extended `src/renderer/src/store/streamBuffers.ts` with per-session streaming message overlays.
- `ChatView(sessionId)` subscribes with `useSessionStreamingMessages(session.id)`.
- Durable completed/checkpointed messages remain in the session store.
- Inactive-session buffering and the 80 ms renderer cadence are preserved.

Likely files:

- `src/renderer/src/store/streamBuffers.ts`
- `src/renderer/src/store/sessions.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/Session/ChatView.tsx`

### 5. Virtualize Or Further Page Transcript Turns - Deferred

Codex has a dedicated thread virtualizer. Orchestrator already pages older transcript messages and collapses turns, but the visible active transcript still maps/render-groups the current message set in React. Long agent transcripts and "x of x messages loaded" can still cause choppy layout and scroll work.

Deferred path:

- Virtualize by transcript turn group rather than individual raw messages.
- Cache turn layouts by message/turn version and expanded-turn state.
- Replace linear visible-window scans with precomputed offsets and binary-search range lookup.
- Preserve bottom-follow behavior and search jump behavior through stable turn anchors.
- Keep the latest running turn always mounted.
- Keep permission/user-input cards mounted when waiting.
- Store measured turn heights and restore scroll by anchor plus distance-from-bottom.

Likely files:

- `src/renderer/src/components/Session/ChatView.tsx`
- `src/renderer/src/components/Session/useTranscriptScrollController.ts`
- `src/renderer/src/components/Session/transcriptVirtualLayout.ts`
- `src/types/transcriptView.ts`

Current state: Orchestrator already has transcript paging, turn grouping/collapse, virtual-window layout, stable anchor restoration, and the focused scroll smoke now passes under background streaming. A deeper turn-level virtualizer rewrite remains a future architecture project, not required for the current responsiveness gate.

### 6. Move Heavy Provider Normalization Off The Main Process Hot Path - Deferred

`src/main/sessions.ts` still runs `applyRunEvents` lifecycle decisions, message conversion, active tool state updates, usage merging, browser patch emission, and store persistence coordination on Electron's main process. When providers emit frequent events, this can still block window responsiveness even if the renderer is efficient.

Recommended path:

- Introduce a provider-event reducer queue with a time budget.
- Coalesce events by session before lifecycle/message conversion.
- Consider a worker thread for event normalization and heavy derived data.
- Keep Electron main responsible for final session mutation and IPC only.

Likely files:

- `src/main/sessions.ts`
- `src/main/providerRuntime.ts`
- `src/main/claudeSdkRuntime.ts`
- `src/main/codexAppServerRuntime.ts`

Current state: the live-provider text-delta queue reduces the hot event rate before `applyRunEvents()`, and `applyRunEvents` batches/coalesces incoming deltas. Moving normalization to a worker thread is a larger risk and should be reconsidered only if main-process event-loop lag smokes regress.

### 7. Reduce Full Session Store Writes - Done

There are still many `store.set('sessions', ...)` callsites. Some are low frequency and fine; others can be on run or lifecycle paths.

Completed path:

- Every remaining durable session write in `src/main/sessions.ts` routes through `setSessionsStore()`.
- Reason metadata is attached to low-frequency writes as well as hot transcript/run writes.
- Hot transcript deltas are already persisted on a lower cadence and flushed on terminal lifecycle events.
- Splitting durable metadata from transcript/run state is deferred until metrics show store writes are still a bottleneck.

Likely files:

- `src/main/sessions.ts`
- `src/main/performanceTelemetry.ts`

### 8. Split Sidebar Session Data From Transcript Data - Deferred

The sidebar only needs title, status, provider, unread, pin/project grouping, recency, and tiny previews. It should never be coupled to large message arrays or high-frequency stream updates.

Recommended path:

- Keep a stable session summary index in renderer state.
- Update summaries only when summary fields change.
- Memoize or externalize per-row status/metadata subscriptions.
- Lazy-load sidebar automation metadata or provide one summary API instead of per-row mount IPC.
- Add a sidebar row commit smoke under background streaming.

Likely files:

- `src/renderer/src/store/sessions.ts`
- `src/renderer/src/components/Sidebar/Sidebar.tsx`
- `src/renderer/src/components/Sidebar/SessionItem.tsx`

Current state: background streaming scroll and typing smokes now bound sidebar commit counts. A dedicated sidebar summary index is still a useful future cleanup, but it is deferred because current smoke gates pass and active streaming overlays/raw diagnostics no longer wake broad transcript state.

### 9. Add Main-Process Event Loop Lag, IPC, And CPU Telemetry - Done

The previous live investigation showed Orchestrator main CPU could spike while the Claude subprocess stayed low. We need direct regression gates for that.

Completed path:

- Samples main-process event-loop delay and utilization during `--background-streaming-scroll`.
- Counts `session:messageUpdated`, `session:events`, and `session:raw` sends by channel/window through smoke-gated `session.ipc.send` metrics.
- Existing telemetry covers `session.applyRunEvents` and `sessions.store.set` durations.
- Smoke output includes p95/max lag and IPC counts with thresholds.
- Provider queue depth, CPU, and raw-bytes-per-second remain candidates for the live provider harness, not required for the current synthetic gate.

Likely files:

- `src/main/performanceTelemetry.ts`
- `src/main/index.ts`
- `scripts/run-automated-ui-smoke.mjs`

### 10. Gate Raw Diagnostics And Make Panels Visibility-Aware - Partly Done, Remaining Work Deferred

Agent threads, plan, raw log, and diff-derived cards should not derive from events unless the relevant UI is visible or the active session needs a tiny badge. Raw SDK diagnostics are useful, but `JSON.stringify()` on every provider event plus string concatenation/slicing is expensive by default.

Already improved:

- Raw/event diagnostics no longer live in the broad session store.

Completed path:

- Raw/event diagnostics no longer live in the broad session store.
- Active-session raw diagnostics are buffered while the events/agents panel is closed and only published to the raw-log store when visible.

Deferred path:

- Avoid deriving full agent thread trees in `ContextSidebar` unless the agents tab is visible or a small live-agent badge needs it.
- Compute lightweight counters separately from full panels.
- Defer raw log rendering and provider-event `JSON.stringify()` until diagnostics are visible or debug logging is enabled.
- Store raw diagnostics as chunk arrays/ring buffers instead of repeated string concat/slice.

Likely files:

- `src/main/claudeSdkRuntime.ts`
- `src/main/copilotSdkRuntime.ts`
- `src/main/cursorSdkRuntime.ts`
- `src/renderer/src/components/Session/ContextSidebar.tsx`
- `src/renderer/src/components/Session/EventInspectorPanel.tsx`
- `src/renderer/src/components/Session/agentNodes.ts`

### 11. Add Query Cache For Cold Data - Deferred

Codex separates cold server data from live stream state with query-cache semantics. Orchestrator still calls IPC directly for many non-streaming reads.

Recommended path:

- Add a query layer for archived summaries, provider diagnostics, git branch/status, automations, worktrees, capabilities, and transcript pages.
- Keep live token streams out of the query cache.
- Use explicit invalidation after provider runs, settings changes, or file/worktree changes.

Likely files:

- `src/renderer/src/App.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/components/Sidebar/SessionItem.tsx`
- `src/main/ipc.ts`

Current state: useful, but outside the current streaming responsiveness fix. It should be planned separately because it touches settings, sidebar, automations, worktrees, capabilities, transcript pages, and invalidation semantics.

### 12. Build A Live Provider Perf Harness - Deferred

Synthetic event floods catch shared regressions, but the user specifically sees live Claude/Codex behavior. We need one repeatable live path when credentials/environment are available.

Recommended path:

- Add a live Claude responsiveness script that records first-token, main event-loop lag, renderer frame gaps, active scroll responsiveness, and provider process CPU.
- Add the same harness for Codex app-server where possible.
- Always distinguish provider latency from UI responsiveness.

Likely files:

- `scripts/claude-sdk-first-token-benchmark.mjs`
- `scripts/run-automated-ui-smoke.mjs`
- `src/main/providerRuntimeDiagnostics.ts`

Current state: synthetic smokes now cover shared UI responsiveness. Live Claude/Codex harnesses are still valuable, but they require credentials/provider availability and should be run as a release-verification workflow rather than a required local code change in this pass.

### 13. A/B Test `MallocNanoZone=0` - Deferred

Codex sets `MallocNanoZone=0` in its app bundle environment. This is plausibly relevant to packaged Electron/native allocation behavior, but it should be treated as an experiment.

Recommended path:

- Add a packaged-app launch variant with and without `MallocNanoZone=0`.
- Run background streaming typing/scroll smokes and live Claude harness against both.
- Keep only if measurements improve without regressions.

Current state: deferred until packaged-app performance testing. It is an experiment, not an assumed optimization.

## Provider-Specific Notes

- Claude was the most visible trigger because the SDK can emit rich structured event streams and subagent/tool events.
- Codex app-server can still hit the same Orchestrator session store and renderer surfaces after protocol normalization.
- Copilot, Cursor, and generic providers share the same normalized `RunEvent` path, so provider-specific fixes are lower leverage than the shared event/session architecture.

## Suggested Implementation Order

1. Done: add `--background-streaming-scroll`, main event-loop lag, and IPC counters.
2. Done: make thinking-trace cleanup stateful.
3. Done: add provider-agnostic run-event coalescing before `applyRunEvents()`.
4. Done: move active `streamingMessages` to per-session external subscriptions.
5. Partly done: gate raw diagnostics when panels are hidden; deeper agent/plan/diff derivation gating is deferred.
6. Done: reduce remaining direct `store.set('sessions')` calls and tag all persistence reasons.
7. Deferred: split sidebar summary state and lazy-load automation metadata.
8. Deferred: add turn-level transcript virtualization with cached offsets and anchor restoration.
9. Deferred: move heavy provider normalization/reduction off the Electron main hot path.
10. Deferred: add live Claude and Codex app-server perf harnesses for release verification.
11. Deferred: A/B test `MallocNanoZone=0` in packaged builds.

## Open Questions

- Does the worst freeze correlate with main-process event-loop lag, renderer commit storms, or both?
- Is the worst active-thread scroll path dominated by transcript DOM size, markdown rendering, scroll anchoring, or sidebar/session updates?
- Do right panel and bottom panel open states materially increase commit counts during background streams?
- Should hot transcript state eventually move to an append-only SQLite/event-log shape instead of a single persisted session array?
