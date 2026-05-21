# Codex Side Panel UI Parity Audit

Date: 2026-05-21

This is a bundle-backed comparison of the locally installed Codex app side-panel UI against Orchestrator. The goal is to make the Orchestrator Chat Sidebar, Workbench Panel, Terminal Panel, settings windows, and related panel content feel as clean, efficient, and robust as Codex before adding bespoke Orchestrator behavior.

Important framing: Codex is the reference for UI maturity and interaction quality, not a provider-specific product target. Any shared behavior should become provider-agnostic Orchestrator shell infrastructure first, with Codex, Claude, Cursor, Copilot, and future providers mapped through adapters.

## Evidence Map

Codex bundle inspected from:

- `/Applications/Codex.app/Contents/Resources/app.asar`
- Extracted audit chunks under `/private/tmp/codex-side-panel-audit`

Primary Codex reference chunks:

- Shell and panels: `app-shell-JLpboL12.js`, `app-shell-BJK30dyj.css`, `app-shell-state-HP0T5lEX.js`, `app-shell-panel-animation-C6SMnz6V.js`
- Tab lifecycle: `app-shell-tab-controller-B2eCi4Le.js`, `thread-side-panel-tabs-D3IwKAR4.js`, `thread-side-panel-tabs-DydIzOtr.js`, `tabs-BgnCzZaP.js`
- Review/files: `review-navigation-model-BQVAIXWq.js`, `review-header-toolbar-B_kdqvHA.js`, `review-file-tree-side-pane-qCgJ0jE8.js`, `review-file-source-tab-_AZBZ4OY.js`, `file-tree-search-input-Cg1SVtq4.js`
- Browser: `browser-sidebar-manager-ivre5jEI.js`, `browser-sidebar-state-BFSGuaA8.js`, `browser-sidebar-open-source-BsfzziCZ.js`, `thread-side-panel-browser-tab-state-PqkmuSww.js`
- Terminal/bottom panel: `thread-page-bottom-panel-state-D1Lz0U4Y.js`, `thread-page-bottom-panel-state-Dxfgdicg.js`, `thread-page-bottom-panel-state-kHJ-D0s7.css`, `terminal-CNbIwMET.js`
- Left sidebar: `sidebar-signals-DI3M13c-.js`, `sidebar-thread-list-signals-FpAb9VJn.js`, `sidebar-project-groups-DUHIVRJe.js`, `sidebar-project-group-signals-B2IlZT8R.js`, `thread-actions-C8deI8Bf.js`
- Settings: `settings-content-layout-Bnulb0lM.js`, `settings-page-Cs2EUu3v.js`, `settings-row-DYYQqFuu.js`, `settings-group-DNhpghsa.js`, `settings-surface-YwAy0P94.js`, `appearance-settings-C6oiotxg.js`, `keyboard-shortcuts-settings-RVscBDKb.js`

Orchestrator files compared:

- Workbench: `src/renderer/src/components/Session/ContextSidebar.tsx`
- Terminal: `src/renderer/src/components/Session/SessionPane.tsx`, `src/renderer/src/components/Session/TerminalView.tsx`
- Workbench tabs/content: `DiffPanel.tsx`, `FilesPanel.tsx`, `BrowserPanel.tsx`, `PlanPanel.tsx`, `EventInspectorPanel.tsx`, `ExtensionsPanel.tsx`, `SideQuestionPanel.tsx`
- Chat Sidebar: `src/renderer/src/components/Sidebar/Sidebar.tsx`, `ProjectSection.tsx`, `SessionItem.tsx`, `SessionActionsMenu.tsx`
- Shared UI/CSS: `src/renderer/src/components/shared/designSystem.tsx`, `src/renderer/src/index.css`
- Settings: `src/renderer/src/components/SettingsModal.tsx`

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
| Codex uses shared selectable/list row primitives and tokenized sidebar signals. | Orchestrator uses `SurfaceRow`, local sidebar CSS, and custom hover cards. | Visual primitives differ. |
| Codex row/header styling is generally quieter and more tokenized. | Orchestrator sidebar still has stronger active outlines, larger empty spaces, and custom section controls. | User-visible messiness remains. |
| Codex hover/action affordances are tied to thread action/menu primitives. | Orchestrator has local pin slot, time/status/actions slot, and portal hover card. | More moving parts per row. |
| Codex settings/sidebar routing is part of app navigation. | Orchestrator swaps sidebar into settings nav inside the same left rail. | Good direction, but structure differs from Codex settings pages. |

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
