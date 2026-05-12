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
| Installed app update path | User can run the latest committed build locally. | `Implemented` | Installed-app smoke checklist below; final installed artifact verified with Computer Use on 2026-05-12. | Keep checklist current and run it after major UI/runtime changes. |

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
| Allow once | Allows one action without changing session settings. | `Complete` | Permission card behavior, tests, and live installed-app Write smoke. | Keep covered by regression tests when approval broker changes. |
| Allow session | Persists scoped grant and resumes. | `Complete` | Session allowlist handling, tests, and live installed-app two-Write smoke. | Add path/tool scoped grants before broadening beyond tool names. |
| Deny | Denies cleanly without corrupting session state. | `Complete` | Fixture coverage, tests, and live installed-app denied Write smoke. | Keep stop/deny interaction covered in P1/P3 tasks. |
| Permission scopes | Tool/path/url/MCP scopes display compactly and map back to provider flags/settings. | `Partial` | Tool names implemented; richer scopes incomplete. | Add path/url/MCP-specific scope UI and parser tests. |
| AskUserQuestion | User question card with choices/custom answer, separate from permissions. | `Implemented` | Fixture-covered. | Live AskUserQuestion session and resume test. |
| SendUserMessage/brief updates | Provider user-facing questions/updates map to user input or assistant status appropriately. | `Research` | Claude help mentions `--brief`. | Capture live/fixture output and decide UI. |
| Plan mode enter | Plan state appears in sidebar/card without crowding transcript. | `Partial` | Fixtures; live native placeholder observed. | Capture real structured plan body and terminal preview path. |
| Plan approval | `Approve Plan` and `Keep Planning` resume correctly. | `Partial` | ExitPlanMode fixture; live approve path verified in installed app. | Live-test keep-planning and save plan approval fixture. |
| Permission mode picker | Product labels map to provider-native policy. | `Implemented` | Provider registry/tests. | Live non-dangerous modes; gated bypass manual check. |

### Agents And Subagents

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Active agent chips | Running agents appear above composer, not as a noisy sidebar list. | `Implemented` | `RunningAgentsStrip`. | Live subagent run and UI verification. |
| Agent sidebar tabs | Clicking an agent chip opens/focuses that agent transcript tab. | `Implemented` | Sidebar tab UI exists; completed subagent transcript verified live after commit `97d30c39`. | Live-test active/running chip behavior and sidechain transcripts. |
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
| Project skills | Discover `.claude/skills` and expose useful runnable entries. | `Implemented` | `src/main/claudeExtensions.ts`, `SkillsPanel` project skill directory rendering, live project skill discovery smoke. | Run one safe project skill live. |
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

Each task below must end with evidence in this file. Prefer exact command names, fixture names, screenshots, commit hashes, or a short live-observation note. If a task cannot be verified in the current environment, mark it `Blocked` with the concrete blocker.

### Verified Checkpoints

| ID | Checkpoint | Status | Evidence |
| --- | --- | --- | --- |
| V-001 | Canonical source-of-truth document exists and older docs point here. | `Complete` | `docs/orchestrator-source-of-truth.md`; older planning docs cleaned up in previous checkpoint. |
| V-002 | Runtime backbone owns provider process lifecycle and Claude hook prep. | `Complete` | `src/main/providerRuntime.ts`; `npm run test:providers`. |
| V-003 | Claude command and skill discovery exists for project and global scopes. | `Complete` | `src/main/claudeExtensions.ts`; slash command tests; live project command/skill discovery smoke on `/private/tmp/orchestrator-agent-ui-smoke`. |
| V-004 | Compact settings surfaces exist for Claude MCP, plugins, agents, auth, and auto-mode defaults. | `Implemented` | `src/renderer/src/components/SettingsModal.tsx`; provider tests; needs installed-app settings smoke. |
| V-005 | Permission cards support allow once, allow session, and deny without confusing user questions. | `Implemented` | `src/main/approvalBroker.ts`; `src/main/sessions.ts`; live Write allow-once, deny, and allow-session smoke in installed app. |
| V-006 | Plan approval reaches Claude native plan flow instead of prompting for `~/.claude/plans/*.md`. | `Implemented` | Live installed-app smoke: native plan artifact write auto-allowed, `Plan Ready` card shown, real workspace file write still prompted. |
| V-007 | Completed subagents appear in the Agents sidebar with cleaned transcript text. | `Implemented` | Live installed-app smoke on Task subagent; raw `agentId`/`<usage>` trailer removed by `src/types/activityView.ts`. |
| V-008 | Project skills render directory-backed Claude skills in the Skills panel. | `Implemented` | Live installed-app smoke showed `.claude/skills/tiny-skill/SKILL.md` as `Project skills 1 file`. |
| V-009 | Latest source/test checkpoint committed. | `Complete` | Commit `97d30c39` (`Polish Claude agent UI flows`); working tree clean afterward. |

### P0: Re-establish Installed-App Verification

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P0-001 | Diagnose final installed-app Computer Use attach timeout. | `Complete` | After reinstall/relaunch, `Computer Use get_app_state` returned the installed Orchestrator accessibility tree in 0.5-2.3 seconds. | Previous timeout did not reproduce after restart/reinstall; treat as stale app/CUA session unless it recurs. |
| P0-002 | Add repeatable install/restart smoke checklist. | `Complete` | `Installed App Smoke Checklist` below documents commands and expected observable app state; checklist was run from a clean package on 2026-05-12. | Keep this checklist as the minimum installed-app gate after major changes. |
| P0-003 | Verify final installed app can start a plain Claude session. | `Complete` | Live installed app returned `FINAL_INSTALLED_APP_SMOKE_OK` with Claude Sonnet 4.6 High in Ask mode. | Verified before the terminal command-bar patch; no Claude runtime changes landed afterward. |
| P0-004 | Verify packaged resources load. | `Complete` | `npm run test:smoke-config` passed; `/Applications/Orchestrator.app/Contents/Resources/pets/*/{pet.json,spritesheet.webp}` contains ditto, orchestrator, pika, and psyduck. `/pet` applied without visible error. | Pet overlay animation fidelity remains separate P-polish work. |

### P1: Claude Core Run Semantics

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P1-001 | Plain answer stream. | `Implemented` | Live installed-app Claude answer streams and ends idle; fixture covers same event shape. | Live provider suites pass; installed app final artifact still needs P0 first. |
| P1-002 | Multi-turn continuity. | `Planned` | Ask a fact in turn 1, reference it in turn 2, verify Claude resumes with same context and no duplicate transcript. | Capture provider session id behavior. |
| P1-003 | Stop during assistant text. | `Planned` | Start a long answer, stop mid-stream, verify process stops, composer re-enables, session status is idle/stopped. | Add automated state-machine test after live failure or success is understood. |
| P1-004 | Stop during tool execution. | `Planned` | Trigger a harmless long shell/read sequence, stop while tool is active, verify no stuck waiting state. | Avoid destructive commands. |
| P1-005 | Stop during permission pause. | `Planned` | Trigger Write permission, click Stop, verify pending hook resolves/cleans up and no file is created. | Completes permission lifecycle hardening. |
| P1-006 | Queue next message. | `Planned` | Send while current run is active; queued card appears and sends after completion. | Include screenshot/accessibility evidence. |
| P1-007 | Steer queued message. | `Planned` | Queue message, use Steer, verify it is injected at the next sensible boundary. | Current code has runtime interrupt tests; live GUI still needed. |
| P1-008 | Decide Claude one-process vs bidirectional stream. | `Research` | Spike `--input-format stream-json` with stdin/stdout harness; write decision in this doc. | Do this after P1-002 through P1-007 expose real pain points. |

### P2: Workspace Effects, Diff, And Files

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P2-001 | File create. | `Implemented` | Live installed-app create shows tool summary, file card, Diff row, and correct file contents. | Verified for `plan-mode-smoke-fixed.txt`; add fixture/live evidence entry before marking complete. |
| P2-002 | File edit. | `Planned` | Edit an existing file in smoke repo; verify transcript summary, file card, Diff additions/deletions, and content. | Use disposable git repo. |
| P2-003 | File delete. | `Planned` | Delete a disposable file; verify deletion summary and Diff deletion warning. | Must avoid repo source files. |
| P2-004 | File read/search/list. | `Planned` | Ask Claude to read/list/search smoke repo; verify compact summaries and no raw JSON dump. | Include `Read`, `LS`, `Grep`/`Glob`. |
| P2-005 | Bash allow once. | `Planned` | Run harmless `pwd`/`printf` style command, approve once, verify output summary and no extra grants. | Should not use network or destructive commands. |
| P2-006 | Bash allow session. | `Planned` | Run two harmless Bash commands in one prompt; first prompts, second auto-allows after session grant. | Mirror Write allow-session verification. |
| P2-007 | Bash deny. | `Planned` | Deny harmless command; verify run ends cleanly and no bogus success text. | Add fixture if transcript shape differs. |
| P2-008 | File reference resolution matrix. | `Planned` | Verify cards for cwd-relative, absolute, tilde, quoted, generated, and missing paths. | Addresses prior false-missing risk. |
| P2-009 | Git Diff edge cases. | `Planned` | Diff panel correctly renders modified, added, deleted, untracked, staged, and large file states. | Use smoke git repo. |

### P3: Permissions, Questions, And Plan Mode

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P3-001 | Write allow once. | `Complete` | Live installed-app smoke created disposable file after `Allow Once`; provider tests pass. | Already verified before commit `97d30c39`. |
| P3-002 | Write allow session. | `Complete` | Live installed-app smoke created two files with only first Write prompt after `Allow Session`; tests pass. | Already verified before commit `97d30c39`. |
| P3-003 | Write deny. | `Complete` | Live installed-app smoke denied Write, run ended idle, file absent; tests pass. | Already verified before commit `97d30c39`. |
| P3-004 | AskUserQuestion choices. | `Implemented` | Live smoke showed `Answer Required`, Alpha/Beta options, answer sent, Claude resumed. | Add saved fixture/live transcript before marking complete. |
| P3-005 | AskUserQuestion free-form answer. | `Planned` | Use custom answer field, verify answer is sent as user input and not permission resolution. | Complements choice test. |
| P3-006 | Plan approve. | `Implemented` | Live smoke showed plan artifact auto-allow, `Plan Ready`, approve, then real workspace Write prompt and created file. | Need final installed artifact recheck after P0 and fixture capture. |
| P3-007 | Plan keep-planning. | `Planned` | Click `Keep Planning`; verify Claude stays in plan mode and no workspace edit occurs. | Also verifies new `Kept planning` label. |
| P3-008 | Permission scope details. | `Planned` | Cards show readable tool/path/url/MCP scope and wrap long paths. | Long path wrap already improved; URL/MCP still open. |
| P3-009 | Permission mode picker. | `Implemented` | Live smoke showed Ask, Auto-edit, Plan, Auto safe, Allowlist, isolated-only Bypass unsafe. | Need non-dangerous live checks for Ask/Plan/Auto-edit/Auto safe. |

### P4: Agents And Subagents

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P4-001 | Task subagent happy path. | `Implemented` | Live smoke used Task to read README; transcript summary and completed Agents sidebar worked. | Add fixture/live transcript from real run before marking complete. |
| P4-002 | Active agent chips while running. | `Planned` | During a long subagent task, chip appears above composer and opens transcript tab. | Existing live smoke only verified completed state. |
| P4-003 | Completed agent sidebar tabs. | `Implemented` | Live installed-app smoke showed completed agent selectable with cleaned transcript. | Covered by commit `97d30c39`. |
| P4-004 | Nested/sidechain transcript capture. | `Planned` | Real Claude nested/sidechain transcript appears without raw event spam; fixture saved. | Existing fixture coverage may not match real sidechain path. |
| P4-005 | Agent failure/cancel states. | `Planned` | Failed/cancelled subagent shows compact status and useful error in sidebar. | Needs synthetic fixture and one live-ish smoke if possible. |
| P4-006 | Selected-agent launch option. | `Planned` | User can choose a configured Claude agent for a run without raw terminal command. | Depends on settings agents list UX. |

### P5: Slash Commands, Skills, MCP, Plugins, Agents

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P5-001 | Slash palette app commands. | `Implemented` | Live smoke showed app commands and no duplicate `/agents`; tests pass. | Add screenshot or CUA tree evidence in decision log if repeated. |
| P5-002 | Project command run. | `Planned` | Run safe `.claude/commands/ui-smoke.md`; verify expansion, response, and fixture if new shape. | Discovery was live-verified, execution still open. |
| P5-003 | Global command discovery/run. | `Planned` | If safe global command exists, discover and run; otherwise create disposable one and cleanly document. | Avoid mutating user global config unless explicitly approved. |
| P5-004 | Project skill discovery. | `Implemented` | Live smoke showed `tiny-skill/SKILL.md` in Skills panel and slash palette. | Execution still separate in P5-005. |
| P5-005 | Project skill run. | `Planned` | Invoke safe project skill and verify Claude uses it or reports expected phrase. | Save fixture if tool shape differs. |
| P5-006 | Global skill discovery/run. | `Planned` | Verify safe global skill discovery and execution, or mark blocked if none exists and user declines creating one. | Do not write global skill without explicit approval. |
| P5-007 | Settings MCP list/get. | `Planned` | Installed app settings render MCP servers/details compactly, including failure statuses. | Parser tests pass; live UI smoke still needed. |
| P5-008 | Settings plugin list. | `Planned` | Installed app settings render plugin JSON/list compactly without raw dump. | Use no-mutation command only. |
| P5-009 | Settings agents list. | `Planned` | Installed app settings render configured agents compactly. | Use no-mutation command only. |
| P5-010 | Mutating provider-management gates. | `Implemented` | Attempting add/remove/login/logout/update/purge routes to confirmation or terminal-only surface. | Needs live UI smoke, but do not execute destructive mutations. |

### P6: Layout, Design, And Accessibility QA

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P6-001 | No page-level horizontal scroll. | `Planned` | Screenshots/accessibility checks for long paths, code blocks, markdown tables, permission cards, agent cards, and tool details at narrow/wide widths. | Core design smell risk. |
| P6-002 | Bounded tool expansions. | `Planned` | Large tool output expands inside scrollable/bounded pane, not entire transcript. | Use synthetic fixture or smoke repo. |
| P6-003 | Permission card visual polish. | `Implemented` | Long paths wrap and card max-width is 560px; live smoke looked acceptable. | Still include in broader screenshot matrix. |
| P6-004 | Answered user-question card polish. | `Planned` | Answered card transitions away from active `Answer Required` visual state. | Live smoke worked functionally but looked a bit heavy. |
| P6-005 | Terminal command input. | `Complete` | In the installed app, Computer Use entered `echo TERMINAL_COMMAND_VISIBLE_OK`; the terminal pane showed the command and `TERMINAL_COMMAND_VISIBLE_OK`. | Added an accessible command bar backed by `terminal:runCommand`, fixed terminal live-event targeting to the main renderer, and made terminal colors consistently dark. |
| P6-006 | Sidebar control audit. | `Planned` | Remove or consolidate duplicate/low-value controls; main transcript stays calm. | Use live walkthrough notes. |

### P7: Fixtures And Automated Coverage

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P7-001 | Save live hook approval fixture. | `Planned` | Fixture covers PreToolUse allow/deny/resume shape used by current approval broker. | Required before marking approval broker complete. |
| P7-002 | Save plan approval fixture. | `Planned` | Fixture covers native plan write, ExitPlanMode approval, and subsequent workspace write prompt. | Based on P3-006 live path. |
| P7-003 | Save project command fixture. | `Planned` | Fixture covers discovered project command execution. | Based on P5-002. |
| P7-004 | Save skill fixture. | `Planned` | Fixture covers discovered project skill execution. | Based on P5-005. |
| P7-005 | Save sidechain/nested agent fixture from real run. | `Planned` | Fixture proves transcript source path and cleaned sidebar output. | Based on P4-004. |
| P7-006 | Save MCP/web approval fixtures. | `Planned` | Fixture covers MCP tool approval and WebFetch/WebSearch approval if available. | Avoid quota/network unless user approves. |
| P7-007 | Save auth/rate/quota error fixtures. | `Planned` | Fixture/classifier distinguishes auth, quota, rate limit, and model failure. | Can be synthetic if live quota failure is unavailable. |
| P7-008 | Add renderer/Playwright smoke harness or documented CUA script. | `Planned` | Repeatable command/checklist verifies core UI states without manual re-discovery. | Pick Playwright if app automation is stable, CUA checklist otherwise. |

### P8: Cross-Provider After Claude Closure

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P8-001 | Shared runtime event contract cleanup. | `Planned` | Common types cover session/message/tool/permission/user_input/plan/agent/diff/usage across providers. | Do not start broad refactor until Claude UX is stable. |
| P8-002 | Codex interactive/app-server approval spike. | `Research` | Real approval/question UX identified and mapped, or explicitly deferred. | Keep Codex exec lane as automation until then. |
| P8-003 | Cursor diagnostics and partial-output fixture. | `Research` | Keychain/auth/partial-output cases are captured and classified. | Defer until Claude completion gates pass. |
| P8-004 | Copilot CLI/SDK fixture capture. | `Research` | No-quota fixture or SDK event capture maps user input/permission/subagent events. | Defer until Claude completion gates pass. |

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

## Installed App Smoke Checklist

Use this after major runtime, renderer, packaging, or resource changes. Record the result in the Decision Log.

1. Build the packaged app:

```bash
npm run pack:mac
```

2. Quit the currently installed app before replacing it:

```bash
killall Orchestrator
```

3. Copy the fresh package into `/Applications`:

```bash
ditto /Users/navital/Desktop/Orchestrator/dist/mac-arm64/Orchestrator.app /Applications/Orchestrator.app
```

4. Launch the installed app:

```bash
open -a /Applications/Orchestrator.app
```

5. Use Computer Use on `Orchestrator` and confirm `get_app_state` returns the accessibility tree for:

```text
file:///Applications/Orchestrator.app/Contents/Resources/app.asar/out/renderer/index.html
```

6. Start or select a disposable smoke project session. Send:

```text
Reply exactly FINAL_INSTALLED_APP_SMOKE_OK. Do not use tools.
```

Expected: the transcript shows `FINAL_INSTALLED_APP_SMOKE_OK` and the run returns idle.

7. Verify packaged resources:

```bash
find /Applications/Orchestrator.app/Contents/Resources/pets -maxdepth 2 -type f | sort
```

Expected: each bundled pet has `pet.json` and `spritesheet.webp`. Running `/pet` should not show missing-resource errors.

8. Toggle Terminal and run:

```text
echo TERMINAL_COMMAND_VISIBLE_OK
```

Expected: the terminal pane shows the command and `TERMINAL_COMMAND_VISIBLE_OK`.

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
- Checkpoint commit `97d30c39` (`Polish Claude agent UI flows`) landed the live-tested permission, plan, subagent, skills, settings, slash, and terminal polish pass.
- Live installed-app GUI smoke before the final label-only polish verified Write allow once, Write allow session, Write deny, AskUserQuestion choices, slash palette grouping, Diff for a real smoke git repo, project command discovery, project skill directory rendering, completed subagent sidebar transcript, and plan approval flow through Claude native `Plan Ready`.
- The final installed-app Computer Use attach timeout no longer reproduces after restart/reinstall. `get_app_state` returned the `/Applications/Orchestrator.app/.../out/renderer/index.html` accessibility tree in 0.5-2.3 seconds.
- Final installed app plain Claude smoke passed: `Reply exactly FINAL_INSTALLED_APP_SMOKE_OK. Do not use tools.` returned `FINAL_INSTALLED_APP_SMOKE_OK` using Claude Sonnet 4.6 High in Ask mode.
- Packaged resource smoke passed: `npm run test:smoke-config` passed, installed pet resources include ditto/orchestrator/pika/psyduck `pet.json` and `spritesheet.webp`, and `/pet` applied without visible missing-resource errors.
- Terminal command input smoke passed in the installed app: Computer Use entered `echo TERMINAL_COMMAND_VISIBLE_OK`, clicked `Run`, and the terminal pane showed both the command and `TERMINAL_COMMAND_VISIBLE_OK`.
- Terminal design smell fixed during smoke: the terminal pane now uses a consistent dark palette instead of inheriting the light app background.
- Verification for this installed-app checkpoint: `npm run test:providers`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run test:smoke-config`, `npm run pack:mac`, copy to `/Applications`, relaunch, and Computer Use GUI smoke.
