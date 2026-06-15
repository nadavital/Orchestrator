# Codex Transcript Parity Spike

## Scope

This spike compares Orchestrator transcript behavior with the installed Codex app bundle at:

`/Applications/Codex.app/Contents/Resources/app.asar`

The goal is transcript behavior parity, not private-source equivalence. The Codex app bundle is minified, so findings below are based on readable chunk names, exported helper behavior, and user-facing strings extracted from the packaged webview assets.

## Codex Findings

- Codex separates transcript history from rendering performance. It uses a dedicated `thread-virtualizer` asset that computes turn-keyed layouts from measured heights, top/bottom offsets, visible ranges, anchors, and scroll-to-key behavior.
- Codex persists scroll restore state around `distanceFromBottomPx` and `virtualizedTurnList`, so switching threads does not depend on re-rendering a fixed message slice.
- Codex is turn-centric. The local conversation page derives `visibleTurnEntries`, renders a virtualized turn list, and routes search/navigation through turn keys.
- Codex collapses older completed turns as new latest turns appear. The minified local conversation thread keeps the current/latest turn expanded, keeps pending or special resource turns visible, and stores collapsed state by turn id.
- Codex provides a user-message navigation rail for long conversations instead of surfacing "hidden messages" as a primary transcript state.

## Orchestrator Before

- `ChatView` sliced loaded messages with `renderLimit` and initially showed only the last 40 messages.
- The UI called all non-rendered earlier loaded messages "hidden", even when they were already present in memory.
- The same code path mixed paging, performance virtualization, and UX hiding.
- Search/focus paths had to override `renderLimit` to make older messages reachable.

## Orchestrator Direction

- Keep paging only for unloaded history.
- Render all currently loaded messages through virtualization.
- Derive provider-agnostic turns from `ChatMessage[]` by starting a new turn at each user text message.
- Collapse older completed turns by default while keeping the latest, streaming, and pending-interaction turns expanded.
- Expand a collapsed turn before search/focus scrolls to a message inside it.

## Verification Targets

- Unit tests for provider-agnostic turn grouping and collapse eligibility.
- Type/build checks for renderer and shared types.
- UI smoke against the repo/dev harness only, not the locally installed Orchestrator app.
