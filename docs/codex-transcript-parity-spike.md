# Codex Transcript Parity Spike

## Scope

This spike compares Orchestrator transcript behavior with the installed Codex app bundle at:

`/Applications/Codex.app/Contents/Resources/app.asar`

The goal is transcript behavior parity, not private-source equivalence. The Codex app bundle is minified, so findings below are based on readable chunk names, exported helper behavior, and user-facing strings extracted from the packaged webview assets.

## Codex Findings

- Codex separates transcript history from rendering performance. It uses a dedicated `thread-virtualizer` asset that computes turn-keyed layouts from measured heights, top/bottom offsets, visible ranges, anchors, and scroll-to-key behavior.
- Codex persists scroll restore state around `distanceFromBottomPx` and `virtualizedTurnList`, so switching threads does not depend on re-rendering a fixed message slice.
- Codex is turn-centric. The local conversation page derives `visibleTurnEntries`, renders a virtualized turn list, and routes search/navigation through turn keys.
- Codex collapses the completed turn's agent body, not the whole turn. The user message and final assistant answer remain visible anchors; intermediate agent/tool activity is hidden behind an inline toggle.
- Codex allows collapse only after final assistant output has started, when the turn is not cancelled, has renderable agent activity, and is not blocked by pending or special visible state. The latest/current turn remains expanded by default, and the previous latest turn auto-collapses as newer turns appear.
- Codex provides a user-message navigation rail for long conversations instead of surfacing "hidden messages" as a primary transcript state. The rail tracks the currently visible user message, renders subtle horizontal tick marks on the left side of the thread, and exposes a richer hover/focus list for labels.

## Orchestrator Before

- `ChatView` sliced loaded messages with `renderLimit` and initially showed only the last 40 messages.
- The UI called all non-rendered earlier loaded messages "hidden", even when they were already present in memory.
- The same code path mixed paging, performance virtualization, and UX hiding.
- Search/focus paths had to override `renderLimit` to make older messages reachable.

## Orchestrator Direction

- Keep paging only for unloaded history.
- Render all currently loaded messages through virtualization.
- Derive provider-agnostic turns from `ChatMessage[]` by starting a new turn at each user text message.
- Collapse older completed turn bodies by default while keeping each user message and final assistant answer visible.
- Keep the latest, streaming, cancelled/error, and pending-interaction turns expanded.
- Expand a collapsed turn before search/focus scrolls to a message inside it.

## Verification Targets

- Unit tests for provider-agnostic turn grouping and collapse eligibility.
- Type/build checks for renderer and shared types.
- UI smoke against the repo/dev harness only, not the locally installed Orchestrator app.
