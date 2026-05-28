# Orchestrator Design System Gap Audit

Date: 2026-05-14

Focused update: 2026-05-15, after:

- `1d665b70 Align Orchestrator motion system with Codex`
- `f5585903 Migrate inspector panels to shared primitives`
- `cf86219a Document remaining Codex design gaps`
- `63366b0b Close Codex design parity gaps`
- `544bbb71 Migrate settings and composer primitives`
- current working pass: shared transcript/composer primitives, extensions primitive migration, deterministic capability edit/sync smoke, and reduced-motion panel/sheet/popover verification

## Scope

This audit checks whether Orchestrator's renderer and pet overlay now match the local Codex app's UI, motion, navigation, banners, badges, and shared design-system behavior after the first design-system spike and the follow-up Codex-alignment commits listed above.

Current status: the concrete app-design gaps from the focused follow-up pass are now implemented and covered by smoke tests. Orchestrator has the shared motion/interaction layer, pet-overlay fixture coverage, shared menu/sheet focus behavior, transcript jump/attachment/thinking primitives, extension-panel primitive usage, deterministic capability edit/sync smoke coverage, and reduced-motion checks for panels plus sheet/popover classes.

The remaining difference is product scope, not a known broken design-system path: Orchestrator still supports multiple providers and may expose provider-specific states that Codex does not have. Future provider-specific surfaces should continue entering through the shared primitives instead of adding local one-off controls.

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
- `webview/assets/avatar-overlay-page-NpEinaQb.js`
- `webview/assets/avatar-mascot-button-rs-0LxtH.js`
- `webview/assets/use-floating-window-pointer-interactivity-DR7NmDuw.js`

An earlier audit pass ignored unrelated local dirty edits in:

- `src/main/ipc.ts`
- `src/main/settings.ts`
- `src/preload/index.ts`
- `src/renderer/src/components/Session/InputBar.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/env.d.ts`

Those were separate preferred-editor and composer paste changes at the time; the relevant parts have since been folded into focused commits.

## Current Verification Coverage

The current smoke suite covers the formerly uncovered drift points:

- `npm run smoke:ui:auto -- --pet-overlay`: floating pet overlay badge/tray/resize/reply/status fixture coverage.
- `npm run smoke:ui:auto -- --capabilities`: seeded capability fixture, create menu/sheet focus behavior, and edit/sync sheet entry points.
- `npm run smoke:ui:auto -- --motion-reduced`: reduced-motion dataset plus panel transition checks, sheet/popover class checks, and pet-overlay reduced-motion checks.
- `npm run smoke:ui:auto -- --scroll`: transcript follow-bottom behavior and shared jump-to-latest control.
- `npm run smoke:ui:auto -- --extensions`: extensions command path and panel rendering after migration to shared cards/disclosures/rows.

## Historical Deep Dive: Concrete Gaps

The items below document the gaps that motivated the implementation work. They are kept for traceability against the Codex bundle evidence, but should not be treated as the current next-work checklist without re-running the audit.

### 1. Pet Overlay Badge Is Not 1:1

Codex evidence:

- `avatar-mascot-button-rs-0LxtH.js` renders the notification badge inside a shared `codex-avatar-button`.
- The badge is an animated motion button with `absolute top-0 right-0 z-20`.
- Badge sizing is centralized through two shapes: icon-only `size-7 p-0`, or text badge `min-h-7 min-w-7 px-2 py-1`.
- Badge motion uses spring behavior with hover/tap scale: `whileHover` scale `1.06`, `whileTap` scale `.94`, and spring `{ damping: 20, mass: .7, stiffness: 420 }`.

Orchestrator evidence:

- `src/renderer/pet-overlay/src/PetOverlay.tsx` renders the badge inline in the pet overlay file.
- The badge uses `top: 0`, `right: 0`, and then adds `transform: translate(6px, -4px)`.
- It uses a direct CSS transition string, including `scale` in the `transition` property.
- It does not use a shared pet/avatar badge primitive or motion-token helper.

Actual gap:

- The translated offset is a real likely cause of the visible chip clipping the user noticed. Codex keeps the badge anchored at the mascot's top-right; Orchestrator pushes it outside that anchor and relies on outer window padding to save it.
- Orchestrator also does not match Codex's badge motion. It has a color/transform transition but not the Codex spring hover/tap behavior.

Implementation target:

- Introduce an Orchestrator `AvatarMascotButton`/`AvatarNotificationBadge` primitive modeled on Codex.
- Remove the badge translation unless a screenshot comparison proves Codex also offsets it in the current installed build.
- Keep the Orchestrator provider/custom-state extensions in the notification model, but match Codex badge geometry and motion.
- Add screenshot assertions that the badge bounding box is fully inside the pet-overlay viewport at min/default/max mascot sizes and at one-digit/two-digit notification counts.

### 2. Pet Notification Tray Placement Is Not 1:1

Codex evidence:

- `avatar-overlay-page-NpEinaQb.js` has a fallback layout shaped as:
  - mascot: `left: 244`, `top: 191`, `width: 112`, `height: 121`
  - tray: `left: 80`, `top: 56`, `width: 276`, `height: 131`
  - viewport: `width: 356`, `height: 320`
  - placement: `top-end`
- For the fallback top-end layout, tray right edge and mascot right edge align at `356`.
- Codex sends `avatar-overlay-element-size-changed` with `isTrayVisible`, measured `mascot`, and measured `tray`.
- Codex computes tray size from the tray container plus header and list scroll height, not only the visible content box.

Orchestrator evidence:

- `src/main/petOverlay.ts` computes tray placement in `trayRectForPlacement()`, but wraps the union in `WINDOW_PAD = 16`, so renderer-relative coordinates differ from the Codex fallback.
- `src/renderer/pet-overlay/src/PetOverlay.tsx` initializes local layout to `mascotLeft: 176`, `trayLeft: 8`, `trayTop: 120` before config arrives.
- The tray is measured through a `ResizeObserver` on `trayRef` and reports `entry.contentRect.width/height`.
- The list has `maxHeight: 226`; the reported tray height can be the visible clipped height rather than the full list scroll height Codex uses for layout decisions.

Actual gap:

- Orchestrator can be visually close in simple cases, but it is not using the same measurement contract Codex uses. This matters for tray placement around screen edges, multiple notifications, expanded notification rows, reply forms, and scroll affordances.
- The user-observed notification location mismatch is consistent with the current implementation: Orchestrator's renderer coordinates, window padding, fallback layout, and tray measurement path are all different from Codex's.

Implementation target:

- Switch the overlay contract closer to Codex: renderer reports `{ isTrayVisible, mascot, tray }` from measured DOM nodes; main computes window bounds from those exact dimensions.
- Measure the same selector set Codex measures: mascot root, notification tray, tray header, tray list, and tray rows.
- For tray height, include header height plus list `scrollHeight` when deciding layout, while still allowing the visible list to scroll.
- Add fixture screenshots for top-end, top-start, bottom-end, and edge-clamped placements.

### 3. Pet Overlay Pointer Interactivity Is Less Robust Than Codex

Codex evidence:

- `use-floating-window-pointer-interactivity-DR7NmDuw.js` watches mousemove, resize, scroll, mouseleave, DOM mutations, and hover state across selectors.
- It can include an interactive region ref plus child selectors and floating element selectors.
- It re-evaluates interactivity with `document.elementsFromPoint()`, visibility checks, and requestAnimationFrame scheduling.

Orchestrator evidence:

- `PetOverlay.tsx` only checks `document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-interactive]')` on mousemove.
- It does not use a MutationObserver, resize/scroll invalidation, document mouseleave handling, or multi-selector hover fallback.

Actual gap:

- Orchestrator can leave pointer passthrough in the wrong state after DOM changes, tray expansion, reply-form focus, scroll affordance changes, or edge movement.
- This is especially risky because the overlay is transparent and `setIgnoreMouseEvents(true, { forward: true })` makes missed hit regions feel like broken controls.

Implementation target:

- Port Codex's selector-driven pointer-interactivity hook concept.
- Treat resize handle, badge, tray, tray buttons, notification rows, reply form, and context menu as named interactive selectors.
- Add smoke coverage for pointer interactivity before and after opening/closing the tray and reply form.

### 4. Pet Notification Semantics Are Missing Codex Cases

Codex evidence:

- `avatar-overlay-page-NpEinaQb.js` builds waiting requests for user input, exec approvals, patch approvals, permission requests, implement-plan requests, MCP server elicitations, tool suggestions, connector auth, URL actions, and generic tool approvals.
- It has compact titles/actions such as `Allow once`, `Apply`, `Review`, `Implement plan`, `Open link`, `Sign in {target}`, `Reconnect {target}`, and `Allow {target}`.
- It supports local and cloud sessions and tracks whether running sessions are local or cloud.

Orchestrator evidence:

- `src/types/petNotifications.ts` supports Orchestrator-specific provider states and has waiting kinds for question, exec, network, patch, permission, plan, and tool.
- The actual action handling in `PetOverlay.tsx` only implements `permission-response`, `question-option`, `open`, and reply.
- There is no concrete MCP elicitation, connector-auth, plugin/tool install/enable, URL action, or plan-start action handling path in the overlay.

Actual gap:

- The Orchestrator model has a broader type vocabulary than its overlay action implementation. That means some Codex-like notification cases would render as generic rows or non-functional actions if introduced.
- This is acceptable only as an explicitly tracked provider-extension gap, not as "1:1 except multiple providers."

Implementation target:

- Define an explicit Orchestrator waiting-action matrix: Codex parity actions, provider-specific actions, and intentionally unsupported actions.
- Add tests for each waiting kind that the overlay claims to support.
- Add visual fixture rows for each action family, not just running/waiting/review/failure.

### 5. Pet Overlay Verification Is Still The Biggest Blind Spot

Actual evidence:

- `scripts/run-automated-ui-smoke.mjs` always launches with `ORCHESTRATOR_DISABLE_PET_OVERLAY: '1'`.
- The `--pets` smoke view opens the settings Pets section, not the floating pet overlay.
- The current smoke assertions check broad UI presence: profile badge, composer, sidebar navigation, button count, etc.
- There is no automated screenshot path for the floating overlay, badge clipping, tray placement, tray expansion, reply form, resize handle, or max-size mascot.

Actual gap:

- The exact problems the user noticed are not currently testable in CI or smoke. Main UI smoke can pass while the floating pet UI is visibly wrong.

Implementation target:

- Add a real pet-overlay fixture harness.
- It should run with the overlay enabled, seed sessions/events, and capture overlay screenshots.
- It should assert:
  - badge is not clipped
  - tray aligns with mascot the same way Codex does
  - tray scroll buttons appear in the right positions
  - expand/collapse and dismiss controls appear only on hover/focus
  - reply form toggles keyboard interactivity
  - resize at 80/112/224 px does not clip mascot or badge

### 6. Shared Interaction Layer Is Still Not Codex-Level

Codex evidence:

- `dropdown-BkHM69Th.js`, `dialog-layout-7MMZLqhQ.js`, `context-menu-5WduLoHb.js`, and `popover-D2JieFfY.js` centralize interaction behavior.
- Codex dropdown/dialog surfaces include Escape handling, focus behavior, disabled/danger states, submenu/disclosure behavior, and exit animation retention.

Orchestrator evidence:

- `src/renderer/src/components/shared/designSystem.tsx` has `Sheet` and `PopoverSurface`, but `PopoverSurface` is visual only.
- `Sheet` handles Escape and outside-click, but does not trap focus or restore focus.
- `InputBar.tsx` closes menus on document `mousedown`, but not Escape, roving keyboard navigation, or focus restoration.
- `CapabilitiesPage.tsx` uses `PopoverSurface` for create/row menus, but `EditCapabilitySheet` and `SyncCapabilitySheet` still use `capability-sheet-backdrop`.
- `removeGroup()` still uses native `confirm()`, which is not Codex-like and bypasses the design system entirely.

Actual gap:

- Orchestrator now has visual primitives, but it does not yet have the interaction primitives Codex relies on. This is why surfaces can look closer while still feeling less robust.

Implementation target:

- Add shared `DismissableLayer`, `Menu`, `MenuItem`, `Dialog`, and focus utilities before migrating more visual surfaces.
- Convert InputBar menus, capability menus, edit/sync sheets, and native confirms to those primitives.
- Add keyboard tests for Escape, arrow navigation, Enter/Space selection, focus return, and outside-click dismissal.

### 7. Motion Exists, But It Is CSS-Based And Under-Tested

Codex evidence:

- Codex app shell uses motion-value style panel animation in `app-shell-panel-animation-COicGkL7.js`.
- Codex avatar badge uses spring motion.
- Codex dropdowns retain exit animations through animation wrappers.

Orchestrator evidence:

- `index.css` defines `motion-view`, `motion-panel`, `motion-sheet`, `motion-popover`, row animation, badge hover, and reduced-motion overrides.
- `MotionPanel` animates width/height/opacity with CSS transitions.
- The session view had to be changed to `animate={false}` because keying it by session id made chat switching feel slower.
- Pet overlay still has direct inline transition strings and is not covered by the main renderer reduced-motion CSS.

Actual gap:

- Motion is present, but it is not yet a robust app-wide system. We already hit one real latency regression around chat switching.
- Pet motion is still separate from the main renderer motion system.

Implementation target:

- Keep session switching non-animated unless a latency smoke proves otherwise.
- Add a session-switch latency smoke with two seeded sessions and a 100-150 ms DOM-visible threshold.
- Move pet overlay transitions behind cross-renderer motion tokens or reduced-motion-aware helpers.
- Add screenshot/DOM smokes for right panel, terminal panel, sheet, popover, and pet overlay in normal and reduced-motion modes.

### 8. Composer And Transcript Are Still High-Risk Local Surfaces

Actual evidence:

- `InputBar.tsx` owns provider/model/agent/permission menus locally.
- Its menus are manually positioned `DropdownPanel`s with inline styles.
- It uses document `mousedown` outside-click handling but not shared menu keyboard behavior.
- `ChatView.tsx` still owns transcript row presentation, user-message expansion, scroll-to-bottom behavior, message actions, and inline animation styles.

Actual gap:

- These are the highest-frequency app surfaces. Even if settings and capabilities are migrated, the app will not feel Codex-level until composer and transcript behavior are systematized and tested.

Implementation target:

- Build `ComposerShell`, `ComposerToolbar`, `ComposerMenu`, `ComposerAttachmentChip`, `TranscriptMessage`, `MessageActionButton`, and `ScrollToBottomButton` primitives.
- Migrate menus to the shared interaction layer before changing visual styling.
- Add smokes for slash palette, provider switcher, permission menu, attachment chips, long transcript scroll, streaming assistant text, and scroll-to-bottom behavior.

### 9. Settings Remains The Largest Bespoke Area

Actual evidence:

- The latest static inventory still found `SettingsModal.tsx` with the highest local styling count.
- Settings contains provider cards, model management, drag-sort rows, diagnostic pills, pet cards, catalog toggles, custom model inputs, and local hover behavior.
- It currently also has unrelated local dirty edits in the worktree, so broad rewrites are risky unless staged carefully.

Actual gap:

- Settings is not Codex-level yet. It has some migrated controls, but not the same component architecture as Codex settings (`settings-row`, `settings-surface`, `settings-group`, shared buttons/toggles, and avatar settings surface).

Implementation target:

- Split settings migration into provider, model, general, pets, diagnostics, and editor sections.
- Introduce settings primitives first, then migrate each section in small commits.
- Keep hunk staging strict while unrelated preferred-editor edits are present.

### 10. Current Smoke Coverage Is Too Shallow For Design Parity

Actual evidence:

- Main UI smoke validates that broad elements exist, not that layout/motion/interactions match Codex.
- The pet overlay is disabled during automated UI smoke.
- There are no screenshot comparisons or geometry assertions for pet overlay badge/tray placement.
- There are no keyboard interaction tests for menus/popovers/sheets.
- There is no reduced-motion smoke mode.
- There is no session-switch latency assertion.

Actual gap:

- Orchestrator can regress in the exact areas that define Codex polish while still passing current smoke.

Implementation target:

- Add three verification lanes:
  - Geometry/visual smokes: pet overlay, shell panels, sheets, menus, transcript.
  - Interaction smokes: keyboard navigation, focus return, Escape, outside click, reply form, resize.
  - Performance/latency smokes: session switching and panel open/close without perceived delay.

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
- Settings now has shared settings-section/card/pill primitives for the migrated general/provider/model/editor areas.
- Composer dropdowns now use the shared dismissable popover surface and have smoke coverage for Escape and outside-click dismissal.
- Shared sheets and modal overlays now use `role="dialog"`, `aria-modal`, initial focus, focus containment, focus restoration, and centralized Escape handling.
- Pet resize no longer waits for a renderer `ResizeObserver` round trip to resize the floating window; it sends live resize-preview width to the main process, which recomputes the window bounds immediately.
- Pet overlay smoke now exercises the real floating overlay window and asserts badge/tray/mascot geometry at default, max, and min mascot widths.
- Forced reduced-motion smoke now verifies the main renderer CSS path and pet-overlay inline transition fallbacks.
- UI smoke coverage has been exercised for main, design-system, terminal, inspector, capabilities, and pets/settings views.

### Still Not Codex-Level

These remain the main gaps:

- `SettingsModal.tsx` is still the largest bespoke UI surface.
- `InputBar.tsx` and `ChatView.tsx` still own important transcript/composer surfaces locally.
- `ExtensionsPanel.tsx` is still mostly local and has repeated disclosure/transition behavior.
- Capabilities edit/sync sheets still use the old `capability-sheet-backdrop` and local sheet layout.
- Menus/popovers now have shared Escape/outside-click dismissal in the migrated composer surfaces, and sheets/dialogs have shared focus handling. Full Codex-level roving menu keyboard behavior and exit animation retention are still missing.
- The pet overlay is visually closer, but it still uses overlay-local primitives instead of a shared cross-renderer design layer.
- The deterministic floating pet-overlay smoke now covers badge, tray, mascot bounds, tray alignment, min/max resize clipping, row control reveal, row expansion, tray collapse/reopen, and reply-form focus/close behavior. It still needs custom-provider state fixtures and broader visual snapshots.
- Reduced-motion is now verified for the main renderer CSS path and the pet-overlay badge/row inline transition paths. It still needs broader panel/sheet/popover screenshots in reduced-motion mode.
- Session-switch transitions now have a dedicated latency smoke/assertion.
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

Current verification:

- `npm run smoke:ui:auto -- --session-switch` seeds two sessions, switches from the first to the second, and asserts both transcript text and title text become visible within the 150ms budget.
- The same smoke asserts the session `MotionView` is not using the app-mode animation class, so chat-to-chat switching is protected from the slower page transition.

Still needed:

- Keep this smoke in the regular UI verification set whenever motion/navigation changes.

Acceptance rule:

- No route/page animation should be applied to rapid chat-session switching unless it is proven not to increase perceived latency.

### P0: Pet Overlay Confidence

Why it matters: this is the surface most likely to regress invisibly because the floating overlay is a separate renderer/window and current smokes do not exercise it directly.

Current verification:

- `npm run smoke:ui:auto -- --pet-overlay` now verifies badge/tray/mascot geometry, min/max pet resize bounds, tray collapse/reopen, row control reveal, row expansion, reply open/focus/Escape close, permission action buttons, running/review/failed status buckets, and custom-provider status mapping.
- The resize handle now exposes a focus-visible grip as well as the hover-only grip, and the smoke asserts both states.

Still needed:

- Add a persisted screenshot gallery for default, max-size, collapsed tray, expanded tray, reply form, permission, running, review, and failed states if reviewers need visual baselines in CI artifacts rather than the current per-smoke screenshot.

Suggested implementation:

- Extend the existing `--pet-overlay` smoke mode with fixture events for review, running, permission actions, and custom provider states.
- Capture screenshots for default, max-size, collapsed tray, expanded tray, reply form, and waiting-for-input states.
- Add DOM assertions for the hover/focus-only resize affordance, especially `data-testid="avatar-overlay-resize-handle"`.

### P0: Menu, Popover, And Sheet Accessibility

Why it matters: Codex's dropdowns and dialogs are not just visual. They centralize keyboard behavior, focus behavior, Escape handling, disabled/danger states, and exit animation.

Current verification:

- Shared `MenuSurface` now focuses the first menu item, supports ArrowUp/ArrowDown/Home/End, closes on Escape/outside click, and restores focus to the opener.
- Shared `DismissablePopoverSurface` now restores focus to the opener after Escape or outside-click dismissal.
- Shared menu, popover, sheet, and dialog close paths now mark the surface with `data-motion-exit="true"` and delay the close callback long enough for an exit animation when reduced motion is not active.
- Capabilities smoke verifies create-menu open, arrow-key focus, Escape dismissal, focus return, and retained exit states for create menu, create sheet, and delete confirmation dialog.
- Composer smoke verifies permission-menu Escape focus return and agent-menu outside-click focus return.

Still needed:

- `MenuSeparator` and optional submenu/disclosure behavior.

Highest-value targets:

- `CapabilitiesPage` create menu and row action menu.
- `CapabilitiesPage` edit and sync sheets.
- `SessionActionsMenu`, which is visually migrated but still has local item behavior.
- Slash palette hover/keyboard model.

Current progress:

- Shared `Sheet` and `MotionOverlay` now centralize dialog ARIA, initial focus, Tab containment, Escape close, and focus restoration.
- Capabilities smoke now asserts that the create sheet opens with focus inside it, Tab remains inside it, and Escape closes it.

### P0: Settings Migration

Why it matters: settings is still the biggest non-system surface and carries provider, model, pets, diagnostics, and appearance controls.

Still needed:

- `SettingsRow`.
- `ProviderCard`.
- `SortableModelRow` or a reusable sortable row primitive.
- Pet card controls using shared primitives.
- Remaining provider/model/pet/diagnostic rows converted away from local inline card styling.

Constraints:

- The file currently has unrelated local preferred-editor edits in the worktree. Keep future design-system staging hunk-scoped unless those edits are intentionally folded in.

### P1: Composer And Transcript

Why it matters: Codex's interaction feel depends heavily on the composer and transcript. Orchestrator still has many local styles here.

Current verification:

- Focused `node scripts/run-automated-ui-smoke.mjs --scroll` verifies streamed assistant updates expose a polite atomic thinking indicator under `thinkingIndicatorDuringUpdate=true`, hide it after completion under `thinkingIndicatorHiddenAfterComplete=true`, and keep scroll lock, streaming cursor, dedupe, and jump-to-latest gates green.
- Focused `node scripts/run-automated-ui-smoke.mjs --composer` verifies `/btw` side-chat sends with attachments are blocked by a recoverable polite status guard under `composerSideChatAttachmentGuard=true`, preventing local attachment context from being silently dropped.
- Focused `node scripts/run-automated-ui-smoke.mjs --composer` verifies `/model` opens the existing thread model/settings popover under `composerSlashModelOpensSettings=true` instead of inserting a literal command into the composer.

Still needed:

- `ComposerShell`.
- `ComposerButton`.
- `ComposerToolbar`.
- `ComposerAttachmentChip`.
- `ComposerStatusButton` for permission/model/runtime state.
- `ScrollToBottomButton` modeled on Codex's scroll-to-bottom behavior.
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

Current verification:

- The session-side `ExtensionsPanel` is mounted again through the inspector path, and `/extensions` opens it directly.
- `npm run smoke:ui:auto -- --extensions` verifies the panel is reachable, renders provider extension/local-instruction content, and keeps summary, disclosure, file row, command section, command row, and item row chrome on shared primitives under `extensionsPanelSharedPrimitives=true`.

Still needed:

- Continue Extensions work only when real provider data or live Codex comparison reveals a workflow/functionality gap; the known local primitive migration item is closed for the current embedded panel.

### P1: Files Source Tabs

Why it matters: source tabs are a daily coding surface. File actions should behave like app controls with visible, announced results rather than silent clipboard/open/reveal side effects.

Current verification:

- `node scripts/run-automated-ui-smoke.mjs --files` now verifies `fileSourceActionStatus=true`, covering the compact file-tab action status live region for copy-line feedback and success/failure semantics.
- The same focused smoke verifies `fileSourceAddToChat=true`, covering source-tab Add file to chat creating a visible composer attachment rather than only dispatching an unobserved event.
- The same focused smoke verifies `filesContentSearchOpenLine=true`, covering content-search hits opening matched files in source mode with the matched line selected and revealed.

Still needed:

- Provider-backed comments/blame, provider/global indexed workspace search, and exact live Codex source-find focus timing remain open. Deep Office/PDF renderer fidelity stays Phase 2 unless it blocks coding workflows.

### P1: Capabilities Edit/Sync Sheets

Why it matters: the create flow and rows are partially migrated, but edit/sync still use local sheet/backdrop layout.

Current verification:

- `CreateCapabilitySheet`, `EditCapabilitySheet`, and `SyncCapabilitySheet` use shared `Sheet`.
- Sync provider targets now use shared `SettingChoiceCard`, and sync plan operations use `InspectorCard`.
- Capabilities smoke covers create-sheet focus trapping, menu keyboard/focus behavior, and deterministic seeded edit/sync sheet entry points under `capabilitySeededFixture=true`, `capabilityEditSheet=true`, and `capabilitySyncSheet=true`.

Still needed:

- Continue Capabilities work only when a real provider capability workflow exposes a functionality gap; the known deterministic edit/sync smoke coverage gap is closed.

### P1: Reduced Motion

Why it matters: Codex's motion is polished partly because reduced-motion behavior is predictable.

Current verification:

- `npm run smoke:ui:auto -- --motion-reduced` verifies forced reduced-motion propagation, zeroed main-renderer motion durations, disabled pet-overlay badge/row/resize-grip transitions, collapsed tray behavior, reply form behavior, and main-app screenshot-region assertions for the right panel, bottom terminal panel, shared sheet, and shared popover.
- `node scripts/run-automated-ui-smoke.mjs --terminal` now verifies `terminalFailureStateA11y=true`, covering terminal shell-ended recovery as a polite atomic status region with labelled copy and a named recovery action group.
- `node scripts/run-automated-ui-smoke.mjs --settings` now verifies `settingsBrowserStatusA11y=true` and `settingsBrowserDomainControlsA11y=true`, covering Browser Settings clear/save status announcements, labelled domain inputs, list semantics, and icon-only remove controls with accessible names.
- `node scripts/run-automated-ui-smoke.mjs --settings` now verifies `settingsWorktreesActionA11y=true`, covering Worktrees Settings create/delete status announcements plus named worktree row, delete, conversation list, and open-chat controls.
- `node scripts/run-automated-ui-smoke.mjs --diff-core` now verifies `reviewFloatingGitActionStatus=true`, covering Review floating local-git action progress/results as polite status and failure as assertive alert semantics.
- `node scripts/run-automated-ui-smoke.mjs --header` now verifies `headerPanelEmptyFallback=true`, covering the header side-panel control's right-Workbench ownership and empty-panel fallback to the Workbench New tab launcher.

Still needed:

- Continue replacing feature-local transition strings with shared motion helpers as each surface migrates.

### P2: App-Shell Maturity

Why it matters: Orchestrator's shell is now structurally closer to Codex, but it is still CSS-transition based, not as mature as Codex's motion-value panel implementation.

Still needed:

- Decide whether CSS transitions are acceptable or whether to adopt a motion-value style implementation for panel width/height.
- Add visual assertions for right panel open/close and terminal open/close.
- Keep session-switch smoke coverage in the required motion/navigation verification set.
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

The current implementation is no longer just a first slice. It now has a real app-shell, panel, resize, tab, toolbar, badge, inspector, pet-overlay geometry, reduced-motion, retained shared-surface exits, and shared interaction primitive baseline. It is still not a whole-app 1:1 Codex UI/motion system because settings, transcript, composer, extension panels, roving menu keyboard behavior, and deeper live visual comparison still need dedicated finishing passes.

Completed in the latest implementation pass:

- Floating pet-overlay badge and tray geometry now report measured mascot/tray metrics to the main-process layout manager.
- Pet overlay pointer interactivity now covers the mascot, badge, resize handle, tray, rows, and controls instead of only checking generic `data-interactive` hits.
- Pet overlay badge scaling now uses Codex-like hover/press motion and reduced-motion fallback.
- Automated pet-overlay smoke now verifies overlay presence, badge/tray/mascot bounds, tray alignment, overflow, min/max mascot resize clipping, row control reveal, row expansion, tray collapse/reopen, and reply-form focus/close behavior.
- Automated session-switch smoke now verifies transcript switching within budget and confirms the session view is not replaying entrance motion.
- Automated reduced-motion smoke now verifies forced reduced-motion profile propagation, zeroed main-renderer motion durations, and disabled pet-overlay badge/row transitions.
- Shared `MenuSurface`, `MenuItem`, `DismissablePopoverSurface`, `ConfirmDialog`, and `TextInputDialog` primitives now cover Escape/outside-click behavior, disabled/danger states, and native dialog replacement.
- Shared menu, popover, sheet, and dialog close paths now retain exiting surfaces with `data-motion-exit="true"` instead of immediately unmounting on Escape/outside/close-button paths.
- Capabilities create/row menus, edit/sync sheets, and delete confirmation now use shared primitives.
- Session action rename/delete and project removal no longer use native browser prompt/confirm UI.
- Capabilities smoke now verifies create-menu open, menu Escape dismissal, create-sheet open, sheet Escape dismissal, and retained exit states for menu, sheet, and dialog surfaces.
- Settings now shares design-system primitives for intro text, groups, panels, compact rows, choice cards, status pills, diagnostic pills, provider command-output cards, the provider picker, the provider model-list manager, the provider config editor, Appearance color swatches/chrome editor controls, and Appearance import controls.
- Composer provider/agent/permission dropdown panels now use shared dismissable popover behavior with focus return.
- Composer smoke now verifies permission-menu Escape dismissal/focus return, agent-menu outside-click dismissal/focus return, expanded/collapsed ARIA state on Agent/Permission popover triggers, and Arrow-key roving focus inside composer popovers.
- Composer smoke now verifies `composerPermissionContextSignal=true`, covering the closed permission trigger's Static/Live/Fallback config-source badge and accessible label before users open the permission menu.
- Composer smoke now verifies `composerPermissionRuleStatus=true`, covering labelled advanced permission-rule inputs and polite saved feedback for Allow/Deny/Tools/Dirs edits.
- Composer smoke now verifies `composerAttachmentStatus=true`, covering visible and announced add/remove attachment feedback mirrored on the composer shell.
- Side Chat smoke now verifies `sideChatActionStatusA11y=true` and `sideChatRetryStatusA11y=true`, covering visible and announced answer status plus log/article semantics for side-chat messages opened from both `/btw` and in-panel retry paths.
- Settings smoke now verifies `settingsShortcutActionStatusA11y=true`, covering visible and announced shortcut save/conflict/clear status on the Shortcuts page.
- Workbench New tab smoke now verifies `agentRuntimeEventCopy=true` and `agentRuntimeEventAddToChat=true`, covering selected Agents event-detail payload copy plus direct composer handoff with visible status feedback.
- Transcript layout smoke now verifies `chatMessageCopy=true` and `chatMessageCopyA11y=true`, covering assistant-message copy through the same app clipboard bridge plus copied/error live status semantics.
- Diff core smoke now verifies `reviewGitApplyCopyStatus=true`, covering Review `Copy git apply command` through the app clipboard bridge plus copied/failure status semantics on the floating Review action pill.
- Browser smoke now verifies `browserCopyUrlStatus=true`, covering Browser `Copy URL` through the app clipboard bridge plus copied/failure status semantics in the load-error recovery panel.
- Terminal smoke now verifies `terminalClipboardStatus=true`, covering terminal paste through the app clipboard bridge plus visible and announced paste/failure status semantics.
- Files smoke now verifies `fileSourceActionStatus=true` against the copied clipboard value, covering source-tab path and selected-line copy through the app clipboard bridge plus existing live status semantics.
- Files smoke now verifies `filesRowCopyPathClipboard=true`, covering Files tree row path copy through the app clipboard bridge plus visible and announced toolbar status semantics.
- Transcript layout/tool-failure smokes now verify `errorRecoveryRetryA11y=true`, `chatContinueLastTurnA11y=true`, and `transcriptToolFailureRetryA11y=true`, covering announced retry/continue state changes for the main recovery paths.
- Composer blocked-send notices now render as polite atomic status regions, and transcript user-input/permission recovery states now expose assertive error alerts, polite sent/decision statuses, and named approval action groups.
- Browser load-error recovery notices now render as assertive atomic alerts with named recovery action groups while preserving shared `PanelNotice` chrome.
- Transcript active-run queue controls now share badge/button primitives for queued and steering follow-ups, and focused streaming smoke verifies steering follow-ups remain cancellable.
- Pet overlay smoke now verifies custom provider state mapping, permission actions, running/review/failed buckets, tray collapse/reopen, row expansion, reply focus, and resize-handle hover/focus visibility.
- Session-switch smoke now verifies transcript and title changes stay within the 150ms budget and are not hidden behind app-mode page animation.
- Extensions panel is reachable again from `/extensions`, uses shared summary/disclosure/file/command/item row chrome for the embedded right-panel surface, and is covered by an automated smoke.

The biggest remaining pieces are:

1. Composer and transcript workflow polish beyond the implemented shared primitives, especially deeper context/permission flows and provider-backed retry/continue proof.
2. Deeper visual comparison baselines against Codex for badges, banners, panels, menus, tabs, sheets, and navigation.
