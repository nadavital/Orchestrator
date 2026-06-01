# Orchestrator Design Language Audit

Date: 2026-05-31
Branch: `codex-side-panel-parity-stabilization`

## Goal

Bring Orchestrator closer to Codex's app language: quiet dense work surfaces, low-border shell structure, compact controls, clear panel hierarchy, hover-revealed secondary actions, and settings that read as navigable rows instead of nested admin cards.

This audit is screenshot-grounded from the current Orchestrator renderer. Live Codex pixel capture is still not available from the automated harness, so the comparison baseline is the Codex desktop design behavior observed in daily use and the existing repo parity notes: continuous canvas, subdued separators, compact icon controls, calm menus, and settings grouped as readable rows with limited card chrome.

## Evidence Captured

Current screenshots:

- `tmp/design-language-audit-current/workbench-right-panel.png`
- `tmp/design-language-audit-current/header.png`
- `tmp/design-language-audit-current/files.png`
- `tmp/design-language-audit-current/browser.png`
- `tmp/design-language-audit-current-focused/settings.png`
- `tmp/design-language-audit-current-focused/settings-providers.png`
- `tmp/design-language-audit-current-focused/side-chat.png`
- `tmp/design-language-audit-current-focused/composer.png`
- `tmp/design-language-audit-current-focused/capabilities.png`
- `tmp/design-language-audit-current-focused/terminal-bottom-panel.png`

The focused visual inventory produced usable screenshots for all required surfaces. Two checks still fail by assertion while producing screenshots: provider settings and terminal bottom-panel decomposition.

## Codex-Language Principles To Apply

1. Continuous workspace canvas: shell areas should feel related, with subtle dividers only where resize or ownership matters.
2. Low chrome by default: reduce hard borders, double separators, and boxed controls in favor of spacing, type weight, and one active state.
3. Compact repeated controls: tabs, menus, settings rows, and toolbars should have stable dimensions and not reserve empty width.
4. Progressive disclosure: secondary controls should reveal on hover/focus or live inside menus instead of being persistently visible.
5. Settings as readable rows: settings pages should have a narrow information hierarchy with grouped rows, not large nested cards.
6. Panel parity: bottom and side panels should share tabs, toolbar density, and transfer affordances where the workflow supports it.
7. Scalable surfaces: new capabilities, plugins, automations, and inspector panels should use the same row, header, menu, and popover grammar.

## Findings

| Surface | Current Evidence | Gap Against Codex-Language Target | Priority | Fix Direction |
| --- | --- | --- | --- | --- |
| Left sidebar and main shell | `workbench-right-panel.png`, `header.png`, `terminal-bottom-panel.png` | The sidebar reads as a darker slab with a visible two-tone edge; center and panel are divided by multiple hard lines. | P0 | Unify shell background tokens, use one low-alpha divider for panel ownership, remove slab-like sidebar edge. |
| Traffic-light/titlebar zone | `workbench-right-panel.png`, `header.png` | Content starts close to the native titlebar area and top controls compete with panel/title content. | P0 | Increase top drag/titlebar reserve and align first interactive row under it across shell/sidebar/panels. |
| Composer | `workbench-right-panel.png`, `composer.png`, `terminal-bottom-panel.png` | Persistent badges, large bordered container, and visible provider chips make the composer busier than Codex's calmer input area. | P0 | Make the base composer quieter, soften border/shadow, collapse secondary labels, keep details in compact controls/popovers. |
| Right Workbench panel | `workbench-right-panel.png`, `side-chat.png`, `browser.png` | Panel tab strip is visually heavy and close buttons can still overlap icon/title regions in some smoke states. | P0 | Fix tab close placement from the tab start/label area, tighten width logic, and reduce tab chrome. |
| Bottom panel | `terminal-bottom-panel.png` | It still presents as terminal-first. Toolbar has many persistent icons and decomposition smoke fails. | P0 | Continue moving to shared workbench tab/toolbar primitives and allow non-terminal transfer targets where supported. |
| Settings main | `settings.png` | Navigation is workable, but the content area is sparse and still uses heavy controls in a large modal-like shell. | P1 | Keep left nav, reduce top border weight, align content width, make rows feel like grouped settings, not a form floating in blank space. |
| Settings providers | `settings-providers.png` | This is the strongest clutter regression: many chips, rows, borders, mini-cards, and status badges compete in one scroll. | P0 | Split into quiet row groups, lower borders, turn capability/status diagnostics into compact disclosure sections, reduce chip contrast. |
| Plugins/capabilities | `capabilities.png` | New-tab/capability entrypoints are list-like and usable, but not yet visually differentiated from generic workbench choices. | P1 | Reuse compact list rows and move advanced capability detail into the side panel without extra card borders. |
| Automations | Current app route and prior regression list | Automations now has a standalone main entry but still has settings legacy concerns to remove/keep out. | P1 | Ensure no settings nav duplication; keep automations as main workflow surface with shared page header/list rows. |
| Inspector/plan/environment/git/review/files/browser | `files.png`, `browser.png`, `workbench-right-panel.png` | These are functional but visually inconsistent: diff cards, file tabs, browser toolbar, and environment rows each use slightly different border/toolbar language. | P1 | Consolidate shared row/header/menu primitives and reduce border contrast across panels. |
| Menus/popovers/dialogs | `composer.png`, provider settings screenshot | Popovers use thick panel borders and stacked row separators; some menu/submenu states risk double scrolling. | P1 | One scroll owner per popover, softer material, compact row height, hover/focus active states. |
| Side chat | `side-chat.png` | Side chat regained function, but the panel material is still too solid and visually merges with main chat unless divided by a hard line. | P0 | Restore translucent/frosted side-chat material while preserving legibility; use subtle separator and local composer style. |
| Animations | Existing motion spike and visual feel | Motion is tokenized in places but still feels sluggish/inconsistent across panel open, popovers, and row reveal. | P2 | Apply shared durations/easing to panels, menus, disclosures, and hover reveal; keep reduced-motion path intact. |

## First Implementation Chunks

1. Shell and surface cleanup: fix sidebar two-tone edge, reduce hard dividers, restore a calmer side-chat material, and lower global panel chrome.
2. Settings cleanup: provider/settings rows, chip groups, status diagnostics, and topbar/nav hierarchy.
3. Composer cleanup: quieter base composer and provider/model popover density.
4. Panel parity cleanup: tab widths/close placement and bottom-panel non-terminal transfer affordances.
5. Menu/popover cleanup: one scroll owner, compact rows, softer material, and shared section dividers.

## Verification Contract

Each chunk should include:

- Fresh screenshot capture for touched surfaces under `tmp/design-language-audit-*`.
- Targeted smoke for touched surfaces, with any failing assertion listed by name.
- `npm run build`.
- Focused git commit and push before the next chunk.
- Reinstall `/Applications/Orchestrator.app` after a visual chunk intended for dogfood.

## Progress Log

- `d6e9f00` created this audit and baseline evidence list.
- `a10b8f8` reduced shell/sidebar/panel chrome, restored softer side-chat material, quieted composer shell controls, and lowered settings/provider border contrast. Verified with `tmp/design-language-audit-after-shell-final`; `npm run build` passed. Remaining failures: right-panel tab visibility/close-edge assertions, composer smoke still expects the older verbose context-chip contract.
- Current tab chunk removes always-reserved hidden close-button width from shared panel tabs and strengthens active-tab scroll handling. Verified with `tmp/design-language-audit-after-tabs` and `tmp/design-language-audit-after-tab-scroll`; `npm run build` passed. Remaining failures: active tab still does not scroll into view after a synthetic right-panel resize, close-edge expectation remains false, and terminal visual decomposition remains false.
