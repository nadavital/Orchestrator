# Codex Side Panel UI Parity Audit

Date: 2026-05-21

This is a bundle-backed comparison of the locally installed Codex app side-panel UI against Orchestrator. The goal is to make the Orchestrator Chat Sidebar, Workbench Panel, Terminal Panel, settings windows, and related panel content feel as clean, efficient, and robust as Codex before adding bespoke Orchestrator behavior.

Important framing: Codex is the reference for UI maturity and interaction quality, not a provider-specific product target. Any shared behavior should become provider-agnostic Orchestrator shell infrastructure first, with Codex, Claude, Cursor, Copilot, and future providers mapped through adapters.

## Evidence Map

Codex bundle inspected from:

- `/Applications/Codex.app/Contents/Resources/app.asar`
- Extracted audit chunks under `/private/tmp/codex-asar-sidebar-audit`

Primary Codex reference chunks:

- Shell and panels: `app-shell-JLpboL12.js`, `app-shell-BJK30dyj.css`, `app-shell-state-HP0T5lEX.js`, `app-shell-panel-animation-C6SMnz6V.js`
- Tab lifecycle: `app-shell-tab-controller-B2eCi4Le.js`, `thread-side-panel-tabs-D3IwKAR4.js`, `thread-side-panel-tabs-DydIzOtr.js`, `tabs-BgnCzZaP.js`, `thread-panel-state-_aKlkyVE.js`, `right-panel-composer-overlay-scroll-reserve-BKJayTK4.js`
- Review/files: `review-navigation-model-BQVAIXWq.js`, `review-header-toolbar-B_kdqvHA.js`, `review-file-tree-side-pane-qCgJ0jE8.js`, `review-file-source-tab-_AZBZ4OY.js`, `file-tree-search-input-Cg1SVtq4.js`, `workspace-directory-tree-CHHgPVoD.js`, `file-diff-D_Wkd-VE.js`, `patch-item-content-DT3HGNNi.js`, `diff-view-mode-C3ZAZUHZ.js`, `diff-stats-C-S_JU1b.js`
- Browser: `browser-sidebar-manager-ivre5jEI.js`, `browser-sidebar-state-BFSGuaA8.js`, `browser-sidebar-open-source-BsfzziCZ.js`, `thread-side-panel-browser-tab-state-PqkmuSww.js`, `browser-sidebar-comment-mode-coachmark-state-DonNJgsl.js`
- Terminal/bottom panel: `thread-page-bottom-panel-state-D1Lz0U4Y.js`, `thread-page-bottom-panel-state-Dxfgdicg.js`, `thread-page-bottom-panel-state-kHJ-D0s7.css`, `terminal-CNbIwMET.js`
- Left sidebar: `app-main-zQ4S20Da.css`, `app-shell-BJK30dyj.css`, `sidebar-signals-DI3M13c-.js`, `sidebar-thread-list-signals-FpAb9VJn.js`, `sidebar-project-groups-DUHIVRJe.js`, `sidebar-project-group-signals-B2IlZT8R.js`, `thread-actions-C8deI8Bf.js`, `pinned-threads-query-C44A652V.js`, `set-pinned-thread-BF6dMuHF.js`, `dropdown-PBHuhi3M.js`, `dropdown-9F1MU8ql.css`, `context-menu-TJfRSX1h.js`, `popover-DPlyXlNf.js`, `button-bq66r8jD.js`
- Settings: `settings-content-layout-Bnulb0lM.js`, `settings-page-Cs2EUu3v.js`, `settings-row-DYYQqFuu.js`, `settings-group-DNhpghsa.js`, `settings-surface-YwAy0P94.js`, `appearance-settings-C6oiotxg.js`, `keyboard-shortcuts-settings-RVscBDKb.js`

Orchestrator files compared:

- Workbench: `src/renderer/src/components/Session/ContextSidebar.tsx`
- Terminal: `src/renderer/src/components/Session/SessionPane.tsx`, `src/renderer/src/components/Session/TerminalView.tsx`
- Workbench tabs/content: `DiffPanel.tsx`, `FilesPanel.tsx`, `BrowserPanel.tsx`, `PlanPanel.tsx`, `EventInspectorPanel.tsx`, `ExtensionsPanel.tsx`, `SideQuestionPanel.tsx`
- Chat Sidebar: `src/renderer/src/components/Sidebar/Sidebar.tsx`, `ProjectSection.tsx`, `SessionItem.tsx`, `SessionActionsMenu.tsx`
- Shared UI/CSS: `src/renderer/src/components/shared/designSystem.tsx`, `src/renderer/src/index.css`
- Settings: `src/renderer/src/components/SettingsModal.tsx`

Current Orchestrator screenshots captured during the 2026-05-22 styling pass:

- Review: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-diff-1779434620728.png`
- Files: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-files-1779434641021.png`
- Browser: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-browser-1779434675335.png`

## Executive Summary

The biggest gap is architectural, not ornamental. Codex has one app-shell system that owns left panel, right panel, bottom panel, focus areas, tab controllers, animated sizes, resize handles, shortcut routing, and panel content lifecycles. Orchestrator has separate local implementations for Chat Sidebar, Workbench Panel, Terminal Panel, Browser, Review, Files, Settings, and hover/menu surfaces.

That split causes the visible problems:

- The Workbench Panel feels like a custom sidebar instead of a first-class app panel.
- The right panel tabs are readable now, but they still lack Codex's controller-backed lifecycle, drag reorder, preview tabs, sticky action slots, and polished close behavior.
- The browser/review/files panels are useful, but they are not as deeply integrated with shell, route state, file tabs, search, review modes, or native app-server events.
- The Chat Sidebar has some Codex-like bits, but it lacks Codex's richer grouping model, connection/projectless/cloud/pending-worktree organization, custom sections, server-backed pinned state, and action set.
- Settings and modal windows are still a large Orchestrator-specific modal rather than Codex-style settings pages built from shared `SettingsPage`, `SettingsSurface`, `SettingsGroup`, and `SettingsRow` primitives.

## Highest Priority Gaps

| Priority | Area | Difference | Why It Matters |
| --- | --- | --- | --- |
| P0 | Shared shell | Codex uses a shared app shell for left/right/bottom panels; Orchestrator uses one-off panel implementations. | This is the root cause of inconsistent motion, sizing, focus, shortcuts, and chrome. |
| P0 | Right panel tab controller | Codex tabs are controller-backed with open/update/close/move/reset/preview/pin semantics; Orchestrator tabs are mostly store arrays plus local handlers. | This blocks Codex-like file tabs, browser tabs, artifacts, terminal movement, preview tabs, and robust close behavior. |
| P0 | Right panel content model | Codex right panel can host browser, review, file, artifact, PR, automation, MCP app, and terminal tabs through the same controller. Orchestrator has fixed Workbench content types plus local side-chat tabs. | Orchestrator needs panel extensibility before its UI will feel powerful instead of stitched together. |
| P0 | Review/File viewer | Codex review supports modes, filters, split/unified diff, hunk expand/collapse, comments, file-source tabs, git blame, rich previews, and search. Orchestrator has a useful but much thinner Review/Files pair. | The right panel's most important productivity surface is far below Codex. |
| P0 | Browser panel | Codex keeps hidden transferable webviews, browser-use cursor/viewport state, device presets, local servers, and comment mode. Orchestrator embeds a simpler browser workbench. | Browser smoothness and persistence will keep feeling worse until lifecycle moves closer to Codex. |
| P1 | Left sidebar information architecture | Codex supports project/connection/recent/all modes, custom sections, collapsed sections, server-backed pinned threads, projectless/cloud/pending-worktree grouping. Orchestrator is mostly local projects plus pinned/recent. | The left sidebar remains visually and structurally less capable. |
| P1 | Settings/windows | Codex settings use page/surface/group/row primitives; Orchestrator settings remain a large modal with dense custom sections. | Settings will continue to feel messy unless rebuilt on shared settings primitives. |
| P1 | Terminal panel | Codex terminal is integrated into app-shell tab controller and can live in bottom or right panel. Orchestrator terminal is a separate bottom-only implementation. | Terminal chrome and robustness will diverge from Codex until shared. |

## Fine-Grained Styling And UI Audit

This section records the exact bundle-backed styling differences found on 2026-05-22. It is intentionally detailed because the remaining gap is now less about whether Orchestrator has a feature at all and more about the small typography, spacing, border, control, and lifecycle decisions that make Codex feel calmer.

### Global Tokens And Visual Language

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Token source | Codex relies heavily on semantic token classes such as `text-token-text-primary`, `text-token-text-secondary`, `text-token-description-foreground`, `border-token-border`, `bg-token-bg-fog`, `bg-token-input-background`, `h-token-button-composer`, `w-token-sidebar`, `h-toolbar`, and `px-row-x` / `py-row-y`. | Orchestrator has local CSS variables and maps some `--color-token-*` aliases, but most surfaces still use bespoke classes such as `right-sidebar-*`, `diff-panel-*`, `files-panel-*`, `browser-*`, `settings-*`, and `surface-row`. | Build one Orchestrator app token layer that all panes consume; reduce surface-specific colors/radii/weights to a minimum. |
| Default UI font | Codex rows and controls generally sit at `text-sm` or `text-base leading-[18px]` depending on the component primitive, with secondary descriptions usually `text-xs` or `text-sm`. File tree explicitly overrides to `13px`. | Orchestrator sets `--font-ui-size: 13px`, `--font-code-size: 13px`, but many local elements use 11px, 11.5px, 12px, 12.5px, 13.5px, 14px, and heavier local weights. | Normalize panel interiors around 13px body text, 12px secondary text, and avoid ad hoc half-pixel sizes unless a component primitive requires it. |
| Font weight | Codex mostly uses normal text for rows, `font-medium` for pills/headings, and hides action emphasis until hover. | Orchestrator still uses 560/600/620/640/650/700 in many sidebar, settings, browser, file, and menu surfaces. | Lower row/control weights: active state should come from color/background, not boldness. Reserve 600+ for real section titles. |
| Radii | Codex commonly uses `rounded-lg` for inputs/nav rows, `rounded-[7px]` for compact pills, toolbar-sized icon buttons, and fewer nested framed cards. | Orchestrator has `--radius-sm: 6px`, `--radius-md: 9px`, `--radius-lg: 13px`, and uses `radius-lg` frequently on settings rows, hover cards, side chat composer, local target cards, browser/error/cards. | Reduce large radii in dense work surfaces; use smaller radii for rows and compact controls, reserving large radii for dialogs/composer-level surfaces. |
| Borders | Codex uses token borders sparingly and lets list primitives define hover/selection; many controls are borderless ghost buttons until active/hover. | Orchestrator often stacks borders: panel border, toolbar border, list border, selected row border, row separators, preview border, card border. | Remove nested hard frames where a parent already supplies separation. Use token border only at pane edges, major splits, and focused controls. |
| Shadows | Codex right panel has shell-level shadow/elevation, not many inner shadows. | Orchestrator right panel has shell shadow in overlay/full states, and most inner surfaces now avoid shadows, but hover/menu/dialog shadows are still custom per surface. | Centralize popover/dialog shadows and avoid content-level shadows in Workbench/Sidebar rows. |
| Motion | Codex app shell exposes animation progress/animated size and uses tab shimmer/loading states. | Orchestrator has CSS transitions and performance smoke budgets, but no shell-wide animated size or Codex-like tab shimmer/pending states. | Move motion into app-shell primitives so resizing, tab changes, loading, and pending states all share timing/easing. |

### App Header And Main Chrome

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Header ownership | Codex title/header tint and edge states are owned by app shell. | Orchestrator `Titlebar` and CSS own header rendering separately from panel shell. | Header should become another shell slot with shared height, tint, drag region, toolbar buttons, and scroll-edge behavior. |
| Toolbar height | Codex uses shared toolbar classes such as `h-toolbar` and toolbar-sized buttons. | Orchestrator uses `--app-shell-toolbar-height: 34px`; settings topbar is 42px; Browser tab strip is 38px plus a 34px toolbar. | Keep top-level shell height shared; avoid nested browser/file toolbars that visually grow taller than Codex equivalents. |
| Pills/chips | Codex compact pills use `inline-flex h-5 rounded-[7px] px-1.5 text-sm font-medium leading-[22px] tracking-[-0.12px]`. | Orchestrator has count badges at 16-20px with `font-weight: 700` and many pill-like provider/header controls with custom constraints. | Adopt one compact pill primitive with predictable height and typography; lower count badge weight. |
| Tooltip behavior | Codex uses delayed tooltips on icon/action controls and keeps flyouts sized to content. | Orchestrator shared tooltips now delay, but some hover cards/flyouts remain custom and one-off. | Route Workbench, sidebar, settings, and terminal action hints through the same tooltip/flyout primitives. |

### Workbench Panel Shell

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Panel surface | Codex right panel is a shell-owned `aside` with thin border, `shadow-xl`, inner absolute pane, and `data-app-shell-focus-area="right-panel"`. | Orchestrator has `.motion-panel-right`, an `aside`, border-left, and focus attribute, but overlay/full-width behavior is CSS-local. | Keep the simple pane look but move sizing, focus, overlay/full mode, and animation into shared shell state. |
| Width model | Codex stores a right-panel width ratio against main content and clamps at breakpoints. | Orchestrator now persists a ratio compatibility layer but still owns much of it in `ContextSidebar`. | Shell should own ratio width, pixel migration, min main width, narrow overlay, full width, and double-click reset. |
| Panel naming | Codex calls the surface `right-panel`; user-facing language is panel/work surface. | Orchestrator still has `right-sidebar-*` classes and old `ContextSidebar` naming. | Continue using user-facing "Workbench Panel"; gradually retire `right-sidebar` naming from new code. |
| Nested chrome | Codex content tabs live under one panel tab controller. | Orchestrator Browser has its own separate tab strip inside the Workbench tab, and Files/Review have their own toolbars. | Browser tabs, file tabs, review tabs, artifact tabs, and terminal tabs should use the same panel-tab controller rather than nested local tab chrome where possible. |

### Workbench Tab Strip

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Controller API | Codex exposes `openTab`, `updateTab`, `activateTab`, `closeTab`, `closeActiveTab`, `reorderTab`, `moveTabTo`, `receiveMovedTab`, `resetTabState`, `pinTab`, `activeTabReactKey`, and `tabById`. | Orchestrator has a reusable `PanelTabStrip`, but tab state is still built by store arrays and local handlers. | Introduce a real panel-tab controller before adding more Workbench-specific tab behavior. |
| Tab metrics | Codex tabs are toolbar-sized, overflow-aware, label-fading, and close controls appear on hover/focus for closable tabs. | Orchestrator uses 24px tab height, 11px labels, 500/560 weights, 6px radius, 7px x-padding. This is close, but active tabs still read more segmented than Codex. | Keep dimensions but lower active visual weight further; rely on controller state and subtle background. |
| Action slots | Codex supports before-list, after-list, and sticky-after-list slots with measured reserve space. | Orchestrator approximates this with fixed action blocks and gradient fades. | Replace gradient guesswork with measured sticky slot reserve. |
| Drag/reorder | Codex uses drag sensors, sortable context, separator visibility, and layout animation. | Orchestrator supports context-menu reordering and some drag metadata, but not full Codex behavior. | Complete drag reorder with measured hit targets and screenshot/perf coverage. |
| Loading tabs | Codex supports shimmering tabs/labels for pending loads. | Orchestrator has no tab shimmer/pending tab visual. | Add loading/shimmer state to shared tabs for file/browser/artifact/pending provider tabs. |

### Workbench Panel Style-Only Gaps

| Dimension | Codex evidence | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Shell material | Codex right panel is shell-owned and uses `bg-token-main-surface-primary`, `border-token-border`, `shadow-xl`, `h-toolbar-pane`, and an inner `grid-rows-[auto_minmax(0,1fr)]` panel structure. | Orchestrator `.motion-panel-right`, `.right-sidebar-chrome`, `workbench-panel-surface`, and embedded panel roots each set local backgrounds, borders, and overlay/full-width shadows. | Move Workbench material, border, overlay/full mode, and chrome background to one right-panel shell primitive. Panel content should not restate the same surface rules. |
| Toolbar pane | Codex panel chrome uses compact toolbar rows with `h-toolbar-pane`, `gap-px`, `h-7` controls, `rounded-md`, `hover:bg-token-list-hover-background`, and `focus:bg-token-list-hover-background`. | Orchestrator uses `--app-shell-toolbar-height: 34px`, plus separate `.right-sidebar-tabbar`, `.diff-panel-toolbar`, `.files-panel-toolbar`, `.browser-toolbar`, `.browser-find-toolbar`, and terminal toolbar styles. | Create a single `ToolbarPane` / `PanelToolbar` primitive and migrate Workbench, Browser, Review, Files, Terminal, and Settings page headers to it. |
| Tab visual language | Codex panel tabs use toolbar-row typography (`text-sm`, Electron `text-base` where needed), compact row padding, subtle active backgrounds, hover/focus-only close controls, measured sticky action slots, and scroll-to-active behavior. | Orchestrator `PanelTabStrip` is close, but `right-sidebar-*` overrides, count badges at `font-weight: 700`, gradient action fades, active segmented backgrounds, and context-menu-only reordering still make it feel custom. | Keep the shared strip but align it to Codex tab metrics: measured sticky slots, lower badge weight, quieter active state, close non-active tabs on hover/focus, middle-click close, drag reorder, and loading shimmer. |
| Action buttons | Codex toolbar actions mostly use shared `size-7`, `rounded-md`, transparent border, description foreground, and token hover/focus backgrounds. | Orchestrator has shared buttons, but Workbench, Browser, Review, Files, Terminal, and sidebar action areas override sizes/colors with `!important`. | Add documented toolbar icon-button variants and remove panel-specific overrides. |
| Search and address fields | Codex file/search input is `h-token-button-composer`, `rounded-lg`, `border-token-border`, `bg-token-bg-fog`, `text-base leading-[18px]`, with icon and clear button primitives. | Orchestrator has `WorkbenchSearchField`, `.inspector-search-field`, `.browser-address-field`, `.browser-find-search`, and settings search variants with different heights, radii, backgrounds, and font sizes. | Replace these with one tokenized search/address input primitive that supports search, URL, find, and shortcut capture modes. |
| Tree/list rows | Codex workspace/review trees use a virtualized tree with `itemHeight = 28`, 13px text, small icon slots, sticky folders, selected-path reveal, hidden non-match search, and row hover/focus tokens. | Orchestrator Review and Files rows use `SurfaceRow`, visible separators, local directory/file row styling, hard status letters, and non-virtualized maps. | Build one `WorkbenchTree` primitive for Review, Files, file source tabs, artifacts, and any provider-backed trees. Styling parity depends on removing local row chrome. |
| Interior borders | Codex favors a single panel boundary plus toolbar/list boundaries only when they clarify hierarchy. File previews become first-class tabs instead of a permanent hard split. | Orchestrator Files has a permanent list/preview split, Review has a hard list/diff divider, Browser has nested tab/address/status/find/inspector rows, and fallback states often look card-like. | Reduce nested borders, promote previews to tabs, and keep only shell boundary, toolbar boundary, focused inputs, and true split handles. |
| Menu/flyout surfaces | Codex uses translucent dropdown material (`bg-token-dropdown-background/90`), `ring-[0.5px]`, `rounded-xl`, `shadow-lg`/`shadow-xl-spread`, backdrop blur, and scale/translate entrance motion. | Orchestrator menus are compact, but Workbench tab menus, Browser action sections, Review/File action menus, and metadata flyouts are mixed local layouts on flatter surfaces. | Extend the shared Codex-like menu/flyout primitive to Workbench tabs, Browser history/zoom/data rows, Review metadata, file tree context menus, and side-chat actions. |
| Browser chrome | Codex browser work is panel-shell integrated and its webviews are managed offscreen with containment, transfer, and browser/comment mode state. | Orchestrator Browser is a nested browser workbench with its own tab strip, URL toolbar, local target card, status row, find row, inspector tabs, and direct embedded webview lifecycle. | Browser parity requires a hidden webview manager and lighter panel-native browser controls; styling the current nested chrome will only partially help. |
| Motion and focus | Codex shell exposes animated panel size/progress, central focus areas, tab panel focus, reduced-motion handling, and fullscreen cleanup when closing tabs. | Orchestrator has CSS width transitions and focus-area attributes, but focus, overlay/full-width motion, tab activation focus, and resize side effects are still local. | Move right-panel animation/focus into shell state so resizing, dragging, closing, opening, and shortcuts all feel like one system. |

### Review / Changes Interior

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Toolbar row | Codex review toolbar rows use `flex items-center gap-2 px-[var(--padding-row-x)] py-[var(--padding-row-y)]`, `text-sm` truncated labels, toolbar buttons, and compact flyout pills. | Orchestrator `.diff-panel-toolbar` is 36px tall, gap 5px, padding 5px 8px, with search, count badge, preview toggle, and actions squeezed into one row. | Make Review toolbar a Codex-like action bar with consistent toolbar buttons and grouped flyouts instead of several local compact chips. |
| Search field | Codex file search wrapper is `h-token-button-composer`, `rounded-lg`, `border-token-border`, `bg-token-bg-fog`, `text-base leading-[18px]`, search icon `icon-xs ms-2`, input borderless. | Orchestrator `.inspector-search-field` is 26px tall, 9px radius, local control background, 5px gap, 6px padding. | Use one file/search input primitive across Review, Files, Browser find, and settings shortcut search. |
| File rows | Codex review/workspace file tree uses a custom `file-tree-container` with `itemHeight = 28`, `--trees-font-size-override: 13px`, `--trees-item-padding-x-override: 6px`, `--trees-level-gap-override: 0px`, and `--trees-item-row-gap-override: 10px`. | Orchestrator Review rows are 28px, but use `SurfaceRow`/local row CSS, status letters, visible separators, stronger selected outlines, and less capable tree behavior. | Replace Review/Files file lists with one virtualized tree/list primitive that matches Codex row metrics and hides non-match search results. |
| Directory rows | Codex sticky folders come from the file tree model and inherit tree row styling. | Orchestrator `.diff-directory-row` uses local 26px height, 2px left border, control-bg, and 560 weight. | Remove the special heavy directory row styling; use the shared tree's folder row affordance. |
| Diff viewer | Codex `file-diff` supports virtualized hunks, split/unified modes, line numbers, selected lines, annotations/comments, hunk separators, collapsed context, gutter utilities, rich preview, wrapping, whitespace, word diffs, and merge-conflict actions. | Orchestrator has a simpler `DiffLines` renderer with line wrap and preview toggle. | Treat diff parity as a component rewrite, not a toolbar tweak. Need virtualized diff model, hunk controls, split/unified, whitespace, word diff, comments, blame, and load-full-file controls. |
| Review metadata | Codex review toolbar includes PR status, checks, comments, reviewers, flyouts sized around `max-w-[420px]`, `max-h-[280px]`, compact `max-w-[220px]` reviewer flyouts. | Orchestrator Review does not expose PR/check/reviewer metadata. | Add provider-agnostic review metadata slots, with Codex mapping to PR/check/comment data where available. |
| Screenshot finding | Current Orchestrator Review screenshot passes smoke but shows a crowded top toolbar, prominent row selection, plus/minus/status pills, and a hard list-to-diff divider. | Codex reference relies on a calmer tree and richer toolbar/flyout model. | Review should visually calm down while becoming functionally richer. |

### Files / File Viewer Interior

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| File tree | Codex workspace browser uses the same virtualized file tree with sticky folders, context menus, open targets, add-to-chat, copy path, and hidden non-match search mode. | Orchestrator Files has a local list and grouped rows. | Replace local list rendering with the shared file tree/list primitive. |
| File identity | Codex opens files as first-class right-panel tabs with `file:<host>:<path>` identity, preview/pin behavior, and file-source tab state. | Orchestrator previews the selected file inside one Files panel. | Add file preview tabs and pin/preview promotion. Files panel should be a browser, not the only viewing surface. |
| Layout | Codex avoids a heavy permanent split when a file is opened as a tab. | Orchestrator `.files-panel-body` is a hard grid split `minmax(140px, 0.42fr) minmax(0, 1fr)`, or a stacked split at narrow widths, with list border and preview border/header. | Move preview into tabs and reduce hard nested borders in the Files panel. |
| Preview header | Codex file-source tabs use toolbar primitives and richer source controls. | Orchestrator file preview header is 34px, 11px text, 600 meta strip, and local action buttons. | Use the same toolbar/action primitives as Review and file-source tabs. |
| Empty/fallback states | Codex empty/loading file tree states are compact list states and tab-level fallbacks. | Orchestrator fallback states are centered mini-cards or grid states with icon boxes and action buttons. | Make Workbench empty states quieter and row-like; reserve centered empty states for full blank panels. |
| Screenshot finding | Current Files screenshot passes smoke but file names appear heavier/larger, the list and preview are visually separated by hard borders, and toolbar controls crowd the top. | Codex file browsing feels like a compact tree plus first-class file tabs. | Files needs both styling and lifecycle changes. |

### Browser Interior

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Webview lifecycle | Codex `browser-sidebar-manager` keeps hidden webviews alive with `position: fixed`, offscreen/opacity state, `pointerEvents: none`, `contain: layout paint size style`, z-index `2147483647`, transfer between conversation ids, and resync on focus/visibility. | Orchestrator embeds the browser directly in `BrowserPanel`. | Browser smoothness parity requires a persistent hidden-webview manager, not just UI styling. |
| Device presets | Codex has presets: responsive 390x844, 4k 2560x1440, laptop-l 1440x900, laptop 1024x768, Surface Pro 7 912x1368, iPad Air 820x1180, iPad Mini 768x1024, Surface Duo 540x720, iPhone 15 Pro Max 430x932, Pixel 8 412x915, iPhone 15 Pro 393x852, Galaxy S24 Ultra 384x824, iPhone SE 375x667. Bounds clamp to min 240x160 and max 4096x4096 with a 20px stage margin. | Orchestrator has viewport/device controls and local targets but not this exact preset/bounds system. | Adopt Codex-like preset list and clamp logic; make device stage math a tested utility. |
| Browser tabs | Codex browser tabs are side-panel tabs managed by the app shell/browser tab state. | Orchestrator has a nested `.browser-tab-strip` with 38px height, 27px tabs, 12px/640 text, 9px radius, and separate close animation. | Browser nested tabs are visually heavier than Codex. Either promote pages to panel tabs or restyle nested tabs as a lighter toolbar segment. |
| URL toolbar | Codex browser UI follows toolbar/action primitives and browser-use state. | Orchestrator toolbar is 34px with local address field, 9px radius, badge max 76px, 10.5px/650 text. | Normalize URL/search/action controls to the same toolbar input/button primitive used elsewhere. |
| Local server list | Codex tracks local server routes and hidden server routes per conversation. | Orchestrator has local targets table/cards with a visible bordered container. | Make local target rows lighter and integrate lifecycle with browser tab state, hidden routes, and conversation identity. |
| Browser modes | Codex supports browse/comment mode and coachmark state. | Orchestrator has side questions and inspector drawers but no browser comment mode. | Add provider-agnostic browser annotation/comment concept where supported. |
| Screenshot finding | Current Browser screenshot shows a usable panel, but the nested tab strip, URL toolbar, and local servers card make the panel feel heavier than Codex. | Codex browser polish comes mostly from hidden-webview lifecycle and shell integration. | Prioritize lifecycle and shared controls before micro-adjusting local target cards. |

### Chat Sidebar

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Data model | Codex sidebar state persists organize mode, keep-projects-in-recent, projectless chats-first, thread-sort-key, section order, collapsed groups, collapsed standard sections, and collapsed custom sections. | Orchestrator has projects, pinned sessions, recent/created sorting, and project collapse. | Add provider-agnostic sidebar organization primitives: organize mode, standard/custom sections, section order, projectless chats, and collapsed state. |
| Thread identity | Codex models local, remote, and pending-worktree thread keys; hover labels derive chat/project/branch/workspace hints; label color metadata exists. | Orchestrator `SessionItem` models local sessions with project/branch hover info after delayed hover. | Extend identity model beyond local project sessions and add label color/remote/pending worktree metadata. |
| Pinned ordering | Codex merges server/provider pinned ids with local/pending thread keys, preserves pinned order, and excludes pinned ids from unpinned keys. | Orchestrator now preserves local `pinOrder`. | Keep local behavior but prepare adapter-backed pinned state for providers that support it. |
| Row styling | Codex uses shared selectable/list row primitives and quieter tokenized row/header states. | Orchestrator `.surface-row` has transparent border, hover bg, active bg, active border, custom pin slot, right slot, state control, hover card, and several transitions. | Simplify row internals: fewer moving slots, quieter active border, and one shared selectable row primitive. |
| Row metadata | Codex can show automation-run state, unread/loading/in-progress across local/remote/pending tasks, project labels, and branch/workspace hints. | Orchestrator shows running/waiting/error/unread dots/spinners and relative time. | Keep the useful local states but map them to a broader task status primitive. |
| Hover card | Codex hover/action affordances are tied to thread action/menu primitives and tokenized tooltips. | Orchestrator hover card is a fixed 260-320px tooltip-style card showing only chat/project/branch after delay. | Good direction, but it should be a shared tooltip/popover primitive with provider-aware identity. |
| Actions | Codex exposes Rename, Archive, Mark unread, Add/Edit automation, Copy working directory, Copy session ID, Copy deeplink, Copy as Markdown, Open in new window, Fork into local/same worktree/new worktree, and interrupt. | Orchestrator has rename/archive/copy ids/open/reveal-like actions but lacks many workflow actions. | Add missing actions through provider-agnostic command primitives. |

#### Chat Sidebar Style-Only Gaps

| Dimension | Codex evidence | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Left rail material | Codex Electron styles make `.app-shell-left-panel` a shell surface using `color-mix(... editor-background 55%, transparent)` and extend that material under the main surface with a `:after` strip sized to `--radius-2xl`. | Orchestrator `.app-sidebar` is a fixed 264px rail with `var(--panel-bg)`, `blur(22px)`, and local width constraints. | Move left rail material into shell tokens: sidebar background, edge blending, main-surface radius/ring, and opaque/translucent modes should be shared with the app shell instead of local sidebar CSS. |
| Width and spacing tokens | Codex defines `--spacing-token-sidebar: clamp(240px, 300px, min(520px, calc(100vw - 320px)))`, `--padding-row-x: 8px`, and row height from `--height-token-nav-row`. | Orchestrator hardcodes 264px and mixes `px-2`, `px-2.5`, `px-3`, `space-y-1`, `h-7`, and custom margins. | Replace fixed rail and ad hoc section padding with sidebar width/row/panel tokens so spacing scales like Codex. |
| Row primitive | Codex sidebar-adjacent rows use shared list/selectable classes such as `rounded-lg`, `px-row-x`, `py-row-y`, `text-sm`, `hover:bg-token-list-hover-background`, and focus outline tokens. | Orchestrator session rows are `SurfaceRow` plus `.session-row-*` local CSS, active border mixing, fixed pin slot, fixed right slot, and status/action overlays. | Build a `SidebarListRow` primitive: one row shell, one icon/meta slot, one action slot, token hover/active/focus states, no per-row border unless selected/focused needs it. |
| Active/hover state | Codex derives emphasis mostly from token backgrounds and foreground changes; action emphasis stays hidden until hover/focus or menu open. | Orchestrator active sessions still use a visible border and custom surface mixing; project headers and footer rows each define their own active/hover language. | Use a quieter token active state across session, project, nav, footer, and settings-nav rows; active state should not add a strong outline-like border. |
| Section chrome | Codex standard sections, custom sections, and import/status cards use compact `min-h-7`, `rounded-lg`, `border-token-foreground/5`, `bg-token-foreground/[0.01]`, and `p-1`/`p-2.5` wrappers. | Orchestrator has `sidebar-section`, project sections, pinned sections, empty project states, and capability/settings rows with separate local margins and font weights. | Normalize section labels, separators, empty states, and status cards around the same compact section primitive; remove one-off section spacing. |
| Menus and flyouts | Codex dropdown/context/popover surfaces use `bg-token-dropdown-background/90`, `ring-[0.5px] ring-token-border`, `rounded-xl`, `shadow-xl-spread`/`shadow-lg`, `backdrop-blur-sm`, and open animation from translate 2px + scale `.98`. | Orchestrator shared menu rows are compact now, but the surface is a flatter 8px `PopoverSurface` with local shadow/background tokens and no Codex-like translucent ring/scale motion. | Evolve `MenuSurface`/popover styling to match Codex dropdown material and motion, then apply it to sidebar organize/project/chat menus and hover surfaces. |
| Action buttons | Codex button primitive handles ghost/icon/toolbar sizes, `[data-state=open]` background, Electron cursor behavior, and opacity reveal via group hover/focus. | Orchestrator uses shared `IconButton`, but sidebar section actions, project actions, row actions, pin buttons, and footer rows override sizes/colors individually. | Remove sidebar-specific button overrides by adding sidebar action-button variants to the shared button primitive. |
| Pin/status/timestamp choreography | Codex rows tend to reveal actions through opacity and keep status/metadata tied to the row primitive. | Orchestrator currently has a persistent left pin slot plus a right slot that swaps timestamp/status/actions. It is functional, but visually busy and layout-specific. | Decide whether pin belongs in the same action slot as row actions or a slimmer leading icon state; keep timestamp/status/action swaps opacity-only and tokenized. |
| Hover card | Codex tooltips/popovers use shared dropdown/tooltip surfaces with token foreground/background and motion. | Orchestrator uses `.session-hover-card` fixed custom tooltip styling with its own border, width, and row grid. | Rebuild the sidebar hover card on shared tooltip/popover primitives, with only chat name, project, and branch content. |
| Sidebar nav/settings mode | Codex settings/window sidebars use page/window primitives and nav rows with the same row tokens. | Orchestrator's left settings nav is directionally liked, but it lives as a mode swap inside the same custom rail and still uses local row style. | Keep the left settings nav shape, but migrate both chat and settings nav rows onto shared sidebar row tokens so switching modes does not change visual language. |

### Terminal / Bottom Panel

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Shell integration | Codex bottom panel uses the same app-shell tab controller and focus routing as right panel. | Orchestrator Terminal uses `SessionPane` local terminal tabs and `terminal-panel-*` CSS. | Migrate Terminal onto the shared panel-tab controller. |
| Placement | Codex can route terminal panels based on right/bottom panel state. | Orchestrator terminal is bottom-only. | Add terminal-as-panel-tab support where it improves workflow. |
| Header styling | Codex toolbar/header styling is shared. | Orchestrator terminal header is close to Workbench tab tokens but still separate selectors. | Remove Terminal-specific tab/header CSS after shared controller migration. |
| Runtime robustness | Codex terminal has service snapshots, error boundaries/reload UI, keyboard behavior, theme/font integration, and link handling. | Orchestrator has basic xterm lifecycle, clear/hide/new tab, and guarded fit/open paths. | Add terminal error state, service snapshots, copy/paste/new-tab keyboard parity, theme integration, and link routing. |

### Settings

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Page shell | Codex settings are route/page-like and use AppShell left panel where available; standalone window uses `window-fx-sidebar-surface`, `w-token-sidebar`, and a draggable `h-toolbar`. | Orchestrator settings are app-internal with a liked left settings nav, custom `settings-shell`, and 42px topbar. | Keep the left nav, but make settings content page-like and shell-owned. |
| Nav grouping | Codex groups settings into App and Host sections and uses icon rows with `px-row-x`, `py-row-y`, `text-base`, `rounded-lg`, `font-normal`, plus collapse support. | Orchestrator has left nav sections but fewer host-aware groups. | Add host/provider grouping, collapsed nav behavior, and consistent nav row primitive. |
| Settings row | Codex `SettingsRow` default is `flex items-center justify-between gap-4 p-3`; label is `text-sm text-token-text-primary`; description is `text-sm` or `text-xs` for nested; nested rows use `min-h-10 px-4 py-0.5`. | Orchestrator `.settings-row` is a bordered card with `radius-lg`, `padding: 11px 13px`, label 13px/650, description 12px; groups use 156px label column and custom panels. | Codex rows are simpler and less card-like. Lower label weight, remove per-row card borders where inside a surface, and use p-3 row rhythm. |
| Settings surface | Codex `SettingsSurface` wraps related content and allows overflow-hidden tables/lists. | Orchestrator `.settings-panel` is close but combines custom compact settings and card rows. | Build explicit `SettingsPage`, `SettingsSurface`, `SettingsGroup`, `SettingsRow`, `SettingsFieldRow` components and migrate content section by section. |
| Shortcuts | Codex shortcuts are editable: table with `text-sm`, columns, hover-only action icons, capture input `h-token-button-composer w-36 rounded-lg border-token-border bg-token-input-background px-3 text-sm`, conflict detection, reset/clear. | Orchestrator shortcuts are mostly a reference section. | Implement editable shortcuts with capture/conflict/reset UI. |
| Appearance/theme | Codex has richer appearance, font, appshot/browser-use/computer-use/plugin/MCP/worktree pages using shared settings primitives. | Orchestrator has expanded custom theming, but it is not as broad or structured as Codex. | Expand theme/font/chrome controls after settings primitives are in place. |

### Menus, Dialogs, Flyouts, And Empty States

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| Menus/flyouts | Codex flyouts have predictable widths: review check flyouts around `max-w-[420px]`, reviewer compact flyouts `max-w-[220px]`, comment flyouts `w-[420px] max-h-[280px]`, section lists `max-h-[104px]`. | Orchestrator shared menu surfaces now have bounded 8px-radius flyouts, 28px/13px/400 menu rows, scroll max-height, and no hover translation; sidebar, Review, Files, Capabilities, and simple Browser action/context rows assert these basics. Some richer local rows, metadata flyouts, and dialog actions still need migration. | Continue centralizing section labels, separators, metadata flyouts, and dialog action styles on the same primitives. |
| Icon buttons | Codex uses toolbar-sized ghost buttons and hides row action buttons with `opacity-0 group-hover:opacity-100`. | Orchestrator uses shared icon buttons, but local browser/actions/settings/sidebar code often overrides sizes and weights. | Stop overriding icon button metrics per surface except for documented sizes. |
| Dialogs | Codex dialogs use dialog-layout primitives and compact content. | Orchestrator confirm/text-input/rename/generic modal dialogs now share compact dialog surface/content/input/action classes; larger sheet-style editors still use sheet primitives. | Keep dialog smoke coverage on shared classes and migrate any newly added local modals to the shared dialog primitive. |
| Empty states | Codex empty/loading states are compact and surface-specific: file tree empty is list-level, settings loading is row/table-level, browser has native browser-sidebar states. | Orchestrator often uses card-like centered empty states inside panels. | Use compact in-panel empty states unless the whole page is empty. |

### Efficiency / Rendering Implications

| Dimension | Codex reference | Orchestrator current state | Gap / target |
| --- | --- | --- | --- |
| File tree performance | Codex file tree is virtualized, sticky-folder aware, search-aware, and preserves scroll/selection with requestAnimationFrame retries. | Orchestrator lists are simpler and may re-render more panel content. | Shared virtualized file tree is both a visual and performance priority. |
| Diff performance | Codex diff viewer virtualizes hunks/lines and tracks measurements/overscan. | Orchestrator diff rendering is simpler and less scalable. | Large diff parity requires virtualized diff rendering and focused perf smoke coverage. |
| Browser performance | Codex hidden-webview manager preserves webview continuity and isolates offscreen webviews with CSS containment. | Orchestrator direct embed can lose continuity and contributes to switching/resize risk. | Persistent webview manager is required before claiming browser parity. |
| Sidebar rendering | Codex selectors memoize thread key arrays and preserve object identity where possible. | Orchestrator has made local ordering fixes but still has local row/action complexity. | Keep tightening sidebar selectors and add componentized visual/perf tests for sorting, pinning, running state, and hover. |

### Immediate Styling Parity Targets

These are the concrete UI targets before declaring sidebar/workbench parity:

1. Move all Workbench, Terminal, and nested browser/file tab chrome onto one tab/controller primitive.
2. Replace Review and Files local list styling with a shared 28px-row, 13px-text virtualized tree/list primitive.
3. Replace `inspector-search-field`, `files-panel-search`, Browser find/search, and shortcut search with one Codex-like search input primitive.
4. Reduce Workbench interior font weights: row labels normal/500, active tabs 500-560 max, badges/pills medium rather than 700.
5. Remove heavy nested borders from Files/Review/Browser interiors; keep only panel boundaries, toolbar boundaries, and focused inputs.
6. Promote file previews to first-class preview/pinned panel tabs and remove the permanent hard Files split as the primary file-viewing path.
7. Restyle Browser nested tabs or promote pages to panel tabs; current 38px strip and 12px/640 tab labels are visibly heavier than Codex.
8. Rebuild settings rows/pages on `SettingsPage` / `SettingsSurface` / `SettingsGroup` / `SettingsRow` equivalents; keep the left nav, which is already directionally right.
9. Extend the shared Codex-sized flyout/menu primitive from sidebar, Review, Files, Capabilities, and simple Browser action rows to shortcuts, richer Browser/history/zoom rows, Review metadata, file tree sections, and any remaining local action menus.
10. Add screenshot checkpoints for the exact surfaces above before marking any parity item complete.

## Right Workbench Panel Differences

### Shell And Layout

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| `AppShell.Root` extracts left panel, right panel, bottom panel, header, right-panel tabs, bottom-panel tabs, and outlets from one slot system. | `SessionPane` composes primary chat, `ContextSidebar`, and bottom terminal directly. | Orchestrator lacks a real shell slot model. |
| Shell context tracks header widths, left panel width, main content width, shell width, right panel animated width, and layout ticks. | `ContextSidebar` measures `session-main-row` with `ResizeObserver`; `SessionPane` handles terminal separately. | Panel layout knowledge is scattered and harder to stabilize. |
| Right panel uses `data-app-shell-focus-area="right-panel"` as part of central focus state. | Orchestrator sets the attribute, but does not have the full central focus-area event/shortcut model. | Attribute exists without the same behavioral system. |
| Codex right panel width is ratio-based against main content, with default size and storage key semantics. | Orchestrator persists pixel width and clamps against a primary-content minimum. | Resizing feels less adaptive across window sizes. |
| Codex panel animation exposes progress and animated size so dependent layout updates during motion. | Orchestrator uses CSS transitions on width/height and local resize state. | Layout can lag or feel less integrated during motion. |
| Codex handles breakpoints centrally and moves focus/collapses panels when shell width changes. | Orchestrator has `shouldOverlayPanel` local logic in `ContextSidebar`. | Narrow-window behavior is local and easier to regress. |
| Codex full-width mode is a width mode inside shell state. | Orchestrator full-width is absolute overlay style with `right-sidebar-expanded`. | Similar end state, different architecture and more special CSS. |
| Codex right panel is an `aside` with thin border, `shadow-xl`, and inner absolutely positioned pane. | Orchestrator uses `MotionPanel` plus an `aside` flex surface. | Orchestrator is close visually but not structurally identical. |
| Codex resize handle is shared, edge-aware, pointer-scale aware, and supports double-click reset. | Orchestrator `PanelResizeHandle` is simple and surface-specific. | Missing reset, close-below-min, and shared semantics. |

### Tab Controller And Tab Strip

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| `app-shell-tab-controller` exposes `openTab`, `updateTab`, `activateTab`, `closeTab`, `closeActiveTab`, `reorderTab`, `moveTabTo`, `receiveMovedTab`, `resetTabState`, `pinTab`, `activeTabReactKey`, and `tabById`. | `ContextSidebar` builds a `tabs` array from booleans and store state, then local handlers activate/close/move. | Orchestrator lacks a real tab lifecycle abstraction. |
| Right and bottom panels use the same controller shape. | Workbench and Terminal have separate implementations. | Chrome and behavior drift between panels. |
| Codex tabs can be preview tabs and later pinned. | Orchestrator has no preview-tab concept. | File/browser/artifact quick-open cannot feel Codex-like. |
| Codex tabs can have `defaultState`, `tabState`, and `resetTabState`. | Orchestrator stores some browser workbench state but not generic tab state. | Panel tabs cannot independently preserve/reset rich state. |
| Codex tabs support `onBeforeClose`, `onClose`, `onMove`, per-tab context menu items, trailing content, highlighted icons, label-only tabs, and shimmering tabs. | Orchestrator has move left/right/close menu and fixed labels/icons/counts. | Missing many lifecycle and presentation states. |
| Codex can move tabs between right and bottom panels. | Orchestrator terminal tabs are bottom-only; Workbench tabs are right-only. | No cross-panel tab movement. |
| Codex drag-reorders tabs with sortable sensors and layout animation. | Orchestrator reorders only by context menu. | Less fluid and less discoverable. |
| Codex close affordance appears on hover/focus and can close non-active tabs; middle-click closes closable tabs. | `TabButton` renders close only for active tab. | Non-active close behavior differs. |
| Codex tab row has before-list, after-list, and sticky-after-list slots with measured reserve space. | Orchestrator has a fixed tab row plus fixed action area and CSS fade. | Sticky action behavior is approximate. |
| Codex tab overflow has hidden scrollbars, intersection-observer edge fades, and scroll-to-active. | Orchestrator uses overflow-x and a pseudo fade before actions. | Works partially, but lacks robust active-tab visibility and edge detection. |
| Codex activates tab panels and focuses the active `tabpanel`. | Orchestrator activates state but does not centralize tab panel focus. | Keyboard flow is weaker. |
| Codex exits fullscreen if a closed tab owns fullscreen content. | Orchestrator has no equivalent. | Closing media/browser/file tabs can be less robust. |
| Codex logs side panel open/close/viewed telemetry. | Orchestrator has smoke/perf hooks but no equivalent product telemetry. | Harder to track UX quality in real use. |

### Workbench Header/Chrome

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex panel chrome is highly tokenized with toolbar-size buttons, subtle active backgrounds, and shared app-shell styling. | Orchestrator has improved but still uses `right-sidebar-*` CSS and local token overrides. | Styling still reads as custom patchwork. |
| Codex action buttons are mostly icon-only with delayed tooltips and stable sizes. | Orchestrator uses shared `IconButton`, but panel-specific CSS sometimes overrides size and active states. | Close but still inconsistent across Workbench, Terminal, Browser, and Settings. |
| Codex keeps tab labels visible and adds local text fades for overflow. | Orchestrator keeps labels visible now, but truncation/fade behavior is simpler. | Long tab labels are less polished. |
| Codex action slots reserve space so tabs do not disappear under controls. | Orchestrator's action block uses a gradient overlay. | It can still feel cramped with many tabs. |

## Right Panel Content Differences

### Review / Changes

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Review model supports `unstaged`, `staged`, `branch`, `commit`, and `last-turn` sources. | Orchestrator Review shows current changed files for a session/workdir. | Missing review source modes. |
| Codex has `diff-filter` storage and staged/unstaged counts from index info. | Orchestrator preserves staged/unstaged data in backend but removed inline controls from Review to match placement. | Need proper Git surface and review filters, not toolbar clutter. |
| Codex can review against base branch or commit. | Orchestrator has no base branch/commit picker. | Missing core review workflows. |
| Codex batches `review-diff` requests, aborts stale path requests, retries, and handles large diffs. | Orchestrator calls file diff APIs per selected file without the same request model. | Less scalable on large changes. |
| Codex has live git refresh/watch paths for index/head/working-tree changes. | Orchestrator refreshes manually and through session events. | Less reactive and robust. |
| Codex Review toolbar has Review options, Refresh, word wrap, expand/collapse all diffs, split/unified diff mode, and Copy git apply command. | Orchestrator now has Refresh, line wrap, preview toggle, Copy git apply command, Open, Reveal, Copy path. | Still missing expand/collapse, split/unified, whitespace, word diff, load-full-files, rich-preview parity. |
| Codex supports hide/show whitespace and word diffs. | Orchestrator has no whitespace/word-diff controls. | Diff readability gap. |
| Codex supports rich preview toggles and load-full-files. | Orchestrator has explicit preview/diff toggle but no load-full-files model. | Partial parity only. |
| Codex has changed-file side pane with search and active file path sync. | Orchestrator has grouped file rows and filter search. | Good start, but not as integrated with global find/navigation. |
| Codex supports comments and PR code review comments in diffs. | Orchestrator has no line comments or PR comment surfaces. | Large missing review capability. |
| Codex file source tabs support line selection, gutter utilities, comments, and git blame. | Orchestrator Files/Review previews do not support blame, line selection, or comments. | File viewer is much thinner. |
| Codex can open workspace file tabs in the right panel from review/file tree. | Orchestrator Files is one panel, not many file tabs. | Missing Codex-style file tab lifecycle. |
| Codex has open-in-editor target preference. | Orchestrator has open/reveal only. | Missing preferred editor target model. |

### Files / File Viewer

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex file viewer is a first-class right-panel tab type with `file:<host>:<path>` identity. | Orchestrator has one `FilesPanel` and previews selected entry inside it. | Missing per-file tabs and preview tabs. |
| Codex file viewer supports Copy path, Open in editor, rich view, word wrap, git blame, and artifact preview controls. | Orchestrator supports basic open/reveal/copy and previews common formats. | Missing advanced file-viewer controls. |
| Codex workspace tree/search is server-backed and host-aware. | Orchestrator recently moved workspace search main-process side, but panel UI is still simpler. | Backend improved; UI still behind. |
| Codex previews image, markdown, PDF, notebooks, docs, artifacts, and source through specialized panels. | Orchestrator previews many formats but mostly inside Files/Review panels. | Similar coverage, less tab/lifecycle polish. |

### Browser

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex Browser uses a `browser-sidebar-manager` with hidden persistent webviews. | Orchestrator browser lives directly inside `BrowserPanel`. | Switching/transfer/persistence likely less smooth. |
| Codex can transfer a webview between conversation ids. | Orchestrator has no webview transfer model. | Forks/side chats/browser continuity are weaker. |
| Codex tracks browser-use active state, viewport size, capture surface size, and cursor state. | Orchestrator has browser workbench state, device mode, policies, inspector, and tabs, but not the full browser-use state bridge. | Browser automation UI is less native. |
| Codex has responsive device presets with robust size clamping and visual/webview bounds. | Orchestrator has viewport controls, but not the same preset/bounds system. | Device testing feels less mature. |
| Codex tracks local server routes and hidden server routes per conversation. | Orchestrator has local targets but less integrated route lifecycle. | Local app testing surface differs. |
| Codex has browser comment mode and coachmark state. | Orchestrator has side questions, not browser comments. | Missing browser review/comment workflow. |
| Codex keeps offscreen webviews alive with opacity/pointer-events/layout containment tricks. | Orchestrator does not use the same hidden webview lifecycle. | Performance and visual continuity gap. |

### Artifacts, MCP Apps, Automations, PRs

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex right panel has artifact tabs, file tabs, MCP app tabs, automation tabs, pull-request tabs, and browser/review tabs under one controller. | Orchestrator has Browser, Files, Review, Plan, Agents, Extensions, and side chats. | Orchestrator lacks the general "tabbed work surface" model. |
| Codex can open artifact side-panel tabs from content. | Orchestrator previews files and attachments but has no equivalent artifact tab lifecycle. | Missing artifact workspace. |
| Codex has pending request item panels. | Orchestrator shows permissions in transcript/sidebar/pet paths. | Different and less panel-native. |
| Codex has MCP/app/plugin/skill settings and panel integration. | Orchestrator has Capabilities/Extensions but not Codex-level app-panel integration. | Capability UI is not yet as useful or integrated. |

### Plan, Agents, Side Chats

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex side chats/forks are conversation-level concepts. | Orchestrator side chats/questions are Orchestrator-owned side panels and side calls. | Missing native fork/lineage semantics. |
| Codex collapses agent activity in transcript and exposes structured state in panels. | Orchestrator has `RunningAgentsStrip` and `EventInspectorPanel`, but transcript/panel split is still custom. | Needs activity collapse and shared agent/task model. |
| Codex app shell routes panel shortcuts through active focus area. | Orchestrator has command palette/shortcuts but not a central shell focus router. | Keyboard ergonomics gap. |

## Terminal / Bottom Panel Differences

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex terminal tabs use the same app-shell tab controller as right panel. | Orchestrator terminal tabs are implemented in `SessionPane`. | Bottom and right panels drift. |
| Codex can route terminal panels to bottom or right based on state and available panel. | Orchestrator terminal is bottom-only. | Missing flexible terminal placement. |
| Codex supports new terminal sessions per conversation through terminal service snapshots. | Orchestrator creates terminal ids from session/tab id and stores simple tabs. | Less robust lifecycle and persistence. |
| Codex terminal has an error boundary with reload UI. | Orchestrator has guarded xterm fit/open paths but no equivalent terminal error state. | Crash recovery is weaker. |
| Codex terminal handles copy/paste/new-tab keyboard behavior across platforms. | Orchestrator has basic terminal UI and clear/hide actions. | Keyboard behavior gap. |
| Codex terminal uses theme/font settings directly from app settings and xterm tokens. | Orchestrator uses xterm but theme integration is thinner. | Visual parity gap. |
| Codex terminal web links open via app browser/open-in-browser message. | Orchestrator terminal link behavior is not equivalent. | Integration gap. |

## Chat Sidebar Differences

### Sidebar Information Architecture

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex has persisted organize mode: project, connection, recent/all chats. | Orchestrator has project, recent projects, chronological. | Similar but not equivalent. |
| Codex has persisted `thread-sort-key` for updated/created. | Orchestrator has local `sortMode` updated/created. | Similar, but not tied into remote/cloud/worktree task model. |
| Codex has collapsed sections, collapsed groups, custom sections, and section order. | Orchestrator has project collapse and pinned/projects sections only. | Missing custom organization primitives. |
| Codex supports pinned section, chats section, threads section, custom sections. | Orchestrator supports pinned chats and projects/recent. | Less flexible organization. |
| Codex supports custom sidebar sections with emoji/name/threadIds and drag membership. | Orchestrator has no custom sections. | Missing major organization feature. |
| Codex groups local, cloud, remote connection, projectless, and pending-worktree conversations. | Orchestrator groups local sessions by user-added projects. | Missing remote/cloud/connection/worktree grouping. |
| Codex resolves project labels from workspace roots, git origins, remote projects, and project assignments. | Orchestrator projects are explicit local roots. | Less automatic and less provider aware. |
| Codex handles Codex worktrees specially when grouping under projects. | Orchestrator has worktree flags but sidebar grouping is simpler. | Worktree sidebar parity missing. |

### Pinned And Ordering Behavior

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex pinned thread ids come from `list-pinned-threads` and are merged with local/pending thread keys. | Orchestrator stores pinned sessions locally with `pinOrder`. | Works locally but not server/provider backed. |
| Codex preserves pinned order while excluding pinned ids from unpinned keys. | Orchestrator now preserves pin order locally. | Near parity for local sessions only. |
| Codex project/group ordering is persisted through project order and connection group order. | Orchestrator can pin projects and sort recent projects. | Missing general persisted group order. |
| Codex supports drag/drop order for custom sections and project/thread membership. | Orchestrator uses no drag/drop ordering. | Interaction gap. |

### Thread Rows And Hover Identity

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex thread keys model local, remote, pending-worktree identities. | Orchestrator `SessionItem` models one local `Session`. | Less flexible identity layer. |
| Codex hover identity derives chat/project label and branch/workspace root hints. | Orchestrator hover card shows chat name, project, branch after delayed hover. | Now close for local identity, but less provider aware. |
| Codex row metadata includes automation-run state and display name. | Orchestrator has no automation-run sidebar identity yet. | Missing automation integration. |
| Codex row state detects loading/unread/in-progress across local, remote, and pending tasks. | Orchestrator has running/waiting/error/unread dots and times. | Useful local state, but not equivalent across provider/task types. |
| Codex supports label color metadata. | Orchestrator does not expose label colors. | Missing visual metadata. |
| Codex projectless chats can be sorted/chats-first. | Orchestrator every session belongs to a project. | Projectless UX gap. |

### Thread Actions

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex thread actions include Rename chat and Archive chat. | Orchestrator has Rename and Archive. | Partial parity. |
| Codex can Mark as unread. | Orchestrator does not expose mark unread. | Missing action. |
| Codex can Add/Edit automation from thread actions. | Orchestrator does not expose thread automation actions. | Missing action. |
| Codex can Copy working directory, Copy session ID, Copy deeplink, Copy as Markdown. | Orchestrator copies folder/project/repo/session/provider IDs and branch, but not deeplink or conversation markdown. | Missing sharing/export actions. |
| Codex can Open in new window. | Orchestrator has window reopen issues and no multi-window thread action. | Missing window model. |
| Codex can Fork into local, same worktree, or new worktree. | Orchestrator has no first-class thread fork actions. | Major missing workflow. |
| Codex can interrupt in-progress local thread from actions. | Orchestrator can stop via composer/session controls but not the same row action set. | Action placement gap. |

### Sidebar Visual Chrome

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex uses shared selectable/list row primitives and tokenized sidebar signals. | Orchestrator uses `SurfaceRow`, local sidebar CSS, fixed pin/right slots, and custom hover cards. | Visual primitives differ; add a shared `SidebarListRow` and migrate session/project/nav/footer rows to it. |
| Codex row/header styling is generally quieter and more tokenized. | Orchestrator sidebar still has stronger active outlines, larger empty spaces, fixed width, and custom section controls. | User-visible messiness remains; shell material, row tokens, and section tokens need a styling pass before more sidebar features. |
| Codex hover/action affordances are tied to shared thread action/menu primitives. | Orchestrator has local pin slot, time/status/actions slot, portal hover card, and sidebar-specific icon button overrides. | More moving parts per row; consolidate action reveal and status metadata into a single sidebar-row primitive. |
| Codex menus/popovers use translucent dropdown material, 0.5px rings, rounded-xl surfaces, and scale/translate open motion. | Orchestrator menu rows are compact, but the surface is flatter and less Codex-like. | Menu/flyout surface polish is still a left-sidebar styling gap, not just a functionality gap. |
| Codex settings/sidebar routing is part of app navigation. | Orchestrator swaps sidebar into settings nav inside the same left rail. | Good direction, but both modes should share the same row/material tokens and eventually be shell-owned. |

## Settings And Window/Modal Differences

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex settings use `SettingsPage`, `SettingsContentLayout`, `SettingsSurface`, `SettingsGroup`, and `SettingsRow`. | Orchestrator has one large `SettingsModal.tsx` with many custom sections. | Settings are still cluttered by architecture. |
| Codex settings pages are route/page-like and host-aware. | Orchestrator settings are modal-like with left nav. | The left nav is liked, but content structure is not Codex-like. |
| Codex appearance settings include deeper theme/font/chrome controls through shared primitives. | Orchestrator has expanded theming, but it is still custom and less extensive. | Theming parity incomplete. |
| Codex shortcut settings support editable keybinding capture/conflict/reset behavior. | Orchestrator shortcuts are mostly a reference/settings section. | Missing editable shortcut system. |
| Codex plugin/MCP/browser/worktree settings are mature pages. | Orchestrator has Capabilities and provider settings, but fewer native install/config flows. | Capability/settings parity incomplete. |
| Codex dialogs use compact dialog/layout primitives. | Orchestrator dialogs have improved backgrounds but remain custom per dialog. | Dialog polish remains uneven. |

## Window And App Chrome Differences

| Codex | Orchestrator | Gap |
| --- | --- | --- |
| Codex has route-backed thread identity and can open threads/hotkey threads/windows consistently. | Orchestrator still mostly uses `activeSessionId` in renderer state. | Window reopen and multi-window behavior remain weaker. |
| Codex shell dispatches shortcut-state changes based on active focus area and open panels. | Orchestrator shortcuts are not fully panel-focus aware. | Cross-window/panel keyboard parity missing. |
| Codex title/header edge-scroll tint is shell-managed. | Orchestrator title/header styling is custom in `Titlebar` and CSS. | Header/chrome polish differs. |
| Codex browser webviews and panels handle visibility/focus lifecycle carefully. | Orchestrator has had crashes/glitches around terminal/sidebar/window state. | Needs shell lifecycle hardening. |

## What To Build Next

This should be tackled as foundation first, then visual polish. Small CSS patches will not close the gap.

1. Build a shared Orchestrator app shell.
   - Own Chat Sidebar, Workbench Panel, Terminal Panel, focus areas, measured widths, animated sizes, resize handles, and panel keyboard routing.
   - Migrate `ContextSidebar` and Terminal Panel to it.

2. Build a reusable panel tab controller.
   - Match Codex concepts: open/update/activate/close/closeActive/reorder/move/reset, tab state, preview tabs, pinning, trailing content, context menu items.
   - Use it for Workbench and Terminal.

3. Rebuild Workbench chrome on the shared controller.
   - Add drag reorder, close non-active tab, middle-click close, sticky action slots, overflow fades, scroll-to-active, and true `tabpanel` focus.
   - Remove remaining `right-sidebar-*` naming from user-facing code and eventually from CSS.

4. Upgrade Review into a Codex-like review workspace.
   - Add review source modes: unstaged, staged, branch, commit, last turn where provider supports them.
   - Add branch/base/commit controls, split/unified diff, expand/collapse, whitespace, word diffs, load-full-files, richer summary, and file-source tabs.
   - Keep stage/unstage/commit in a proper Git surface, not inline clutter.

5. Upgrade Files into file tabs.
   - Open files as preview/pinned right-panel tabs.
   - Add git blame, line selection, copy path, open target preference, rich/source toggles, and shared search.

6. Rework Browser around a persistent webview manager.
   - Preserve webviews across tab switches and conversation/fork movement.
   - Add Codex-like device presets, bounds scaling, browser-use cursor/state bridge, local server route lifecycle, and comment mode where useful.

7. Rebuild the Chat Sidebar data model.
   - Add local/remote/cloud/projectless/pending-worktree identities, connection grouping, custom sections, section order, collapsed sections, label colors, and automation row state.
   - Keep local project behavior but do not make it the only model.

8. Expand thread actions.
   - Add mark unread, copy deeplink, copy as Markdown, open in new window, automation actions, fork actions, worktree actions, and interrupt placement where appropriate.

9. Rebuild settings content on shared primitives.
   - Keep the left settings nav, but migrate content to `SettingsPage`/`SettingsSurface`/`SettingsGroup`/`SettingsRow` equivalents.
   - Add editable shortcuts and deeper theme/font/chrome controls.

10. Add parity verification.
   - Screenshot checkpoints for Chat Sidebar, Workbench Panel, Review, Files, Browser, Terminal, Settings.
   - Smoke tests for tab overflow, close-active-tab, drag reorder, resize reset, focus routing, file tab open/close, browser persistence, sidebar custom sections, and settings layout.

## Implementation Slices

Recommended order:

1. Shell/tab foundation only.
2. Workbench chrome migration.
3. Terminal migration to shared bottom/right panel controller.
4. Review source modes and Codex toolbar parity.
5. File tabs and file viewer parity.
6. Browser lifecycle parity.
7. Chat Sidebar model and visual rebuild.
8. Settings primitive migration.
9. Thread actions, worktrees, automations, and multi-window parity.

Do not start with individual sidebar colors, shadows, or row padding unless a screenshot test proves a small visual mismatch after the shared primitives are in place.
