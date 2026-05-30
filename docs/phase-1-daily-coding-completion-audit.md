# Phase 1 Daily Coding Completion Audit

Date: 2026-05-29
Branch: `codex-side-panel-parity-stabilization`
Checkpoint proof: local final gates refreshed on 2026-05-29

This checkpoint exists to prevent Phase 1 from drifting into low-value parity polish. The goal is day-to-day coding readiness in Orchestrator, with Codex used as a maturity reference rather than an endless source of pixel or renderer backlog.

## Current Readiness

- Local daily-coding workflows are roughly 85-90% of the Phase 1 target after the final local proof gates passed.
- The full Phase 1 objective is roughly 75-80% complete because provider-backed data, non-Codex lifecycle proof, and live Codex evidence boundaries remain.
- The current side-panel comparison has no executable local mismatches in the refreshed 27-capture inventory, but it still reports remaining parity gaps that are mostly live Codex UI proof, provider adapters/proof, runtime signal, and renderer fidelity.
- The high-risk work is no longer another local action-status or copy-button pass. It is proving the app as a coherent coding tool across app shell, chat/composer, Git/Review, Browser, Terminal, Settings, and provider lifecycle boundaries.

## Must Fix Before Calling Phase 1 Daily-Use Ready

1. Completion proof gates passed on 2026-05-29:
   - `npm run build`
   - `npm run test:providers`
   - `npm run smoke:visual:side-panels -- --out tmp/side-panel-visual-inventory-current --full` with 27/27 captures passing.
   - No additional packaged shell/settings check was required for this harness-only final-gate stabilization slice.
2. Git PR readiness has the required product pass as of this checkpoint: the app opens the hosted GitHub compare/create route only when the branch is known published, and otherwise exposes/copies the exact `git push -u <remote> <branch>` command.
   - Follow-up: the Git Pull Request card now also consumes hosted GitHub PR metadata directly, shows `View pull request` when metadata is available, and can refresh that metadata without requiring the user to open Review first.
   - Follow-up: the Review metadata strip now has its own forced hosted-metadata refresh so checks, reviewers, comments, and provider inline review data can update from Review without a panel reload.
   - Follow-up: Git now has an explicit authenticated `gh pr create` action gated on published branches, while unpublished branches continue to surface the safe push command first.
3. Provider lifecycle boundaries must stay explicit. Codex app-server send/resume/continue/retry/approval/model-switch paths have live proof, but non-Codex provider lifecycle proof and deterministic live non-command permission/user-input fixtures remain open. Do not implement speculative adapters; prove or clearly mark the boundary.
4. Settings must stay honest about provider/account/runtime adapters. Local settings, personalization, browser policy, provider config, shortcuts, worktrees, automations, and data-control flows have smoke coverage. Provider-native account/runtime sync and real remote-host pages remain known adapter gaps.
5. Header, right Workbench panel, bottom panel, and route/window focus behavior must pass together in the final visual/contact-sheet check. The user explicitly observed that panels can pass individually while still feeling unlike Codex when they meet the header incorrectly.

## Accept As Good Enough For Phase 1 Unless New Evidence Shows A Break

- More local copy, add-to-chat, terminal-draft, row-action, and status affordances across Files, Review, Browser, Terminal, Settings, transcript cards, and side chat.
- More DOCX/XLSX/PPTX/PDF rendering fidelity unless a coding workflow depends on it.
- Exact Codex pixel spacing, animation timing, or live screenshot parity while current capture routes produce black or unavailable Codex screenshots.
- Additional bottom-panel tab kinds beyond Terminal and Plan unless there is a clear coding workflow demand.
- More broad smoke runs for tiny diffs when `smoke:ui:changed:*` selects a focused target.

## Phase 2 Backlog

- Deep Office/PDF fidelity: pagination, comments/revisions, advanced workbook/slide editing, chart/object selection, persisted edits, and PDF annotations beyond the lightweight coding-use controls.
- Provider-native hosted Review data: PR comments, blame, checkpoint Undo, hosted/cloud sources, and authenticated PR submission metadata.
- Provider-native Browser/browser-use event streaming and provider-applied visual changes where available.
- Non-Codex provider adapters once real events/APIs are available for Claude, Cursor, Copilot, or another runtime.
- Broader accessibility audit beyond the many focused keyboard/status gates already covered.

## Next Slice

The final local proof gates are clean. Next Phase 1 work should not be another local copy/status/action polish loop. The remaining high-value work is:

- Provider-backed proof where deterministic live evidence exists, especially non-Codex provider lifecycle boundaries.
- Hosted/native Review data such as PR metadata/actions, comments, blame, hosted sources, and checkpoint Undo.
- Live Codex UI screenshot/proof boundaries only when the app/browser can produce nonblank comparable captures.
- A real day-to-day dogfood pass across app shell, chat/composer, Browser, Terminal, Git/Review, Settings, and side chat, filing only workflow breaks that block coding use.
