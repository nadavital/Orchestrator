# Codex Side Panel Live Comparison

Last updated: 2026-05-25

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
- Current Orchestrator full visual inventory: `tmp/side-panel-visual-inventory-current/manifest.json`, 23 captures, no failures, created at `2026-05-25T05:42:15.115Z`.
- Current pushed branch: `codex-side-panel-parity-stabilization`.

## Verified Mismatches

| Surface | Codex evidence | Orchestrator state | Next action |
| --- | --- | --- | --- |
| Global find / Review search | `review-runtime-bridge-CZUIqW4U.js` registers `find-in-thread`, renders `content-search-input`, and provides `Search chat` / `Search diffs` scope buttons. If Browser is the active right-panel tab and the browser webview/right-panel is focused, the command dispatches `browser-sidebar-command` `{ type: "open-find" }`. | `App.tsx` routes `Cmd+F` by focused panel. Review focuses `diff-file-search`, Files focuses `workspace-file-search`, Browser opens `browser-find-input`, and Chat opens `transcript-search`. The right-panel smoke currently treats this as passing through `rightPanelFindShortcutRouting=true`. | Replace the Orchestrator-specific per-panel proof with a Codex-style thread find contract: one floating find UI with chat/diff scopes, diff-domain search integration, and Browser-focused `open-find` routing. Until that lands, the smoke is a regression check, not Codex parity proof. |
| Review source metadata | Codex review chunks publish host snapshot metrics through `set-review-pane-snapshot-metrics-for-host` and support PR/check/reviewer/comment/blame toolbar/flyout surfaces. | Orchestrator has local and GitHub-backed metadata paths plus fixture coverage, but provider-native hosted/cloud review sources, checkpoint Undo, provider comments, and provider blame remain unavailable. | Implement one provider-backed review source at a time from real provider events or mark unavailable with explicit UI. Do not expand fixture-only Review work as if it proves hosted parity. |
| Browser webview lifecycle | Codex `browser-sidebar-manager-ivre5jEI.js` maintains body-attached hidden/visible webviews keyed by `data-browser-sidebar-conversation-id`, transfers webviews between conversations, and subscribes to browser-use state, viewport, capture surface, cursor, and local-server notifications. | Orchestrator has manager state parsing, body-host webview containment, fork transfer, DOM transfer, and browser-use no-mutation smokes. Live provider-emitted Codex/browser-use proof is still missing. | Run a live Codex app-server/browser-use proof. Keep existing synthetic no-mutation smoke, but do not treat it as provider parity. |
| Browser device presets | Codex presets include responsive 390x844, 4k, laptop-l, laptop, Surface Pro 7, iPad Air, iPad Mini, Surface Duo, iPhone 15 Pro Max, Pixel 8, iPhone 15 Pro, Samsung Galaxy S24 Ultra, and iPhone SE, with 240-4096 width and 160-4096 height clamps. | Orchestrator's `BrowserPanel.tsx` preset dimensions match the Codex set and clamp ranges. The visible label for `laptopLarge` is `Laptop L`; Codex's bundle id is `laptop-l`. | Keep this as lower priority unless a live UI screenshot shows label/order differences. No implementation change needed from the bundle/code comparison alone. |
| Terminal bottom panel | Codex bottom-panel chunk is terminal-specific, uses xterm, terminal service snapshots, session-conversation mapping, `Terminal {index}` fallback titles, font/theme sync, and bottom/right move helpers. | Orchestrator has bottom/right terminal movement, shared tab strips, snapshots, theme/font sync, and a pipe fallback when `node-pty` fails. Exact Codex height/timing remains unverified. | Compare live Codex and Orchestrator terminal open/close height, target size, and animation timing. Keep `--terminal-visual` as screenshot evidence, not timing proof. |
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

- Some checks validate Orchestrator's approximation instead of Codex's behavior. The clearest example is `rightPanelFindShortcutRouting`, which currently proves per-panel search focus even though Codex uses a shared thread find bar with chat/diff scope and special Browser webview routing.
- Broad smoke failures can look like product parity gaps when the real issue is harness timing or fixture setup.
- Screenshot inventory proves visual regression coverage, not provider-backed semantics.
- Synthetic browser-use and review metadata events prove reducer/UI behavior, not that live Codex/provider sessions emit the same data in the app.

Correct trigger model going forward:

1. Use focused smokes while developing a slice.
2. Run the full 23-surface visual inventory only as the final regression net for a stable slice.
3. Add small Codex contract checks only after verifying the behavior in the Codex bundle or live Codex UI.
4. Keep provider/live smokes separate from fixture smokes, and label fixture-only proof as fixture-only.
5. If a smoke assertion conflicts with Codex evidence, change or downgrade the assertion before building more UI around it.

## Immediate Plan

1. Fix the find/search model first because it is a verified mismatch and the current smoke explicitly masks it.
2. Re-run right-panel and Review focused smokes after the find model is changed.
3. Use the full visual inventory only after the focused contract checks pass.
4. Move to live provider-backed Browser or Review proof next, instead of expanding fixture-only Review work.
