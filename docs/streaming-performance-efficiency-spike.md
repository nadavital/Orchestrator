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

### 1. Add A Background Streaming Scroll Smoke

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

Follow-on variants:

- `--background-streaming-drag`: same background `applyRunEvents` flood while exercising titlebar/window drag.
- right-panel/bottom-panel matrix: closed, agents/events tab open, bottom terminal open, both open.
- installed-app run: verify the same path in `/Applications/Orchestrator.app`, not only dev server.

### 2. Add A Main-Process Run Event Coalescer

All providers feed the same hot path: provider event, main-process normalization, `sessionManager.applyRunEvents()`, session persistence/IPC, renderer state. This is no longer Claude-specific.

Recommended path:

- Add a provider-agnostic `RunEventCoalescer` before `applyRunEvents()`.
- Merge `assistant.text.delta` events per `streamId` every 50-100 ms.
- Flush lifecycle, tool, permission, user-input, and completion events immediately.
- Record `eventsCoalesced`, `batchesFlushed`, `rawBytesDropped`, and `applyRunEvents.p95`.
- Replay the same synthetic event flood through Claude, Cursor, Copilot, Codex app-server, and generic normalizers.

Likely files:

- `src/main/sessions.ts`
- `src/main/providerRuntime.ts`
- `src/main/claudeSdkRuntime.ts`
- `src/main/copilotSdkRuntime.ts`
- `src/main/cursorSdkRuntime.ts`
- `src/main/codexAppServerRuntime.ts`

### 3. Make Thinking Cleanup Stateful

The thinking trace UI was removed/disabled as a likely efficiency risk, but cleanup can still scan active streaming records and session messages on common events. If no thinking-trace messages exist for a session, this should be an immediate no-op.

Recommended path:

- Track `hasThinkingTraceMessages` per session.
- Only run `clearThinkingTraceMessages()` when that flag is true.
- Clear once, then turn the flag off.
- Add a small unit test that many non-thinking events do not scan messages.

Likely files:

- `src/main/sessions.ts`

### 4. Move Active Streaming Message Overlays Out Of Broad Zustand

The recent `streamBuffers` fix moved raw/event diagnostics out of the broad session store. Active `streamingMessages` still lives in `useSessionStore`, so high-frequency active stream overlays can still wake subscribers that do not need them.

Recommended path:

- Extend `src/renderer/src/store/streamBuffers.ts` or add a sibling per-session streaming-message external store.
- Make `ChatView(sessionId)` subscribe to streaming overlays for only that session.
- Keep the durable message list in the session store for completed/checkpointed messages.
- Preserve inactive-session buffering and the existing 80 ms renderer cadence.

Likely files:

- `src/renderer/src/store/streamBuffers.ts`
- `src/renderer/src/store/sessions.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/Session/ChatView.tsx`

### 5. Virtualize Or Further Page Transcript Turns

Codex has a dedicated thread virtualizer. Orchestrator already pages older transcript messages and collapses turns, but the visible active transcript still maps/render-groups the current message set in React. Long agent transcripts and "x of x messages loaded" can still cause choppy layout and scroll work.

Recommended path:

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

### 6. Move Heavy Provider Normalization Off The Main Process Hot Path

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

### 7. Reduce Full Session Store Writes

There are still many `store.set('sessions', ...)` callsites. Some are low frequency and fine; others can be on run or lifecycle paths.

Recommended path:

- Route every write through `setSessionsStore` for metrics.
- Add reason metadata to remaining direct writes.
- Split durable session metadata from hot transcript/run state if store write metrics still show pauses.
- Persist hot transcript deltas on a lower cadence and flush on terminal lifecycle events.

Likely files:

- `src/main/sessions.ts`
- `src/main/performanceTelemetry.ts`

### 8. Split Sidebar Session Data From Transcript Data

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

### 9. Add Main-Process Event Loop Lag, IPC, And CPU Telemetry

The previous live investigation showed Orchestrator main CPU could spike while the Claude subprocess stayed low. We need direct regression gates for that.

Recommended path:

- Sample main-process event loop delay and event-loop utilization during streaming smokes.
- Count `session:messageUpdated`, `session:events`, and `session:raw` sends by session/window.
- Emit `main.eventLoopLag`, `main.providerEventQueueDepth`, `main.applyRunEvents.duration`, `main.sessionStoreSet.duration`, `ipcSendsPerSecond`, and `rawBytesPerSecond`.
- Include p95/max values in smoke output.
- Add a threshold that fails before the UI becomes unusable.

Likely files:

- `src/main/performanceTelemetry.ts`
- `src/main/index.ts`
- `scripts/run-automated-ui-smoke.mjs`

### 10. Gate Raw Diagnostics And Make Panels Visibility-Aware

Agent threads, plan, raw log, and diff-derived cards should not derive from events unless the relevant UI is visible or the active session needs a tiny badge. Raw SDK diagnostics are useful, but `JSON.stringify()` on every provider event plus string concatenation/slicing is expensive by default.

Already improved:

- Raw/event diagnostics no longer live in the broad session store.

Next steps:

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

### 11. Add Query Cache For Cold Data

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

### 12. Build A Live Provider Perf Harness

Synthetic event floods catch shared regressions, but the user specifically sees live Claude/Codex behavior. We need one repeatable live path when credentials/environment are available.

Recommended path:

- Add a live Claude responsiveness script that records first-token, main event-loop lag, renderer frame gaps, active scroll responsiveness, and provider process CPU.
- Add the same harness for Codex app-server where possible.
- Always distinguish provider latency from UI responsiveness.

Likely files:

- `scripts/claude-sdk-first-token-benchmark.mjs`
- `scripts/run-automated-ui-smoke.mjs`
- `src/main/providerRuntimeDiagnostics.ts`

### 13. A/B Test `MallocNanoZone=0`

Codex sets `MallocNanoZone=0` in its app bundle environment. This is plausibly relevant to packaged Electron/native allocation behavior, but it should be treated as an experiment.

Recommended path:

- Add a packaged-app launch variant with and without `MallocNanoZone=0`.
- Run background streaming typing/scroll smokes and live Claude harness against both.
- Keep only if measurements improve without regressions.

## Provider-Specific Notes

- Claude was the most visible trigger because the SDK can emit rich structured event streams and subagent/tool events.
- Codex app-server can still hit the same Orchestrator session store and renderer surfaces after protocol normalization.
- Copilot, Cursor, and generic providers share the same normalized `RunEvent` path, so provider-specific fixes are lower leverage than the shared event/session architecture.

## Suggested Implementation Order

1. Add `--background-streaming-scroll`, main event-loop lag, and IPC counters.
2. Make thinking-trace cleanup stateful.
3. Add provider-agnostic run-event coalescing before `applyRunEvents()`.
4. Move active `streamingMessages` to per-session external subscriptions.
5. Gate raw diagnostics and make agent/plan/diff derivation visibility-aware.
6. Reduce remaining direct `store.set('sessions')` calls and tag all persistence reasons.
7. Split sidebar summary state and lazy-load automation metadata.
8. Add turn-level transcript virtualization with cached offsets and anchor restoration.
9. Move heavy provider normalization/reduction off the Electron main hot path.
10. Add live Claude and Codex app-server perf harnesses for release verification.
11. A/B test `MallocNanoZone=0` in packaged builds.

## Open Questions

- Does the worst freeze correlate with main-process event-loop lag, renderer commit storms, or both?
- Is the worst active-thread scroll path dominated by transcript DOM size, markdown rendering, scroll anchoring, or sidebar/session updates?
- Do right panel and bottom panel open states materially increase commit counts during background streams?
- Should hot transcript state eventually move to an append-only SQLite/event-log shape instead of a single persisted session array?
