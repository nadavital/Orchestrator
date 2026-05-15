# Orchestrator Design System Gap Audit

Date: 2026-05-14

Focused update: 2026-05-15, after:

- `1d665b70 Align Orchestrator motion system with Codex`
- `f5585903 Migrate inspector panels to shared primitives`

## Scope

This audit checks whether Orchestrator's renderer and pet overlay now match the local Codex app's UI, motion, navigation, banners, badges, and shared design-system behavior after the first design-system spike and the follow-up Codex-alignment commits listed above.

The answer is still: not yet. Orchestrator now has a much stronger app-wide foundation, and the highest-risk pet resize clipping issue has been fixed, but the system is not yet as mature as Codex across settings, the composer/transcript, extension panels, menu accessibility, pet-overlay automation, and reduced-motion verification.

The intended end state should still allow Orchestrator-specific differences:

- Multiple providers.
- Provider-specific and custom states.
- Orchestrator-specific capabilities and extension surfaces.

Everything else should converge on Codex's component behavior, density, motion language, and accessibility patterns where those patterns apply.

## Method

I inspected the Orchestrator renderer source and compared it against the installed local Codex app bundle.

Codex app source was extracted from:

`/Applications/Codex.app/Contents/Resources/app.asar`

Temporary extracted bundle:

`/private/tmp/codex-full-design-review`

Important Codex bundle references:

- `webview/assets/app-shell-CPTk8PRl.js`
- `webview/assets/app-shell-panel-animation-COicGkL7.js`
- `webview/assets/dropdown-BkHM69Th.js`
- `webview/assets/animations-YISQKbh8.js`
- `webview/assets/button-B0wCHa0n.js`
- `webview/assets/banner-Dkf3Meef.js`
- `webview/assets/segmented-toggle-22ctH3eA.js`
- `webview/assets/scroll-to-bottom-buton-BY5G-Ioq.js`

I ignored unrelated local dirty edits in:

- `src/main/ipc.ts`
- `src/main/settings.ts`
- `src/preload/index.ts`
- `src/renderer/src/components/Session/InputBar.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/env.d.ts`

Those appear to be separate preferred-editor and composer paste changes.

## Current State After The Focused Implementation

### Now In Good Shape

These are no longer the primary blockers:

- App mode transitions now use `MotionView`.
- Right inspector and bottom terminal panels now use `MotionPanel`.
- Right/bottom panel resizing now uses `PanelResizeHandle` instead of local hover-only handles.
- Titlebar controls now use shared `ToolbarButton`.
- Session status now uses shared badge behavior.
- Context tabs and terminal tabs now use shared `TabButton`.
- The capabilities page now uses shared `Button`, `Badge`, `SurfaceRow`, `SegmentedControl`, `PopoverSurface`, and `Sheet` for the first-pass create flow and rows.
- Diff, plan, agent activity, running agents, and side-question panels now use shared panel/card/badge/metric/row primitives.
- Settings now uses the shared switch and provider/model segmented-control primitive in the migrated spots.
- Pet resize no longer waits for a renderer `ResizeObserver` round trip to resize the floating window; it sends live resize-preview width to the main process, which recomputes the window bounds immediately.
- UI smoke coverage has been exercised for main, design-system, terminal, inspector, capabilities, and pets/settings views.

### Still Not Codex-Level

These remain the main gaps:

- `SettingsModal.tsx` is still the largest bespoke UI surface.
- `InputBar.tsx` and `ChatView.tsx` still own important transcript/composer surfaces locally.
- `ExtensionsPanel.tsx` is still mostly local and has repeated disclosure/transition behavior.
- Capabilities edit/sync sheets still use the old `capability-sheet-backdrop` and local sheet layout.
- Menus/popovers still do not have a shared dismissable-layer/focus/keyboard model comparable to Codex's dropdown stack.
- The pet overlay is visually closer, but it still uses overlay-local primitives and inline transition strings instead of a shared cross-renderer design layer.
- There is no deterministic floating pet-overlay smoke harness for badge, banner, tray, hover controls, resize, and provider/custom states.
- Reduced-motion is broadly present in the main renderer CSS, but not verified end-to-end across the pet overlay and every direct inline transition.
- Session-switch transitions exist at the view wrapper level, but there is not yet a dedicated visual smoke/assertion for session switching.
- Session switching must remain effectively instant. The first follow-up implementation keyed the session `MotionView` by `activeSessionId`, which could make chat-window switching feel like a slower page transition. That is not acceptable for Codex parity; session switching should prefer state preservation and immediate content swap over decorative transition.

### Updated Renderer Inventory

This inventory was regenerated after the two follow-up commits. It counts inline `style` refs, direct `transition` strings, hover handlers, and shared primitive references. It is directional, not a quality score.

| File | Inline style refs | Transition refs | Hover handlers | Shared primitive refs | Current status |
| --- | ---: | ---: | ---: | ---: | --- |
| `SettingsModal.tsx` | 167 | 4 | 2 | 6 | Biggest remaining migration |
| `ChatView.tsx` | 73 | 2 | 0 | 38 | Partial; transcript primitives still missing |
| `ExtensionsPanel.tsx` | 63 | 5 | 1 | 4 | Major remaining local surface |
| `InputBar.tsx` | 47 | 4 | 1 | 2 | Composer still mostly local |
| `PetOverlay.tsx` | 30 | 10 | 2 | 15 | Visually closer; not systematized/tested enough |
| `PlanPanel.tsx` | 16 | 0 | 0 | 17 | Mostly migrated |
| `DiffPanel.tsx` | 13 | 0 | 0 | 17 | Mostly migrated |
| `EventInspectorPanel.tsx` | 12 | 0 | 0 | 18 | Mostly migrated |
| `Titlebar.tsx` | 8 | 0 | 0 | 8 | Mostly migrated |
| `SideQuestionPanel.tsx` | 7 | 0 | 0 | 8 | Mostly migrated |
| `RunningAgentsStrip.tsx` | 4 | 0 | 0 | 6 | Mostly migrated |
| `SessionPane.tsx` | 4 | 0 | 0 | 12 | Shell/terminal migrated |
| `ContextSidebar.tsx` | 1 | 0 | 0 | 9 | Shell/tabs migrated |
| `CapabilitiesPage.tsx` | 2 | 0 | 0 | 38 | Partial; edit/sync sheets and menu behavior remain |
| `TerminalView.tsx` | 4 | 0 | 0 | 0 | Stable xterm shell; low priority |

## Remaining Work

### P0: Chat Switch Latency Guard

Why it matters: motion is only acceptable if it does not make high-frequency workflows slower. Switching between chat windows is a core Orchestrator action and should not feel gated by animation.

Current fix:

- The session content wrapper should not be keyed by `activeSessionId`.
- The session `MotionView` should not run the 360ms app-mode animation.
- App-mode transitions can keep motion, but session-to-session switching should be immediate unless profiling proves a lightweight transition has no perceptible cost.

Still needed:

- Add a deterministic smoke or integration check for session switching latency.
- Seed at least two sessions in the smoke profile.
- Click between sessions and measure time until the active transcript/session title changes.
- Fail the smoke if switching exceeds a tight threshold, for example 100-150ms for DOM-visible content under the smoke fixture.
- Add screenshot or DOM assertions that the transcript is visible immediately and not blocked behind a view fade.

Acceptance rule:

- No route/page animation should be applied to rapid chat-session switching unless it is proven not to increase perceived latency.

### P0: Pet Overlay Confidence

Why it matters: this is the surface most likely to regress invisibly because the floating overlay is a separate renderer/window and current smokes do not exercise it directly.

Still needed:

- Add a deterministic pet-overlay harness or smoke route that can render the floating overlay with fixture sessions.
- Verify badge collapsed/expanded states.
- Verify notification banner/tray rows, dismiss, expand, reply, and action buttons.
- Verify resize at min/default/max widths without clipping.
- Verify hover-only resize affordance and notification expand affordance.
- Verify custom provider statuses map to the intended badge/banner states.
- Verify reduced-motion behavior inside the pet overlay, not only the main renderer.

Suggested implementation:

- Add a `--pet-overlay` smoke mode that opens the pet overlay with fixture config and fixture session events, or add a renderer-only `#pet-overlay-preview` route that uses the same `PetOverlay` components with mocked `window.petApi`.
- Capture screenshots at default, max-size, collapsed tray, expanded tray, and waiting-for-input states.
- Add DOM assertions for `data-testid="avatar-overlay-resize-handle"` and `data-testid="avatar-overlay-notification-badge"`.

### P0: Menu, Popover, And Sheet Accessibility

Why it matters: Codex's dropdowns and dialogs are not just visual. They centralize keyboard behavior, focus behavior, Escape handling, disabled/danger states, and exit animation.

Still needed:

- Shared dismissable-layer primitive.
- Shared `Menu`, `MenuItem`, `MenuSeparator`, and optional submenu/disclosure behavior.
- Keyboard navigation for menus.
- Escape and outside-click behavior for every menu/popover.
- Focus trap or focus restoration for sheets/dialogs.
- Exit animation retention instead of immediate unmount for menus/sheets where feasible.

Highest-value targets:

- `CapabilitiesPage` create menu and row action menu.
- `CapabilitiesPage` edit and sync sheets.
- `SessionActionsMenu`, which is visually migrated but still has local item behavior.
- Slash palette hover/keyboard model.

### P0: Settings Migration

Why it matters: settings is still the biggest non-system surface and carries provider, model, pets, diagnostics, and appearance controls.

Still needed:

- `SettingsPanel`.
- `SettingsRow`.
- `SettingsCard`.
- `StatusPill`.
- `ProviderCard`.
- `DiagnosticPill`.
- `SortableModelRow` or a reusable sortable row primitive.
- Pet card controls using shared primitives.
- General settings cards converted away from local inline card buttons.

Constraints:

- The file currently has unrelated local preferred-editor edits in the worktree. Keep future design-system staging hunk-scoped unless those edits are intentionally folded in.

### P1: Composer And Transcript

Why it matters: Codex's interaction feel depends heavily on the composer and transcript. Orchestrator still has many local styles here.

Still needed:

- `ComposerShell`.
- `ComposerButton`.
- `ComposerToolbar`.
- `ComposerAttachmentChip`.
- `ComposerStatusButton` for permission/model/runtime state.
- `ScrollToBottomButton` modeled on Codex's scroll-to-bottom behavior.
- `ThinkingIndicator`.
- `AttachmentChip`.
- `FileReferenceCard`.
- `MarkdownSurface`.
- Shared copy/action controls for message rows.

Suggested verification:

- Long transcript scroll smoke.
- In-progress assistant smoke.
- File-reference card smoke.
- Attachment paste/drop smoke.
- Composer overflow/paste smoke.

### P1: Extensions Panel

Why it matters: this is now the largest untouched session-side panel.

Still needed:

- Replace local extension cards with `InspectorCard`.
- Replace local disclosure chevrons with `DisclosureSection` or a more Codex-like animated disclosure primitive.
- Replace metric/status pills with `MetricPill`/`Badge`.
- Replace file/command rows with `SurfaceRow`.
- Add an extensions-panel smoke view.

### P1: Capabilities Edit/Sync Sheets

Why it matters: the create flow and rows are partially migrated, but edit/sync still use local sheet/backdrop layout.

Still needed:

- Convert `EditCapabilitySheet` to shared `Sheet`.
- Convert `SyncCapabilitySheet` to shared `Sheet`.
- Replace sync provider checkboxes with shared row/card primitives.
- Replace sync plan operation cards with `InspectorCard`/`Badge`.
- Add smoke assertions for opening edit/sync sheets, not just landing on the capabilities page.

### P1: Reduced Motion

Why it matters: Codex's motion is polished partly because reduced-motion behavior is predictable.

Still needed:

- Add `--motion-reduced` smoke mode.
- Force `prefers-reduced-motion` in the smoke harness or add a CSS/test flag.
- Assert panels still open/close without transform motion.
- Assert pet overlay does not run direct inline transitions in reduced-motion mode.
- Replace pet overlay direct transition strings with tokenized helpers or reduced-motion branches.

### P2: App-Shell Maturity

Why it matters: Orchestrator's shell is now structurally closer to Codex, but it is still CSS-transition based, not as mature as Codex's motion-value panel implementation.

Still needed:

- Decide whether CSS transitions are acceptable or whether to adopt a motion-value style implementation for panel width/height.
- Add visual assertions for right panel open/close and terminal open/close.
- Add session-switch smoke coverage.
- Add resizing persistence if desired for inspector width and terminal height.
- Check wide/narrow viewport screenshots for panel overlap and min-width behavior.

### P2: Design-System Boundaries

Why it matters: the shared primitives are growing in one file. That is fine for a spike, but not ideal long-term.

Still needed:

- Split `designSystem.tsx` once primitive ownership stabilizes:
  - buttons
  - badges/status
  - panels
  - menus/popovers
  - forms
  - settings
  - transcript/composer
- Move cross-renderer-safe tokens/primitives into a place the pet overlay can consume.
- Keep feature-specific CSS out of `index.css` where practical.

## Historical Baseline

The original spike details below are retained as the baseline that led to the current implementation. The "missing" statuses in that historical section are superseded by the current-state and remaining-work sections above.

## What Already Exists

Orchestrator now has a real starting point:

- `src/renderer/src/design/motion.ts` defines motion tokens.
- `src/renderer/src/components/shared/designSystem.tsx` defines shared UI primitives.
- `src/renderer/src/components/DesignSystemPreview.tsx` provides a smoke-testable preview.
- `src/renderer/src/components/shared/Modal.tsx` uses the new modal primitives.
- `src/renderer/src/components/shared/SessionActionsMenu.tsx` is migrated.
- `src/renderer/src/components/Session/SlashCommandPalette.tsx` is partly migrated.
- `src/renderer/src/components/shared/ToolCallCard.tsx` is partly migrated.
- `src/renderer/src/components/Session/ChatView.tsx` is partly migrated.
- Sidebar project/session rows are partly migrated.
- The pet overlay has Codex-like badge and banner concepts, but still has local inline component behavior.

This is enough for future migration work to reuse instead of starting over.

## Codex Baseline

### App Shell Motion

Codex has app-shell-level motion, not only component-level hover transitions.

Observed behavior in `app-shell-CPTk8PRl.js` and `app-shell-panel-animation-COicGkL7.js`:

- Left panel uses `AnimatePresence` and motion-powered mount/unmount opacity.
- Right panel width and opacity are animated through motion values.
- Bottom panel height and opacity are animated through motion values.
- Header slots animate width and min-width.
- Resize handles have stable invisible hit targets and hover/active gradient lines.
- Panels preserve layout while animating size, instead of conditionally snapping in and out.

Orchestrator does not yet have this app-shell animation layer.

### Dropdowns, Popovers, And Disclosure

Codex centralizes dropdown behavior through Radix-style primitives and animation wrappers.

Observed in `dropdown-BkHM69Th.js`:

- Dropdown content uses enter and exit CSS classes.
- Exit animations are held through `AnimatePresence`.
- Submenus/disclosures animate height and opacity.
- Disabled, danger, icon, shortcut, and submenu item states are centralized.

Observed in `animations-YISQKbh8.js`:

```ts
{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }
```

Orchestrator has one migrated session actions menu, but many remaining menus are local.

### Shared Primitives

Codex has centralized primitives for common UI:

- Button variants and sizes.
- Badge.
- Banner.
- Segmented toggle.
- Tooltip.
- Dropdown/context menu.
- Popover.
- Dialog layout.
- Settings row.
- Scroll-to-bottom button.
- App shell panels.

Orchestrator now has some equivalent primitives, but they are not broad enough yet and are not used consistently.

## Renderer Inventory

This is a quick static inventory of remaining inline styles, direct transition strings, hover handlers, and shared primitive usage.

| File | Inline style refs | Transition refs | Hover handlers | Shared primitive refs | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `SettingsModal.tsx` | 171 | 5 | 4 | 0 | Not migrated |
| `ChatView.tsx` | 73 | 4 | 0 | 41 | Partial |
| `ExtensionsPanel.tsx` | 63 | 5 | 2 | 0 | Not migrated |
| `InputBar.tsx` | 35 | 4 | 2 | 2 | Partial |
| `PlanPanel.tsx` | 24 | 0 | 0 | 2 | Mostly local |
| `EventInspectorPanel.tsx` | 22 | 1 | 0 | 0 | Not migrated |
| `DiffPanel.tsx` | 19 | 2 | 4 | 0 | Not migrated |
| `SessionPane.tsx` | 11 | 1 | 10 | 0 | Not migrated |
| `Titlebar.tsx` | 11 | 2 | 0 | 1 | Mostly local |
| `SideQuestionPanel.tsx` | 8 | 0 | 0 | 0 | Not migrated |
| `Sidebar.tsx` | 7 | 0 | 0 | 7 | Partial |
| `ToolCallCard.tsx` | 6 | 1 | 0 | 3 | Partial |
| `RunningAgentsStrip.tsx` | 5 | 1 | 0 | 0 | Not migrated |
| `EmptyState.tsx` | 5 | 1 | 0 | 0 | Not migrated |
| `ContextSidebar.tsx` | 5 | 0 | 2 | 0 | Not migrated |
| `TerminalView.tsx` | 4 | 0 | 0 | 0 | Mostly local |
| `SlashCommandPalette.tsx` | 3 | 0 | 1 | 9 | Partial |
| `SessionActionsMenu.tsx` | 3 | 0 | 2 | 3 | Mostly migrated |
| `CapabilitiesPage.tsx` | 2 | 0 | 0 | 0 | Not migrated |
| `Modal.tsx` | 2 | 0 | 0 | 5 | Migrated |

The numbers are not a quality score by themselves, but they show where local, non-system UI remains concentrated.

## Missing Areas

### 1. App-Level Navigation And View Transitions

Status: missing.

Evidence:

- `src/renderer/src/App.tsx` hard-switches between design preview, settings, capabilities, and the main session UI.
- `src/renderer/src/components/Session/SessionPane.tsx` resets terminal tabs on session change but does not animate session content changes.
- Settings and capabilities pages appear as direct state switches, not motion-managed views.

Missing:

- Route/view transition primitive.
- Session switch transition.
- Main app mode transition.
- Reduced-motion fallback for view transitions.

Bridge:

- Add `MotionView` or `AppModeTransition`.
- Key session content by active session id for controlled crossfade/slide.
- Use the same primitive for settings, capabilities, design preview, and main session views.
- Add smoke coverage for switching app modes and switching sessions.

### 2. App Shell, Side Panel, And Bottom Panel Animation

Status: missing.

Evidence:

- `ContextSidebar` returns `null` when there is no active panel, so the right panel snaps in and out.
- `SessionPane` conditionally renders the terminal bottom panel; it snaps open/closed.
- Terminal resizing is hand-rolled with inline hover/transition behavior.
- The main content width changes immediately when the context sidebar appears.

Codex baseline:

- Right and bottom panels animate size plus opacity.
- Resize handles have consistent invisible hit areas and hover/active affordances.
- Panel visibility is managed separately from mounted/unmounted state so exit motion can complete.

Missing:

- `MotionPanel`.
- `ResizablePanel`.
- `RightPanel`.
- `BottomPanel`.
- `PanelResizeHandle`.
- Layout-preserving panel state.

Bridge:

- Build a panel animation layer modeled on Codex's app-shell panel animation.
- Migrate `ContextSidebar` and the terminal bottom panel first.
- Then migrate extensions, plan, diff, and event inspector panels onto the same panel shell.

### 3. Header And Titlebar Controls

Status: mostly missing.

Evidence:

- `Titlebar.tsx` still defines local `TitleBtn`.
- `StatusDot` has direct pulse styling instead of using shared `StatusBadge`.
- Toggle and active states use local Tailwind classes.
- The title/session text changes without transition.

Missing:

- Shared titlebar button primitive.
- Toolbar icon button sizing.
- Header status badge.
- Animated active state for provider/session controls.
- Consistent tooltip behavior.

Bridge:

- Add `ToolbarButton`, `ToolbarGroup`, and `HeaderStatusBadge`.
- Replace local titlebar controls.
- Use the same button primitive for terminal, diff, capabilities, and settings toolbars.

### 4. Tabs And Segmented Controls

Status: mostly missing.

Evidence:

- `ContextSidebar` has local `InspectorTab`.
- `SessionPane` has local terminal tabs.
- `CapabilitiesPage` has local tabs.
- `SettingsModal` has several local segmented controls.

Codex baseline:

- Segmented toggle is centralized and built on shared Button and Tooltip behavior.

Missing:

- Shared `Tabs`.
- Shared `SegmentedControl`.
- Animated active indicator.
- Disabled, icon-only, full-width, compact, and tooltip variants.

Bridge:

- Add `Tabs`, `TabButton`, and `SegmentedControl`.
- Migrate context inspector tabs, terminal tabs, settings segmented controls, and capabilities tabs.

### 5. Dropdowns, Context Menus, And Popovers

Status: partially missing.

Evidence:

- `SessionActionsMenu` is migrated.
- `CapabilitiesPage` still has local create and row action menus.
- Settings has local provider/model/dropdown-like controls.
- Some local menus do not appear to share Escape/outside-click behavior.

Codex baseline:

- Dropdowns use shared primitives, enter/exit classes, submenu disclosure, disabled/danger states, and focus-aware behavior.

Missing:

- Shared `Menu`.
- Shared `MenuItem`.
- Shared `MenuSeparator`.
- Shared `Submenu`.
- Shared `PopoverSurface`.
- Shared dismissable layer behavior.

Bridge:

- Generalize the current `SessionActionsMenu` approach into primitives.
- Migrate capabilities menus next, because they are high-value and currently fully local.
- Migrate settings menus after the settings controls are split.

### 6. Sheets And Dialogs

Status: partial.

Evidence:

- `Modal.tsx` uses the new design primitives.
- `CapabilitiesPage` still owns its sheet backdrop and sheet layout.
- Settings remains a very large bespoke modal/page surface.

Missing:

- Shared `Sheet`.
- Shared `DialogLayout`.
- Form footer and action row primitives.
- Focus trap and Escape behavior shared across sheet/dialog variants.
- Enter/exit motion for sheets.

Bridge:

- Add `Sheet`, `DialogBody`, `DialogFooter`, and `FormActionRow`.
- Migrate capability detail/create/edit sheets.
- Then migrate settings modal sections.

### 7. Settings System

Status: not migrated.

Evidence:

- `SettingsModal.tsx` has 171 inline style references and no shared primitive references.
- Local controls include segmented choices, switches, status pills, provider side picker, provider header cards, diagnostic grids, pet cards, model list rows, and drag-reorder controls.
- It also contains unrelated dirty local edits, so migration should be staged carefully.

Missing:

- Settings row primitive.
- Settings panel primitive.
- Shared switch/toggle.
- Shared status pill.
- Shared provider card.
- Shared diagnostic row/grid.
- Shared draggable row or sortable list primitive.
- Shared pet card controls.

Bridge:

- First split settings UI primitives without changing behavior.
- Then migrate settings sections in small passes:
  - General settings.
  - Provider settings.
  - Model management.
  - Pet settings.
  - Diagnostics.
- Keep unrelated preferred-editor changes out of the migration commit.

### 8. Capabilities Page

Status: not migrated.

Evidence:

- `CapabilitiesPage.tsx` uses local stateful menus, rows, sheet, and form UI.
- `src/renderer/src/index.css` contains many `cap-*` classes for this one page.
- It does not use shared Button, Badge, SurfaceRow, Sheet, Menu, or Tabs primitives.

Missing:

- Shared capability row.
- Shared sheet.
- Shared menu.
- Shared form controls.
- Shared badges.
- Motion for create/edit sheet mount/unmount.

Bridge:

- Replace `cap-*` page-specific controls with design-system primitives.
- Keep capability-specific layout, but move interaction and component states into shared UI.
- Add smoke coverage for create/edit sheets and row action menu.

### 9. Context Rail Panels

Status: mostly missing.

Files:

- `ContextSidebar.tsx`
- `DiffPanel.tsx`
- `PlanPanel.tsx`
- `EventInspectorPanel.tsx`
- `SideQuestionPanel.tsx`
- `ExtensionsPanel.tsx`
- `RunningAgentsStrip.tsx`

Evidence:

- Tabs are local.
- Rows/cards/status dots are local.
- Diff rows use manual hover handlers.
- Plan cards use local block components.
- Event inspector has local transcript/stat/status UI.
- Extensions panel has many local inline styles and disclosure transitions.
- Running agents strip uses local pills and pulse styles.

Missing:

- `PanelHeader`.
- `PanelTabs`.
- `InspectorCard`.
- `InspectorRow`.
- `MetricPill`.
- `ExpandableGroup`.
- `StatusBadge`.
- `AnimatedStrip`.

Bridge:

- Migrate the context shell first.
- Then migrate each panel's repeated rows/cards/status elements.
- Keep content-specific logic local, but move all repeated interaction and visual treatment to shared primitives.

### 10. Transcript And Message Surfaces

Status: partial.

Evidence:

- `ChatView.tsx` has high shared primitive usage, but still has many inline styles.
- Remaining local areas include file references, inline attachments, markdown/code block treatment, thinking indicator, scroll-to-bottom behavior, and some message layout details.

Codex baseline:

- Scroll-to-bottom button has centralized appearance, opacity transition, and optional working-dot animation.
- Message surfaces use consistent badges, buttons, and dense spacing.

Missing:

- `ScrollToBottomButton`.
- `ThinkingIndicator`.
- `AttachmentChip`.
- `FileReferenceCard`.
- `MarkdownSurface`.
- Shared copy/action affordances.

Bridge:

- Extract transcript-specific primitives.
- Keep provider-specific message states, but render them through shared badges and surfaces.
- Add transcript smoke tests for long scroll, tool calls, file references, and in-progress states.

### 11. Composer And Input Bar

Status: partial.

Evidence:

- `InputBar.tsx` still has local styles, transitions, hover handlers, and only a small amount of shared primitive usage.
- Current local file has unrelated dirty edits, so it should be handled carefully.

Missing:

- Composer button primitive.
- Attachment chip primitive.
- Provider/model dropdown primitive.
- Permission/sandbox status button primitive.
- Shared drag-over and paste states.
- Reduced-motion behavior for composer affordances.

Bridge:

- Create `ComposerButton`, `ComposerToolbar`, and `ComposerAttachmentChip`.
- Migrate local controls after preserving the unrelated paste behavior work.
- Keep the slash palette migration as a separate already-started thread.

### 12. Pet Overlay

Status: closer visually, not systematized.

Evidence:

- `src/renderer/pet-overlay/src/PetOverlay.tsx` contains Codex-like badge and notification/banner behavior.
- It still owns many inline transitions, action buttons, icon buttons, tray rows, and overlay-specific surface styles.
- The pet overlay is a separate renderer bundle, so it cannot automatically consume the main renderer design-system module without a shared location.

Missing:

- Shared cross-renderer primitives or a pet-overlay copy generated from the same source.
- Reduced-motion coverage inside the pet overlay bundle.
- A pet overlay harness that tests badge, banner, compact/expanded notification list, hover controls, scaling, and custom provider states.
- Explicit provider-state mapping tests.

Bridge:

- Move pure design primitives into a shared renderer package path that both the app renderer and pet overlay can import, or create a small pet-overlay design layer that mirrors the shared primitive API.
- Add a pet-overlay smoke harness.
- Keep Orchestrator-specific provider/custom states in mapping code, but render badges and banners through the same primitive behavior.

### 13. Terminal Shell

Status: mostly missing.

Evidence:

- Terminal tabs and controls live in `SessionPane`.
- `TerminalView.tsx` is mostly local terminal frame rendering.
- Bottom panel visibility and resizing are not motion-managed.

Missing:

- Shared bottom panel primitive.
- Shared terminal tab primitive.
- Shared terminal toolbar buttons.
- Animated terminal open/close.

Bridge:

- Migrate terminal container after `BottomPanel` exists.
- Keep xterm rendering stable; only animate the surrounding shell.

### 14. CSS And Token Gaps

Status: partial.

Evidence:

- `motion.ts` exists.
- `index.css` still contains page-specific capability styling and many global animation/transition utilities.
- Several components still define transitions directly in inline style strings.

Missing:

- Codex-like semantic token aliases for panels, rows, menus, sheets, tabs, and badges.
- A clear split between generic primitives and feature CSS.
- Reduced-motion support for every animation path.

Bridge:

- Promote repeated classes into component primitives.
- Keep global CSS only for tokens, resets, xterm, markdown, and utility animations that are truly shared.
- Add reduced-motion tests.

### 15. Accessibility And Focus Behavior

Status: uneven.

Evidence:

- Some local controls use spans or divs for button-like UI.
- Local menus and sheets do not uniformly share Escape/outside-click/focus behavior.
- Codex leans on centralized primitives for dropdown/dialog behavior.

Missing:

- Shared focus trapping for dialogs and sheets.
- Shared dismissable layer.
- Shared menu keyboard behavior.
- Consistent `aria-*` labels for icon-only controls.
- Consistent disabled semantics.

Bridge:

- Prefer Radix-style behavior or equivalent local accessible primitives.
- Migrate menus/sheets before deep visual polish so keyboard/focus behavior is not repeatedly reimplemented.

### 16. Test And Verification Gaps

Status: partial.

Existing coverage:

- Typecheck for renderer and node.
- Provider tests.
- Main UI smoke.
- Design-system preview smoke.
- Build verification.

Missing smoke/visual coverage:

- Settings modal/page.
- Capabilities page and sheets.
- Context sidebar panel switching.
- Terminal bottom panel open/close/resize.
- Session switching.
- Pet overlay badge/banner/tray/hover scale controls.
- Reduced-motion mode.
- Menu keyboard behavior.
- Sheet Escape/outside-click behavior.

Bridge:

- Add smoke flags or deterministic routes for:
  - `--settings`
  - `--capabilities`
  - `--inspector`
  - `--terminal`
  - `--pet-overlay`
  - `--motion-reduced`
- Capture screenshots for desktop and a narrow viewport.
- Add targeted DOM assertions for mounted/visible states.

## Recommended Implementation Phases

### Phase 1: App Shell And Navigation

Goal: make motion app-wide, not just local component polish.

Deliverables:

- `MotionView`
- `MotionPanel`
- `ResizablePanel`
- `RightPanel`
- `BottomPanel`
- `PanelResizeHandle`
- Route/app-mode transitions in `App.tsx`
- Session switch transition in `SessionPane`
- Animated context sidebar and terminal bottom panel

Primary files:

- `src/renderer/src/App.tsx`
- `src/renderer/src/components/Session/SessionPane.tsx`
- `src/renderer/src/components/Session/ContextSidebar.tsx`
- `src/renderer/src/components/Session/TerminalView.tsx`
- `src/renderer/src/components/shared/designSystem.tsx`
- `src/renderer/src/design/motion.ts`

Verification:

- Main smoke.
- Session switch smoke.
- Terminal panel smoke.
- Context sidebar smoke.
- Reduced-motion smoke.

### Phase 2: Menus, Sheets, Tabs, And Header Controls

Goal: eliminate the biggest local interaction patterns.

Deliverables:

- `ToolbarButton`
- `ToolbarGroup`
- `Tabs`
- `SegmentedControl`
- `Menu`
- `MenuItem`
- `MenuSeparator`
- `PopoverSurface`
- `Sheet`
- `DialogFooter`
- `FormActionRow`

Primary files:

- `src/renderer/src/components/Titlebar.tsx`
- `src/renderer/src/components/CapabilitiesPage.tsx`
- `src/renderer/src/components/Session/ContextSidebar.tsx`
- `src/renderer/src/components/Session/SessionPane.tsx`
- `src/renderer/src/components/shared/designSystem.tsx`

Verification:

- Capabilities page smoke.
- Keyboard menu smoke.
- Sheet Escape/outside-click smoke.

### Phase 3: Settings And Capabilities Migration

Goal: move the largest non-system UI surfaces onto shared primitives.

Deliverables:

- `SettingsPanel`
- `SettingsRow`
- `Switch`
- `StatusPill`
- `ProviderCard`
- `DiagnosticPill`
- Capability rows/forms/sheets using shared primitives
- Removal or major reduction of `cap-*` page-specific CSS

Primary files:

- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/components/CapabilitiesPage.tsx`
- `src/renderer/src/index.css`

Verification:

- Settings smoke.
- Capabilities smoke.
- Provider settings smoke.
- Model reorder smoke if practical.

### Phase 4: Inspector Panels, Transcript, Composer, And Pets

Goal: finish the high-touch working surfaces.

Deliverables:

- `PanelHeader`
- `InspectorCard`
- `InspectorRow`
- `MetricPill`
- `ExpandableGroup`
- `AnimatedStrip`
- `ScrollToBottomButton`
- `ThinkingIndicator`
- `AttachmentChip`
- `FileReferenceCard`
- `ComposerButton`
- Shared or mirrored pet overlay primitives

Primary files:

- `src/renderer/src/components/Session/DiffPanel.tsx`
- `src/renderer/src/components/Session/PlanPanel.tsx`
- `src/renderer/src/components/Session/EventInspectorPanel.tsx`
- `src/renderer/src/components/Session/SideQuestionPanel.tsx`
- `src/renderer/src/components/Session/ExtensionsPanel.tsx`
- `src/renderer/src/components/Session/RunningAgentsStrip.tsx`
- `src/renderer/src/components/Session/ChatView.tsx`
- `src/renderer/src/components/Session/InputBar.tsx`
- `src/renderer/pet-overlay/src/PetOverlay.tsx`

Verification:

- Inspector smoke.
- Transcript smoke.
- Composer smoke.
- Pet overlay smoke.

### Phase 5: Visual QA And 1:1 Acceptance

Goal: make the work objectively checkable.

Deliverables:

- Screenshot baselines for critical surfaces.
- Reduced-motion mode coverage.
- Accessibility checks for menus/dialogs/sheets.
- File-level checklist updated after each migration.
- A Codex-vs-Orchestrator comparison checklist for badges, banners, panels, menus, tabs, sheets, and navigation.

Verification:

- `npm run typecheck`
- `npm run test:providers`
- `npm run smoke:ui:auto`
- Design-system preview smoke
- New targeted smoke tests
- `npm run build`

## Acceptance Checklist

Use this as the definition of done for the full migration.

- App mode changes animate consistently.
- Session switches animate consistently.
- Right sidebar opens/closes with size and opacity motion.
- Bottom terminal panel opens/closes with size and opacity motion.
- Resize handles match the Codex interaction model.
- Header buttons use shared toolbar primitives.
- Status indicators use shared badges.
- Notification banners use shared banner behavior across app and pet overlay.
- Notification compact/expanded controls match Codex behavior.
- Menus use shared enter/exit, focus, Escape, outside-click, disabled, and danger states.
- Sheets/dialogs use shared layout, focus, and motion.
- Tabs and segmented controls use a shared active indicator and keyboard-safe buttons.
- Settings uses shared rows, switches, segmented controls, status pills, cards, and form actions.
- Capabilities uses shared rows, menus, badges, forms, and sheets.
- Inspector panels use shared panel headers, rows, cards, badges, and disclosure motion.
- Transcript uses shared scroll-to-bottom, file, attachment, code, and thinking surfaces.
- Composer uses shared toolbar, button, attachment, and dropdown controls.
- Pet overlay uses shared or mirrored primitives for badge, banner, tray, rows, icon buttons, scale controls, and custom states.
- Reduced-motion behavior applies across the main renderer and pet overlay.
- Smoke tests cover settings, capabilities, navigation, panels, terminal, transcript, composer, and pets.

## Bottom Line

The current implementation is no longer just a first slice. It now has a real app-shell, panel, resize, tab, toolbar, badge, and inspector primitive baseline. It is still not a whole-app 1:1 Codex UI/motion system.

The biggest remaining pieces are:

1. Chat switching latency guard and smoke coverage.
2. Floating pet-overlay visual smoke coverage and reduced-motion hardening.
3. Shared dismissable menu/popover/sheet accessibility behavior.
4. Full settings migration.
5. Composer and transcript primitives.
6. Extensions panel migration.
7. Capabilities edit/sync sheet migration.

The next best step is the latency/pet-overlay verification pass: prove chat switching is instant, then add the floating pet-overlay harness so resize, badge, tray, banner, and custom-state behavior can be checked automatically.
