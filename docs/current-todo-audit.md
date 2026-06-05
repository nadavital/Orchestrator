# Current TODO Audit

Date: 2026-06-04
Branch checked: `codex/provider-sdk-integration`

This is a cleanup checkpoint for deciding which Orchestrator TODOs are still real after the recent provider-settings, sidebar, Copilot, chat, and hover-chip work. It is intentionally shorter than the historical parity ledgers; use it as the current triage entrypoint before opening the larger docs.

## Evidence Checked

- Source TODO search: `rg -n '\b(TODO|FIXME|XXX|HACK)\b' src scripts package.json docs`.
- Broad doc/status search: `rg -n 'In progress|Remaining work|Remaining slices|TODO|FIXME|Open questions|Next steps|Known issue|not yet|still' docs src scripts package.json`.
- Phase 1 status reporter: `npm run smoke:ui:phase1:status -- --markdown --details`.
- Current local git state: branch is clean and ahead of `origin/codex/provider-sdk-integration`.

## Current Outcome

- There are no active source-code `TODO`, `FIXME`, `XXX`, or `HACK` markers in `src`, `scripts`, or `package.json`.
- The only source hits for `TODO` are fixture payload strings in `src/main/__fixtures__/providers/claude/repo-actions.jsonl`; they are test data, not open work.
- Most remaining "todo" language lives in docs as parity/backlog language. Some is still useful, but several rows were stale after recent implementation work.
- The Phase 1 status reporter currently says local daily-use is not ready only because this worktree has no recent `tmp/` proof manifests or live-proof artifacts. That is an artifact-retention boundary, not fresh evidence of a broken UI.

## Now Completed Or Stale

These items should not be treated as open implementation TODOs unless fresh dogfood evidence contradicts them:

- Hover-chip parity phases 1-4 from `docs/codex-hover-chip-parity-spike.md` are implemented locally: shared tooltip delay/skip-delay handoff, single active tooltip, focus-visible opening, first-visible-frame stable placement, viewport clamping, opacity-only tooltip motion, and removal of global shell icon hover scale.
- The hover-chip proof path is covered by focused header/sidebar/right-panel smoke checks, plus `npm run build` and `git diff --check`.
- The sidebar Chats header cleanup is done: the count was removed, the chevron sits to the right of the label, and the hover action says `New chat`.
- The sidebar chat row hover action now shows Archive directly; chat actions remain available from the context menu.
- Copilot reasoning/status cards are hidden from the main transcript so internal reasoning/status text does not render as a separate user-facing card below the answer.
- The local packaged-app install path is understood: after renderer/main changes, run `npm run pack:mac` before `npm run install:mac` because the installer copies `dist/mac-arm64/Orchestrator.app`.

## Still Real

These are the remaining buckets that still appear justified:

- Provider live proof and adapter parity: Claude, Copilot, Cursor, Codex app-server, and Antigravity still need provider-specific live proof where the SDK/runtime actually exposes structured events, auth state, model catalogs, permissions, tool calls, and lifecycle behavior.
- Copilot quality gap: the current Copilot SDK/runtime integration has improved but still needs specific smoke coverage for streaming deltas, tool-call rendering, permission modes, auth state, and model/effort compatibility.
- Provider Settings cleanup: keep simplifying the page and avoid duplicate model/default controls. The desired steady state is one reorderable visible-model list per provider where the first model is the default, custom models are tagged/deletable, fast-mode variants are toggles, auth is quiet, and endpoint/runtime fields appear only when the provider actually supports them.
- Composer/provider consistency: model ordering and provider defaults should persist into the composer, and provider/model switching should be disabled for an existing conversation when the backing provider thread contract cannot safely switch mid-thread.
- Live Codex UI pixel/timing proof: still blocked until there is manual side-by-side evidence or a nonblank ScreenCaptureKit/screenshot route. Do not convert this into another generic local UI-polish loop.
- Browser runtime-signal proof: Orchestrator has its own Browser bridge, but native provider-emitted browser-use events and provider-applied visual-change signals remain unproven.
- Hosted Review/provider proof: authenticated hosted metadata exists, but commented PR proof, richer PR actions, blame, checkpoint Undo, hosted sources, and provider-backed workspace rollback remain open.
- Phase 2 renderer fidelity: deeper Office/PDF/image artifact editing fidelity remains out of scope for Phase 1 daily coding, but it is still a real later backlog.

## How To Continue

1. For local UI changes, use `npm run smoke:ui:list` and the narrowest focused target first.
2. For broad readiness, regenerate proof in the current worktree with focused daily-coding targets or `npm run smoke:ui:daily-coding -- --full --keep-going`; do not rely on old `tmp/` paths being present.
3. For provider work, start from `docs/provider-integration-runbook.md` and refresh live proof before claiming current SDK behavior.
4. For hover-chip regressions, start from `docs/codex-hover-chip-parity-spike.md`; it now records the completed local implementation and remaining deferred hover-card/pixel-proof boundaries.
