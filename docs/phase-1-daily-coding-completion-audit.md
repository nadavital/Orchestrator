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
- 2026-05-29 Codex Goal boundary: Orchestrator now keeps Goal useful where it is proven, not where it is guessed. Plan renders live/persisted goal metrics, but live `npm run live:codex-composer-goal` showed `/goal ...` and `/goal clear` emit no app-server goal notifications, so `/goal` is no longer advertised and the Codex Plan clear action is a disabled unavailable boundary. Evidence: `tmp/codex-composer-goal-live-proof/result.json`; focused changed-smoke evidence: `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-plan-1780104674275.json`.
- 2026-05-30 Codex sidebar pinned-thread boundary: `npm run live:codex-pinned-threads` now records a passing provider-backed boundary instead of a stale failing assumption. The current app-server supports `thread/list`, but `list-pinned-threads`, `set-thread-pinned`, and `set-pinned-threads-order` return unknown-variant errors, so Orchestrator keeps provider-projected pinned state read-only until Codex exposes a supported mutation route. Evidence: `tmp/codex-pinned-threads-live-proof/result.json`.
- 2026-05-30 Review Last turn local undo: Last turn Review cards can now reverse-apply the exact provider unified diff locally with `git apply --reverse`, while still marking provider-history checkpoint rollback unsupported. Evidence: focused `--diff-last-turn` smoke `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-diff-last-turn-1780106139173.json` and compiled `gitChanges.test.js` coverage.
- 2026-05-30 Settings host provider handoff: unavailable remote-host Settings pages now offer a direct Provider Settings jump in addition to Local recovery, so a remote host adapter boundary is not a dead end. Evidence: focused `--settings` smoke `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-settings-1780106704811.json`.
- 2026-05-30 hosted Review metadata error boundary: Git/Review metadata refresh now treats true no-PR responses as unavailable but surfaces hosted-provider failures such as GitHub auth/network/API errors instead of silently reporting "No hosted metadata found." Evidence: `gitChanges.test.js` classifier coverage and focused `--workbench-new-tab` smoke `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-workbench-new-tab-1780107163714.json`.

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
6. Milestone validation should use the curated daily-coding smoke runner instead of repeatedly choosing between tiny changed-file smokes and the full side-panel comparison. Use `npm run smoke:ui:daily-coding` for the core app-coding surfaces, `npm run smoke:ui:daily-coding -- --full` for the broader Phase 1 milestone gate, and `npm run smoke:ui:daily-coding -- --only header,composer,browser` when validating a known subset.

## Accept As Good Enough For Phase 1 Unless New Evidence Shows A Break

- More local copy, add-to-chat, terminal-draft, row-action, and status affordances across Files, Review, Browser, Terminal, Settings, transcript cards, and side chat.
- More DOCX/XLSX/PPTX/PDF rendering fidelity unless a coding workflow depends on it.
- Exact Codex pixel spacing, animation timing, or live screenshot parity while current capture routes produce black or unavailable Codex screenshots.
- Additional bottom-panel tab kinds beyond Terminal and Plan unless there is a clear coding workflow demand.
- More broad smoke runs for tiny diffs when `smoke:ui:changed:*` selects a focused target.
- Running the curated daily-coding smoke after every small diff. It is a milestone/dogfood gate, not the routine edit loop.

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
- After the next meaningful app-shell or workflow batch, run `npm run smoke:ui:daily-coding -- --full --keep-going` and use its manifest as the Phase 1 dogfood checklist before deciding whether more local UI work is warranted.

## 2026-05-29 Daily-Coding Smoke Runner

Added `npm run smoke:ui:daily-coding` as the midpoint between tiny changed-files smokes and the full side-panel visual inventory. The core target set covers header/session/composer/transcript/workbench/Review/Files/Browser/Terminal/Settings. The full target set adds permission/user-input, Agent Activity, Environment, provider Settings, and side chat.

Verification: `node -c scripts/run-daily-coding-smoke.mjs`, `npm run smoke:ui:daily-coding -- --list`, `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package-json-ok')"`, and `git diff --check` passed. Focused elevated `npm run smoke:ui:daily-coding -- --only header` passed after the expected sandbox localhost bind failure on the unelevated attempt; daily manifest `/Users/nadav/Desktop/Orchestrator/tmp/daily-coding-smoke/daily-coding-smoke-1780100404708.json`; smoke JSON `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-header-1780100396221.json`; screenshot `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-header-1780100396221.png`.

Full milestone result: elevated `npm run smoke:ui:daily-coding -- --full --keep-going` passed all 17 daily-coding targets with no failed surfaces. Manifest: `/Users/nadav/Desktop/Orchestrator/tmp/daily-coding-smoke/daily-coding-smoke-1780100822131.json`. This is strong local fixture evidence for Phase 1 daily-coding readiness across header/session routing, composer/transcript, permission/user-input, Workbench/Git/Agent Activity, Environment, Review, Files, Browser, Terminal, Settings, provider Settings, and side chat. It does not close provider-backed live gaps or Phase 2 renderer fidelity.

## 2026-05-29 Packaged Daily-Coding Check

Packaged verification found one real daily-coding issue: the Workbench Git pull-request command handoff could append a generated `gh pr create` command to an existing terminal draft when the smoke had already inserted a file path into the active terminal tab. That was a usability bug, not visual polish. The fix opens a fresh terminal tab for the generated PR command while keeping file/path terminal handoffs on the active terminal.

Verification:

- `npm run smoke:ui:changed:static` passed for `src/main/index.ts`, `src/main/terminal.ts`, and `src/renderer/src/components/Session/GitPanel.tsx`.
- `npm run pack:mac` passed and rebuilt `dist/mac-arm64/Orchestrator.app`.
- Elevated `npm run smoke:ui:daily-coding -- --packaged --only workbench-new-tab --verbose` passed after the fix. Manifest: `/Users/nadav/Desktop/Orchestrator/tmp/daily-coding-smoke/daily-coding-smoke-1780101908989.json`; smoke JSON: `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-workbench-new-tab-1780101892520.json`.
- Elevated `npm run smoke:ui:daily-coding -- --packaged --only header,session-switch,composer,workbench-new-tab,browser,terminal --keep-going` passed the original packaged subset that exposed the bug. Manifest: `/Users/nadav/Desktop/Orchestrator/tmp/daily-coding-smoke/daily-coding-smoke-1780102021969.json`.

## 2026-05-29 Daily-Coding Failure Artifact Traceability

The daily-coding runner now extracts nested smoke `outputPath` and `screenshotPath` from both stdout and stderr. This matters because focused smoke failures can print their diagnostic JSON on stderr; without parsing both streams, the manifest can lose the artifact path needed to inspect the actual failed surface. The changed-file planner also runs the runner unit test whenever the daily-coding smoke script changes.

Verification: `npm run smoke:ui:changed:static`, `npm run smoke:ui:daily-coding -- --list`, and elevated `npm run smoke:ui:daily-coding -- --only header` passed. Header manifest: `/Users/nadav/Desktop/Orchestrator/tmp/daily-coding-smoke/daily-coding-smoke-1780102327846.json`.

## 2026-05-29 Claude Provider Boundary Check

Non-Codex provider proof remains unavailable in the current local environment. The Claude live capability harness now runs no-quota probes before structured scenarios and skips quota-using scenarios when the probes show invalid credentials. Current elevated evidence: `claude --version` reports `2.1.51`, Claude resource probes can run, but `claude auto-mode defaults` returns API 401 invalid credentials. The harness therefore skipped `plain`, `file_ops`, `plan_mode`, and `streaming` structured scenarios instead of treating failed auth responses as product behavior.

Artifact: `/Users/nadav/Desktop/Orchestrator/tmp/claude-live-capabilities/_summary/summary.json`.

## 2026-05-29 Provider Settings Auth Diagnostics

Provider Settings now surfaces auth failures found by no-quota provider probes, not only the provider's primary auth command. This keeps the UI honest when a provider can report a local account or version but still fail a safe runtime readiness probe before a real run. The current Claude registry includes `auto-mode defaults` as a no-quota probe, and a probe response such as API 401 invalid credentials promotes the Provider Settings Auth row to an error with the failing probe label.

Verification: `npm run smoke:ui:changed:static` passed TypeScript plus all 77 provider tests, including the new auth-failure parser coverage. Elevated `npm run smoke:ui:changed:smoke` passed the focused Provider Settings smoke after the harness wait was hardened for slower diagnostics; evidence JSON `/var/folders/bj/cxpn19xd78q4k1h9w4c_99700000gn/T/orchestrator-automated-ui-smoke-settings-providers-1780103128372.json`.

## 2026-05-29 Daily-Coding Dogfood Refresh

Elevated `npm run smoke:ui:daily-coding -- --full --keep-going` passed all 17 daily-coding targets again after the provider-auth checkpoint. Manifest: `/Users/nadav/Desktop/Orchestrator/tmp/daily-coding-smoke/daily-coding-smoke-1780103586824.json`. This confirms the local app shell, chat/composer, transcript, permission/user-input cards, Workbench/Git, Agent Activity, right panel, Environment, Review, Files, Browser, Terminal, Settings, provider Settings, and side chat fixtures are currently green.

No local UI failures were exposed by this pass. The remaining Phase 1 work should stay focused on live/provider proof and real dogfood workflow breaks, not another local action/status micro-pass.

## 2026-05-29 Codex Plan Live Proof

Added `npm run live:codex-composer-plan`, an opt-in live Codex app-server proof mode in `scripts/codex-composer-appserver-live-proof.mjs`. It starts a real app-server turn in a disposable workspace, asks Codex to produce a native plan update without shell commands or file edits, and requires an observed `turn/plan/updated` notification plus the final assistant token.

Verification: `npm run smoke:ui:changed:static` passed for `package.json` and the live proof harness. Elevated `npm run live:codex-composer-plan` passed with `planUpdateCount=1`, `commandExecutionCount=0`, model `gpt-5.4-mini`, effort `low`, and artifact `/Users/nadav/Desktop/Orchestrator/tmp/codex-composer-plan-live-proof/result.json`. The recorded plan steps were `Inspect app-server plan surface` and `Record live plan evidence`.
