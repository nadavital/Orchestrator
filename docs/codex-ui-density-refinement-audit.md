# Codex UI Density Refinement Audit

Last updated: 2026-06-01

This is the current, worktree-local gap list for making Orchestrator feel closer to Codex across the main app surfaces. It is based on a fresh full dev visual inventory from the `codex/agent-threads` worktree plus the existing Codex bundle comparison, not only the older parity notes.

Fresh evidence:

- Comparison report: `tmp/codex-side-panel-comparison-agent-threads/comparison-report.md`
- Visual inventory manifest: `tmp/side-panel-visual-inventory-agent-threads/manifest.json`
- Contact sheet: `tmp/codex-side-panel-comparison-agent-threads/header-panel-contact-sheet.html`
- Screenshot set: `tmp/side-panel-visual-inventory-agent-threads/*.png`
- Focused Agent Threads smoke after first row-density change: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-agent-inspector-1780353512131.json`

Branch/base note:

- `codex-side-panel-parity-stabilization` is already an ancestor of the current `codex/agent-threads` branch, via merge commit `293261b6` / PR #6. Do not redo that older side-panel/tab/settings/composer density work before checking whether a gap below is still present.
- `main` and `origin/main` were verified on 2026-06-01 at `46a437e6 Merge codex/provider-refresh`, which includes `c07abb80 Polish Codex-style composer actions`. This `codex/agent-threads` PR branch was then rebased onto that `main`.
- The previous parallel UI thread (`019e6a60-2ddc-7542-b22c-212279d723f0`) landed through `codex/provider-refresh`. Its work touched Codex-style transcript/composer behavior, including thinking indicator, jump-to-latest, and composer spacing. Treat those changes as the baseline, not work to redo.
- Regenerate the comparison artifacts before taking screenshots as proof. The evidence paths below are still useful for context, but they were captured before the `46a437e6` merge commit.

The comparison still cannot prove exact live Codex pixel parity because the live Codex screenshot route did not provide a nonblank screenshot in this environment. The report therefore has `optionalFileEvidenceFailures=2` for the header/panel and Workbench shell rows. Treat this document as a concrete Orchestrator refinement queue, not a full Codex parity certificate.

## Current Result

The full comparison completed with:

- 28 visual captures.
- 3 comparison mismatches: `Header and panel interaction`, `Global find / Review search`, and `Settings host scope`.
- 1 needs-proof row: `Review provider metadata`.
- 4 blocked rows: Browser runtime events, Terminal timing, Files artifact/provider metadata, and Chat sidebar provider pin contracts.
- 19 remaining parity gaps, all classified by the comparison as live-proof, provider-contract, provider-proof, runtime-signal, or Phase 2 renderer work.
- 5 local smoke captures with failing assertions: `review-last-turn`, `settings-providers`, `plan`, `composer`, and `transcript-narrow`.

Important nuance: the comparison says there are no Codex-proven local implementation gaps, but the screenshots and failing local assertions still expose concrete product polish and verification gaps. Those are the changes below.

## Cross-Surface Gaps

| Priority | Surface | Concrete gap | Evidence | Change target |
| --- | --- | --- | --- | --- |
| P0 | Visual verification | Some reference screenshots are not clean surface states. `workbench-new-tab` is captured behind a modal/blurred panel, and `transcript-narrow` ends on Settings Shortcuts rather than a transcript. | `workbench-new-tab.png`, `transcript-narrow.png`; failed `transcript-narrow` checks. | Split visual inventory into clean reference captures and interaction/modal captures. A clean reference screenshot should never include a transient modal unless the surface being audited is the modal. |
| P0 | Composer smoke | The full composer capture failed many active-thread settings assertions: permissions menu, dropdown material, provider/model switch persistence, agent row labels, and send-status recovery. | `composer.log`; failed checks include `composerDropdownMaterial`, `composerSlashPermissionsOpensMenu`, `composerAgentRowLabelsCalm`. | Re-run the focused composer smoke and fix real regressions. If the failures are fixture-state drift, make the smoke enter a deterministic composer state before assertions. |
| P0 | Provider settings smoke | Provider Settings failed `settingsProviderConfigEditorShared`. | `settings-providers.log`, `settings-providers.png`. | Bring the provider config editor path back onto the shared editor/dialog primitive or update the fixture if the shared contract changed intentionally. |
| P0 | Review Last Turn smoke | Review Last Turn failed `reviewLastTurnVisualState`. | `review-last-turn.log`, `review-last-turn.png`. | Fix the visual-state assertion or the UI state that broke it before using Last Turn as a Codex-density reference. |
| P0 | Plan/Agent Threads smoke | Plan failed `planAgentStatLabelsCalm`. | `plan.log`, `plan.png`. | Calm the live-agent stat/label presentation in the Plan/Agent Threads combined state, then update the assertion only if the new visual contract is intentional. |
| P0 | Message editing and forks | Editing a previous user message currently creates a forked chat instead of letting the user actually edit the message in the visible transcript. Forking a pinned chat also appears to make the new fork immediately pinned, which is not the desired sidebar behavior. | User-observed behavior from the Workbench UI; needs fresh smoke coverage after provider-refresh. | Separate edit-in-place from explicit fork creation in the UI model. When a fork is created from a pinned source chat, the new chat should start unpinned unless the user pins it explicitly. Add deterministic smoke coverage for edit and fork-from-pinned behavior. |
| P1 | Main shell empty state | New-chat/empty state still feels too vertically theatrical: centered prompt cluster, large empty area, and a tall composer reserve compete with Codex's quieter working surface. | `header.png`. | Lower the hero-like empty prompt treatment, tighten vertical gap to the composer, and reduce empty composer reserve when no multiline draft or attachments are present. |
| P1 | Composer | Composer is visually large in empty and split-panel states. The review rail plus composer creates two stacked rounded surfaces before real content appears. | `header.png`, `composer.png`, `review-last-turn.png`. | Make the resting composer more compact when the side panel is open or when the draft is empty. Keep the expanded textarea only for multiline draft, attachments, or queued/running states. |
| P1 | Agent Threads rows | The selected thread row was readable but too card-like: strong outline, large vertical row, and repeated title/status metadata made it heavier than Codex thread rows. First pass reduced selected border strength, row padding, summary height, and close affordance width while keeping provider metadata intact. | `plan.png`, live Agent Threads smoke; focused `--agent-inspector` smoke passed after the first row-density change. | Continue with title/detail duplication cleanup after the broader Plan/Agent Threads smoke is green. |
| P1 | Provider details dialog | Provider details still reads like a compact admin report rather than a Codex utility popover/dialog. Grouping is wide, config/capability sections are visually similar, and the dialog consumes a large center area. | `settings-providers.png`. | Narrow or split details into a simpler primary status section plus disclosure-backed diagnostics. Keep everyday provider defaults outside the diagnostics dialog. |
| P1 | Review split view | When Review is open, the main chat side still shows a large changed-file preview and a large composer, so the split screen feels dense and double-framed. | `review-last-turn.png`. | Compact the main transcript's changed-file card when a right Review panel is open. Prefer a slim rail/summary, with detailed diff owned by the Review panel. |
| P1 | Modal/dialog captures | Git dialog and permission approval states visually stack on top of composer/change rail and blurred right panel, producing clutter that is hard to compare with Codex. | `workbench-new-tab.png`. | Treat permission cards, Git dialog, provider details, and menus as separate modal surfaces with their own density pass. Do not use those captures as baseline Workbench screenshots. |
| P2 | Settings general density | Main settings mostly passes, but shortcuts/settings table rows are still larger and more admin-like than Codex utility rows in narrow captures. | `transcript-narrow.png` accidentally landed on Shortcuts. | Audit Settings rows with a clean Settings-specific capture: row height, icon size, shortcut chip size, and edit/delete affordance density. |
| P2 | Files/artifacts | Local Files passes, but full Codex-grade XLSX/PPTX/PDF/DOCX renderer fidelity is still deferred. | comparison `Files and file source tabs` blocked row. | Keep Phase 1 file/source controls stable; treat advanced artifact canvas fidelity as Phase 2 unless a coding workflow depends on it. |
| P2 | Browser | Browser UI passes current local smoke, but native browser-use runtime events and exact Codex pixel/timing proof are not available. | comparison `Browser webview lifecycle` blocked row. | Do not add placeholder UI. Keep provider/runtime unavailable states explicit until native events exist. |
| P2 | Terminal | Terminal behavior and layout pass local smoke, but exact Codex open/close timing is not live-proven. | comparison `Terminal bottom panel` blocked row. | Leave local layout alone unless live Codex timing/pixel evidence shows drift. |
| P2 | Sidebar provider state | Sidebar density passes, but live Codex pinned-thread mutations and non-Codex provider pin contracts remain unavailable. | comparison `Chat sidebar provider state` blocked row. | Keep provider-projected pin mutations read-only until safe list/set/order contracts exist. |

## Implementation Order

1. Confirm the branch is still at or ahead of current `main`. If `main` moved again, rebase first and do not reintroduce pre-merge `ChatView.tsx` or `index.css` assumptions while resolving.
2. Regenerate the full visual inventory so the audit reflects the merged composer/transcript baseline:
   `npm run compare:codex-side-panels -- --run-smoke --full --no-fail --out tmp/codex-side-panel-comparison-agent-threads --smoke-out tmp/side-panel-visual-inventory-agent-threads`
3. Add deterministic coverage for message edit-in-place and fork-from-pinned behavior before changing transcript chrome. These are interaction-model issues and should not be hidden inside visual polish.
4. Stabilize the five failing local captures before broad styling work:
   `composer`, `transcript-narrow`, `review-last-turn`, `settings-providers`, and `plan`.
5. Split screenshot coverage into baseline states versus modal/interaction states. This will make density comparisons trustworthy.
6. Apply the first visual refinement pass:
   compact empty-state/composer vertical rhythm, flatten Agent Threads rows, calm Provider details, and slim changed-file previews when Review is open.
7. Re-run:
   `npm run compare:codex-side-panels -- --run-smoke --full --no-fail --out tmp/codex-side-panel-comparison-agent-threads --smoke-out tmp/side-panel-visual-inventory-agent-threads`
8. Only after the local capture set is clean, attempt fresh live Codex screenshot proof for exact header/panel spacing and animation timing.

## Provider-Agnostic Boundary

Do not fill Codex-only gaps with fallback UI. For providers that do not expose native thread, pin, review, browser-use, or artifact metadata contracts, the UI should remain unified and capability-gated:

- Show the shared surface only when it has useful provider-neutral content.
- Hide unavailable provider-specific actions instead of adding disabled clutter.
- Put unavailable/proof-needed details in docs or diagnostics, not in the primary daily UI.
- Prefer disclosure-backed diagnostics over always-visible inspector/admin sections.
