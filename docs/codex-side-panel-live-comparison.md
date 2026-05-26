# Codex Side Panel Live Comparison

Last updated: 2026-05-26

This file is the current comparison ledger for the side-panel parity goal. It separates Codex-bundle evidence from Orchestrator fixture-smoke evidence so passing local smokes do not accidentally count as full Codex parity.

## Runnable Comparison

- Reuse the latest side-panel smoke manifest and compare it with the current Codex app bundle:
  `npm run compare:codex-side-panels`
- Regenerate the full side-panel visual inventory first, then compare:
  `npm run compare:codex-side-panels -- --run-smoke --full`
- Generate the same report without failing the shell on known mismatches:
  `npm run compare:codex-side-panels -- --no-fail`
- The generated report is written to `tmp/codex-side-panel-comparison/comparison-report.md` and `tmp/codex-side-panel-comparison/comparison-report.json`.

Scope note: "side panel" in the comparison matrix means the right-side Workbench panel unless a row explicitly says Bottom panel, Left sidebar, or Settings.

## Evidence Used

- Codex app bundle: `/Applications/Codex.app/Contents/Resources/app.asar`, `CFBundleShortVersionString=26.519.41501`.
- Extracted Codex side-panel chunks under `tmp/codex-app-assets`.
- Current Orchestrator full visual inventory: `tmp/side-panel-visual-inventory-current/manifest.json`, 23 captures, no failures, created at `2026-05-26T07:30:11.302Z`.
- Current runnable comparison: `tmp/codex-side-panel-comparison/comparison-report.json`, status `fixture-covered=8`, `aligned=2`, `mismatch=0`, `blocked=0`.
- Current pushed branch: `codex-side-panel-parity-stabilization`.

## 2026-05-26 Visual Pass

Direct live Codex UI inspection through Computer Use is currently blocked by the app safety boundary: `com.openai.codex` is not inspectable from this environment. A macOS `screencapture` route does work for the currently visible Codex window, so live visual checks can use whole-screen screenshots when Codex is on screen. This pass still does not claim full pixel-level side-by-side parity with the running Codex app. It combines the live installed Codex bundle/version, live screenshot evidence where available, the runnable comparison script, and the current Orchestrator 23-surface screenshot inventory.

Live screenshot evidence from 2026-05-26: `/private/tmp/codex-current-screen.png` showed Codex's left sidebar top utility rows as `New chat`, `Search`, `Plugins`, and `Automations`, followed by Pinned, Projects, Chats, and a Settings footer. It also showed the Review right panel using compact Review tabs, a `Last turn` source row, file path header, and compact diff rows.

Reviewed Orchestrator screenshots:

- `tmp/side-panel-visual-inventory-current/workbench-right-panel.png`
- `tmp/side-panel-visual-inventory-current/chat-sidebar.png`
- `tmp/side-panel-visual-inventory-current/review-entry.png`
- `tmp/side-panel-visual-inventory-current/review-source.png`
- `tmp/side-panel-visual-inventory-current/browser.png`
- `tmp/side-panel-visual-inventory-current/terminal-bottom-panel.png`
- `tmp/side-panel-visual-inventory-current/settings.png`

Result: the local surfaces look coherent against the current shared shell primitives, and `npm run compare:codex-side-panels -- --no-fail` reports `fixture-covered=8`, `aligned=2`, `mismatch=0`, `blocked=0`. The real remaining parity risk is not obvious one-off padding or color drift in the current Orchestrator screenshots; it is the set of areas that still need either live Codex screenshot/timing evidence or provider-backed data that fixtures cannot create.

Highest-value next UI/parity work:

1. Browser agent-driven parity: build a real dynamic client-tool bridge for browser-use style requests before claiming provider parity. Manual Browser UI is strong, and server-initiated dynamic tool calls now surface an explicit unavailable status when no bridge exists.
2. Review provider data parity: add one real provider-backed source at a time, especially provider blame or live commented-PR proof. Do not treat local fixture comments as final hosted/cloud parity.
3. Terminal visual parity: capture live Codex bottom-panel height/animation at multiple window sizes if a manual screenshot path becomes available; local Orchestrator terminal layout is smoke-covered but exact Codex timing is not.
4. Settings adapter parity: keep unsupported Host Personalization and remote-host pages explicitly unavailable until real provider adapters exist.
5. Review visual spacing: defer further Review padding/color work unless a live Codex screenshot or a new visual fixture demonstrates a specific mismatch.

## Recently Aligned

| Surface | Codex evidence | Orchestrator state | Follow-up |
| --- | --- | --- | --- |
| Header and panel interaction contract | Live screenshot `/private/tmp/codex-current-screen.png` shows Codex treats sidebar, conversation header, right panel, and bottom panel as coordinated shell surfaces rather than independent stacked panes. Bundle evidence in `app-shell-state-HP0T5lEX.js` and `thread-page-bottom-panel-state-D1Lz0U4Y.js` confirms shared right/bottom shell state and terminal bottom-panel ownership. | The runnable comparison now has a dedicated `Header and panel interaction` row covering `sidebarTopInsetCodexLike=true`, `sessionHeaderInPrimaryColumn=true`, `rightPanelHeaderSeam=true`, and `terminalVisualHealthyContent=true` across `chat-sidebar`, `transcript-narrow`, `workbench-right-panel`, and `terminal-bottom-panel` captures. | Keep all future sidebar, main header, Workbench, and Terminal shell moves under this contract. Exact live Codex pixel spacing and animation timing still need new live screenshot evidence. |
| Header and panel interaction | Live screenshot `/private/tmp/codex-current-screen.png` shows the Codex right-panel/review shell chrome starts in the same compact top band as the conversation header/titlebar rather than below it. | Orchestrator now renders the session titlebar inside the primary chat column while the Workbench right panel remains a sibling in the same session row. Focused right-panel smoke gates `rightPanelHeaderSeam=true`, proving the titlebar, primary content, right panel shell, right panel surface, and right-panel chrome share the same top seam and that the titlebar right edge meets the right-panel left edge. Terminal visual smoke confirms the bottom panel still attaches across the content area after the layout change. | Keep future work to live Codex pixel/timing comparison or a new screenshot-proven mismatch; the structural header/right-panel seam is now smoke-covered. |
| Chat sidebar top inset | Live screenshot `/private/tmp/codex-current-screen.png` shows Codex's first sidebar utility row closer to the window/header band than Orchestrator's previous 64 px spacer allowed. | Orchestrator reduced the left sidebar drag spacer to 48 px, exposes it as `sidebar-window-drag-spacer`, and focused sidebar smoke now gates `sidebarTopInsetCodexLike=true` while preserving 240 px sidebar width, compact rows, and section-order checks. | Keep exact row spacing/pixel comparison open only if a new live screenshot shows measurable drift. |
| Terminal bottom-panel default size | Codex bundle `tmp/codex-app-assets/app-shell-state-HP0T5lEX.js` initializes the shared bottom-panel size signal at `400`, while `thread-page-bottom-panel-state-D1Lz0U4Y.js` keeps Terminal content below shared bottom-panel chrome. | Orchestrator now opens/resets Terminal to 350 px content plus 50 px chrome for a 400 px total bottom panel. The focused Terminal smoke gates that total target through `terminalBottomPanelSizeDecomposition=true`, and the visual smoke captures healthy pipe-backed terminal content at the new size. | Live Codex animation timing remains unverified; keep future work to timing/route-shell ownership unless a new screenshot shows a concrete visual mismatch. |
| Chat sidebar top-level section structure | Live screenshot `/private/tmp/codex-current-screen.png` shows Pinned, Projects, then Chats as top-level sidebar sections after the utility rows. | Orchestrator now renders projectless Chats as a top-level sibling section next to Projects instead of nesting it inside the project group list. The existing "Chats before projects" preference still works, while default screenshot capture is reset to the Codex-like Projects then Chats order for directly comparable visual inventory evidence. | Keep custom-section and user preference behavior covered by focused sidebar smoke, but keep visual inventory captures in default Codex-like order. |
| Global find / Review search | `review-runtime-bridge-CZUIqW4U.js` registers `find-in-thread`, renders `content-search-input`, and provides `Search chat` / `Search diffs` scope buttons. If Browser is the active right-panel tab and the browser webview/right-panel is focused, the command dispatches `browser-sidebar-command` `{ type: "open-find" }`. | Orchestrator now opens a shared floating `content-search-input` for transcript/Review find, exposes `Search chat` and `Search diffs` scopes, routes the diff scope into Review content search/match stepping, keeps Files on workspace file search, and preserves Browser-focused `open-find` routing. The focused right-panel smoke treats `rightPanelFindShortcutRouting=true` as this Codex-style contract, not the older per-panel Review search focus. | Keep live Codex side-by-side comparison for spacing, animation, and focus timing. Keep the smoke contract focused on behavior. |

## Verified Mismatches

| Surface | Codex evidence | Orchestrator state | Next action |
| --- | --- | --- | --- |
| Chat sidebar top actions, width, inset, and section order | Live screenshot `/private/tmp/codex-current-screen.png` shows the Codex sidebar starts with `New chat`, `Search`, `Plugins`, and `Automations` above top-level Pinned/Projects/Chats, measures roughly 240 px wide, and places those utility rows close to the window/header band. | Orchestrator now renders those four top utility rows above the sidebar sections, uses the shared sidebar row primitive, fixes the left sidebar width at 240 px instead of the old 300 px wide desktop layout, reduces the top drag spacer from 64 px to 48 px, and renders Chats as a sibling section after Projects by default. Smoke gates order, placement, behavior, tightened width, top inset, projectless metadata, and the optional Chats-before-Projects preference. | Keep future sidebar visual work anchored in live screenshots; next sidebar gap is provider-backed pin/list mutation semantics or exact row spacing if a new live screenshot shows drift. |
| Review source metadata | Codex review chunks publish host snapshot metrics through `set-review-pane-snapshot-metrics-for-host` and support PR/check/reviewer/comment/blame toolbar/flyout surfaces. | Orchestrator has local and GitHub-backed PR/check/reviewer/general comment plus inline review-thread summary metadata paths. GitHub provider comments can render as read-only per-line cards in Review with fixture coverage, including review-comment commit/blame metadata from real GraphQL `commit` / `originalCommit` fields. Live Codex app-server proof now captures real `turn/diff/updated` events with provider session/turn ids and no checkpoint ids; `thread/rollback` works with `numTurns: 1` for persisted thread history but does not revert the workspace file/git diff. Provider-native hosted/cloud review sources, real working-tree checkpoint restore, and live commented-PR proof remain unavailable. | Keep provider Last turn Undo disabled unless a future provider path restores workspace changes, not just thread history. Implement one provider-backed review source at a time from real provider events or mark unavailable with explicit UI. |
| Browser webview lifecycle | Codex `browser-sidebar-manager-ivre5jEI.js` maintains body-attached hidden/visible webviews keyed by `data-browser-sidebar-conversation-id`, transfers webviews between conversations, and subscribes to browser-use state, viewport, capture surface, cursor, and local-server notifications. `app-server-manager-signals-Csopz8aM.js` also contains `dynamic-tools-for-thread-start-requested`, `dynamic-tool-call-requested`, `item/tool/call`, `capture-browser-use-turn-route`, `browser-use-turn-route-capture`, `browser-use-turn-route-release`, and `codex/browserUse` evidence. | Orchestrator has manager state parsing, body-host webview containment, fork transfer, DOM transfer, and browser-use no-mutation smokes. Fresh live proof through `npm run live:codex-browser-appserver` reaches the real Codex app-server and completes a turn with `session.started`, assistant deltas, and `run.completed`, but it emits zero `browser.manager_state` events, sends no browser/tool server requests, and replies `CODEX_BROWSER_LIVE_NO_BROWSER`; artifact: `tmp/codex-browser-appserver-live-proof/result.json`. If a server-initiated `item/tool/call` does arrive, Orchestrator now emits a visible `Client tool unavailable` assistant status and returns a structured JSON-RPC unsupported-tool error instead of leaving the boundary diagnostic-only. | Treat live browser-use provider proof as blocked at the current stdio app-server client boundary. The next implementation-worthy step is an Orchestrator-owned dynamic client-tool bridge only if we can advertise tools and route calls to the Browser renderer. Keep synthetic no-mutation smoke labeled fixture-only and keep unsupported runtime boundaries user-visible. |
| Browser device presets | Codex presets include responsive 390x844, 4k, laptop-l, laptop, Surface Pro 7, iPad Air, iPad Mini, Surface Duo, iPhone 15 Pro Max, Pixel 8, iPhone 15 Pro, Samsung Galaxy S24 Ultra, and iPhone SE, with 240-4096 width and 160-4096 height clamps. | Orchestrator's `BrowserPanel.tsx` preset dimensions match the Codex set and clamp ranges. The visible label for `laptopLarge` is `Laptop L`; Codex's bundle id is `laptop-l`. | Keep this as lower priority unless a live UI screenshot shows label/order differences. No implementation change needed from the bundle/code comparison alone. |
| Terminal bottom panel | Codex bottom-panel chunk is terminal-specific, uses xterm, terminal service snapshots, session-conversation mapping, `Terminal {index}` fallback titles, font/theme sync, bottom/right move helpers, and a shared bottom-panel size signal initialized at `400`. | Orchestrator has bottom/right terminal movement, shared tab strips, snapshots, theme/font sync, a pipe fallback when `node-pty` fails, and a 400 px total default/reset bottom-panel target. Exact Codex animation timing remains unverified. | Compare live Codex and Orchestrator terminal open/close animation timing when live terminal evidence is available. Keep `--terminal-visual` as screenshot evidence, not timing proof. |
| Files / file source tabs | Codex file-source tabs expose Open file empty state, Open in editor, Copy path, word wrap, rich view, artifact preview, and git blame controls. | Orchestrator has Files and file tabs with source search, previews, fallback notices, actions, selected lines, comments/blame placeholders, and focused smokes. Full artifact renderer parity and provider-backed comments/blame remain incomplete. | Compare artifact renderer controls and provider metadata paths; prioritize document/spreadsheet/slides/PDF parity or provider-backed comments/blame over more local file-tree styling. |
| Settings host scope | Codex has many settings chunks for appearance, general, shortcuts, remote connections, personalization, plugins, skills, usage, worktrees, MCP, hooks, git, and local environments. | Orchestrator has shared settings primitives, route-owned settings, grouped app/host nav, and explicit unavailable boundaries for host-scoped Personalization without adapters. Real remote-host adapters and Codex Personalization data are missing. | Add real host-scoped adapters only where provider data exists; keep explicit unavailable states for unsupported host pages. |
| Chat sidebar provider state | Codex sidebar chunks expose project groups, signals, thread keys, thread list signals, pinned metadata, and provider/worktree metadata paths. | Orchestrator has provider thread-list projection, local pin order, grouping, and sidebar smokes. Live provider pin set/list mutation is still externally blocked through the current app-server bridge. | Find a safe state boundary for provider pin set/list, or keep local pin order clearly scoped as Orchestrator-local behavior. |

## Smoke Harness Assessment

The current smoke setup is valuable but not sufficient for the parity goal.

What it does correctly:

- It launches isolated profiles, seeds deterministic fixtures, and gives repeatable screenshots without touching the user's active app state.
- The 23-surface visual inventory is a useful regression net for broad UI drift.
- Focused flags such as `--diff-core`, `--browser`, `--terminal`, `--settings`, and `--sidebar` keep most failures localized.
- Recent timeout stabilization made the full inventory reliable enough to run after parity slices.

Where it has been holding progress back:

- Some checks can validate Orchestrator's approximation instead of Codex's behavior. `rightPanelFindShortcutRouting` was the clearest example; it has been rewritten to prove the shared thread find bar with chat/diff scope plus special Browser routing.
- The transcript-layout smoke now also asserts the shared `content-search-input`/scope controls instead of the old local `transcript-search` field, so the full inventory and focused right-panel check validate the same find contract.
- Broad smoke failures can look like product parity gaps when the real issue is harness timing or fixture setup.
- Screenshot inventory proves visual regression coverage, not provider-backed semantics.
- Synthetic browser-use and review metadata events prove reducer/UI behavior, not that live Codex/provider sessions emit the same data in the app. The `live:codex-browser-appserver` proof makes this explicit for Browser: the live app-server path works, the Codex bundle contains browser-use client route evidence, but no browser-use surface is exposed to this stdio client in the tested protocol.

Correct trigger model going forward:

1. Use focused smokes while developing a slice.
2. Run the full 23-surface visual inventory only as the final regression net for a stable slice.
3. Add small Codex contract checks only after verifying the behavior in the Codex bundle or live Codex UI.
4. Keep provider/live smokes separate from fixture smokes, and label fixture-only proof as fixture-only.
5. If a smoke assertion conflicts with Codex evidence, change or downgrade the assertion before building more UI around it.
6. For agent-driven Browser, do not treat manual Browser parity or synthetic manager-state smokes as provider parity. A runtime either needs a real dynamic client-tool bridge or an explicit unavailable status when a server requests a client tool.

## Immediate Plan

1. Re-run right-panel and Review focused smokes after each find/search change.
2. Use the full visual inventory only after the focused contract checks pass.
3. For Browser, separate manual Browser panel parity from agent-driven browser-use parity: the Browser panel should stay provider-neutral, while agent-driven browser-use needs a real dynamic tool bridge. Runtimes without that bridge should keep the current explicit unavailable status path.
4. Move to the next provider-backed Review gap only after live proof identifies an actual provider event/API. For checkpoint Undo, `thread/rollback` alone is insufficient because it rolls back history but not the working tree.
5. Keep newly aligned global/thread find under the comparison script so regressions fail directly.
