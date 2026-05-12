# Orchestrator Agent GUI Completion Spec

Date: 2026-05-08

This is the completion checklist for making Orchestrator a first-class GUI for Claude Code first, while keeping every behavior mapped through provider-agnostic runtime contracts so Codex, Cursor, Copilot, and future CLIs can share the same surface.

Completion means the item is either implemented and verified, or intentionally blocked from automatic execution because it is destructive, mutates provider state, or may spend model quota.

## Runtime And Provider Contracts

- [x] Provider definitions expose shared abstract capabilities for resume, interactive CLI, structured output, stream events, interactive permissions, tool allowlists, workspace sandboxing, full access, and bypass-all behavior.
- [x] Provider registries expose provider-specific features, gaps, no-quota probes, command surfaces, and slash commands without hardcoding Claude-only UI paths.
- [x] Runtime command builders can still represent structured and native interactive CLI lanes, but the normal product path does not ask users to choose between them.
- [x] Claude structured runs map model, effort, permission mode, allowed tools, denied tools, available tools, extra directories, resume session id, and per-run hook settings to native CLI flags.
- [x] Claude structured CLI streaming is the default session path, with a per-run Orchestrator hook bridge for approval UI and the native PTY kept as an escape hatch for true TUI-only flows.
- [x] Provider diagnostics distinguish binary, version, auth, models, usage, live-smoke, and probe readiness without claiming unsupported usage/quota data.

## Claude Code Capability Map

- [x] Plain assistant output is parsed from stream JSON and rendered as assistant text.
- [x] File read, write, edit, and delete tools normalize into shared action descriptors.
- [x] Shell commands normalize separately from file actions and carry command text only in expanded detail.
- [x] Search, list, web, MCP, and unknown provider tools normalize without raw payload noise in the transcript.
- [x] `AskUserQuestion` is rendered as a user-input request, not as a permission prompt.
- [x] `ExitPlanMode` permission denials render as plan approval UI, not as a red tool failure.
- [x] `TodoWrite`, `EnterPlanMode`, and related plan events feed normalized plan state.
- [x] `Task` and `Agent` tools feed Activity agent nodes, including progress and completion summaries.
- [x] Claude slash commands are represented in the provider registry and appear for supported provider features without exposing runtime lanes.
- [x] Claude no-quota command surfaces cover auth status, agents, MCP, plugins, and auto-mode defaults.
- [x] Claude mutating commands, destructive commands, and model-quota commands are blocked from automatic settings execution.
- [x] Live Claude Sonnet smoke verifies the installed local CLI can complete a real run.

## Main Transcript UX

- [x] Assistant rows stay flat and readable.
- [x] Tool activity collapses to concise action counts such as `Wrote 1 file` or `Ran 1 command`.
- [x] Expanded tool activity shows exact targets without dumping provider JSON by default.
- [x] Permission cards summarize requested actions using the same tool vocabulary as transcript activity.
- [x] Plan approval cards use product language: `Approve Plan` and `Keep Planning`.
- [x] User question cards preserve provider choices and custom reply input.
- [x] Raw events stay in Activity/Raw, not in the main transcript.

## Permissions And Safety

- [x] Session permission mode picker maps to provider-native policies.
- [x] Claude allowed tools are persisted in session state and passed to resumed runs.
- [x] Claude denied tools are persisted in session state and passed to native flags.
- [x] Claude available tool sets are persisted in session state and passed to native flags.
- [x] Claude additional directories are persisted in session state and passed to native flags.
- [x] Permission cards support `Allow Once`, which resumes with a one-time allowlist and does not mutate session settings.
- [x] Permission cards support `Allow Session`, which persists the grant and resumes.
- [x] Permission cards support denial without confusing it with user-input replies.
- [x] Claude headless tool approvals resolve through the Orchestrator hook bridge without killing and replaying the process when a hook request is pending.
- [x] Pet overlay permission notifications default to `Allow Once` for safer background approvals.
- [x] Mutating provider command surfaces are blocked from settings auto-run.
- [x] Provider-quota command surfaces are blocked from settings auto-run unless routed through composer/terminal intent.

## Slash Commands, Skills, And Provider Commands

- [x] App slash commands are shared by all providers.
- [x] Provider slash commands are exposed from the provider registry.
- [x] Slash availability respects provider support status without a user-visible runtime lane split.
- [x] `/review` maps to Claude review intent without requiring the interactive CLI lane.
- [x] `/agents`, `/mcp`, and `/plugins` map to Claude provider flows without requiring users to switch runtimes.
- [x] Skills and project instruction surfaces live outside the transcript so command discovery does not crowd chat.
- [x] Provider settings can run safe no-quota command surfaces and render structured output with secret redaction.

## Agents, Diff, And Workspace UX

- [x] Agents sidebar focuses on subagent rows and captured subagent output instead of raw provider event feeds.
- [x] Agent nodes derive from both nested subagent files and live stream-json events.
- [x] Plan states derive from normalized plan/todo events.
- [x] Diff panel summarizes changed files by status, additions, deletions, and risk.
- [x] File deletions and large changes are visible without dumping full patches into chat.
- [x] App-managed worktrees are available as the cross-provider workspace isolation path.
- [x] Provider-native worktree extras are tracked as advanced follow-up only; the cross-provider product path is implemented.

## Cross-Provider Reuse

- [x] Generic permission, question, tool, agent, and completion events are fixture-tested across Claude, Codex, Cursor, and Copilot.
- [x] Provider support gaps are explicit and evidence-labeled instead of inferred from another CLI.
- [x] Settings and runtime metadata are driven by provider definitions, not Claude-only branches.
- [x] The provider command-surface contract can block unsafe commands before any provider-specific shell call runs.
- [x] The Activity, Diff, slash, and transcript helpers live in shared `src/types` modules.

## Verification Gates

- [x] Node TypeScript: `npx tsc -p tsconfig.node.json --noEmit`
- [x] Renderer TypeScript: `npx tsc -p tsconfig.web.json --noEmit`
- [x] Provider/unit suite: `npm run test:providers`
- [x] Provider smoke probes: `npm run smoke:providers`
- [x] Smoke config suite: `npm run test:smoke-config`
- [x] Production build: `npm run build`
- [x] Whitespace guard: `git diff --check`
- [x] Live Claude Sonnet smoke: `LIVE_PROVIDERS=claude npm run live:providers`
- [x] Computer Use GUI verification: transcript collapse/expand, slash palette, Diff panel, provider settings surfaces, and permission-card controls.
