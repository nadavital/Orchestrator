# Codex Thread Rendering Parity Spike

## Goal

Make Orchestrator's main chat view behave like a stable thread surface rather than a collection of independently moving transcript, footer, lazy-load, and side-panel effects.

Completion evidence should include failing-then-passing visual stability smokes for streaming typing, live Claude streaming typing, long transcript paging, search/jump anchors, and side/bottom panel resizing.

## Local Codex Findings

The local Codex bundle splits thread rendering into dedicated primitives:

- `thread-scroll-layout-*`: owns the scroll container, footer resize preservation, scroll padding, user scroll listeners, distance-from-bottom state, and scroll-to-bottom/distance APIs.
- `thread-scroll-controller-context-value-*`: exposes a single controller for children that need scroll state or imperative scroll actions.
- `thread-virtualizer-*`: computes turn-keyed layouts from measured heights, top offsets, bottom offsets, total height, visible ranges, overscan, and scroll-to-key anchors.
- `local-conversation-thread-*`: derives visible turn entries, tracks the latest turn, passes virtualized turn lists through the thread layout, and handles latest-turn follow modes.
- `thread-user-message-navigation-rail-*`: navigates by stable user-message or turn keys rather than transient DOM row positions.

Two implementation details matter most for Orchestrator:

- Codex treats distance from bottom as a first-class coordinate. Bottom-following views do not rely only on top `scrollTop` math while live content above the footer grows.
- Footer resize is a scroll-layout concern. The footer height updates scroll padding and preserves the viewport through the same controller instead of dispatching an app-wide resize event and letting the transcript react later.

## Current Orchestrator Mismatch

`ChatView` currently owns too many responsibilities at once:

- transcript item derivation and turn collapsing
- measured row virtualization
- lazy history loading and prepend compensation
- search result hydration and jump positioning
- composer/footer reserve mirroring
- bottom-follow state and latest-activity affordance
- user-message navigation rail state

The result is multiple independent writers to visual position:

- `SessionPane` measures the composer overlay and dispatches `orchestrator:composer-reserve-changed`.
- `ChatView` stores that height, changes the internal transcript spacer, updates scroll metrics, and may schedule a later scroll-to-bottom.
- Streaming row growth updates measured virtual heights and recomputes the window while tail rows are still visible.
- History/loading/status rows live above the virtualized list and can change the physical list offset.

## First Implementation Slice

The initial flicker smoke now records:

- cumulative layout shift
- layout-shift source selectors
- virtual transcript row adds/removes
- composer reserve height samples and max delta
- primary content visibility changes

The first code slice stabilizes the active streaming typing path by:

- reserving the active-run send notice slot in the composer footer
- pinning the textarea height while a run is active so typed follow-up text scrolls inside the composer instead of resizing the overlay
- preserving bottom scroll in a layout effect when live transcript content changes
- disabling native overflow anchoring on the transcript scroller
- pinning active bottom-follow virtual ranges to the list bottom
- freezing row-height corrections while the user is following an active live run

Current measured progress:

- synthetic streaming typing now passes the strict visual gates
- live Claude streaming typing now passes the strict visual gates
- composer reserve delta dropped from `61px` to `0px`
- virtual row removals dropped from repeated churn to `0` in the latest stable slice
- typing dispatch and focus/editability remain healthy
- concurrent background streaming is covered by the synthetic streaming typing smoke while the active thread remains stable
- long transcript stress, transcript reserve, transcript layout, bottom-panel max, and right-panel smokes pass against this slice

## Scalable Architecture Landed

The clean scalable target is now represented by extracted Orchestrator primitives rather than more one-off effects inside `ChatView`:

- `useTranscriptScrollController`
  - owns the transcript scroller refs, bottom-follow state, scroll lockout state, jump-to-latest affordance, wheel/touch user intent, and frame-scheduled scroll work
- `buildVirtualTranscriptWindow`
  - computes measured heights, top offsets, bottom offsets, total height, visible range, overscan, and scroll-to-key by stable transcript item or turn key
- `transcriptVirtualLayout`
  - groups turn-keyed transcript items, estimates item heights, preserves collapsed/expanded hidden work, and gives search, lazy-load, and rail jumps stable message keys

Queued follow-ups now render in a bottom-pinned lane while the active thread is live and following bottom. That keeps queued actions visible and interactive without making them ordinary rows under a growing streaming assistant message. When the user scrolls away or the run settles, queued messages remain available through normal transcript rendering.

Future hardening should keep new features routed through these primitives: side chats, richer tool cards, alternate transcript filters, and multi-agent overlays should add stable transcript item keys or controller intents rather than directly mutating scroll position.

## Verification Matrix

Parity evidence from this slice:

- `npm run smoke:ui:auto -- --streaming-typing`
  - passing
  - visual layout stable
  - transcript row churn bounded
  - composer reserve stable
  - typing drift/input dispatch/frame gaps within thresholds
  - concurrent background streaming session updates while the active thread remains stable
- `npm run smoke:ui:auto -- --claude-live-streaming-typing`
  - passing
  - same visual stability gates against the provider-backed path
- long transcript stress smoke
  - passing via `npm run smoke:ui:auto -- --transcript-stress`
  - lazy load preserves anchor
  - search/jump targets land without visible hops
  - rail navigation uses stable turn/message keys
- side/bottom panel smoke
  - passing via `npm run smoke:ui:auto -- --bottom-panel-max`
  - passing via `npm run smoke:ui:auto -- --right-panel`
  - right sidebar open, bottom panel expanded, active stream running
  - footer reserve and latest-activity button remain correctly positioned
- multi-session streaming smoke
  - covered by `npm run smoke:ui:auto -- --streaming-typing`
  - multiple sessions can stream/update in store without inactive thread layout work causing visible active-thread jumps
