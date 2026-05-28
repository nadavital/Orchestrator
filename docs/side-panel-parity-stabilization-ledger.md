# Side Panel Parity Stabilization Ledger

Last updated: 2026-05-25

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

- Main chat thread, composer, inspector/context panel, and Settings still need an explicit day-to-day coding usability audit and implementation pass. Codex parity evidence is useful here, but Orchestrator-owned workflow quality is the success bar.
- Inspector/context first pass: Agents is now reachable from the Workbench New tab even before a live subagent exists, and its empty state shows session/runtime context under `workbenchNewTabAgentsAction=true`. Remaining inspector work should focus on deeper selected-event/runtime diagnostics and real coding workflow gaps rather than more empty-state access fixes.
- Codex-style global/thread find parity. Fresh Codex bundle evidence shows `Cmd+F` opens a floating `content-search-input` with `Search chat` and `Search diffs` scope controls, while Orchestrator currently routes `Cmd+F` to per-panel inputs. `rightPanelFindShortcutRouting=true` is therefore a regression check for current Orchestrator behavior, not full Codex parity.
- Live Codex side-by-side visual comparison across the 23-surface inventory.
- Route/window lifecycle and installed-app replacement proof.
- Provider-backed Review checkpoint Undo, cloud/hosted sources, PR metadata, comments, and blame.
- Provider pin mutation and richer hosted/cloud/worktree sidebar reconciliation.
- Live provider-emitted Browser/browser-use proof and non-Codex browser/local-server adapters where available.
- Real remote-host Settings adapters and Codex-style Host Personalization for memory/personality/custom instructions.
- Dedicated accessibility audit for keyboard-only traversal, focus restoration, screen-reader labels, and reduced motion.
- Deep Office/PDF renderer work remains tracked, but it is Phase 2 unless a coding workflow depends on it.

See `docs/codex-side-panel-live-comparison.md` for the current surface-by-surface Codex evidence and smoke-harness assessment.
