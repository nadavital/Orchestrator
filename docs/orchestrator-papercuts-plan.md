# Orchestrator Papercuts Plan

Date: 2026-05-20

This is the active checklist for the current sidebar, notification, modal, archive, tooltip, and typing-latency cleanup pass. Keep this file current as implementation moves, add any newly reported papercuts here, and commit completed slices locally. Remote push is intentionally out of scope while the user is on corporate VPN.

Status key: `Todo`, `Investigating`, `Verified`, `In progress`, `Complete`, `Blocked`.

## Working Rules

- Verify every user report against the current implementation or running UI before calling it fixed.
- Keep changes in small local commits with focused verification.
- Update this file when findings change or a new papercut is added.
- Compare Codex behavior directly from the local Codex app bundle when a report asks for Codex parity.
- Treat Codex as the richest reference implementation, not as a provider-specific destination. When a behavior is useful across providers, build the Orchestrator primitive provider-agnostically first, then map Codex, Claude, Cursor, Copilot, and future providers through adapters.
- Preserve `bootstrap.js` as untracked local state unless the user explicitly says otherwise.

## Provider-Agnostic Parity Rule

Codex parity means matching the maturity of the Codex app where it provides the strongest local reference for reliability, UI shape, and runtime semantics. It does not mean hardcoding Codex-only architecture unless the feature is genuinely Codex-only.

Use this split when implementing the backlog:

- **Provider-agnostic primitives**: session identity, route/deeplink/open-window behavior, worktree/fork lifecycle, scroll and virtualization, composer drafts/attachments, command registry, search/find, notifications, file references, review UX, settings primitives, runtime process robustness, and automation scheduling.
- **Provider adapters**: Codex app-server, Claude CLI/JSONL, Cursor/Copilot MCP/config surfaces, and future provider runtimes should implement the same product contracts through provider-specific APIs.
- **Provider-specific surfaces**: Codex apps/connectors, Codex-native plugin install methods, app-server heartbeat details, or provider-specific permission modes can stay behind adapters, but the UI should expose the shared concept whenever another provider can support it.

## Surface Names

- **Chat Sidebar**: the left navigation rail with projects, pinned chats, recents, and Settings entry.
- **Workbench Panel**: the right-side contextual panel with Changes, Files, Browser, Plan, Agents, Extensions, and side-chat tabs. Legacy code may still call this `ContextSidebar` or `right-sidebar`.
- **Terminal Panel**: the bottom shell panel and its terminal tabs.

## Codex Workbench Panel Comparison

Codex reference came from `/Applications/Codex.app/Contents/Resources/app.asar`, especially `webview/assets/app-shell-CcsLZiAu.js` and `webview/assets/app-shell-BJK30dyj.css`.

Parity rule: do not add broad bespoke Orchestrator workbench behavior until the shared shell, interaction, performance, and robustness gaps below are either closed or intentionally accepted. If a new Orchestrator-specific idea overlaps a Codex primitive, first migrate or adapt the Codex-shaped primitive.

| Area | Codex behavior | Orchestrator gap | Action |
| --- | --- | --- | --- |
| Product naming | Focus area is `right-panel`; user-facing controls say "panel". | The product conversation used "sidebar" for both sides, and code/UI mixed `ContextSidebar`, `right-sidebar`, and panel labels. | Standardize user-facing language to Workbench Panel while leaving legacy class names only where changing them would be churn. |
| Shell architecture | Right, left, and bottom panels share app-shell state, sizing, focus areas, animation, and tab primitives. | Orchestrator has separate hand-rolled CSS/React paths for the Workbench Panel, Terminal Panel, Chat Sidebar, and settings. | Keep migrating toward shared shell primitives as polish continues. |
| Panel surface | Codex right panel is a plain raised pane: thin left border, subtle shadow, no extra card framing. | Orchestrator was close, but right-panel naming and chrome still felt custom. | Preserve the simple pane surface and make header/action styling quieter. |
| Tab strip | Codex shows labeled tabs, supports drag reorder/context menus, uses overflow scrolling, edge fades, and sticky action slots. | Orchestrator collapsed inactive Workbench tabs to icons, making the panel less readable. | Keep labels visible on inactive Workbench tabs and rely on horizontal overflow/compact max widths. |
| Tab weight | Codex uses small text, restrained active backgrounds, and hover close affordances. | Orchestrator active tabs were visually heavier and more segmented. | Lower Workbench tab font/background weight and keep icon actions transparent until hover/focus/active. |
| Resize/width | Codex stores a ratio against main content width, clamps below usable sizes, and switches focus/full-width state at smaller breakpoints. | Orchestrator uses pixel width and an overlay fallback; the focused smoke had an invalid overlay threshold. | Keep current pixel model for now, but verify docked, expanded, and true narrow-overlay behavior. |
| Remaining gap | Codex tab close affordance appears as an overlay and is available beyond the active tab. | Orchestrator `TabButton` only renders close on the active tab. | Backlog unless it blocks UX; changing shared tab semantics needs a broader pass. |

## Codex Parity Matrix

This matrix is the higher-level parity ledger. The goal is not to clone Codex blindly, but to reach the same level of usefulness, efficiency, speed, and robustness before layering on Orchestrator-specific product ideas.

| Dimension | Codex baseline | Orchestrator current state | Required parity work | Status |
| --- | --- | --- | --- | --- |
| Shared shell model | `AppShell.Root`, `LeftPanel`, `RightPanel`, `BottomPanel`, header slots, focus areas, layout ticks, and panel animation are shared primitives. | Shell behavior is split across `SessionPane`, `ContextSidebar`, `TerminalPanel`, `Sidebar`, and `SettingsModal`. | Extract a shared Orchestrator shell layer for panel sizing, focus areas, resize handles, tab headers, and action slots. | `Todo` |
| Workbench tabs | Tabs are controller-backed, labeled, draggable, overflow-scrollable, fade at edges, and have sticky before/after action slots. | Labels/context/reorder exist, but close affordances, action slots, and overflow behavior are still simpler. | Move Workbench tabs onto a reusable tab controller with Codex-like close, overflow, and sticky action behavior. | `Todo` |
| Panel sizing | Right panel width is ratio-based against main content and reacts cleanly to breakpoints/full width. | Pixel width plus overlay fallback works but can feel less smooth and less robust across window sizes. | Replace or augment pixel width with ratio persistence and breakpoint-aware layout. | `Todo` |
| Workbench usefulness | Codex right panel can host browser/artifacts/contextual panels with polished tab lifecycle and keyboard shortcuts. | Orchestrator has Browser, Files, Review, Plan, Agents, Extensions, and side chat, but panel lifecycles are less cohesive. | Audit each Workbench tab for Codex-level lifecycle, empty states, toolbar density, keyboard access, and close/reopen behavior. | `Todo` |
| Performance | Codex shell keeps resizing, tab switching, scroll, and composer interaction responsive during live work. | Several papercuts were already fixed, but no systematic performance budget exists for Workbench resize/tab switching/typing while running. | Add smoke/perf checks for tab switching, resize, composer latency during streaming, and long-thread rendering. | `Todo` |
| Robustness | Codex shell centralizes focus, window size, close-tab shortcuts, and active focus area state. | Orchestrator has focused fixes, but many shell behaviors remain one-off and easier to regress. | Centralize focus-area state and close-active-tab/keyboard handling across Workbench and Terminal. | `Todo` |
| Styling system | Codex uses tokenized toolbar heights, row padding, tab radii, shadows, surfaces, and settings primitives. | Recent polish aligned individual surfaces, but token use is still partial. | Consolidate app chrome tokens and remove surface-specific styling drift. | `Todo` |
| Verification | Codex behavior is mature enough to trust through repeated interaction; parity claims should be screenshot and smoke backed. | Existing smoke tests cover surfaces, but not all cross-panel interactions or perceived speed. | Add parity smoke suites and screenshot checkpoints for Workbench, Terminal, Settings, Chat Sidebar, and cross-panel flows. | `Todo` |

## Codex Bundle Deep Dive Notes

### 2026-05-20: Shell, Panel, And Layout Mechanics

Reference chunks:

- `webview/assets/app-shell-CcsLZiAu.js`
- `webview/assets/app-shell-panel-animation-BXrIvkvo.js`
- `webview/assets/create-resize-observer-CTl6Pw5t.js`

Findings:

- Codex treats the app shell as a slot system, not separate panels. `AppShell.Root` extracts `LeftPanel`, `RightPanel`, `BottomPanel`, `Header`, `HeaderAction`, `RightPanelOutlet`, `RightPanelTabs`, and bottom-panel equivalents from children, then lays them out through one shell context.
- The shell context tracks `headerLeftWidth`, `headerRightWidth`, `leftPanelWidth`, `leftPanelAnimatedWidth`, `mainContentWidth`, `shellWidth`, `rightPanelAnimatedWidth`, and a `rightPanelLayoutTick`. Orchestrator currently recreates pieces of this in `SessionPane`, `ContextSidebar`, `TerminalView`, and CSS.
- Right panel sizing is ratio-based. Codex derives `rightPanelWidthRatio` from a `defaultWidth`, `storageKey`, and current `mainContentWidth`; full-width mode uses a different width mode instead of treating max width as a larger pixel clamp.
- Right panel resize uses a shared resize handle with edge semantics, pointer scaling, double-click reset to default size, and a close behavior when the dragged width falls below the minimum. Orchestrator resize handles are currently per-surface and do not share reset/close semantics.
- Codex right panel is an animated `aside` with `data-app-shell-focus-area="right-panel"`, a thin left border, `shadow-xl`, and an inner absolutely positioned pane. The outer shell owns animation/width; panel contents stay overflow-hidden and stable.
- Codex updates layout state during panel animation through `progress`/`animatedSize`, so dependent layout can respond while the panel animates. Orchestrator mostly reacts after width/state changes and relies on local `ResizeObserver` patches.
- Codex has explicit breakpoint behavior around shell width. At narrower widths it moves focus back to main, disables full-width/right-panel states when necessary, and collapses left panel where appropriate. Orchestrator has local overlay logic in `ContextSidebar` but not one central breakpoint policy.

Migration implications:

- First extract an Orchestrator `AppShell` layer that owns focus areas, measured shell widths, panel resize handles, toolbar heights, and animated sizes.
- Move Workbench and Terminal into this shell before adding new Workbench-only features.
- Treat ratio-based Workbench width as a shell concern, with existing pixel width migrated through a compatibility step.
- Add double-click reset and below-min close semantics to shared resize handles once both panels use them.

### 2026-05-20: Tabs, Focus, And Shortcut Lifecycle

Reference chunks:

- `webview/assets/app-shell-CcsLZiAu.js`
- `webview/assets/thread-side-panel-browser-tab-state-C5u0Yb1s.js`
- `webview/assets/command-keybindings-CahU8007.js`
- `webview/assets/tabs-Dhgr0Bym.js`

Findings:

- Codex right and bottom panels use the same tab-list renderer contract: controller-provided `tabs$`, `displayedTab$`, `activeTabReactKey$`, `activateTab`, `closeTab`, `reorderTab`, `clearClosingTab`, and `closeActiveTab`.
- The Codex app-shell tab row supports before-list content, normal after-list content, and sticky after-list content. Sticky actions are measured with `ResizeObserver` so the scroll area reserves enough end padding.
- Tab overflow is intentional: the strip is horizontally scrollable, hides scrollbars, has left/right edge fades driven by `IntersectionObserver`, and preserves tab labels rather than collapsing to icons.
- Individual Codex tabs measure label overflow and add a local text fade. Close is an overlay affordance that appears on hover/focus and can be used on non-active tabs; middle-click also closes closable tabs.
- Codex reorder uses drag sensors with a small activation distance, sortable context data, separator visibility around the active tab, and layout animation for moved tabs. Orchestrator has manual context-menu move but no drag reorder.
- Codex exposes active shell state to global shortcuts by dispatching `app-shell-shortcut-state-changed` with `focusArea`, `bottomPanelCanCloseActiveTab`, `rightPanelCanCloseActiveTab`, `rightPanelBrowserConversationId`, and image-preview state. The global `close-active-app-shell-tab` command routes to bottom or right based on focus area.
- Orchestrator currently has keyboard shortcuts, but Workbench/Terminal close behavior is not centralized through an active app-shell focus-area model.

Migration implications:

- Build a reusable `PanelTabController` abstraction for Workbench and Terminal before polishing either tab strip further.
- Upgrade shared `TabButton` so close is hover/focus overlay and works for non-active tabs, while preserving accessible labels and middle-click close.
- Add shell-level focus-area state and route close-active-tab/keyboard commands through it.
- Add overflow fades and sticky action-slot measurement to the shared tab strip, then remove the bespoke Workbench and Terminal tab-row CSS.
- Use Codex-style controller semantics as the API boundary: panel content should register tabs and actions; shell should render tab chrome.

### 2026-05-20: Broader Parity Investigation Wave

This pass fanned out read-only investigations across the non-shell Codex parity areas. The MCP/apps/plugins/skills subagent stalled, so that area was completed locally from the current capability docs and implementation.

#### Chat And Thread Runtime

Reference chunks:

- `webview/assets/use-active-conversation-id-CBsI3TAh.js`
- `webview/assets/use-start-new-conversation-DK-qycZW.js`
- `webview/assets/pending-worktree-conversation-BeU8KFPH.js`
- `webview/assets/local-conversation-thread-BX7YNcUw.js`
- `webview/assets/local-conversation-page-Bt6RhPKI.js`
- `webview/assets/remote-conversation-page-CRbylpi9.js`

Findings:

- Codex conversation identity is route-backed for local, remote, and hotkey-thread windows. Orchestrator still treats `activeSessionId` as renderer store state, so deep links, new windows, and reopen semantics are weaker.
- Codex has first-class pending worktree conversations with launch mode, fork source, owner metadata, pin placement, title, goal, and browser-transfer metadata. Orchestrator creates a normal session first and mutates worktree state on first send.
- Codex resumes cold/missing conversations on page open, handles archiving/missing states explicitly, and tracks hot/cold switch readiness. Orchestrator mainly resumes provider threads as part of a run path.
- Codex side chat is an ephemeral forked conversation. Orchestrator side questions are UI-local detached calls, so they do not preserve native fork semantics.
- Codex marks read from visible active conversation state. Orchestrator clears unread on active-session selection, which can mark work read before the transcript is actually visible.

Migration implications:

- Add route-backed session identity before expanding new-window/deeplink behavior.
- Add a pending conversation/worktree launch model instead of relying only on first-send mutation.
- Add page-open lifecycle states such as `resuming`, `missing`, `archiving`, `closed`, and `ready`.
- Use Codex fork-latest/fork-turn semantics for side chats and worktree forks where provider support exists.
- Delay unread clearing until transcript readiness is confirmed.

#### Live Generation And Transcript Rendering

Reference chunks:

- `webview/assets/thread-scroll-layout-Cxloffmz.js`
- `webview/assets/thread-layout-Chou_aJz.js`
- `webview/assets/thread-detail-level-B_mdNLmM.js`
- `webview/assets/conversation-markdown-By6oKuLC.js`
- `webview/assets/right-panel-composer-overlay-scroll-reserve-BZSZnzFs.js`
- `webview/assets/virtualized-turns-JewydgrT.js`

Findings:

- Codex scroll math is distance-from-bottom based and exposes a scroll adapter. Orchestrator still uses direct `scrollTop` and height-delta compensation.
- Codex virtualizes by turn keys with measured offsets, binary search, overscan, first-visible preservation, and `scrollToKey`. Orchestrator virtualizes message/tool rows with custom window math and direct DOM `scrollIntoView`.
- Codex has explicit footer/composer reserve CSS, response spacer state, and follow modes such as `static`, `user_follow`, `prework_watch`, and `prework_follow`. Orchestrator has a good first pass for manual-scroll protection, but no shared scroll controller or composer reserve primitive.
- Existing Orchestrator smokes cover lazy load, search jump, transcript stress, and manual scroll during streaming, but not typing latency during live streaming or very large transcript headroom.
- Codex collapses verbose agent/subagent activity by default: the transcript primarily shows the final agent summary plus elapsed work time, with a chevron to expand earlier agent thinking/tool-call messages. Orchestrator still renders more agent internals directly, so a future transcript/performance slice should add agent-activity collapse to reduce visual noise and long-thread render cost.

Migration implications:

- Introduce a reusable `ThreadScrollController` with distance-from-bottom semantics.
- Route search and lazy-load jumps through stable transcript item keys instead of raw DOM scroll calls.
- Add a composer/footer reserve variable even while the composer remains outside the scroll container.
- Add default-collapsed agent activity groups with elapsed-time summaries and explicit expand/collapse.
- Add typing-latency, composer-reserve, search-jump-anchor, and larger 10k-message stress smokes.

#### Composer And Input Ergonomics

Reference chunks:

- `webview/assets/composer-DXaiOlFj.js`
- `webview/assets/composer-atoms-BeIctnnK.js`
- `webview/assets/composer-0WIQtlLp.css`
- `webview/assets/thread-context-inputs-CFTJKUBX.js`
- `webview/assets/user-message-attachments-C4kFKr_t.js`

Findings:

- Codex composer is ProseMirror-backed, with persisted atoms for enter behavior, prompt history, auto context, and richer input preferences.
- Codex handles pasted files/images, drag/drop, pending uploads, cancel/error surfaces, and broad context chips for files, selected text, native app context, prior conversation, PR checks, and workspace roots.
- Orchestrator has per-session text drafts, paste caret fixes, local attachment chips, slash commands, and permission/question split, but attachment chips are still local `InputBar` state rather than per-session draft state.
- Mixed text+file paste can leave the caret behavior inconsistent with text-only paste, and large file paste reads full buffers in the renderer without pending/cancel feedback.

Migration implications:

- Persist or key composer attachments by session id.
- Add drag/drop file attachment with pending/error/cancel chip states.
- Normalize caret behavior for mixed text+file paste.
- Add prompt history and configurable enter behavior before considering a heavier editor substrate.
- Add focused smokes for draft/attachment isolation, paste behavior, slash palette keys, and large attachment latency.

#### Search And Navigation

Reference chunks:

- `webview/assets/search-C95l31xn.js`
- `webview/assets/keyboard-shortcuts-search-input-DxhdKVBY.js`
- `webview/assets/workspace-file-command-menu-bridge-Du8_GPQH.js`
- `webview/assets/use-workspace-file-search-CrqRc_Zo.js`
- `webview/assets/file-tree-search-input-X-DM55OR.js`
- `webview/assets/command-keybindings-CahU8007.js`
- `webview/assets/use-command-hotkey-B6nOAHzG.js`

Findings:

- Codex has a centralized command/keybinding model. Orchestrator still splits command metadata, handlers, menu accelerators, and global `keydown` logic.
- Codex command menu has modes such as file search and routes `Cmd/Ctrl+P` into workspace file search. Orchestrator command palette is clean, but lacks file/search-chat modes and still treats file search as panel-local.
- Codex workspace search is app/server backed, ignored-dir aware, fuzzy ranked, and root-labeled. Orchestrator file search is renderer-recursive, depth/cap limited, and substring based.
- Codex find is cross-surface with active match state, highlight, counts, capped results, and scroll-to-match across conversation and diff. Orchestrator transcript search works but has no shared find model, and diff search only filters changed file paths.
- Codex shortcuts settings are editable with capture, conflicts, remove/reset, and persisted keymap state. Orchestrator shortcuts are static searchable reference rows.

Migration implications:

- Create a unified command registry with metadata, default shortcuts, handlers, enabled state, and palette/menu visibility.
- Add command-palette file mode and `Cmd/Ctrl+P`.
- Move workspace file search into main process or a long-lived search session with fuzzy ranking and ignored dirs.
- Add shared `FindBar` state for transcript and diff, then add diff hunk search and highlighting.
- Add editable shortcut overrides after the registry is real.

#### MCPs, Apps, Plugins, Skills, And Capabilities

Reference sources:

- `docs/provider-resource-dedupe-spike.md`
- `docs/capability-sync-spike.md`
- `docs/codex-appserver-support-matrix.md`
- `src/main/providerResources.ts`
- `src/main/capabilitySync.ts`
- Codex chunks still to inspect more deeply: `mcp-DS0lNDOd.js`, `mcp-settings-BRGoGTc_.js`, `apps-C0n7YO22.js`, `apps-queries-nPdSwUTo.js`, `plugins-page-BZD8O17r.js`, `plugin-install-store-CO2NIqvP.js`, `skills-settings-BbRndg3i.js`, `check-plugin-availability-BLUA-GwE.js`

Findings:

- Orchestrator already has a strong normalized capability model: `ProviderResource`, provider badges, dedupe by resource kind/fingerprint, file-backed create/edit/delete, and sync projection across Claude, Codex, Cursor, and Copilot where safe.
- Capability sync can write Codex `.agents/skills`, portable `.codex-plugin/plugin.json`, Codex plugin marketplace entries, and Codex MCP TOML. Risky provider-native installs are intentionally represented as gated operations.
- Codex app-server support is still mostly read-only for apps, skills, plugins, MCP status, account/model/config, and feature flags. Missing first-class parity includes app connector auth/invocation, `plugin/read/install/uninstall`, `skills/config/write`, MCP reload/OAuth/resource/tool management, native mention insertion, and app/server filesystem/search integration.
- The existing recommendation to keep Capabilities as its own surface still stands. Do not duplicate it into Settings; Settings should host provider/account/config preferences while Capabilities hosts inventory, install, sync, and projection state.

Migration implications:

- Finish the Codex bundle inspection for native app/plugin/skill UI details before changing the Capabilities page heavily.
- Add gated provider-native install/config flows on top of the existing preview/apply plan model.
- Promote read-only app-server resource data into real browser/picker flows with app/skill/plugin mention insertion.
- Add MCP reload/OAuth/resource/tool management only behind explicit confirmation and diagnostics.

#### Automations And Follow-Ups

Reference chunks:

- `webview/assets/automation-schedule-BpeIuMts.js`
- `webview/assets/automation-dialog-BvGLQK24.js`
- `webview/assets/automations-page-s8q9NlzD.js`
- `webview/assets/heartbeat-automation-eligibility--gq6YWh5.js`
- `webview/assets/heartbeat-automation-permissions-wzgH9Qd2.js`
- `webview/assets/heartbeat-automation-thread-bridge-DXwhZizF.js`

Findings:

- Codex supports `cron` and `heartbeat` automations, `ACTIVE`/`PAUSED`/`DELETED` states, RRULE schedule parsing/summaries, execution environments, models, reasoning effort, run-now, optimistic update/revert, and run history.
- Codex heartbeat eligibility is explicit: local host, existing conversation, resumed/not resuming, no active turn, and no pending user input/approval/MCP elicitation.
- Orchestrator has no persisted automation subsystem yet. Current follow-ups are in-memory active-run queue/steer behavior and should not be stretched into scheduled reminders.

Migration implications:

- Start with runtime types and a tested `AutomationManager`, not a scheduling dialog.
- Persist `Automation`, `AutomationRun`, `AutomationTarget`, schedule, permission snapshot, next/last run, and status.
- Add fake-clock tests for RRULE, next-run, pause/resume/delete, restart hydration, and single-flight guards.
- Add heartbeat eligibility mapped from current session/provider state before exposing thread wakeups.

#### Permissions, Approvals, And Safety

Reference chunks:

- `webview/assets/permission-request-model-DztoNKAv.js`
- `webview/assets/permissions-mode-defaults-TVsdTyUZ.js`
- `webview/assets/permissions-mode-helpers-CExUWaUo.js`
- `webview/assets/permissions-mode-visibility-Cz4wOMkW.js`
- `webview/assets/computer-use-app-approvals-query-D_eSSbpv.js`
- `webview/assets/use-permissions-mode-Ch7rOI7L.js`

Findings:

- Orchestrator already separates `permission.requested` from `user_input.requested` across types, lifecycle, transcript cards, pet notifications, system notifications, and app-server runtime handling.
- Backend mapping already separates Codex `approvalPolicy`, `approvalsReviewer`, and sandbox policy, but renderer UI still exposes a static provider-mode abstraction.
- Codex derives visible/default permission modes from host/cwd config requirements, latest-turn params, global/draft scope, full-access/custom visibility, guardian availability, and preferred non-full-access defaults.
- Orchestrator preserves raw `item/permissions/requestApproval` payloads too generically. Codex expands network/filesystem access into explicit request parts.
- Transcript permission card supports `Allow Once`, `Allow Session`, and `Deny`; pet overlay currently lacks the `Allow Session` parity action.

Migration implications:

- Split Codex UI state into explicit `approvalPolicy`, `sandboxMode`, and `approvalsReviewer`, keeping legacy `permissionMode` as compatibility.
- Feed app-server `config/read` and `configRequirements/read` into composer/settings mode visibility.
- Expand permission requests into structured network/filesystem details for transcript and pet cards.
- Add `Allow Session` to the pet approval path.
- Add focus-refresh checks for pending approvals/questions on app focus return.

#### Notifications And Provider Runtime Robustness

Reference chunks:

- `webview/assets/app-server-manager-hooks-BpnIGmYe.js`
- `webview/assets/app-server-manager-signals-BEaGjuc8.js`
- `webview/assets/app-server-notification-debug-signals-B4ZABWlc.js`
- `webview/assets/app-server-connection-state-COgfP2Bg.js`

Findings:

- Orchestrator has the core Codex app-server runtime, EPIPE global guards, and synchronous write-race handling, but not Codex's host-scoped app-server manager model.
- The live app-server session lacks child `error`, stdin `error`, write-callback, pending-request rejection, and typed unexpected-exit handling.
- An unexpected app-server exit can currently flow through `onExit()` and leave the session looking idle instead of failed if no `run.failed` notification arrived.
- Generic reconnect lifecycle exists, but Codex app-server disconnects are not normalized into connection state or restart/resume events.
- Codex keeps an app-server notification debug ring with host/thread/method/severity/noisy classification. Orchestrator now has provider-neutral runtime connection snapshots plus a bounded runtime debug ring.

Migration implications:

- Harden the provider runtime transport contract first, then make `CodexAppServerSession` the first concrete implementation. The same error/exit/write semantics should apply to Claude/Cursor/Copilot process lanes where possible.
- Add provider-host connection state with version, error code, and transition source. Codex app-server can populate the richest version first; other providers should still report process/runtime connection health.
- Emit failed lifecycle state for unexpected app-server exits.
- Continue expanding runtime diagnostics with provider-specific subscription state where the provider exposes it. Connection snapshots and the notification/debug ring are now exposed through provider diagnostics and a hidden provider-details card.
- Main-to-renderer and pet-overlay sends now use a shared safe-send guard for production session, terminal, menu, and pet messages; automated smoke-only sends can stay direct.

#### Review, Diff, Files, And Workspace

Reference chunks:

- `webview/assets/diff-summary-BdtgnJ_7.js`
- `webview/assets/diff-view-mode-Kp3YUUoJ.js`
- `webview/assets/file-diff-B3JvW2yY.js`
- `webview/assets/review-file-tree-side-pane-DTvkJOnY.js`
- `webview/assets/open-workspace-file-DOOUD1lA.js`
- `webview/assets/workspace-directory-tree-DltP8zc2.js`
- `webview/assets/file-preview-page-CJlBKAuy.js`
- `webview/assets/use-workspace-file-search-CrqRc_Zo.js`

Findings:

- Orchestrator Review often prefers rich current-file previews for changed markdown/json/csv/notebook/document/image files before showing diffs. Codex keeps diff rendering as the first-class path with split/unified modes, hunk expansion, line metadata, word diffs, and virtualization.
- Orchestrator changed files are flat filtered rows. Codex uses a review file tree with active path selection, search, comment counts, and scroll-to-file.
- Orchestrator Files panel crawls from the renderer with a 360-entry cap and depth-4 cutoff. Codex uses lazy directory queries and fuzzy search sessions across roots.
- Orchestrator assistant file cards are regex-extracted and can show false positives, especially with missing absolute paths or basename fallback into the workspace. This matches the user's reported bad cards for prose values such as comments and numeric examples.
- Orchestrator strips line suffixes like `foo.ts:42`; Codex open-file routing preserves path, cwd, line, column, end line, target, preview mode, and outcome telemetry.

Migration implications:

- Make Review diff-first and move rich previews behind an explicit Preview toggle.
- Replace flat changed-file rows with a directory tree and selected-file/search state.
- Harden file reference extraction and workspace resolution before adding more card UI.
- Preserve line/column metadata and expand open-file routing to editor-specific line opens.
- Add fixtures for prose false positives, same-basename outside-workspace paths, deep files, >360 files, and changed rich-preview file types.

#### Settings And Personalization

Reference chunks:

- `webview/assets/settings-page-BoavEVDX.js`
- `webview/assets/settings-content-layout-BeqejwUq.js`
- `webview/assets/settings-row-BUhYC5Lf.js`
- `webview/assets/appearance-settings-HaBPvNZV.js`
- `webview/assets/personalization-settings-B0sHaE0K.js`
- `webview/assets/keyboard-shortcuts-settings-IS-vX_o_.js`

Findings:

- Codex settings are routed full-page surfaces with grouped App/Host sections. Orchestrator settings are now cleaner, but still have a smaller flat section set.
- Codex row primitives are more reusable: standard row, compact row, nested row, action row, icon, label, description, and control. Orchestrator has shared pieces, but many settings controls still use one-off row/card layouts.
- Theme parity is closer than expected, but uneven. `opaqueWindows` and `semanticColors.skill` are stored/exposed without complete CSS application, and legacy appearance setters can drop v2 theme fields until reload.
- Codex shortcuts are editable with capture, conflict detection, multiple bindings, reset/remove, and persisted keymap state. Orchestrator shortcuts are static reference rows.
- Codex treats pets as part of personalization, with current pet, built-in/custom groups, create/refresh/open/tuck controls. Orchestrator has pet asset/install controls but a simpler top-level Pets section.
- Codex data controls include archived chat inventory and unarchive. Orchestrator data controls mainly expose profile/user-data paths.

Migration implications:

- Continue migrating settings to Codex-shaped primitives and grouped sections while preserving the liked left nav.
- Fix theme application consistency before adding more theme controls.
- Build editable keybindings on top of the unified command registry.
- Fold pet controls into a broader personalization model or intentionally document why Orchestrator keeps them separate.
- Expand data controls with archived session inventory and restore/unarchive before destructive cleanup flows.

## Additional Codex Parity Dives

These are the next areas to inspect beyond shell/workbench chrome. Each area should produce code-backed notes before broad Orchestrator-specific feature work continues.

| Area | Codex chunks to inspect | Orchestrator surfaces to compare | Why it matters |
| --- | --- | --- | --- |
| Chat/thread runtime | `local-conversation-page-Bt6RhPKI.js`, `local-conversation-thread-BX7YNcUw.js`, `remote-conversation-page-CRbylpi9.js`, `pending-worktree-conversation-BeU8KFPH.js`, `use-active-conversation-id-CBsI3TAh.js`, `use-start-new-conversation-DK-qycZW.js` | `SessionPane`, `ChatView`, `SessionItem`, `sessions.ts`, `sessionManager` | Chat switching, thread lifecycle, active conversation tracking, pending worktrees, and startup path should feel as reliable as Codex before adding more orchestration concepts. |
| Live generation and transcript rendering | `thread-scroll-layout-Cxloffmz.js`, `thread-layout-Chou_aJz.js`, `thread-detail-level-B_mdNLmM.js`, `conversation-markdown-By6oKuLC.js`, `right-panel-composer-overlay-scroll-reserve-BZSZnzFs.js` | `ChatView`, transcript virtualization/lazy loading, composer isolation, transcript stress smokes | Streaming should not block typing or manual scrolling, long threads should remain fast, and hidden/lazy content should feel intentional rather than surprising. |
| Composer and input ergonomics | `composer-DXaiOlFj.js`, `composer-atoms-BeIctnnK.js`, `composer-0WIQtlLp.css`, `thread-context-inputs-CFTJKUBX.js`, `user-message-attachments-C4kFKr_t.js` | `InputBar`, attachment handling, per-chat drafts, slash commands, permission/model controls | The composer is the highest-frequency interaction. It should match Codex-level latency, focus behavior, paste behavior, attachments, context inputs, and keyboard ergonomics. |
| Search and navigation | `search-C95l31xn.js`, `keyboard-shortcuts-search-input-DxhdKVBY.js`, `workspace-file-command-menu-bridge-Du8_GPQH.js`, `use-workspace-file-search-CrqRc_Zo.js`, `file-tree-search-input-X-DM55OR.js` | Command palette, transcript search, file search, diff search, sidebar search if added | Search should be unified, keyboard-first, and predictable across transcript, files, commands, and settings. |
| MCPs, apps, plugins, and skills | `mcp-DS0lNDOd.js`, `mcp-settings-BRGoGTc_.js`, `apps-C0n7YO22.js`, `apps-queries-nPdSwUTo.js`, `plugins-page-BZD8O17r.js`, `plugin-install-store-CO2NIqvP.js`, `skills-settings-BbRndg3i.js`, `check-plugin-availability-BLUA-GwE.js` | `CapabilitiesPage`, settings capabilities, provider runtime discovery, app/plugin install paths | Orchestrator should not invent a parallel capabilities model if Codex already has mature patterns for MCPs, apps, plugins, skills, availability, install state, and settings. |
| Automations and follow-ups | `automation-bN0RD0G3.js`, `automation-dialog-BvGLQK24.js`, `automation-schedule-BpeIuMts.js`, `automations-page-s8q9NlzD.js`, `heartbeat-automation-thread-bridge-DXwhZizF.js`, `heartbeat-automation-eligibility--gq6YWh5.js`, `heartbeat-automation-permissions-wzgH9Qd2.js` | Any future Orchestrator automation/follow-up UI, thread wakeups, scheduled runs | Automations need careful permission, eligibility, schedule, and thread-bridge semantics. We should mirror Codex patterns before building new scheduling UX. |
| Permissions, approvals, and safety | `permission-request-model-DztoNKAv.js`, `permissions-mode-defaults-TVsdTyUZ.js`, `permissions-mode-helpers-CExUWaUo.js`, `permissions-mode-visibility-Cz4wOMkW.js`, `computer-use-app-approvals-query-D_eSSbpv.js`, `use-permissions-mode-Ch7rOI7L.js` | Permission states in sidebar, pet, notifications, transcript controls, provider approval modes | Permission waits are product-critical and easy to make confusing. The UI and runtime should preserve Codex-level clarity between approval mode, permission prompts, and app focus. |
| Notifications and provider runtime robustness | `app-server-manager-hooks-BpnIGmYe.js`, `app-server-manager-signals-BEaGjuc8.js`, `app-server-notification-debug-signals-B4ZABWlc.js`, `app-server-connection-state-COgfP2Bg.js` | provider runtime manager, main/renderer event bridge, pet overlay, system notifications, reconnect handling | Orchestrator has had crashes and EPIPE issues; Codex app-server state is the richest reference, but the resulting transport, reconnect, and diagnostics model should apply to all provider runtimes where possible. |
| Review/diff/files/workspace | `diff-summary-BdtgnJ_7.js`, `diff-view-mode-Kp3YUUoJ.js`, `file-diff-B3JvW2yY.js`, `review-file-tree-side-pane-DTvkJOnY.js`, `open-workspace-file-DOOUD1lA.js`, `workspace-directory-tree-DltP8zc2.js`, `file-preview-page-CJlBKAuy.js` | `DiffPanel`, `FilesPanel`, file-reference extraction, open-file behavior | The user already saw file parsing issues. Diff/file panels need Codex-level parsing, grouping, previews, open behavior, and review ergonomics. |
| Settings and personalization | `settings-page-BoavEVDX.js`, `settings-content-layout-BeqejwUq.js`, `settings-row-BUhYC5Lf.js`, `appearance-settings-HaBPvNZV.js`, `personalization-settings-B0sHaE0K.js`, `keyboard-shortcuts-settings-IS-vX_o_.js` | `SettingsModal`, theme settings, shortcuts, providers, pets, data controls | Recent settings polish was a start. Full parity needs theme depth, shortcuts behavior, sections, row controls, and personalization breadth. |

## Checklist

| ID | Report | Initial Evidence | Plan | Status |
| --- | --- | --- | --- | --- |
| PP-001 | The sidebar loading indicator should live where the time/actions live, not farther inset. | `SessionItem` rendered spinner/status dot before the right metadata/actions slot. | Make the right-side slot mutually exclusive: action button on hover/focus, otherwise running/waiting/error/unread state, otherwise relative creation time. Verify with sidebar smoke/DOM checks. | `Complete` |
| PP-002 | A blank newly created chat should always remain at the top; an older chat rose above it. | Sidebar sort used `latestMessageAt ?? createdAt`, so any recently updated/running chat could jump above a blank active chat. | Add an active blank-chat priority before normal sorting. Verify with unit tests and sidebar smoke if available. | `Complete` |
| PP-003 | Active chats constantly reorder; active chats should stay in a stable order above inactive chats. | `compareSessionsByMode` sorted every unpinned list by latest activity, so streaming or status updates could move active rows repeatedly. | Group live sessions (`running`, `reconnecting`, waiting states) above inactive rows, but keep that group in a stable created-time/id order instead of latest-message order. | `Complete` |
| PP-004 | Permission requests need sidebar state, pet state, and notification behavior when the app is not focused. | Pet notification mapping already treats `waiting_for_permission` and `waiting_for_user` as `waiting`; sidebar `showStatusIndicator` excluded waiting states. App notification code focused on finished sessions. | Add sidebar waiting state first, then inspect app-focus notification behavior and extend if missing. Verify pet tests and notification path. | `Complete` |
| PP-005 | Delete confirmation blurs the whole app and has no visible card background. | `ConfirmDialog` uses `MotionOverlay`; `.motion-overlay-surface` had no background/border/shadow, while backdrop blur was `16px`. | Add shared card styling to the overlay surface and reduce the default blur. Verify delete dialog visually and via CSS/DOM smoke where possible. | `Complete` |
| PP-006 | Codex may archive chats before deleting; investigate and mirror if appropriate. | Codex local bundle includes an `Archive chat` action and app-server archive lifecycle via `thread/archive`, `thread/unarchive`, `thread/unsubscribe`, and `thread/archived`. Orchestrator delete called remove directly. | Add an archive path that hides chats from active lists while preserving their stored record, and keep hard remove for empty/internal cleanup. | `Complete` |
| PP-007 | Header hover chips/tooltips are malformed; one wraps one character per line. | `.orchestrator-tooltip` used `overflow-wrap: anywhere` with normal wrapping and no intrinsic width, which could produce unreadably narrow chips. | Fix tooltip sizing/wrapping constraints and verify tooltip screenshots/DOM measurements. | `Complete` |
| PP-008 | Composer typing lags while an agent is generating. | Streaming updates mutate session/message state; `SessionPane` passes the full session into `InputBar`, and `InputBar` subscribed to the full session store. | Profile/inspect render path, then isolate composer props/state from streaming transcript updates where practical. Verify typing smoke or render-count evidence. | `Complete` |
| PP-009 | Confirm whether app notification behavior covers permission waits when unfocused. | Renderer notification bridge only created a system notification for inactive completed sessions. | Add a deduped permission/user-input waiting notification when the document is not focused. | `Complete` |
| PP-010 | Composer text persists when switching chats; drafts should be per chat and restored when returning. | `InputBar` owned `text` as local component state, so changing the `session` prop did not reset or restore per-session content. Empty draft-only chats were also auto-cleaned during switching. | Store composer draft text in `uiState` by session id, load it whenever `InputBar` changes sessions, and do not auto-remove empty chats with drafts. | `Complete` |
| PP-011 | Sidebar chat hover card is hidden behind the main window and nearly invisible. | Hover card was rendered inside the sidebar subtree; the sidebar uses overflow/blur styling that can clip or create a containing layer for fixed children. | Portal the hover card to `document.body` and raise its z-index above app chrome. | `Complete` |
| PP-012 | Adding a project should put the user on a new chat screen for that project. | Empty-state project add creates and activates a session, but sidebar `handleAddProject` only added the project. | Make sidebar Add Project create/activate a new local chat in the newly added project. | `Complete` |
| PP-013 | Double-clicking a chat in the sidebar no longer renames it. | `SurfaceRow` supports double-click but `SessionItem` did not wire it to rename. | Add double-click rename on chat rows and cover it in sidebar smoke. | `Complete` |
| PP-014 | Rename chat popup lacks Cancel, has redundant divider lines, and the title field can be hard to focus. | `RenameChatDialog` had only a primary button plus bordered header/footer sections. Focus was split between overlay focus management and the dialog's own focus request. | Simplify the dialog, add Cancel, remove redundant dividers, and make the input focus/select reliably. | `Complete` |
| PP-015 | Toggling terminal on a running thread with sidebar open caused the page to go blank. | Terminal panel uses xterm fit/spawn work inside animation/resize paths; unchecked fit errors can break the UI. | Guard terminal fit/resize/open paths and run focused terminal smoke. | `Complete` |
| PP-016 | Closing the last window leaves the app alive but dock click does not reopen a window; app also lacks multi-window support. | `activate` checked `BrowserWindow.getAllWindows()`, which includes the pet overlay, and `mainWindow` was a singleton. | Track real app windows, reopen/focus correctly on macOS activate, and add a New Window menu item. | `Complete` |
| PP-017 | Sidebar hover cards appear too immediately. | Sidebar card opened on `mouseenter`/focus immediately. | Add a short intent delay for pointer hover while preserving instant keyboard focus behavior. | `Complete` |
| PP-018 | Sidebar hover card should only show chat name, project name, and branch. | `SessionItem` hover card included preview, folder, environment, provider, status, and updated age. | Trim the hover card to the requested identity fields and keep it readable above the main window. | `Complete` |
| PP-019 | Browser/right panel cannot expand much beyond initial width unless maximized. | `ContextSidebar` clamped docked panel width against a 640px primary-content minimum and 720px panel maximum, leaving little flexible space on normal laptop widths. | Loosen docked panel limits while preserving a minimum usable chat area and keep full-width maximize as the explicit largest state. | `Complete` |
| PP-020 | New-chat screen lost useful prompt text like "what should we build in {project}". | `ChatView` returned an empty canvas for message-less chats and relied only on composer placeholder text. | Restore quiet project-aware prompt copy and examples in the empty chat canvas. | `Complete` |
| PP-021 | Terminal header styling feels ugly and much less clean than Codex. | Live Orchestrator shows a tall bottom-panel header with a boxed selected tab, visible plus button, and separate boxed clear/hide controls. Codex bundle uses a shared app-shell bottom-panel tab list with `h-toolbar-pane`, subtle tab backgrounds, delayed tooltips, and sticky action slots. | Rebuild the terminal header on the same shell language as the right panel: compact 28px tabs, icon-first action cluster, lighter selected state, no oversized tab bubble, and shared resize/header tokens. Verify with terminal smoke plus screenshot comparison. | `Complete` |
| PP-022 | Sidebar headers look cluttered and less clean than Codex. | Live Orchestrator shows always-visible project header action icons beside small section labels; Codex bundle uses app-shell/section primitives with quieter group headings, row-y spacing, hover actions, and tokenized sidebar surface/toolbar heights. | Make sidebar headers calm section rows: lighter labels, consistent row spacing, hover/focus-revealed organize/add actions, no header crowding, and shared sidebar header/button sizing. Verify with sidebar smoke and desktop screenshot. | `Complete` |
| PP-023 | Settings pages are messy, cluttered, and unlike Codex. | Orchestrator `SettingsModal` mixes one-off header styles, wide two-column setting groups, card grids, sliders, and dense appearance controls in one long scroll. The current left settings nav is liked and should remain. Codex bundle has `SettingsPage`, `SettingsContentLayout`, `SettingsGroup`, `SettingsSurface`, `SettingsRow`, and `SectionedPage` primitives. | Keep the left settings nav, but refactor the pages around Codex-shaped content primitives: a calmer settings shell, bounded content width, sectioned in-page structure for long pages, surface rows with label/description/control, and fewer nested cards. Verify with settings smoke and screenshots for General, Appearance, Providers, Shortcuts, Pets, and Data controls. | `Complete` |
| PP-024 | App chrome primitives are still too one-off across terminal, right sidebar, sidebar, and settings. | Codex app-shell chunks centralize left/right/bottom panel sizing, headers, tabs, focus areas, and toolbar tokens. Orchestrator currently styles these independently in `SessionPane`, `ContextSidebar`, `Sidebar`, `SettingsModal`, and `index.css`. | Create/adopt shared Orchestrator shell primitives and CSS tokens for toolbar height, tab buttons, panel headers, section headers, action clusters, and surfaces before doing broad polish. Use them to make PP-021 through PP-023 consistent instead of patching each surface separately. | `Complete` |
| PP-025 | The right sidebar also needs the clean Codex-like header treatment. | Naming was ambiguous: PP-022 covered the Chat Sidebar, while the right-side `ContextSidebar`/`right-sidebar` tabbar still has heavier active tab weight, always-prominent action buttons, old "right sidebar" naming, and inactive tabs collapsed to icons unlike Codex. | Standardize product language to Workbench Panel, then polish its tab/header chrome with the same calmer one-line tab/action language used for Terminal Panel. Verify with right-panel smoke and screenshot review. | `Complete` |
| PP-026 | Reach Codex-level Workbench parity before bespoke Orchestrator-specific changes. | The Workbench comparison shows deeper architecture gaps beyond visual polish: shared shell primitives, tab controller behavior, ratio sizing, focus handling, performance checks, and cross-panel robustness. | Work through the Codex Parity Matrix above in small commits, starting with shared shell primitives and reusable tab-controller behavior. | `Todo` |
| PP-027 | Workbench tabs still do not fully behave like Codex tabs. | Codex close affordances are built into the tab and available beyond just the active tab; Codex also has stronger edge fades and sticky action slots. | Extend the shared tab primitive/controller so Workbench and Terminal can use Codex-like tab close, overflow, and trailing action semantics. | `Todo` |
| PP-028 | Workbench sizing should be as smooth and robust as Codex. | Codex stores panel width as a ratio against main content while Orchestrator persists pixel width and uses overlay fallback. | Implement ratio-based Workbench sizing or a compatibility layer that gives the same behavior across normal, narrow, and full-width windows. | `Todo` |
| PP-029 | Parity needs speed and robustness gates, not only screenshots. | Current verification is mostly TypeScript plus surface smoke. That catches regressions but does not prove resize, typing, scrolling, and tab switching remain fast under live agent load. | Add focused smoke/perf checks for Workbench tab switching, panel resize, composer typing during streaming, long-thread lazy rendering, and cross-panel keyboard handling. | `Todo` |
| PP-030 | Workbench and Terminal need a shared app-shell tab controller. | Codex uses the same controller-shaped tab renderer for right and bottom panels; Orchestrator renders Workbench tabs in `ContextSidebar` and Terminal tabs in `SessionPane` separately. | Create a shared tab controller/renderer, migrate Workbench first, then Terminal, with Codex-style tab registration, close-active-tab support, overflow fades, sticky actions, and drag reorder hooks. | `Todo` |
| PP-031 | Shell focus and global close-tab shortcuts need to be centralized. | Codex dispatches shell shortcut state from active focus area and routes `close-active-app-shell-tab` through right/bottom panel controllers. Orchestrator does not have equivalent focus-area command routing. | Add shell focus-area state for main, Workbench, and Terminal; route close-active-tab and related shortcuts through the focused panel. | `Todo` |
| PP-032 | Broaden parity research beyond Workbench shell. | Completed the first investigation wave across chat/thread runtime, transcript rendering, composer, search/navigation, capabilities, automations, permissions/safety, notifications/app-server robustness, review/files/workspace, and settings/personalization. | Use the Broader Parity Investigation Wave notes above as the implementation backlog before bespoke Orchestrator changes. | `Complete` |
| PP-033 | Chat switching and live transcript behavior need Codex-level verification. | Codex uses route-backed conversation identity, pending worktree launch state, turn-key virtualization, and distance-from-bottom scroll control. Orchestrator still uses store-backed active id plus message-row virtualization and direct scroll math. | Add route-backed session identity, a pending worktree launch model, page-open lifecycle states, a `ThreadScrollController`, stable transcript item keys, and parity smokes for switch/scroll/search/typing latency. | `Todo` |
| PP-034 | Capabilities should align with mature apps/MCP/plugins/skills patterns without becoming Codex-only. | Orchestrator already has a normalized `ProviderResource` and capability-sync model, while Codex app-server exposes the richest read/write reference surfaces for apps, skills, plugins, MCP, config, and external agent imports. | Keep Capabilities as the primary provider-agnostic inventory, finish Codex-native bundle inspection, then add adapter-backed native install/config flows, app/skill/plugin pickers, mention insertion, and MCP reload/OAuth/resource controls where each provider supports them. | `Todo` |
| PP-035 | Automations and follow-ups need provider-agnostic scheduling before provider-specific UX. | Codex supports persisted cron/heartbeat automations, RRULE schedules, run-now, pause/delete, run history, execution environments, and heartbeat eligibility/permission snapshots. Orchestrator only has in-memory active-run queued follow-ups. | Build a provider-agnostic `AutomationManager` runtime with persisted types, fake-clock schedule tests, run history, permission snapshots, and provider-specific eligibility adapters before building create/edit schedule UI. | `Todo` |
| PP-036 | Review/files/workspace parsing should match Codex robustness. | Orchestrator currently has regex file-reference extraction, basename fallback, preview-first review rendering, flat changed-file rows, and capped renderer-side workspace crawling. Codex has diff-first review, file trees, line-aware open routing, lazy workspace trees, and fuzzy search sessions. | File-reference hardening started: absolute references outside the current workspace no longer resolve by basename into unrelated local files, while relative/suffix workspace matches still work. Review now defaults textual and rich binary changed files to the diff/binary state and exposes an explicit Preview/Diff toggle for changed rich files. Line/column reference metadata now flows through PP-048. Remaining work: main-process workspace search/session, file tree, and deep-file fixtures. | `In progress` |
| PP-037 | Route-backed session identity is needed for Codex-like reliability. | Codex derives active conversation from local/remote/hotkey routes and supports copy links/open-in-new-window semantics. Orchestrator cannot reopen or deep-link a chat from route alone. | Add local route parsing/sync for session id, then wire new-window/deeplink/open-chat actions through the route-backed layer. | `Todo` |
| PP-038 | Pending worktree/fork lifecycle should be first-class. | Codex pending worktree conversations carry start-vs-fork mode, source turn, owner metadata, pin placement, title, goal, and browser-transfer metadata. Orchestrator mutates worktree state on first send. | Add a pending conversation record and use it for new worktree chats, fork-latest, fork-turn, and side-chat worktree flows. | `Todo` |
| PP-039 | Composer attachments should be isolated per chat. | Text drafts are now per chat, but composer attachments remained local `InputBar` state and could leak across session switches. Codex treats attachment state as part of composer context. | Added `composerAttachments` to per-session UI state, keyed attachment add/remove/clear through the session store, and expanded focused composer smoke coverage so draft plus attachment isolation are verified together. | `Complete` |
| PP-040 | Composer file input needs Codex-like pending states. | Codex supports drag/drop, pasted files/images, pending upload chips, cancel/error states, and richer context chips. Orchestrator read pasted files fully in the renderer and had no drag/drop overlay or pending/cancel feedback. | First slice complete: drag/drop now shows a drop overlay and attaches through the saved-file path; pasted/dropped files show saving/error chips with dismiss/cancel behavior; async saves capture the target session; attachment-only empty chats are protected from cleanup; focused composer smoke covers per-chat attachments, attachment-only session preservation, drop overlay, and drop attachment. Remaining work: richer context chips and large-file latency/cancel stress coverage. | `In progress` |
| PP-041 | Command, shortcut, and search handling need one registry. | Codex centralizes command metadata/keybindings and uses modeful command-menu search for files/chats/find. Orchestrator split `APP_COMMANDS`, menu accelerators, and global keydown handlers. | Global renderer keydown handling now resolves through the shared app command registry, including command palette, chat creation, find, file search, rename/pin, chat navigation, panel toggles, settings, shortcuts, and chat slots. `Cmd/Ctrl+P` opens the Files Workbench tab and focuses workspace file search. Remaining work: shared find-next/previous commands and editable shortcut overrides. | `In progress` |
| PP-042 | Provider runtime transport must fail loudly and recoverably. | The old EPIPE crash was globally mitigated, but `CodexAppServerSession` still lacked child/stdin error listeners, write callbacks, pending-request rejection, and unexpected-exit failure events; generic PTY lanes already had spawn/exit cleanup tests but fewer low-level transport signals to hook. | Hardened the Codex app-server provider adapter as the first concrete implementation: stdin errors, child errors, write-callback failures, unexpected exits, and pending request cleanup now produce `run.failed` instead of silent idle fallback. Generic PTY lanes remain covered by provider runtime spawn/exit tests; PP-043 will add provider-host diagnostics across adapters. | `Complete` |
| PP-043 | Provider runtime diagnostics should mirror Codex's strongest connection/debug signals. | Codex tracks host-scoped connection states, versions, typed errors, subscriptions, and notification debug rings. Orchestrator had generic event buffers without provider-runtime-specific diagnostics. | Added provider-neutral runtime connection snapshots, generic PTY start/stop/spawn/exit state, Codex app-server initialize/thread/version/failure state, a bounded runtime debug ring, Codex app-server request/notification/permission/unsupported-tool/transport-failure recordings with host/thread/method/severity/noisy metadata, IPC access, provider diagnostics integration, a hidden provider-details Runtime card, and shared safe-send guards for production renderer/pet messages. Remaining follow-up can add provider-specific subscription state when available. | `Complete` |
| PP-044 | Permission modes should be dynamic, explicit, and provider-adapter backed. | Backend mapping separated `approvalPolicy`, `approvalsReviewer`, and sandbox policy, but renderer UI exposed static provider modes. Codex derives mode visibility/defaults from app-server config and cwd requirements; other providers expose different but related permission surfaces. | First slice complete: `ResolvedExecutionPolicy` now carries an explicit provider-backed execution contract for native mode, approval policy, reviewer, sandbox, tool policy, and config source; Codex app-server launch config consumes the same policy mapping as provider runtime info; settings and composer surfaces display compact contract chips; provider tests and settings-provider smoke assert the contract stays visible. Second slice in progress: added a provider-neutral permission runtime context; Codex now reads live app-server `config/read` and `configRequirements/read` into mode defaults/visibility when available, while non-Codex providers retain the same static contract. Remaining follow-up: promote successful live Codex context into saved defaults only when the user confirms, and add richer failure/refresh affordances. | `In progress` |
| PP-045 | Permission request cards need richer provider-normalized structure and pet parity. | Codex expands network/filesystem permission requests into explicit parts. Orchestrator preserves raw permissions generically, and pet overlay lacks `Allow Session`; other providers also emit tool/permission denials with provider-specific payloads. | Normalize provider permission requests into structured command/file/network/tool details, render them clearly in transcript and pet, add `Allow Session` when supported, and refresh pending safety state on app focus. | `Todo` |
| PP-046 | Settings need full command/theme/data parity. | Codex settings are routed full-page surfaces with grouped sections, reusable rows, editable shortcuts, personalization, and archived chat data controls. Orchestrator settings are calmer now but still smaller and partly one-off. | Add reusable settings row primitives, fix v2 theme application, build editable keybindings, expand data controls with archived session inventory, and decide Pets vs Personalization taxonomy. | `Todo` |
| PP-047 | Capabilities native actions should be gated but real through provider adapters. | Existing sync plans deliberately block provider-native installs and app-server writes without confirmation. Codex exposes richer plugin install/read, skills config, app connector, MCP reload/OAuth, and external agent import flows; Claude/Cursor/Copilot have different native management surfaces. | Add confirmation-backed native actions using the existing preview/apply plan model, starting with Codex `plugin/read/install/uninstall`, `skills/config/write`, and MCP reload/OAuth diagnostics, then map equivalent Claude/Cursor/Copilot actions through adapters. | `Todo` |
| PP-048 | Workspace file search and open-file routing should preserve intent. | Codex preserves cwd, line, column, target, preview mode, and open outcome; Orchestrator stripped line suffixes and opened only paths. | File references now preserve line/column metadata separately from paths, cards display the target suffix, and `fs.openPath` carries line/column into editor-specific URL opens for VS Code, VS Code Insiders, and Cursor with the existing selected-app fallback. The editor URL builder has focused tests. Remaining work: target/preview-mode metadata, open outcome telemetry, Zed-specific line support if a stable scheme is available, and provider/workspace search integration. | `In progress` |

## Verification Log

- 2026-05-20: `git status --short --branch` shows `main...origin/main [ahead 1]` and untracked `bootstrap.js`.
- 2026-05-20: Initial code inspection confirms sidebar ordering is activity timestamp based, delete dialog has no surface card style, sidebar waiting status is not in `showStatusIndicator`, pet notification semantics already know waiting states, and tooltip CSS can wrap anywhere.
- 2026-05-20: Added `compareSidebarSessions` with tests for active blank chats and stable live-chat ordering. `npm run test:providers` passed all 170 tests.
- 2026-05-20: Local Codex bundle inspection found UI copy `Archive chat`; action calls `archive-conversation`, and app-server manager sends `thread/archive`, suppresses archived conversations, unpins archived threads, removes them from cache, handles `thread/archived`, and uses `thread/unsubscribe` for empty discarded threads.
- 2026-05-20: Composer latency likely came from `InputBar` subscribing to the entire Zustand store plus receiving a full `session` object. First mitigation isolates store selectors and memoizes the composer against message-only session churn.
- 2026-05-20: Verification passed for first slice: `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.node.json --noEmit`, `git diff --check`, and escalated `npm run smoke:ui:auto -- --sidebar`.
- 2026-05-20: Archive slice adds `sessions.archive`, `archivedAt`, active-list filtering, `session:archived`, and Archive chat UI copy. Verification passed: web/node TypeScript, `git diff --check`, escalated sidebar smoke, and `npm run test:providers` with 170 passing tests.
- 2026-05-20: Added PP-010 through PP-012 from user testing: per-chat composer drafts, sidebar hover-card visibility, and Add Project opening a new chat.
- 2026-05-20: Draft/hover/add-project slice complete. Composer drafts are stored per session in `uiState`; draft-only empty chats are no longer auto-removed on chat switch/new-chat cleanup; sidebar hover cards portal to `document.body`; sidebar Add Project creates and activates a new chat in the added project. Verification passed: web/node TypeScript, `git diff --check`, escalated sidebar smoke, and escalated composer smoke with `composerDraftsPerChat: true`.
- 2026-05-20: Added PP-013 through PP-017 from user testing: double-click rename, rename dialog polish/focus, terminal blanking, window reopen/multi-window behavior, and delayed sidebar hover cards.
- 2026-05-20: Rename/window/terminal slice complete. Chat rows now double-click rename; rename dialog has Cancel, no redundant divider rows, and reliable input focus; sidebar hover cards use delayed pointer intent; terminal fit/resize is guarded against hidden/zero-size containers; app tracks real windows separately from pet overlay, supports File > New Window, and reopens/focuses an app window on macOS activate. Verification passed: web/node TypeScript, `git diff --check`, escalated sidebar smoke, and escalated terminal smoke.
- 2026-05-20: Added and completed PP-018 through PP-020 from user testing. Sidebar hover cards now show only chat title, project, and branch when available; right-panel docked sizing allows a wider browser before full-width expansion while preserving a minimum main-chat area; empty new chats show quiet project-aware prompt copy. Verification passed: web/node TypeScript, `git diff --check`, escalated sidebar smoke, escalated browser smoke, and escalated main UI smoke.
- 2026-05-20: Added PP-021 through PP-024 from Codex parity review. Direct Computer Use inspection of Orchestrator confirmed the terminal header, sidebar headers, and settings layout issues; Computer Use cannot inspect `com.openai.codex`, so Codex comparison came from the installed app bundle. Relevant Codex chunks: `app-shell-CcsLZiAu.js`, `app-shell-BJK30dyj.css`, `thread-page-header-DOy8QQg2.js`, `settings-page-BoavEVDX.js`, `settings-content-layout-BeqejwUq.js`, `settings-group-DwDYNKp_.js`, `settings-surface-BLiaJ7K3.js`, `settings-row-BUhYC5Lf.js`, `sectioned-page-C-MGQMtH.js`, and `tabs-Dhgr0Bym.js`.
- 2026-05-20: User clarified the current left settings nav is good. PP-023 now preserves that nav and scopes settings polish to page hierarchy, content primitives, and row/surface layout.
- 2026-05-20: UI chrome cleanup slice complete. Terminal header now uses a compact one-line tab/action strip; sidebar project header actions are hover/focus-revealed; settings keeps the liked left nav but uses a quieter shell/topbar, calmer setting groups, softer panels, and less heavy choice cards. Verification passed: web/node TypeScript, `git diff --check`, `npm run smoke:ui:auto -- --sidebar`, `npm run smoke:ui:auto -- --terminal`, and `npm run smoke:ui:auto -- --settings`; screenshot review caught and fixed terminal tab label wrapping before final terminal smoke.
- 2026-05-20: User clarified "sidebar" meant both sides. Added canonical surface names: Chat Sidebar for the left rail, Workbench Panel for the right contextual panel, and Terminal Panel for the bottom shell. Added PP-025 for Workbench Panel chrome polish.
- 2026-05-20: Workbench Panel comparison and polish slice complete. Codex bundle inspection showed labeled right-panel tabs, sticky tab actions, overflow fades, thin bordered pane surfaces, and ratio-based sizing. Orchestrator now uses Workbench Panel labels, calmer right-panel chrome, visible inactive tab labels, and corrected right-panel smoke coverage for true narrow overlay widths. Verification passed: escalated `npm run smoke:ui:auto -- --right-panel` with screenshot review at `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-right-panel-1779312014437.png`.
- 2026-05-20: Expanded the Workbench comparison into a broader Codex Parity Matrix covering usefulness, efficiency, speed, robustness, shared shell structure, sizing, tab lifecycle, styling tokens, and verification gates. Added PP-026 through PP-029 so future work prioritizes parity before bespoke Orchestrator-specific behavior.
- 2026-05-20: Completed two deeper Codex bundle dives: shell/panel/layout mechanics and tab/focus/shortcut lifecycle. Added migration notes for a shared Orchestrator app shell, ratio-based Workbench sizing, shared Workbench/Terminal tab controller, hover-overlay close affordances, overflow fades, sticky actions, focus-area shortcut routing, and shared resize semantics. Added PP-030 and PP-031.
- 2026-05-20: Added Additional Codex Parity Dives beyond Workbench shell: chat/thread runtime, live transcript rendering, composer/input ergonomics, search/navigation, MCP/apps/plugins/skills, automations/follow-ups, permissions/safety, notifications/app-server robustness, review/diff/files/workspace, and settings/personalization. Added PP-032 through PP-036.
- 2026-05-20: Completed the first broader parity investigation wave. Read-only subagents inspected chat/thread runtime, live transcript rendering, composer/input, search/navigation, automations, permissions/safety, notifications/provider-runtime robustness, review/files/workspace, and settings/personalization. The MCP/apps/plugins/skills subagent stalled, so that area was completed locally from `providerResources`, `capabilitySync`, `provider-resource-dedupe-spike`, `capability-sync-spike`, and `codex-appserver-support-matrix`. Added detailed notes plus PP-037 through PP-048.
- 2026-05-20: Corrected the parity framing to be provider-agnostic. Codex remains the richest local reference implementation, but shared concepts should become Orchestrator primitives with provider adapters for Codex, Claude, Cursor, Copilot, and future providers where possible.
- 2026-05-20: Completed PP-042 transport hardening slice. `CodexAppServerSession` now listens for stdin errors and child process errors, uses stdin write callbacks, emits `run.failed` for unexpected exits before a terminal run event, rejects pending client requests on close, clears pending server requests, and avoids silent idle fallback after app-server transport failure. Verification passed: node TypeScript, web TypeScript, compiled targeted `codexAppServerRuntime` test with 4 passing tests, and `npm run test:providers` with 173 passing tests.
- 2026-05-20: Started PP-036 with the file-reference trust fix. `resolveWorkspaceFileReference` no longer resolves absolute references from another workspace by basename into the current workspace, preventing prose or stale absolute paths from becoming misleading file cards when only the basename happens to exist locally. Verification passed: node TypeScript, web TypeScript, and compiled targeted `toolActions` plus `workspaceResolver` tests with 10 passing tests.
- 2026-05-20: Continued PP-036 with the Review diff-first slice. `DiffPanel` now renders textual diffs before rich current-file previews and keeps binary diff markers out of text diff rendering, matching the Codex principle that changed files should open on the diff path first. Verification passed: node TypeScript, web TypeScript, compiled targeted `reviewPreview`, `toolActions`, and `workspaceResolver` tests with 12 passing tests, plus `git diff --check`.
- 2026-05-20: Completed PP-039 composer attachment isolation. Composer attachments now live in per-session UI state alongside composer drafts, including external add-composer-attachment events and remove/clear flows. Verification passed: node TypeScript, web TypeScript, focused escalated `npm run smoke:ui:auto -- --composer` with `composerDraftsPerChat`, `composerAttachmentsPerChat`, and `composerAttachmentsClearedOnSwitch` all true, plus `git diff --check`.
- 2026-05-20: Started PP-048 with line/column-preserving file references. `extractFileReferences` now keeps `:line` and `:line:column` as metadata instead of stripping them, file cards display the target, and `fs.openPath` passes target metadata into VS Code, VS Code Insiders, and Cursor URL opens before falling back to the selected app open path. Verification passed: node TypeScript, web TypeScript, compiled targeted `toolActions` plus `workspaceResolver` tests with 11 passing tests, plus `git diff --check`.
- 2026-05-20: Continued PP-036 with an explicit Review Preview/Diff toggle. Changed rich files default to the textual diff path, and users can switch to the rich current-file preview with a toolbar/menu control. Verification passed: node TypeScript, web TypeScript, focused escalated `npm run smoke:ui:auto -- --diff` with `reviewDiffFirst` and `reviewJsonPreview` both true, plus `git diff --check`.
- 2026-05-20: Addressed read-only review follow-ups for PP-036 and PP-048. Rich binary-native changed files such as images now default to the binary diff state instead of current-file preview, with Preview as an explicit toggle. Focused diff smoke now covers JSON, CSV, DOCX, notebook, image binary-diff default, image preview toggle, and generic binary state. `editorFileUrl` is extracted and tested for URL-scheme line opens, spaces, missing schemes, and invalid target values. Verification passed: node TypeScript, web TypeScript, compiled targeted `editorOpen`, `toolActions`, and `workspaceResolver` tests with 14 passing tests, focused escalated `npm run smoke:ui:auto -- --diff`, and `git diff --check`.
- 2026-05-20: Started PP-040 composer file input parity. Composer now supports drag/drop with an overlay, pending/error attachment chips for pasted or dropped file saves, dismiss/cancel behavior, and target-session-safe async attachment completion. Empty-chat cleanup now treats composer attachments as draft state so attachment-only chats are preserved. Verification passed: node TypeScript, web TypeScript, focused escalated `npm run smoke:ui:auto -- --composer` with `composerAttachmentOnlySessionPreserved`, `composerDropOverlay`, and `composerDragDropAttachment` true, plus `git diff --check`.
- 2026-05-20: Started PP-041 command registry consolidation. Added keyboard-event resolution to the shared app command registry and routed the renderer global keydown handler through it instead of a separate hard-coded switch. Verification passed: node TypeScript, web TypeScript, compiled targeted `appCommands` tests with 3 passing tests, and `git diff --check`.
- 2026-05-20: Continued PP-041 with registry-backed file search. Added `open-file-search` on `Cmd/Ctrl+P`, exposed it in command palette/shortcuts, opened the Files Workbench tab from the command handler, and focused `workspace-file-search` through a panel event. Verification passed: node TypeScript, web TypeScript, compiled targeted `appCommands` tests with 3 passing tests, focused escalated `npm run smoke:ui:auto -- --files`, and `git diff --check`.
