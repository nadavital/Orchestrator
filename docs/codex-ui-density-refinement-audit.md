# Codex UI Density Refinement Audit

Last updated: 2026-06-02

This is the current, worktree-local gap list for making Orchestrator feel closer to Codex across the main app surfaces. It is based on a fresh full dev visual inventory from the `codex/agent-threads` worktree plus the existing Codex bundle comparison, not only the older parity notes.

Fresh evidence:

- Comparison report: `tmp/codex-side-panel-comparison-agent-threads-final2/comparison-report.md`
- Visual inventory manifest: `tmp/side-panel-visual-inventory-agent-threads-final2/manifest.json`
- Contact sheet: `tmp/codex-side-panel-comparison-agent-threads-final2/header-panel-contact-sheet.html`
- Screenshot set: `tmp/side-panel-visual-inventory-agent-threads-final2/*.png`
- Focused Agent Threads smoke after first row-density change: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-agent-inspector-1780353512131.json`
- Focused plan/Agent Threads smoke after current hero/list re-scope: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-plan-1780357485394.json`
- Focused Provider Settings smoke after dialog/editor re-scope: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-settings-providers-1780357602134.json`
- Focused Review Last Turn smoke after source-stats and split-view density fixes: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-diff-last-turn-1780357732401.json`
- Focused transcript layout smoke after transcript/composer column alignment: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-transcript-layout-1780358497551.json`
- Focused composer smoke after compact menu and provider/model re-scope: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-composer-1780358992551.json`
- Fresh live Codex screenshot attempt with nonblank window/screen captures: `tmp/codex-side-panel-live-gap-verification/comparison-report.json`
- Focused header smoke proof: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-header-1780365750233.json`
- Focused right-panel smoke proof, with remaining overflow failures: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-right-panel-1780365766913.json`
- Focused Review core smoke proof: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-diff-core-1780365796305.json`
- Focused Workbench new-tab smoke proof: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-workbench-new-tab-1780365823368.json`
- Focused sidebar smoke proof, with remaining menu/tooltip/action failures: `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-sidebar-1780365848443.json`
- Codex pinned-thread app-server proof: `tmp/codex-pinned-threads-live-proof/result.json`
- GitHub hosted Review metadata proof for PR #7: `tmp/github-review-metadata-live-proof/result.json`
- Codex Review app-server diff/checkpoint proof: `tmp/codex-review-appserver-live-proof/result.json`
- Codex Browser dynamic-tools proof: `tmp/codex-browser-tools-live-proof/result.json`

Branch/base note:

- `codex-side-panel-parity-stabilization` is already an ancestor of the current `codex/agent-threads` branch, via merge commit `293261b6` / PR #6. Do not redo that older side-panel/tab/settings/composer density work before checking whether a gap below is still present.
- `main` and `origin/main` were verified on 2026-06-01 at `46a437e6 Merge codex/provider-refresh`, which includes `c07abb80 Polish Codex-style composer actions`. This `codex/agent-threads` PR branch was then rebased onto that `main`.
- The previous parallel UI thread (`019e6a60-2ddc-7542-b22c-212279d723f0`) landed through `codex/provider-refresh`. Its work touched Codex-style transcript/composer behavior, including thinking indicator, jump-to-latest, and composer spacing. Treat those changes as the baseline, not work to redo.
- Regenerate the comparison artifacts before taking screenshots as proof. The paths above are the current worktree evidence after the `46a437e6` baseline plus the agent-thread UI smoke/density fixes.

The original comparison could not prove exact live Codex pixel parity because the live Codex screenshot route did not provide a nonblank screenshot in that environment. Follow-up verification below captured a nonblank Codex window, but exact pixel/timing parity still needs explicit side-by-side measurement. Treat this document as a concrete Orchestrator refinement queue, not a full Codex parity certificate.

## Current Result

The final refreshed comparison completed with:

- 28 visual captures.
- 0 comparison mismatches and 0 local implementation gaps.
- 3 `needs-smoke` rows: `Header and panel interaction`, `Right-side Workbench shell`, and `Global find / Review search`. These are caused by broader smoke infrastructure failures (`chat-sidebar`, `workbench-new-tab`, `review-core`) and missing live Codex proof, not by the agent-thread/composer/provider/settings changes in this slice.
- 1 needs-proof row: `Review provider metadata`.
- 4 blocked rows: Browser runtime events, Terminal timing, Files artifact/provider metadata, and Chat sidebar provider pin contracts.
- 19 remaining parity gaps, all classified by the comparison as live-proof, provider-contract, provider-proof, runtime-signal, or Phase 2 renderer work.
- The previously failing local captures from this audit are now green in focused smoke and in the final full report: `review-last-turn`, `settings-providers`, `plan`, `composer`, and `transcript-narrow`.

Important nuance: the refreshed comparison still cannot prove exact live Codex pixel parity by itself. Treat remaining live-Codex rows as proof gaps, not as license to add fallback UI or visible unavailable clutter.

Follow-up verification on 2026-06-02 narrowed this: the live Codex screenshot route now captured a nonblank Codex window and screen, so optional file evidence failures are gone for that run. Exact pixel/timing parity is still not proven because the report does not yet do an automated side-by-side measurement against the captured Codex window.

## Verified Gap Status

| Gap | Current verification result | Evidence | Next action |
| --- | --- | --- | --- |
| Header and panel interaction | Header smoke is green. Sidebar density is green, but sidebar menu/tooltip/action workflow assertions still fail locally. Live Codex screenshot capture now works, but exact side-by-side pixel/timing parity is not measured. | `--header`; `--sidebar`; `tmp/codex-side-panel-live-gap-verification/comparison-report.json` | Fix sidebar action-menu/tooltip workflow failures, then add side-by-side live Codex measurement if exact pixel parity is required. |
| Right-side Workbench shell | Workbench new-tab focused smoke is green. Right-panel smoke finds real overflow issues: active tab is clipped after resize and fade-mask state does not indicate clipped tabs. | `--workbench-new-tab`; `--right-panel` | Fix tab overflow visibility/fade-mask behavior before calling Workbench shell fully locally verified. |
| Global find / Review search | Review core focused smoke is green, including shared find/diff routing. The full report's `review-core` failure is likely broad-suite infrastructure or ordering fragility. | `--diff-core` | Keep focused Review core as the local regression proof; stabilize broad full-suite ordering separately. |
| Chat sidebar provider pin mutations | Codex app-server currently supports `thread/list`, but rejects `list-pinned-threads`, `set-thread-pinned`, and `set-pinned-threads-order` as unknown variants. | `npm run live:codex-pinned-threads` | Keep Codex provider pin mutations read-only until the app-server exposes list/set/order methods or equivalent metadata mutations. |
| Hosted Review metadata and commented PR proof | GitHub hosted PR metadata is authenticated and passes for PR #7, but `commentedProof=false` because this PR has no issue or review-thread comments. | `npm run live:github-review-metadata` | Use `npm run live:github-review-metadata:comments` against a safe commented PR before claiming commented-PR rendering proof. |
| Codex Review diff/checkpoint metadata | Live Codex app-server emits `diff.updated` events and local `thread/rollback` by `numTurns:1` succeeds, but no checkpoint IDs are emitted. | `npm run live:codex-review-appserver` | Treat local turn rollback as verified; keep provider-history checkpoint rollback deferred until checkpoint IDs or provider history semantics are exposed. |
| Browser dynamic tools/runtime events | Codex app-server can request real Browser dynamic tools and complete open/read/click/type/screenshot/fill/key/select/check/scroll round trips. Native browser runtime event count is still zero. | `npm run live:codex-browser-tools` | Keep Browser tool bridging verified; keep native browser-use event streaming as unavailable until runtime events are emitted. |

## Cross-Surface Gaps

| Priority | Surface | Concrete gap | Evidence | Change target |
| --- | --- | --- | --- | --- |
| Done | Visual verification for this slice | The old audit used stale captures where `transcript-narrow` landed on Settings Shortcuts and several assertions reflected pre-provider-refresh UI. | Final report `tmp/codex-side-panel-comparison-agent-threads-final2/comparison-report.md`; focused `--transcript-layout` smoke. | The transcript capture is now a transcript state, and the local slice has 0 mismatches. Remaining `needs-smoke` rows are broader infrastructure/live-proof work. |
| Done | Composer smoke | The old composer smoke expected stale segmented active-thread controls and failed permission/provider/model checks. | Focused `--composer` smoke and final `composer.png`. | The smoke now exercises the compact permission menu, menu material, provider/model drill-in rows, selected Sonnet/Codex state, send-status recovery, and regeneration wiring. |
| Done | Provider settings smoke | Provider Settings failed `settingsProviderConfigEditorShared` because the smoke searched outside the details dialog and did not allow the legitimate redacted-secrets warning state. | Focused `--settings-providers` smoke and final `settings-providers.png`. | The smoke now scopes editor assertions to `provider-details-dialog`, records editor debug state, and accepts warning tone only when the status explicitly says secrets are redacted. |
| Done | Review Last Turn smoke | Review Last Turn used the all-source diff stats in the header even when Last Turn content was active, and the chat side duplicated a large changed-file list beside the Review panel. | Focused `--diff-last-turn` smoke and final `review-last-turn.png`. | Header counts now use the active review source, Last Turn shows `+1` for the focused file, and the primary chat side compacts/hides duplicate Review detail when the right Review panel is open. |
| Done | Plan/Agent Threads smoke | The old smoke asserted removed stat-label test ids instead of the current Agent Threads hero/list contract. | Focused `--plan` smoke and final `plan.png`. | The smoke now verifies the Codex-adjacent Agent Threads hero, active/total metadata, a Codex row, calm row status, and provider-neutral transcript availability. |
| Done | Message editing and forks | Editing a previous user message was routed through local fork creation, and forks from pinned chats inherited local pinned state. | Focused transcript smoke guards `chatUserMessageEditToDraft` and `chatMessageForkStartsUnpinnedFromPinnedSource`. | Editing seeds the current composer without switching chats; explicit forks from pinned source chats start unpinned unless the user pins them. |
| Partially done | Main shell empty state | New-chat/empty state still feels more vertical and prompt-centered than Codex in some states. | `header.png`; final report has no local implementation gap for this slice. | No broad hero rewrite was made in this pass. Keep this as future design polish once live Codex proof is available or a specific product target is chosen. |
| Done | Composer/transcript column density | Before this pass, the transcript column and composer column had visibly different horizontal starts. | Focused `--transcript-layout` smoke and final `transcript-narrow.png`. | Transcript padding now aligns the transcript column with the composer column; compact menu rows expose provider-neutral selectors and pressed state for future smoke coverage. |
| Done | Agent Threads rows | The selected thread row was readable but too card-like in the earlier audit. | `plan.png`, live Agent Threads smoke, focused `--agent-inspector`, focused `--plan`. | The first row-density pass is preserved and now has broader Plan/Agent Threads smoke coverage. Continue only with live Codex or user-visible duplication evidence. |
| Partially done | Provider details dialog | Provider details is now smoke-stable, but the dialog can still be simplified visually into everyday status plus disclosure-backed diagnostics. | `settings-providers.png`; focused `--settings-providers`. | This pass fixed correctness/verification. Deeper visual simplification remains a future density pass, not a blocker for this PR. |
| Done | Review split view | The main chat side showed a large changed-file preview while the Review panel owned the detailed diff. | Focused `--diff-last-turn`; final `review-last-turn.png`. | Primary content now exposes right-panel state and applies compact Review summary styling when the Review panel is open. |
| Deferred | Modal/dialog captures | Some broad full-smoke failures are still modal/interaction infrastructure states rather than clean reference screenshots. Focused `workbench-new-tab` and `diff-core` now pass, so their old full-suite failures should be treated as broad-suite fragility unless they fail again focused. | Final report failures: `workbench-new-tab`, `environment`, `review-empty`, `review-loading`, `review-core`, `terminal-behavior`; focused `workbench-new-tab` and `diff-core` green. | Split baseline and modal interaction captures in a separate smoke-infrastructure pass. Do not treat focused-green captures as open agent-thread UI regressions. |
| P2 | Settings general density | Main settings mostly passes, but shortcuts/settings table rows are still larger and more admin-like than Codex utility rows in narrow captures. | `transcript-narrow.png` accidentally landed on Shortcuts. | Audit Settings rows with a clean Settings-specific capture: row height, icon size, shortcut chip size, and edit/delete affordance density. |
| P2 | Files/artifacts | Local Files passes, but full Codex-grade XLSX/PPTX/PDF/DOCX renderer fidelity is still deferred. | comparison `Files and file source tabs` blocked row. | Keep Phase 1 file/source controls stable; treat advanced artifact canvas fidelity as Phase 2 unless a coding workflow depends on it. |
| P2 | Browser | Browser UI passes current local smoke, but native browser-use runtime events and exact Codex pixel/timing proof are not available. | comparison `Browser webview lifecycle` blocked row. | Do not add placeholder UI. Keep provider/runtime unavailable states explicit until native events exist. |
| P2 | Terminal | Terminal behavior and layout pass local smoke, but exact Codex open/close timing is not live-proven. | comparison `Terminal bottom panel` blocked row. | Leave local layout alone unless live Codex timing/pixel evidence shows drift. |
| P2 | Sidebar provider state | Sidebar density passes, but live Codex pinned-thread mutations and non-Codex provider pin contracts remain unavailable. | comparison `Chat sidebar provider state` blocked row. | Keep provider-projected pin mutations read-only until safe list/set/order contracts exist. |

## Implementation Order

1. This PR branch is already rebased onto `46a437e6 Merge codex/provider-refresh`.
2. The message-edit and pinned-fork behavior is implemented and smoke-guarded.
3. The old local P0 captures are stabilized: `composer`, `transcript-narrow`, `review-last-turn`, `settings-providers`, and `plan`.
4. The first density pass is applied for transcript/composer alignment, Agent Threads smoke coverage, and Review split-view duplication.
5. Next local work should fix the now-verified right-panel tab overflow/fade-mask failures and the sidebar action-menu/tooltip/action workflow failures.
6. Next smoke-infrastructure work should stabilize broad full-suite failures that pass focused (`workbench-new-tab`, `review-core`) and still investigate the unfocused broad failures (`review-loading`, `environment`, `review-empty`, `terminal-behavior`).
7. Next proof work should use the now-working live Codex capture route for side-by-side measurement of exact header, Workbench, Browser, Terminal, and sidebar pixel/timing parity.
8. Next provider work should be real contracts for provider-native Review metadata, hosted/cloud Review sources, checkpoint IDs/provider-history rollback, browser-use runtime events, artifact metadata, and pinned-thread mutations.

## Provider-Agnostic Boundary

Do not fill Codex-only gaps with fallback UI. For providers that do not expose native thread, pin, review, browser-use, or artifact metadata contracts, the UI should remain unified and capability-gated:

- Show the shared surface only when it has useful provider-neutral content.
- Hide unavailable provider-specific actions instead of adding disabled clutter.
- Put unavailable/proof-needed details in docs or diagnostics, not in the primary daily UI.
- Prefer disclosure-backed diagnostics over always-visible inspector/admin sections.
