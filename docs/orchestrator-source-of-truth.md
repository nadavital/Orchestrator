# Orchestrator Source Of Truth

Last updated: 2026-05-12

This is the canonical execution plan for Orchestrator. Every long-running implementation pass should start here, update this file as work lands, and treat the older docs in `docs/` as supporting research or historical evidence.

The goal is a first-class desktop GUI for local coding agents, with Claude Code as the first complete provider and Codex, Cursor, Copilot, and future CLIs mapped through the same Orchestrator-native abstractions.

## Operating Rules

- This file owns the product goal, feature status, implementation backlog, and completion gates.
- Code is the authority for whether something is implemented. This file is the authority for whether it is complete enough to claim.
- A feature is not complete until it has product behavior, provider/runtime mapping, UI treatment, automated coverage, and live or no-quota verification when applicable.
- Do not expose provider capability matrices to normal users. Keep capability detail in diagnostics, settings, tests, and this plan.
- Do not add a user-visible runtime picker for normal chat. Users choose the provider and task; Orchestrator chooses the right runtime path.
- Provider-specific behavior must translate at the provider edge into Orchestrator concepts. Shared UI should not become Claude-shaped, Codex-shaped, or Copilot-shaped.
- Every new live provider transcript shape that we rely on should be saved as a fixture before being called supported.
- Mutating provider-state commands, destructive commands, account/login/logout flows, and quota-spending diagnostics must be gated by confirmation or routed to the native terminal overlay.

## Status Vocabulary

| Status | Meaning |
| --- | --- |
| `Complete` | Implemented, covered by automated tests, and verified live/no-quota where applicable. |
| `Implemented` | Wired in code, but still needs stronger fixture, live, GUI, or installed-app verification. |
| `Partial` | Some behavior exists, but important paths or UI states are missing. |
| `Planned` | Product behavior is specified, but implementation has not started. |
| `Research` | Needs CLI/SDK/repo verification before product behavior should be designed. |
| `Gated` | Possible, but should only run with explicit user confirmation because it is destructive, mutates provider/account state, or spends quota. |
| `Blocked` | Cannot be completed until an external dependency, auth state, provider capability, or product decision changes. |
| `Won't Do` | Intentionally out of scope; include the reason. |

## Current Product Decisions

| Decision | Current answer |
| --- | --- |
| Primary Claude path | Structured Claude CLI print mode: `claude -p --output-format stream-json --verbose --include-partial-messages`, with Sonnet by default and per-run hook settings for approvals. |
| Native Claude terminal | Escape hatch for true TUI-only flows, prompt handling, provider management, and behavior the structured path cannot faithfully model yet. |
| Runtime choice | Hidden from normal users. Advanced diagnostics may show runtime health, but chat should not ask users to choose JSON vs CLI. |
| Provider abstractions | Use Orchestrator-native `session`, `assistant.text`, `tool`, `permission`, `user_input`, `plan`, `agent`, `diff`, `command`, `workspace`, `attachment`, and `usage` concepts. |
| Claude slash commands | App-owned slash commands run in Orchestrator. Prompt-like project/global commands and skills should be discovered and expanded where possible. True provider TUI commands route to terminal overlay. |
| Permissions | Tool approvals and user questions are separate UX lanes. Never answer `AskUserQuestion` through the generic permission resume path. |
| Subagents | Active agents appear as compact chips above the composer. Clicking a chip opens or focuses an agent transcript tab in the sidebar. |
| Sidebar | One right sidebar with tabs for Diff, Agents, Terminal/Raw, Skills, and other secondary detail. The main transcript stays calm. |
| Headless/automation | Keep structured/headless paths for normal Claude chat and provider smoke tests. For other providers, use headless automation where it is reliable, but do not pretend it exposes full interactive UX. |
| Installation | A feature is user-ready only after the dev build works and the installed app has been rebuilt/installed when the user needs to try it. |

## Completion Target

Orchestrator is complete for Claude Code when a user can use the installed app for normal Claude coding sessions without needing to open the raw Claude TUI, except for explicitly terminal-only provider management.

The expected experience:

- Assistant text streams smoothly without horizontal overflow.
- File create/edit/delete/read/search/shell/MCP/web actions appear as concise summaries.
- Diff and file cards make repo changes inspectable without dumping patches into chat.
- Tool approvals, plan approvals, and user questions pause the run cleanly and resume correctly.
- Stop, queue, and steer work consistently while a run is active.
- Subagents are visible as active/completed chips and transcript tabs, not raw event spam.
- Slash commands, skills, MCP, plugins, agents, auth, and diagnostics are available in the right surfaces without cluttering chat.
- All provider-specific behavior maps into shared Orchestrator abstractions so other CLIs can be added without rewriting the product.

## Source Documents

These files remain useful, but this file is the root plan:

| Document | Role |
| --- | --- |
| `docs/provider-cli-spec.md` | CLI evidence and provider capability reference. |
| `docs/claude-cli-map.md` | Claude-specific CLI to Orchestrator mapping reference. |
| `docs/claude-code-support-test-matrix.md` | Historical Claude live/fixture matrix. Promote important facts here as work continues. |
| `docs/provider-capability-research.md` | Research notes from provider/open-source/SDK investigations. |

## Orchestrator-Native Abstractions

All providers should translate into these shapes at the adapter/runtime boundary.

| Abstraction | Purpose | Provider examples |
| --- | --- | --- |
| `ProviderRuntime` | Starts, streams, resumes, stops, and cleans up a provider run. | Claude structured CLI, Claude PTY overlay, Codex exec, future Copilot SDK/ACP. |
| `Session` | Durable chat/task state, provider session id, cwd, model, effort, permission policy, queued input. | Claude `session_id`, Codex resume id, Cursor chat id. |
| `Message` | User/assistant transcript text and compact cards. | Assistant deltas/finals, user prompts, queued steering. |
| `ToolActivity` | Normalized tool start/progress/completion/failure. | Claude `tool_use`, Codex tool call, Copilot tool events. |
| `WorkspaceChange` | File create/edit/delete/read and diff provenance. | Claude Write/Edit/DeleteFile, Codex patch/apply, Cursor write events. |
| `PermissionRequest` | Provider asks whether an action may proceed. | Claude PreToolUse hook, Codex approval, Copilot permission handler. |
| `UserInputRequest` | Provider asks a question or requests structured user input. | Claude `AskUserQuestion`, MCP elicitation, Copilot ask-user. |
| `PlanState` | Planning/todo/approval state. | Claude `EnterPlanMode`, `ExitPlanMode`, `TodoWrite`; Cursor plan mode; Copilot plan. |
| `AgentNode` | Parent/child agent lifecycle, transcript, tools, status, usage. | Claude `Task`/`Agent`, Codex multi-agent, Copilot subagents. |
| `CommandSurface` | Safe provider command inventory and gated provider management actions. | `claude mcp list`, `codex review`, `copilot plugin list`. |
| `ExtensionSurface` | Skills, slash commands, plugins, MCP tools, rules, provider config. | `.claude/skills`, Codex plugins, Cursor rules, Copilot skills. |
| `UsageSummary` | Tokens, cost, duration, rate limit, budget. | Claude JSON usage, Copilot SDK usage, Codex runtime metrics. |
| `Attachment` | Files/images/resources added to a run. | Claude `--file`, Codex `--image`, future provider artifacts. |

## Feature Registry

### Runtime And Session Core

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Claude structured session | Default Claude chat streams from structured CLI with hook bridge. | `Implemented` | `src/main/sessions.ts`, `src/main/providers.ts`, provider tests, live structured smoke. | Verify multi-turn behavior and make status here match code after each runtime change. |
| Claude bidirectional input | Send queued/steer/user-question replies into the same provider process where possible. | `Research` | Claude supports `--input-format stream-json`; not implemented. | Spike `ProviderTransport` with stdin/stdout fixture harness; decide if it replaces one-prompt-per-process. |
| Claude PTY overlay | Native terminal for TUI-only flows and fallback prompt handling. | `Implemented` | Native prompt bridge and live capability suite notes. | Keep as escape hatch; do not make it the normal user-visible runtime. |
| Provider runtime abstraction | One interface for start/send/resolve/stop across structured, PTY, SDK, app-server. | `Partial` | `src/main/providerRuntime.ts` owns PTY process start/stdout parsing/cleanup, JSONL tailing, and Claude hook prep for current CLI lanes. | Extend the runtime contract for future SDK/app-server lanes and complete live stop/queue/steer verification. |
| Resume/continue | Continue provider sessions with preserved provider session ids and user-visible continuity. | `Partial` | Claude resume command construction and fixtures. | Live test queued message, permission continuation, and user-question answer. |
| Stop | Stop consistently interrupts current run and leaves composer usable. | `Partial` | Existing stop path; user reported inconsistency. | Add integration test for stop during text stream, tool call, permission pause, and queued message. |
| Queue next message | Users can type while a run is active; message sends immediately after the current run completes. | `Partial` | Queue behavior exists, but boundary semantics need hardening. | Add state machine tests and visible queued-message cards. |
| Steer after current tool | Queued message has a `Steer` action that injects at the next sensible boundary. | `Implemented` | `providerRuntime.interrupt`, `sessionManager.steerQueuedMessage`, provider runtime fake-process tests. | Live-test steering during Claude text/tool states and verify queued card behavior in the GUI. |
| Installed app update path | User can run the latest committed build locally. | `Partial` | Build scripts exist; installation is manual per pass. | Add documented install/reinstall checklist and verify installed app after major changes. |

### Transcript And Layout UX

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Streaming assistant text | Text appears as soon as provider emits it, with no artificial throttling unless needed for paint stability. | `Implemented` | Partial-message parser and terminal fallback parser. | Add regression test for no duplicate final text and visible streaming in dev app. |
| No horizontal app scroll | Main pane, markdown, code blocks, tables, cards, and sidebar content never force page-level horizontal scroll. | `Partial` | Several fixes landed; user still found table/sidebar cases earlier. | Add Playwright/Computer Use visual checks for code blocks, tables, long paths, agent cards, and tool cards. |
| Code block behavior | Long code scrolls inside the block, not the whole app. | `Implemented` | Renderer CSS changes from prior pass. | Add snapshot/screenshot fixture with long code. |
| Markdown tables | Table cell text wraps responsively instead of forcing horizontal scroll. | `Implemented` | Prior CSS changes. | Add screenshot fixture at narrow and wide widths. |
| Tool summaries | Main transcript shows concise counts and action labels; detail is expandable and bounded. | `Implemented` | `ToolCallCard`, `ChatView`, provider fixtures. | Add max-height scroll test for large tool-call expansions. |
| Raw events | Raw provider event noise stays out of the main transcript. | `Implemented` | Sidebar/inspector design. | Continue enforcing in UI tests. |
| File reference cards | Created/referenced files appear as cards that open existing files and do not falsely say missing. | `Partial` | Cards exist; user reported false missing state. | Re-test path resolution across cwd, absolute paths, tilde paths, quoted paths, and generated files. |
| Activity/sidebar simplicity | Secondary information is available but not crowded or duplicated in header/sidebar. | `Partial` | Header/sidebar simplification in prior pass. | Audit sidebar actions and remove duplicate controls. |

### Files, Diff, And Workspace Effects

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| File create | Transcript summary, file card, Diff row, and click-to-open behavior. | `Partial` | Live disposable file create smoke; fixtures. | Add GUI verification after live file operation. |
| File edit | Summary, exact file target, Diff row with additions/deletions. | `Partial` | Fixture-covered. | Live edit smoke and GUI diff verification. |
| File delete | Clear deletion summary and Diff warning. | `Partial` | Live create/delete smoke. | Add UI screenshot for deletion state. |
| File read/search/list | Compact summary; no raw JSON; searchable targets in expanded details. | `Implemented` | Fixtures. | Add live grep/list smoke where no quota impact is excessive. |
| Bash/shell | Permission-aware command summary with bounded output. | `Partial` | Fixture-covered. | Live harmless shell permission flow with allow once/session/deny. |
| Workspace provenance | Session knows cwd, worktree/base/branch, provider session id, and generated artifact roots. | `Partial` | App-managed worktrees exist. | Add provenance strip/detail to session metadata and tests. |
| Git state | Diff panel reflects changed files and risky deletes/large patches. | `Implemented` | Diff panel exists. | Verify after real Claude edits and staged/untracked cases. |

### Permissions, Questions, And Plan Mode

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Claude hook broker | Tool approval cards can resolve without killing/replaying the Claude process when a hook is pending. | `Implemented` | `src/main/approvalBroker.ts`, tests. | Live mutating-tool approval flow with Sonnet. |
| Allow once | Allows one action without changing session settings. | `Implemented` | Permission card behavior and tests. | Live test. |
| Allow session | Persists scoped grant and resumes. | `Implemented` | Session allowlist handling. | Live test and verify persisted command flags. |
| Deny | Denies cleanly without corrupting session state. | `Implemented` | Fixture coverage. | Live deny test. |
| Permission scopes | Tool/path/url/MCP scopes display compactly and map back to provider flags/settings. | `Partial` | Tool names implemented; richer scopes incomplete. | Add path/url/MCP-specific scope UI and parser tests. |
| AskUserQuestion | User question card with choices/custom answer, separate from permissions. | `Implemented` | Fixture-covered. | Live AskUserQuestion session and resume test. |
| SendUserMessage/brief updates | Provider user-facing questions/updates map to user input or assistant status appropriately. | `Research` | Claude help mentions `--brief`. | Capture live/fixture output and decide UI. |
| Plan mode enter | Plan state appears in sidebar/card without crowding transcript. | `Partial` | Fixtures; live native placeholder observed. | Capture real structured plan body and terminal preview path. |
| Plan approval | `Approve Plan` and `Keep Planning` resume correctly. | `Partial` | ExitPlanMode fixture. | Live plan approval and keep-planning flow. |
| Permission mode picker | Product labels map to provider-native policy. | `Implemented` | Provider registry/tests. | Live non-dangerous modes; gated bypass manual check. |

### Agents And Subagents

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Active agent chips | Running agents appear above composer, not as a noisy sidebar list. | `Implemented` | `RunningAgentsStrip`. | Live subagent run and UI verification. |
| Agent sidebar tabs | Clicking an agent chip opens/focuses that agent transcript tab. | `Partial` | Sidebar tab UI exists; transcripts unreliable per user. | Fix transcript source and tab lifecycle. |
| Task tool | `Task` creates/updates/completes an `AgentNode`. | `Implemented` | Fixtures. | Live Claude task run. |
| Agent tool | `Agent` maps to same shared agent model. | `Implemented` | Fixtures. | Live selected-agent run if locally available. |
| Sidechain/nested transcript | Child transcript captured without raw event spam. | `Partial` | Fixture-covered; user saw `no subagent transcript`. | Trace real Claude JSONL sidechain location and promote fixture. |
| Agent failures | Failed/cancelled subagents show compact state and useful error. | `Planned` | Not fully covered. | Add fixtures and UI states. |
| Multi-provider agents | Codex/Copilot/Cursor agent events use same `AgentNode` model. | `Partial` | Generic fixtures. | Add provider-specific live/fixture captures after Claude is solid. |

### Slash Commands, Skills, And Composer Commands

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| App slash commands | `/pet`, `/diff`, `/settings`, etc. are provider-neutral app actions. | `Implemented` | Slash palette and `/pet` prior change. | Add tests for command availability and no provider runtime dependency. |
| Provider slash commands | Prompt-like provider commands appear only where supported and useful. | `Partial` | Provider registry. | Audit visible command list for usefulness and runtime correctness. |
| Built-in Claude TUI commands | True TUI-only commands open terminal overlay or provider management UI. | `Partial` | `/mcp`, `/plugins`, `/agents` surfaces. | Verify no fake chat handling for TUI-only flows. |
| Project commands | Discover `.claude/commands` and render in command palette. | `Implemented` | `src/main/claudeExtensions.ts`, slash command tests. | Live-test a safe project command and promote any real transcript shape if needed. |
| Global commands | Discover `~/.claude/commands`. | `Implemented` | `src/main/claudeExtensions.ts`, source-scoped palette grouping. | Add cache/invalidation if repeated scans become visible. |
| Project skills | Discover `.claude/skills` and expose useful runnable entries. | `Implemented` | `src/main/claudeExtensions.ts`, `SkillsPanel` project skill directory rendering. | Run one safe project skill live. |
| Global skills | Discover `~/.claude/skills`. | `Implemented` | `src/main/claudeExtensions.ts`, `SkillsPanel` global skill directory rendering. | Run one safe global skill live. |
| Skill variables | Expand `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`, `$ARGUMENTS` where provider semantics allow. | `Partial` | `$ARGUMENTS` expansion is covered for discovered slash commands. | Add session/skill-dir variable expansion only after confirming Claude semantics for those contexts. |
| Command safety | Mutating/provider-state commands require confirmation or terminal handoff. | `Implemented` | Provider command surfaces block quota/mutating commands and settings renders them as terminal/confirmation handoffs. | Add explicit terminal-launch buttons only after confirming the desired handoff UX. |

### MCP, Plugins, Agents Config, And Provider Management

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Claude auth status | Settings shows compact status, not raw CLI output. | `Implemented` | Smoke probes. | Verify in installed app. |
| Claude login/logout | Explicit terminal handoff or confirmation; never silent. | `Gated` | CLI help verified. | Design confirmation/terminal flow. |
| Claude MCP list/get | Settings renders servers/tools compactly. | `Implemented` | Settings Native surface includes `mcp list` plus safe `mcp get` details per discovered server. | Live-verify against local MCP config in the dev app. |
| Claude MCP add/remove/reset | Confirmation or terminal handoff only. | `Gated` | CLI help verified. | Add gated command flow in settings. |
| Native `.mcp.json` prompt | Compact Answer Required card. | `Implemented` | Native prompt tests/live suite. | Manual UI smoke for enable/reject. |
| Claude plugin list | Settings renders plugins compactly. | `Implemented` | Settings Native surface runs `plugin list --json` and renders structured output compactly. | Live-verify local plugin output shape. |
| Claude plugin mutations | Explicit confirmation or terminal handoff. | `Gated` | CLI help verified. | Add gated flow or mark terminal-only. |
| Claude agents list | Settings shows configured agents compactly. | `Implemented` | Settings Native surface runs `claude agents` and renders compact output. | Add selected-agent launch option after live UX check. |
| Claude agent mutation | Confirmation/terminal handoff. | `Gated` | CLI help verified. | Decide product scope. |
| Doctor/update/install/setup-token/project purge | Diagnostics or terminal-only; destructive/system flows gated. | `Gated` | CLI help verified. | Add policy table before implementation. |

### Attachments, Images, Usage, And Advanced Launch

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Claude file attachments | Composer can attach files/resources using provider-supported flags. | `Planned` | Claude `--file` verified. | Define attachment model and command construction tests. |
| Codex images | Composer image attachment only when provider/runtime supports it. | `Planned` | Codex help verified. | Add shared attachment capability after Claude file path. |
| Usage/cost | Show unobtrusive cost/token/duration summary where provider emits usage. | `Planned` | Claude JSON result includes usage/cost. | Parse usage and render in session detail, not chat clutter. |
| Rate limits/errors | Auth/rate/quota errors are classified and actionable. | `Partial` | Provider parser has auth error handling. | Add fixtures for rate limit and quota states. |
| Claude launch extras | `--agent`, `--agents`, `--name`, `--session-id`, `--fork-session`, `--from-pr`, `--worktree`, `--tmux`, `--fallback-model`, `--max-budget-usd`, `--json-schema`, `--file`. | `Planned` | CLI help verified. | Add advanced launch sheet only for options with clear user value. |
| Provider profiles/backends | Codex local/OSS, Cursor Bedrock/API key, Copilot custom providers. | `Research` | Help/package evidence. | Defer until Claude support is complete. |

### Cross-Provider Parity

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Codex exec automation | Deterministic structured lane for smoke/automation. | `Partial` | Adapter/tests. | Keep working; do not fake interactive approvals through exec. |
| Codex interactive approvals | Real approval UX via PTY/app-server/other protocol. | `Research` | CLI help shows interactive approval flags. | Spike after Claude runtime abstraction. |
| Codex MCP elicitation | Map to `user_input.requested`. | `Partial` | Feature flag and generic fixture. | Capture provider-specific fixture. |
| Cursor print mode | Structured stream lane. | `Partial` | Adapter/tests; keychain caveats. | Add partial-output parsing and keychain-aware diagnostics. |
| Cursor plan/ask/worktree/MCP/rules | Shared plan/workspace/extension surfaces. | `Research` | Help verified. | Implement after Claude/Codex core. |
| Copilot prompt/interactive/SDK | Map rich SDK/CLI events to Orchestrator abstractions. | `Research` | Package/CLI research. | Defer until Claude is complete; keep diagnostics honest. |
| Provider diagnostics | Binary/version/auth/models/probes distinguish missing, auth error, keychain error, and smoke pass. | `Implemented` | `smoke:providers`. | Continue updating as provider probes change. |

### Pets And App Polish

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| `/pet` command | Composer slash command toggles pet visibility. | `Implemented` | Prior change. | Add renderer test if available. |
| Built-in pets | Packaged app includes all bundled pets, including Psyduck asset. | `Implemented` | `resources/pets`, `extraResources`. | Verify installed app asset load after next install. |
| Pet animation fidelity | Pets animate consistently with Codex expectations where possible. | `Partial` | User observed hover/idle differences. | Compare Codex pet behavior if accessible; adjust state machine. |
| Pet permission notifications | Approval notification defaults to safer one-time grant. | `Implemented` | Prior change. | Verify with live permission request. |

## Execution Backlog

Work in this order unless the user explicitly redirects. A long-running agent should pick the first unchecked item whose dependencies are satisfied, implement it, verify it, update this file, and commit at stable checkpoints.

### Phase 0: Keep The Plan Trustworthy

- [x] Create this canonical source-of-truth document.
- [x] Add short pointers in older docs saying this file owns active status.
- [x] Resolve runtime wording drift in older docs so they no longer contradict the current product decision.
- [x] Add a `Last verified` note whenever a live provider suite passes.
- [ ] Keep `main` clean with checkpoint commits after broad changes.

### Phase 1: Runtime Backbone

- [x] Introduce `ProviderRuntime` or `ProviderTransport` as the owner of provider process lifecycle.
- [x] Move Claude structured process start/stdout/stderr/cleanup into that runtime.
- [x] Attach the Claude approval broker from the runtime, not ad hoc session code.
- [x] Add a fake-process test harness for stdout JSONL, stderr text, stdin input, process exit, and cleanup.
- [ ] Spike Claude `--input-format stream-json` for same-process follow-up, user-question replies, and queued steering.
- [ ] Decide and document whether Claude remains one-prompt-per-process with `--resume` or becomes a long-lived bidirectional stream.
- [ ] Ensure stop/queue/steer semantics are runtime-owned and tested.

### Phase 2: Claude Core UX Closure

- [ ] Live-test Claude plain answer, multi-turn answer, and stop during answer.
- [ ] Live-test file create/edit/delete/read/search and verify transcript, file cards, and Diff.
- [ ] Live-test Bash permission flow with allow once, allow session, deny, and stop.
- [ ] Live-test AskUserQuestion and structured choices.
- [ ] Live-test plan enter, plan body capture, approve plan, and keep planning.
- [ ] Live-test subagent/task run and fix transcript tabs until they work in the sidebar.
- [ ] Save each live transcript shape as a fixture.
- [ ] Add GUI verification for the above in dev app using Computer Use or Playwright.

### Phase 3: Command, Skill, MCP, Plugin, Agent Surfaces

- [x] Implement `.claude/commands` scanner with frontmatter and argument expansion.
- [x] Implement `~/.claude/commands` scanner with source labels and safe errors.
- [x] Implement `.claude/skills` and `~/.claude/skills` discovery.
- [x] Add slash palette grouping: app commands, project commands, global commands, provider terminal commands.
- [x] Add MCP list/get settings UI with compact status and no raw JSON by default.
- [x] Add plugin list settings UI.
- [x] Add agents list settings UI.
- [ ] Add selected-agent launch option.
- [x] Add confirmation/terminal handoff policy for all mutating MCP/plugin/agent/auth/system commands.

### Phase 4: Cross-Provider Runtime Reuse

- [ ] Move common runtime event contracts into shared types.
- [ ] Keep current Codex exec lane as automation, but add a Codex interactive/app-server spike for approvals/questions.
- [ ] Add Cursor partial-output/keychain-aware diagnostics and fixtures.
- [ ] Add Copilot CLI/SDK event fixture captures without spending quota where possible.
- [ ] Map provider-specific plans, permissions, user questions, agents, MCP, and attachments to the shared abstractions.
- [ ] Update this file with per-provider done criteria once Claude is complete.

### Phase 5: Packaging And Release Readiness

- [x] Run `npm run test:providers`.
- [x] Run `npx tsc -p tsconfig.web.json --noEmit`.
- [x] Run `npm run test:smoke-config`.
- [x] Run `npm run smoke:providers`.
- [x] Run `npm run build`.
- [x] Run `npm run live:claude-capabilities` with Sonnet when quota/network/auth allow.
- [x] Run `LIVE_PROVIDERS=claude npm run live:providers` with Sonnet when quota/network/auth allow.
- [ ] Verify dev app visually for the core flows.
- [ ] Rebuild/install the app for local use.
- [ ] Verify installed app launches, has current pets/resources, and can start a Claude session.

## Required Fixtures

Add or refresh these fixtures as features are implemented:

Current Claude fixture files that back the implemented rows:

- `plain-answer.jsonl`
- `partial-message.jsonl`
- `repo-actions.jsonl`
- `permission-denied.jsonl`
- `ask-user-question.jsonl`
- `plan-todos.jsonl`
- `exit-plan-denial.jsonl`
- `task-agent.jsonl`
- `agent-tool.jsonl`
- `task-progress.jsonl`
- `agent-partial-message.jsonl`
- `sidechain-agent.jsonl`

- [x] Claude plain answer.
- [x] Claude partial assistant message.
- [x] Claude file/tool action bundle.
- [x] Claude permission denial.
- [x] Claude AskUserQuestion.
- [x] Claude plan/todo events.
- [x] Claude ExitPlanMode denial.
- [x] Claude Task/Agent subagent events.
- [ ] Claude live hook approval event stream.
- [ ] Claude MCP tool approval.
- [ ] Claude web fetch/search approval.
- [ ] Claude plan approval live transcript.
- [ ] Claude sidechain/nested real transcript.
- [ ] Claude slash command real transcript beyond `/help`.
- [ ] Claude project/global command fixture.
- [ ] Claude skill fixture.
- [ ] Claude rate limit/quota/auth error.
- [ ] Codex interactive approval or app-server fixture.
- [ ] Codex MCP elicitation fixture.
- [ ] Cursor partial-output fixture.
- [ ] Copilot user-input/permission/subagent fixture.

## Completion Gates

Do not mark Claude support `Complete` until all of these pass or are explicitly marked `Gated`/`Won't Do` with a reason:

1. Structured Claude session starts with Sonnet and streams assistant text.
2. Multi-turn continuity works.
3. Stop works during text, tool, permission, and queued-message states.
4. Queue next works and visibly sends after completion.
5. Steer works at the next sensible boundary or is explicitly deferred with product rationale.
6. File create/edit/delete/read/search produce transcript summaries, file cards, and Diff state.
7. Bash permission flow supports allow once, allow session, deny, and resumed execution.
8. AskUserQuestion uses user-input UI and resumes without permission-path confusion.
9. Plan mode captures the plan, approves, and keeps planning.
10. Task/subagent run shows chips and opens transcript tabs with real content.
11. Slash palette supports app commands, provider commands, discovered project/global commands, and terminal handoffs.
12. Skills discovery works for project and global skills, with at least one safe live skill run.
13. MCP/plugin/agent list surfaces render compactly in settings.
14. Mutating provider-management commands are gated.
15. Main window and sidebar have no page-level horizontal scroll under long code, tables, long paths, and agent cards.
16. Large tool expansions are bounded in scrollable panes.
17. No capability matrix appears in normal user-facing UI.
18. Provider diagnostics remain available for development/support.
19. Automated tests pass.
20. Live Claude Sonnet verification passes when auth/quota/network allow.
21. Installed app is rebuilt and smoke-verified after major changes.

## Verification Commands

Use the strongest feasible set for the change:

```bash
npm run test:providers
npx tsc -p tsconfig.web.json --noEmit
npm run test:smoke-config
npm run smoke:providers
npm run build
npm run live:claude-capabilities
LIVE_PROVIDERS=claude npm run live:providers
```

Live Claude commands may need to run outside the sandbox because the local Claude API key helper can require network/keychain access. Use Sonnet for live Claude tests.

## Update Protocol For Future Agents

When implementing against this plan:

1. Read this file first.
2. Pick the first unchecked backlog item whose dependencies are done.
3. Confirm the current implementation from code before changing status.
4. Implement the smallest durable slice that moves a feature toward `Complete`.
5. Add or update tests and fixtures.
6. Run relevant verification commands.
7. Update the Feature Registry row, Execution Backlog checkbox, Required Fixtures, and Completion Gates.
8. Add a dated note below only for important live verification results or product decisions.
9. Commit at a stable checkpoint if the change is broad or user-facing.

## Decision Log

### 2026-05-11

- Created this canonical source-of-truth file.
- Current code default for Claude sessions is structured/headless CLI mode with hook approval bridge. Native interactive PTY remains an escape hatch.
- Older docs now point here for active status. Some historical notes still describe native CLI experiments, but their active runtime-decision sections have been aligned to the structured Claude default.
- Removed superseded plan/checklist docs from the remote-bound tree so this file remains the only active product specification.

### 2026-05-12

- Added `ProviderRuntimeManager` as the process lifecycle owner for current CLI lanes, including Claude hook prep, PTY stdout parsing, JSONL tailer cleanup, stop, and interrupt-for-steer behavior.
- Added project/global Claude command and skill discovery with frontmatter descriptions, source-scoped slash palette grouping, and `$ARGUMENTS` expansion.
- Settings Native surfaces now include compact MCP list/details, plugin JSON list, and agents list rendering while mutating/quota commands remain terminal/confirmation handoffs.
- Fixed live Claude capability capture to parse structured `-p stream-json` PTY stdout and use the structured runtime for normal Claude capability scenarios.
- Last verified: `CLAUDE_CAPABILITY_STRICT_EMPTY_MCP=1 npm run live:claude-capabilities` passed with Sonnet (`claude-sonnet-4-6`, low effort), covering plain answer, file ops, plan mode, streaming, slash help, auth status, MCP list, plugin JSON list, auto-mode defaults, and agents list.
- Last verified: `LIVE_PROVIDERS=claude npm run live:providers` passed with Sonnet (`claude-sonnet-4-6`, low effort), capturing `session.started`, assistant streaming, and `run.completed`.
- `npm run pack:mac` rebuilt `dist/mac-arm64/Orchestrator.app`; packaged resources include the bundled pets, and the packaged app launch was confirmed by process list. It was not copied over `/Applications/Orchestrator.app`.
- Verified `npm run test:providers`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run test:smoke-config`, `npm run smoke:providers`, `npm run build`, `npm run pack:mac`, and `git diff --check`.
