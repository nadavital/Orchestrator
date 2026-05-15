# Orchestrator Motion And Design System Gap Spike

## Purpose

Orchestrator should feel native to the Codex interaction model while still supporting multiple providers and provider-specific states. This spike inventories the current gap between Codex-style UI/motion and Orchestrator's design system, then lays out a path to bridge it without forcing the whole app into a Codex-only architecture.

## Executive Summary

Orchestrator has a useful visual foundation: theme tokens, density settings, shared shell patterns, and a design-language document. The missing layer is motion as a system. Today most animation is ad hoc: Tailwind transition utilities, inline transition strings, and a few isolated keyframes. There is no shared motion runtime, no motion token scale, no reduced-motion contract beyond local CSS usage, and no canonical animated primitives for overlays, rows, menus, badges, disclosure controls, or notifications.

Codex uses motion as part of its component grammar, not just decoration. Notification trays spring in and out, badges scale on hover/tap, row entrances are gently staggered, secondary controls reveal on hover/focus, expandable content animates height/opacity, and reduced-motion handling removes transform-heavy behavior. Orchestrator can match that behavior by adding a small shared motion layer, then migrating high-traffic surfaces to those primitives in stages.

## Implementation Checkpoint

Status as of 2026-05-15: the first implementation bridge is complete. Orchestrator now has shared motion tokens, reduced-motion CSS, `Button`, `IconButton`, `Badge`, `StatusBadge`, `SurfaceRow`, `DisclosureSection`, `MotionOverlay`, `Sheet`, `MenuSurface`, `DismissablePopoverSurface`, `ScrollEdgeButton`, shared attachment/markdown/thinking primitives, and focused smoke coverage for pet overlay, scroll/jump behavior, capabilities edit/sync, extensions, session switching, and reduced motion.

Future work should treat this document as design rationale, not as an open task list. New provider-specific UI should reuse the shared primitives first; only add new primitives when a repeated pattern appears in more than one surface.

## Current Orchestrator State

Evidence from the renderer:

- `src/renderer/src/index.css` defines color, radius, spacing, density, shadows, font, state, and transcript tokens, but no motion token family.
- `src/renderer/src/theme.ts` controls appearance, accent, density, sidebar tint, transcript style, interface scale, and fonts, but has no motion preference or animation intensity setting.
- `src/renderer/src/components/shared/` has a few shared utilities, but there is no broad UI primitive layer for button, badge, row, overlay, disclosure, tooltip, tray, or animated list behavior.
- Motion is scattered across feature components through `transition-*` utilities, inline `transition: ...` styles, and a single `statusPulse` keyframe.
- The pet overlay now has the closest Codex-like behavior, but much of its motion and interaction logic is still local to that overlay rather than reusable.

## Codex Baseline Observed Locally

The local Codex app uses animated primitives for the pet overlay and notification tray. The important patterns to carry over are:

- Overlay entrance: notification tray uses spring animation with `damping: 26`, `mass: 0.8`, `stiffness: 360`, and transform origin based on placement.
- Badge interaction: notification badge uses spring animation with `damping: 20`, `mass: 0.7`, `stiffness: 420`, plus hover scale around `1.06` and tap scale around `0.94`.
- Row entrance: notification rows enter with `opacity: 0 -> 1`, `y: 4 -> 0`, `duration: 0.18`, `easeOut`, and a short stagger capped by the first few rows.
- Edge controls: tray edge buttons use `duration: 0.14`, `easeOut`, hover scale around `1.03`, and tap scale around `0.96`.
- Hover/focus reveal: dismiss, reply, expand, and resize controls exist in the DOM but reveal visually on hover/focus with opacity and small x/y offsets.
- Expansion: notification bodies animate between compact and expanded states instead of snapping.
- Reduced motion: transform-heavy transitions are disabled or simplified when reduced motion is requested.

## Gap Matrix

| Area | Codex Baseline | Orchestrator Today | Gap | Bridge |
| --- | --- | --- | --- | --- |
| Motion runtime | Component-level motion primitives with spring/tween variants and presence transitions. | No dedicated motion dependency or abstraction. | No consistent way to animate mount, unmount, layout, hover, tap, or expansion. | Add a renderer motion layer with shared presets and reduced-motion wrappers. |
| Motion tokens | Repeated spring/tween values encode product feel. | Durations/easing are embedded per component. | Changes are hard to audit and parity cannot be measured. | Add `motion.ts` presets and CSS vars for durations/easing. |
| Reduced motion | Transform-heavy motion collapses or becomes opacity-only. | Mostly component-local, if present at all. | Accessibility behavior will drift by surface. | Add global reduced-motion CSS plus a `useReducedMotion` hook/helper. |
| Buttons | Icon buttons use scale/tap feedback, focus rings, tooltip-friendly labels. | Multiple hand-rolled icon/text buttons. | Interaction details differ across surfaces. | Create shared `IconButton` and `Button` primitives. |
| Badges | Status badges use token colors, spring hover/tap, and compact icon/count behavior. | Provider/status badges are locally styled. | Notification and provider badges do not share behavior. | Create `Badge` and `StatusBadge` primitives. |
| Rows | Rows animate in, use tokenized hover/focus, and reveal secondary controls only when relevant. | Session rows, transcript rows, tool rows, and capability rows each solve this separately. | Repeated styling and inconsistent motion. | Create `SurfaceRow` and animated-list helpers. |
| Overlays | Trays, menus, and panels have presence animation and predictable transform origins. | Modals/popovers/menus mostly snap or use local transitions. | Overlay behavior feels less native and less cohesive. | Create `MotionOverlay`, `PopoverSurface`, and tray primitives. |
| Disclosures | Expand/collapse controls animate content and icon state. | Expansion behavior varies by component. | Notification, tool, and transcript details feel unrelated. | Create `DisclosureSection` with shared animation presets. |
| Tooltips | Controls often expect hover labels. | Tooltips are not a consistent primitive. | Icon-only controls can become unclear. | Add tooltip primitive before broad icon-button migration. |
| Notifications | Codex banner/tray rows have compact body, hover controls, status icons, reply/action affordances, and edge scroll buttons. | Pet notifications have been partially brought closer; app-wide notifications are not systematized. | Pet parity improves, but the design system still lacks reusable notification primitives. | Extract notification row/tray pieces after pet parity stabilizes. |
| Transcript | Codex-like flows emphasize calm rows, delayed secondary actions, and animated expansion. | Transcript still has several bespoke row/control patterns. | Main work surface will not inherit pet/notification improvements. | Migrate transcript blocks, tool calls, and permission cards to shared row/disclosure primitives. |
| Sidebar | Native-feeling row hover/active/tap motion is inconsistent. | Project/session rows use local transitions. | The first navigation surface does not share the same interaction grammar. | Apply `SurfaceRow`, active indicator, and hover/tap presets to sidebar rows. |
| Settings/capabilities | Codex-style surfaces use compact tokenized controls and consistent feedback. | Capability/settings-style surfaces have many local controls. | Complex pages will keep accumulating one-off UI. | Migrate after primitives are stable; avoid changing behavior during the first pass. |
| Visual QA | Motion and visual parity need screenshot or interaction checks. | Automated UI smoke exists, but no focused design-system harness. | Regressions will be hard to see. | Add a design-system preview route or test harness with screenshots. |

## Motion Spec To Port

Start with these shared presets:

```ts
export const motionPresets = {
  spring: {
    badge: { type: 'spring', damping: 20, mass: 0.7, stiffness: 420 },
    tray: { type: 'spring', damping: 26, mass: 0.8, stiffness: 360 },
  },
  tween: {
    edge: { duration: 0.14, ease: 'easeOut' },
    row: { duration: 0.18, ease: 'easeOut' },
    controlReveal: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
  scale: {
    badgeHover: 1.06,
    edgeHover: 1.03,
    tapStrong: 0.94,
    tapSoft: 0.96,
  },
  row: {
    enterY: 4,
    staggerMs: 35,
    maxStaggerRows: 3,
  },
  reveal: {
    controlOffsetPx: 6,
  },
};
```

Reduced-motion behavior should keep opacity changes where helpful, but remove scale, y-offset, transform-origin, and spring movement.

## Recommended Implementation Path

### Phase 1: Foundations

- Add a motion runtime decision. Prefer a small React motion dependency if the bundle impact is acceptable; otherwise use CSS transitions with shared class helpers for the first pass.
- Add `src/renderer/src/design/motion.ts` with Codex-derived presets, reduced-motion helpers, and reusable transition names.
- Add motion CSS variables to `src/renderer/src/index.css`, including reduced-motion overrides.
- Add a design-system preview route or local harness with buttons, badges, rows, overlays, notifications, transcript rows, and pet tray states.

### Phase 2: Shared Primitives

- Add shared `Button`, `IconButton`, `Tooltip`, `Badge`, `StatusBadge`, `SurfaceRow`, `DisclosureSection`, `PopoverSurface`, `MotionOverlay`, and `ScrollEdgeButton`.
- Keep the primitives provider-neutral. Provider-specific state should enter as data, not as a separate visual system.
- Use Codex-like hover/focus reveal for secondary actions instead of permanently visible low-priority controls.

### Phase 3: High-Value Migration

- Finish extracting pet badge, tray, notification row, resize handle, and action controls into reusable pieces.
- Move session action menus, slash command palette, and modals onto shared overlay/popover behavior.
- Move sidebar project/session rows onto shared row and active-state behavior.
- Move transcript blocks, tool-call cards, permission cards, and notification banners onto shared row/disclosure/badge primitives.
- Move settings/capabilities surfaces last, after the primitives have proven themselves in high-frequency surfaces.

### Phase 4: Verification

- Add visual smoke coverage for the design-system harness.
- Add interaction checks for hover reveal, tap scale, tray open/close, expandable content, and reduced-motion mode.
- Keep pet overlay checks separate because it runs in its own overlay window and has unique drag/resize behavior.

## Concrete First Tickets

1. Add the renderer motion foundation: presets, CSS variables, reduced-motion helper, and package decision.
2. Build the shared UI primitives needed by pets and notifications first: `IconButton`, `Badge`, `SurfaceRow`, `DisclosureSection`, and `ScrollEdgeButton`.
3. Refactor the pet notification badge/tray/rows onto those primitives to prove Codex parity in the smallest surface.
4. Migrate menus and modal overlays, because they are high-visibility and low-risk.
5. Migrate sidebar rows and transcript/tool rows, where the app will feel most different day to day.
6. Add visual smoke states so future provider-specific additions do not drift from the shared system.

## Open Decisions

- Whether to add a React motion package or implement the first pass with CSS-only primitives.
- Whether to expose a user-facing motion preference, or only honor OS-level reduced motion.
- Whether to alias Codex token names into Orchestrator's token system for easier parity checks.
- How strict visual parity should be outside pet/notification surfaces, where Orchestrator may intentionally keep its own calmer layout.
- Whether the design-system harness should live as an internal route, a Storybook-like local surface, or a hidden renderer mode.

## Recommendation

Do the bridge in two tracks. First, finish pets and notifications as the parity proof, because they have the clearest Codex reference and the most obvious missing pieces. Second, build a small motion/design primitive layer and migrate the rest of the app surface by surface. That keeps Orchestrator provider-neutral while making its interaction grammar much closer to Codex.
