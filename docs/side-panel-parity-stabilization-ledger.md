# Side Panel Parity Stabilization Ledger

Last updated: 2026-05-25

This ledger exists to turn the large Codex side-panel parity worktree into reviewable, durable app progress. Until the current dirty tree is split into commits, pause new parity feature work except for fixes required to make a slice verifiable.

## Current State

- Branch: `codex-side-panel-parity-stabilization`.
- Base: `origin/main` at `ba31ea6 Add sidebar parity handoff notes`.
- Current dirty tree: broad side-panel parity work across shell, terminal, browser, files, sidebar, settings, review, automations, smoke harness, and docs.
- Nothing was staged at the start of this stabilization pass.
- The current Review selected-line action cleanup has passed:
  - `pnpm exec tsc --noEmit`
  - `npm run smoke:ui:auto -- --diff-core`
  - `npm run smoke:ui:auto -- --diff-source`
- Latest Review source evidence:
  - JSON: `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-diff-source-1779685442980.json`
  - Screenshot: `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-diff-source-1779685442980.png`

## Commit Slices

Commit these as separately verified slices where practical.

1. Shared shell, panel, and command primitives.
2. Terminal bottom/right panel parity.
3. Files, file tabs, artifacts, and workspace search.
4. Browser manager and webview parity.
5. Sidebar organization and provider thread metadata.
6. Settings route ownership, page split, and app protocol.
7. Review/diff workspace and local Git controls.
8. Automations model, scheduler, and UI actions.
9. Smoke harness and parity docs.

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

- Codex-style global/thread find parity. Fresh Codex bundle evidence shows `Cmd+F` opens a floating `content-search-input` with `Search chat` and `Search diffs` scope controls, while Orchestrator currently routes `Cmd+F` to per-panel inputs. `rightPanelFindShortcutRouting=true` is therefore a regression check for current Orchestrator behavior, not full Codex parity.
- Live Codex side-by-side visual comparison across the 23-surface inventory.
- Route/window lifecycle and installed-app replacement proof.
- Provider-backed Review checkpoint Undo, cloud/hosted sources, PR metadata, comments, and blame.
- Provider pin mutation and richer hosted/cloud/worktree sidebar reconciliation.
- Live provider-emitted Browser/browser-use proof and non-Codex browser/local-server adapters where available.
- Real remote-host Settings adapters and Codex-style Host Personalization for memory/personality/custom instructions.
- Dedicated accessibility audit for keyboard-only traversal, focus restoration, screen-reader labels, and reduced motion.

See `docs/codex-side-panel-live-comparison.md` for the current surface-by-surface Codex evidence and smoke-harness assessment.
