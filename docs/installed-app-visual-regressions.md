# Installed App Visual Regression List

This list tracks the product-facing visual and interaction regressions found during installed-app dogfooding. It is separate from the broader Codex parity ledger: these are issues visible in the local Orchestrator app that should be judged by manual dogfood plus focused Electron smokes.

## Current Fixes

| Issue | Status | What changed | Verification |
| --- | --- | --- | --- |
| Panel tab widths oscillate between too wide and truncated labels | Fixed in `7dc61fb` | Removed forced active-tab width, made tab close controls participate in layout, and protected short common labels like New tab, Plan, Browser, Git, and Terminal from unnecessary ellipsis. | `npm run smoke:ui:auto -- --terminal`; visual screenshot showed `Terminal 1`, `Terminal 2`, `Browser`, `New tab`, `Plan`, and `Browser` labels without truncation. |
| Bottom panel presents as terminal-only | Improved in `7dc61fb` | Added direct bottom-panel actions for Plan, Browser, Files, Review, and Side chat; terminal-only actions now only show while a terminal tab is active. | `npm run smoke:ui:auto -- --terminal`; gates include `bottomPanelPlanTransfer`, `bottomPanelPlanToolbarAction`, and `bottomPanelOpenTabMenu`. |
| Side-chat panel lost its translucent surface | Improved in `7dc61fb` | Restored frosted/translucent side-chat panel and composer material with blur/saturation. | `npm run smoke:ui:auto -- --side-chat`; visual screenshot still needs manual taste check because dark theme transparency is subtle without content behind the panel. |
| Installed app can lag behind packaged app | Fixed in `c986072` | Installer now cleanly replaces `/Applications/Orchestrator.app`, clears xattrs, ad-hoc signs, and refreshes LaunchServices/Spotlight import. | Installed `app.asar` hash matched packaged `app.asar`; `codesign --verify --deep --strict` passed. |
| Automations appears in both Settings and the main window | Fixed in current design-language pass | Kept Automations as a standalone main workflow and normalized stale Settings `automations` state back to General so Settings navigation/search no longer treats it as a settings page. | `settingsNavigationGroupsForHostKind('local')` excludes `automations`; direct `/settings/automations` route still opens the standalone page. |
| Duplicate vertical scrollbars in chat action menus | Improved in current design-language pass | Removed the extra scroll owner from the session action menu so `MenuSurface` owns scrolling once. | Targeted code inspection plus focused UI smoke/build; manual menu screenshot still useful. |

## Open Regressions

| Issue | Impact | Proposed fix | Proof needed |
| --- | --- | --- | --- |
| Settings pages still feel cluttered compared with Codex | Hard to scan and navigate individual settings sections. | Continue flattening dense cards into Codex-style section rows, reduce repeated borders, group advanced controls behind disclosure, and keep each page to one clear primary column. | Focused `--settings` and `--settings-providers` smokes plus manual screenshots of General, Providers, Worktrees, Browser, and Appearance. |
| Traffic-light controls conflict with content | Window chrome feels misaligned and can collide with header content. | Revisit titlebar safe-area layout, reserve a stable left inset for macOS controls, and verify header actions start after that reserved region. | Header smoke plus installed-app screenshot at narrow and wide widths. |
| Left sidebar has a two-tone vertical edge | Sidebar/main boundary reads like an accidental stripe. | Audit sidebar/content shell backgrounds and remove mismatched adjacent background layers; keep only one intentional separator or none. | Header/sidebar screenshot before and after. |
| Composer feels busier than Codex composer | Primary writing surface has too many visible controls and chips. | Hide secondary controls behind compact menus, keep provider/model/permission state quiet, and reduce persistent badges unless state is actionable. | `--composer` smoke plus manual empty and draft composer screenshots. |
| Side panel content is not usable when bottom panel is expanded | Right panel and bottom panel compete for vertical space. | Add responsive right-panel content compaction when bottom panel height crosses threshold; ensure Files/Browser/Review/side-chat keep usable minimum heights. | `--terminal`, `--right-panel`, `--browser`, `--files`, and manual bottom-expanded screenshot. |
| Git should not be a heavyweight dedicated tab for every workflow | Git surface feels oversized for quick contextual actions. | Move common Git actions into Review/File/Workbench context actions; keep full Git only for explicit branch/status workflows. | `--workbench-new-tab`, `--diff-core`, and manual Git workflow dogfood. |
| New chat route can show `Chat not found` for deleted/stale local folders | Fresh chat flow can fail when orchestrator state references missing local/archive folders. | Harden route-backed session recovery for deleted local folders and stale archived links; fall back to a valid new chat instead of dead route. | `--session-switch` smoke with deleted-folder fixture plus manual new-chat dogfood. |
| Add project can freeze | Project setup can block the app. | Profile add-project path, isolate filesystem scans/import work off the UI path, and add timeout/error state. | Add-project focused manual test plus process/log evidence. |
| App still has too many visible borders and sluggish animations in places | Design language feels heavier than Codex. | Continue removing nested card borders, prefer full-bleed panels/rows, and shorten slow transitions using shared motion tokens. | Manual contact sheet across sidebar, main chat, Workbench, Settings, side chat, and bottom panel. |

## Operating Rule

Do not treat the side-panel parity report as the visual regression list. The parity report is useful calibration, but this list should be updated only from installed-app dogfood, focused screenshots, or a user-visible workflow break.
