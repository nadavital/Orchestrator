# Codex Hover Chip Parity Spike

Date: 2026-06-04

## Scope

This spike compares Codex app hover chips, tooltips, and hover action surfaces against Orchestrator. The focus is the jarring hover behavior seen around top chrome and side-panel controls, including chips that appear or disappear over the macOS traffic-light area.

Evidence sources:

- Codex app bundle: `/Applications/Codex.app/Contents/Resources/app.asar`, extracted to `/private/tmp/codex-app-asar-hover-spike`.
- Codex tooltip bundle: `/private/tmp/codex-app-asar-hover-spike/webview/assets/tooltip-BhXPONlb.js`.
- Codex side-panel bundle: `/private/tmp/codex-app-asar-hover-spike/webview/assets/thread-side-panel-tabs-BiJ44OOM.js`.
- Orchestrator tooltip primitive: `src/renderer/src/components/shared/designSystem.tsx`.
- Orchestrator hover/action CSS: `src/renderer/src/index.css`.
- Orchestrator sidebar hover-card implementation: `src/renderer/src/components/Sidebar/SessionItem.tsx`.
- Orchestrator smoke coverage: `src/main/index.ts`.

## Summary

Codex uses a mature Floating UI tooltip primitive with collision handling, active-tooltip coordination, skip-delay handoff, focus-visible semantics, overflow-only mode, and zoom-aware portal placement. The original Orchestrator spike found a hand-rolled fixed-position tooltip that corrected its position after render and applied global hover scale to `motion-icon-button`, including shell/titlebar/panel controls.

That difference explains most of the observed weirdness:

- Orchestrator can render a tooltip at an initial approximate position, then move it on the next layout pass.
- Orchestrator opens immediately through `onMouseOver`, bypassing its own 700ms delay.
- Orchestrator top-edge placement only checks `rect.top < 38`, not collision with traffic lights, titlebar chrome, visual viewport, zoom, or side-panel bounds.
- Orchestrator tooltip exit uses transform transitions in the document body portal, so stale chips can visibly animate across unrelated chrome when the anchor disappears.
- Orchestrator scales icon buttons on hover, which moves the target while the tooltip is being scheduled and positioned.

## Current Implementation Status

Updated: 2026-06-04

The main local hover-chip parity work is now implemented and verified. Treat the original phase plan below as historical context, not as an open TODO list.

Completed:

- Shared `Tooltip` now uses delayed first hover, a 300ms skip-delay handoff between tooltip targets, and a single active-tooltip coordinator.
- Keyboard focus opens custom tooltips only for `:focus-visible`.
- Tooltip positioning renders hidden first, measures, then publishes fixed coordinates, so the first visible frame is stable.
- Tooltip placement is clamped within the viewport and smoke-checked against a top-left traffic-light safe area.
- Tooltip CSS now uses opacity-only motion instead of visible transform travel across shell chrome.
- Global `.motion-icon-button` hover/active scale was removed for shell icon controls.
- Focused smoke coverage now checks header, sidebar, and right-panel tooltip bounds and calm motion.

Verified in this branch:

- `npm run build`
- `git diff --check`
- `npm run smoke:ui:auto -- --header`
- `npm run smoke:ui:auto -- --sidebar`
- `npm run smoke:ui:auto -- --right-panel`

Still real:

- Sidebar hover cards and richer interactive hover surfaces are coordinated with tooltips, but they do not yet share one Floating UI-style positioning primitive. Move them only if a concrete hover-card bug recurs.
- Exact live Codex pixel/timing proof is still blocked by live capture limitations. Use manual side-by-side evidence or a working nonblank ScreenCaptureKit route before reopening pixel-level hover parity.
- If installing locally, rebuild the packaged app with `npm run pack:mac` before `npm run install:mac`; the installer copies `dist/mac-arm64/Orchestrator.app`.

## Concrete Differences

### Positioning

Codex:

- Uses Floating UI with `offset`, `flip`, `shift`, and `size`.
- Uses `padding: 8` for collision boundaries.
- Exposes available width/height CSS variables from Floating UI.
- Computes placement from Floating UI output and writes `data-side`.
- Handles window zoom when the portal container is the document body.

Orchestrator:

- Computes fixed coordinates manually from the anchor rect.
- Chooses only `top` or `bottom`.
- Uses `rect.top < 38` as the top-edge rule.
- Clamps to the viewport manually.
- Re-measures after render and updates state if the final tooltip size changes the clamped position.

Impact:

- Codex avoids most edge/collision surprises before paint.
- Orchestrator can visibly jump because it paints from approximate coordinates first.
- Orchestrator has no real traffic-light-safe-area or side-panel-aware collision model.

### Timing And Handoff

Codex:

- Default delay is 700ms.
- Skip-delay window is 300ms when moving between tooltip targets.
- Tracks the active tooltip so only one tooltip remains open.
- Supports hover handoff for interactive hover cards using a pointer triangle between trigger and content.
- Opens on focus only when the trigger matches `:focus-visible`.

Orchestrator:

- Defines `tooltipHoverDelayMs = 700`.
- Schedules tooltip open on pointer/mouse enter and move.
- Also calls `showNow` on `onMouseOver`, making many tooltips immediate despite the delay.
- Uses `announceHoverSurfaceOpen` and `useExclusiveHoverSurface`, but without skip-delay intent, hover handoff locks, or interactive triangle handling.
- Opens on any focus, not just focus-visible.

Impact:

- Codex feels calmer when moving across adjacent shell controls.
- Orchestrator can flicker or feel jumpy because every mouseover can immediately force a new body-portal tooltip.

### Animation

Codex:

- Tooltip content is positioned by Floating UI and appears as a simple tokenized surface.
- Side-panel expanded action pills use portal positioning, but tooltip surfaces themselves do not rely on a broad transform exit path across the shell.
- Button hover treatments are mostly color/background changes in the inspected side-panel bundles.

Orchestrator:

- `.orchestrator-tooltip` starts hidden with `opacity: 0`, `visibility: hidden`, and a translated transform.
- Visible state transitions opacity and transform.
- Bottom placement transitions from `translate(-50%, 3px)` to `translate(-50%, 0)`.
- Top placement transitions from `translate(-50%, -100%) translateY(-3px)` to `translate(-50%, -100%)`.
- `.motion-icon-button:hover` globally scales controls via `transform: scale(var(--motion-scale-edge-hover))`.

Impact:

- Orchestrator can make a disappearing tooltip look like it is traveling through the titlebar/traffic-light area.
- Hover scale changes the anchor geometry as positioning happens, which makes top controls more likely to feel unstable.

### Stacking And Portal Behavior

Codex:

- Portals to `document.body` by default.
- Uses a tokenized `z-50` tooltip surface within its app stacking system.
- Supports an explicit portal container.

Orchestrator:

- Always portals tooltips to `document.body`.
- Uses `z-index: 760` for tooltips and `z-index: 10020` for sidebar hover cards.
- Hover card and tooltip systems are separate positioning implementations.

Impact:

- Orchestrator hover surfaces can sit above more app chrome than intended.
- Sidebar hover cards and tooltips are coordinated through `announceHoverSurfaceOpen`, but not through a shared positioning/collision primitive.

### Styling

Codex:

- Tooltip surface classes include tokenized dropdown background, foreground, border, rounded-lg, compact text, and constrained max width.
- Hover-card surface uses translucent dropdown background, ring, shadow, and backdrop blur.

Orchestrator:

- Tooltip uses custom `--icon-tooltip-*` tokens, 12px text, 6px/7.5px padding, and stronger shadow.
- Sidebar hover card uses blur, 12px radius, and menu shadow.

Impact:

- Orchestrator surfaces look more bespoke and higher-contrast.
- The stronger shadow plus transform transition makes motion artifacts more noticeable.

## Suspected Root Causes For The Traffic-Light Issue

1. Body-portaled tooltips are not constrained by a titlebar-safe collision boundary.
2. `onMouseOver={showNow}` bypasses delay and can create rapid open/close churn near dense controls.
3. Tooltip position is corrected in `useLayoutEffect`, causing a second-position frame.
4. Tooltip exit transitions keep the surface visible after the trigger has already changed or unmounted.
5. Global icon-button hover scale changes anchor geometry while the tooltip is being positioned.
6. There is no Floating UI `flip/shift/size` equivalent, so top-edge and left-edge controls have weaker placement guarantees.
7. Side-panel action chips and sidebar hover cards are separate primitives, so each surface has slightly different timing, animation, and stacking behavior.

## Recommended Implementation Plan

### Phase 1: Replace The Tooltip Primitive

Replace `Tooltip` in `src/renderer/src/components/shared/designSystem.tsx` with a Codex-style Floating UI primitive:

- Use `@floating-ui/react-dom` or the repo's existing Floating UI dependency if present.
- Use `offset({ mainAxis: 2 })`, `flip({ padding: 8 })`, `shift({ padding: 8 })`, and `size({ padding: 8 })`.
- Keep the 700ms default delay.
- Add a 300ms skip-delay window when moving between tooltip triggers.
- Track one active tooltip globally.
- Open on keyboard focus only for `:focus-visible`.
- Remove `onMouseOver={showNow}`.
- Avoid position-correction state updates after the first paint.

### Phase 2: Calm Tooltip Exit Motion

Change `.orchestrator-tooltip` to avoid visible travel on close:

- Prefer opacity-only enter/exit for simple tooltips.
- Keep transforms subtle or remove them for titlebar/shell surfaces.
- Hide immediately when the anchor unmounts or when placement cannot be computed.
- Respect reduced motion with no transform.

### Phase 3: Unify Shell Tooltip Usage

Audit all `data-tooltip-label` and `title` usage around:

- `src/renderer/src/components/Titlebar.tsx`
- `src/renderer/src/components/Session/InputBar.tsx`
- `src/renderer/src/components/Session/WorkbenchTree.tsx`
- Workbench panel tab actions and file/diff/browser toolbars
- Sidebar session archive/pin/new-chat controls

Route these through the shared tooltip primitive instead of relying on ad hoc attributes or native titles. Preserve `aria-label` for accessibility, but avoid native `title` where we show a custom tooltip.

### Phase 4: Reduce Shell Button Scale

Stop applying global hover scale to shell controls:

- Keep scale for large primary buttons only if it still feels intentional.
- Remove or scope down `.motion-icon-button:hover { transform: scale(...) }` for titlebar, side-panel, toolbar, and sidebar controls.
- Use background/color/opacity changes for icon hover, matching Codex's quieter feel.

### Phase 5: Reuse One Positioning Primitive For Hover Cards

Move sidebar session hover cards and side-panel action chips toward the same positioning stack:

- Use Floating UI collision handling for hover cards too.
- Keep hover cards interactive only when they need pointer interaction.
- Use pointer-triangle handoff for interactive surfaces.
- Keep simple tooltips `pointer-events: none`.

## Verification Plan

Add focused smoke coverage:

- Titlebar hover smoke: hover title, metadata, pin/profile/sidebar controls near the macOS traffic-light area and assert visible tooltip rects do not intersect a top-left safe rect.
- Side-panel hover smoke: hover tab actions, file toolbar actions, and right-panel controls; assert exactly one visible tooltip and no travel outside the side-panel bounds.
- Sidebar hover smoke: keep existing archive/new-chat coverage, but assert tooltips are delayed, body-portaled, collision-clamped, and not co-visible with hover cards.
- Reduced-motion smoke: verify shell icon hover does not apply transform and tooltip transition duration is zero or opacity-only.
- Visual proof: capture before/after screenshots or short videos for top chrome and side-panel action hover.

## Suggested Acceptance Criteria

- Hovering dense top controls never draws a tooltip over the traffic-light buttons.
- Tooltip position is stable on first visible frame.
- Moving between adjacent controls opens only one tooltip at a time.
- Tooltip delay matches Codex: delayed first open, faster handoff after the first tooltip.
- Side-panel action chips and sidebar hover cards use the same collision behavior.
- Shell icon buttons no longer scale on hover.
- No native browser tooltip appears over custom tooltip surfaces.
