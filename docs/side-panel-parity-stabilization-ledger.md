# Side Panel Parity Stabilization Ledger

Last updated: 2026-05-28

This ledger exists to turn the large Codex side-panel parity worktree into reviewable, durable app progress. Until the current dirty tree is split into commits, pause new parity feature work except for fixes required to make a slice verifiable.

## Current State

- Branch: `codex-side-panel-parity-stabilization`.
- Base: `origin/main` at `ba31ea6 Add sidebar parity handoff notes`.
- Current dirty tree: broad side-panel parity work across shell, terminal, browser, files, sidebar, settings, review, automations, smoke harness, and docs.
- Nothing was staged at the start of this stabilization pass.
- Product priority has shifted from broad Codex parity closure to day-to-day coding usability. Keep side-panel polish active, but treat deep DOCX/XLSX/PPTX/PDF renderer fidelity as Phase 2 unless it directly blocks coding workflows.
- The current Review selected-line action cleanup has passed:
  - `pnpm exec tsc --noEmit`
  - `npm run smoke:ui:auto -- --diff-core`
  - `npm run smoke:ui:auto -- --diff-source`
- Latest Review source evidence:
  - JSON: `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-diff-source-1779685442980.json`
  - Screenshot: `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-diff-source-1779685442980.png`

## Commit Slices

Commit these as separately verified slices where practical.

### Phase 1: Daily Coding Usability

1. Shared shell, header, panel, route/window, and command primitives.
2. Main chat thread readability, streaming/tool-call states, errors, approvals, retry/continue behavior, and long-thread ergonomics.
3. Composer controls for attachments, context, provider/model/permission selection, keyboard behavior, submit/stop states, and side-chat consistency.
4. Right Workbench side panel polish across Review, Browser, Files/source tabs, Side Chat, and useful inspector/context panels.
5. Terminal bottom/right panel behavior for coding workflows.
6. Sidebar organization and provider thread metadata.
7. Settings route ownership, page split, app protocol, provider/account/runtime/browser/shell preferences, and adapter-backed unavailable states.
8. Browser manager and webview actions that support real app-building flows.
9. Review/diff workspace and local Git controls.
10. Automations model, scheduler, and UI actions where they support coding sessions.
11. Smoke harness and product-usability docs.

### Phase 2: Artifact And Provider Depth

1. Full DOCX layout/style/pagination/comment/revision fidelity.
2. Full XLSX/PPTX canvas, object, editing, chart, formula, and persisted-edit fidelity.
3. Full PDF canvas rendering and provider-backed annotations.
4. Provider-backed artifact comments, blame, and metadata.
5. Non-Codex provider adapters that require real provider contracts rather than local fixtures.

## Mixed Files That Need Care

Do not blindly file-stage these unless the target commit intentionally owns all touched hunks:

- `src/main/index.ts`
- `scripts/run-automated-ui-smoke.mjs`
- `src/types/index.ts`
- `src/renderer/src/store/sessions.ts`
- `src/renderer/src/index.css`
- `src/renderer/src/components/shared/designSystem.tsx`
- `src/renderer/src/App.tsx`
- `src/main/git.ts`
- `src/renderer/src/components/shared/SessionActionsMenu.tsx`
- `docs/codex-side-panel-ui-parity-audit.md`

## Verification Policy

Before committing a slice:

1. Run the narrow unit tests for that slice.
2. Run the focused smoke for that slice.
3. Run `pnpm exec tsc --noEmit`.
4. Run `git diff --check`.
5. Update docs only with evidence that was produced by the current worktree.

Before considering the stabilization complete:

1. Run `npm run build`.
2. Run `npm run test:providers`.
3. Run `npm run smoke:visual:side-panels -- --out tmp/side-panel-visual-inventory-current --full`.
4. Run any packaged checks required by shell/settings changes.

## Remaining Goal Gaps

These remain real goal gaps and should not be claimed complete from local fixture smokes:

- Main chat thread, composer, inspector/context panel, and Settings still need an explicit day-to-day coding usability audit and implementation pass. Codex parity evidence is useful here, but Orchestrator-owned workflow quality is the success bar. Local Personalization Settings now have a first pass with persisted custom instructions/coding preferences and focused smoke coverage; provider Settings now expose existing runtime capability gaps as compact boundaries, shared command-output card chrome, a shared provider-picker surface, a shared model-list manager, and a shared config-editor surface instead of bespoke inline card/chip/editor styling; Appearance Settings now keep color swatches, import controls, and chrome editor controls on shared surface/input chrome; empty-chat starter actions, failed-run retry recovery, tool-failure retry recovery, first-pass assistant continuation, partial-response stopped recovery, queued follow-up cancellation, steering follow-up cancellation, compact active-run queue summaries, first-pass long-thread history/load/find ergonomics, active-thread model/agent/effort composer settings, composer popover trigger ARIA state, composer popover roving keyboard navigation, blocked-send composer status, blocked-send live-region semantics, transcript approval/user-input recovery live regions, side-chat retry/multiline composer behavior, and first-pass side-chat context metadata now have coverage. Remaining main-chat/composer work should target deeper context/permission workflow polish, exact live Codex long-thread timing only when live evidence is available, and real provider-backed retry/continue/partial-continue/model-switching/permission proof; remaining Settings work should target provider-native account/runtime adapters, real remote adapters, and higher-value daily coding workflows.
- Inspector/context first pass: Agents is now reachable from the Workbench New tab even before a live subagent exists, its empty state shows session/runtime context under `workbenchNewTabAgentsAction=true`, runtime issue rows summarize failed/waiting events under `agentRuntimeIssueTriage=true`, issue failures are grouped by cause under `agentRuntimeFailureGroups=true`, recent runtime events can be search-narrowed under `agentRuntimeEventFilter=true`, severity/source facets narrow noisy runtime streams under `agentRuntimeEventFacetFilters=true`, matching runtime events can be selected for a bounded detail payload under `agentRuntimeEventDetail=true`, selected agent tabs now show a compact lifecycle timeline under `agentSelectedTimeline=true`, and raw provider transport output is summarized/redacted under `agentTransportLog=true`. Remaining inspector work should focus on richer provider-backed observability and real coding workflow gaps.
- Extensions panel primitive migration is closed for the current embedded right-panel surface: `/extensions` now exposes shared summary, disclosure, file-row, command-section, command-row, and item-row contracts under `extensionsPanelSharedPrimitives=true`. Remaining Extensions work should be evidence-led provider data/functionality gaps rather than another local chrome pass.
- Codex-style global/thread find parity has first-pass coverage: the shared `content-search-input` with `Search chat` and `Search diffs` scopes is implemented for transcript/Review/file-source search, Browser-focused `Cmd+F` still routes to Browser find, and the comparison script now treats `rightPanelFindShortcutRouting=true` as the Codex-style shared-find contract. Exact live Codex focus timing and pixel spacing remain open.
- Live Codex side-by-side visual comparison across the 23-surface inventory.
- Route/window lifecycle and installed-app replacement proof.
- Provider-backed Review checkpoint Undo, cloud/hosted sources, PR metadata, comments, and blame.
- Provider pin mutation and richer hosted/cloud/worktree sidebar reconciliation.
- Live provider-emitted Browser/browser-use proof and non-Codex browser/local-server adapters where available.
- Real remote-host Settings adapters and Codex-style provider-native Host Personalization for memory/personality/custom instructions. Local Orchestrator personalization is implemented separately and should not be mistaken for provider-native sync.
- Dedicated accessibility audit for keyboard-only traversal, broader screen-reader labels, and reduced motion. First-pass composer popover focus restoration, trigger expanded/collapsed ARIA state, roving keyboard navigation, composer blocked-send live status, transcript user-input sent/error live regions, transcript permission decision/error action semantics, and Browser load-error alert/action-group semantics are now smoke-gated, but this does not close the whole-app accessibility pass.
- Deep Office/PDF renderer work remains tracked, but it is Phase 2 unless a coding workflow depends on it.

See `docs/codex-side-panel-live-comparison.md` for the current surface-by-surface Codex evidence and smoke-harness assessment.
