# Orchestrator Source Of Truth

Last updated: 2026-05-19

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
- Mutating provider-state commands, destructive commands, account/login/logout flows, and quota-spending diagnostics must be gated by confirmation or routed to explicit settings/user-terminal handoff.

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
| Native Claude terminal | Removed from the normal chat runtime. Use structured Claude JSON for chat; provider-management actions should use Orchestrator-native settings or the separate user terminal, not the old Claude-native chat parser. |
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
| `docs/capabilities-surface-matrix.md` | Current capability ownership matrix for Claude/Codex file-backed, plugin-backed, and provider-managed resources. |
| `docs/capability-sync-spike.md` | Spike and implementation plan for syncing/importing capabilities across Claude, Codex, and future provider projections. |

## Orchestrator-Native Abstractions

All providers should translate into these shapes at the adapter/runtime boundary.

| Abstraction | Purpose | Provider examples |
| --- | --- | --- |
| `ProviderRuntime` | Starts, streams, resumes, stops, and cleans up a provider run. | Claude structured CLI, Codex exec automation, Codex app-server, future Copilot SDK/ACP. |
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
| Claude bidirectional input | Send queued/steer/user-question replies into the same provider process where possible. | `Research` | P1-002 through P1-007 pass with current structured resume/interrupt path; Claude supports `--input-format stream-json`, but P1 does not require replacing one-prompt-per-process. | Revisit only if P3 user-question/plan flows require same-process stdin semantics. |
| Claude PTY overlay | Old Claude-native chat parser and prompt bridge. | `Won't Do` | Structured JSON supports the needed Claude chat surfaces with cleaner events. | Removed the Claude-native parser/prompt bridge; use structured JSON for chat and the separate user terminal for manual provider management. |
| Claude selectable native chat runtime | Users choose Native Terminal for normal Claude chats. | `Won't Do` | Structured JSON supports core Claude Code tools/subagents/MCP/slash prompt flows with cleaner events; native warm follow-up was fragile in UI smoke. | No chat-runtime support remains; use Orchestrator settings or the separate user terminal for provider management. |
| Provider runtime abstraction | One interface for start/send/resolve/stop across structured CLI, exec automation, SDK, and app-server transports. | `Partial` | `src/main/providerRuntime.ts` owns current subprocess lifecycle, Claude hook prep, Codex app-server dispatch, stop, and interrupt-for-steer. | Keep broadening only as Cursor/Copilot structured runtimes are added. |
| Resume/continue | Continue provider sessions with preserved provider session ids and user-visible continuity. | `Partial` | Claude resume command construction, fixtures, and installed-app continuity smoke. | Live test permission continuation and user-question answer. |
| Stop | Stop consistently interrupts current run and leaves composer usable. | `Complete` | Installed-app smokes cover assistant text, tool execution, and permission pause; tests cover interrupted message settlement and stop availability. | Keep covered when approval or provider runtime changes. |
| Queue next message | Users can type while a run is active; message sends immediately after the current run completes. | `Complete` | Installed-app P1-006 queued follow-up ran to `P1_QUEUE_FOLLOWUP_OK`; composer state and queued card were visible. | Add lower-level state-machine coverage if queue logic broadens beyond one pending follow-up. |
| Steer after current tool | Queued message has a `Steer` action that injects at the next sensible boundary. | `Complete` | Installed-app P1-007 retry interrupted the active text stream and ran the follow-up to `P1_STEER_RETRY_OK`; provider runtime and lifecycle tests cover the intentional interrupt path. | Re-test with an active tool boundary during P2 Bash smokes. |
| Installed app update path | User can run the latest committed build locally. | `Implemented` | Installed-app smoke checklist below; final installed artifact verified with Computer Use on 2026-05-12. | Keep checklist current and run it after major UI/runtime changes. |

### Transcript And Layout UX

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Streaming assistant text | Text appears as soon as provider emits it, with no artificial throttling unless needed for paint stability. | `Complete` | `npm run smoke:ui:auto -- --scroll` verifies the streaming cursor appears during an active simulated stream, disappears after completion, and the final streamed text is not duplicated. | Keep partial/final dedupe covered when provider streaming event shapes change. |
| Streaming scroll behavior | New tokens keep the transcript pinned only while the user is already following the latest output; manual upward scroll wins immediately. | `Complete` | `npm run smoke:ui:auto -- --scroll` covers scrolling up during a simulated streaming update, preserving position, returning with Jump to latest, and final streaming settlement. | Keep this invariant when changing transcript rendering, virtualization, or message batching. |
| No horizontal app scroll | Main pane, markdown, code blocks, tables, cards, and sidebar content never force page-level horizontal scroll. | `Complete` | `npm run smoke:ui:auto -- --transcript-layout` covers long code, tables, file cards, expanded tool summaries, and document/transcript scroll width. | Keep viewport-resized screenshot automation as a future enhancement if Browser/Playwright stability improves. |
| Code block behavior | Long code scrolls inside the block, not the whole app. | `Complete` | `npm run smoke:ui:auto -- --transcript-layout` verifies long code stays bounded and internally scrollable at desktop and narrow widths. | Keep covered when markdown/code rendering changes. |
| Markdown tables | Table cell text wraps responsively instead of forcing horizontal scroll. | `Complete` | `npm run smoke:ui:auto -- --transcript-layout` verifies table bounds and cell wrapping at desktop and narrow widths. | Keep covered when markdown/table rendering changes. |
| Tool summaries | Main transcript shows concise counts and action labels; detail is expandable and bounded. | `Complete` | `ToolCallCard`, `ChatView`, provider fixtures, and transcript-layout smoke for large expanded tool summaries. | Keep max-height behavior when adding new tool detail renderers. |
| Raw events | Raw provider event noise stays out of the main transcript. | `Complete` | `npm run smoke:ui:auto -- --transcript-layout` injects raw provider data/events and verifies the sentinel stays out of the transcript at desktop and narrow widths. | Keep enforcing in UI tests as new provider event buffers are added. |
| File reference cards | Created/referenced files appear as cards that open existing files and do not falsely say missing. | `Complete` | Installed-app P2-008 smoke verified cwd-relative, absolute, quoted path with spaces, long path with spaces, generated file, missing file, and `~/...` references after parser/card-cap fixes. | Keep covered by file-reference unit tests and installed-app smoke when parser/UI changes. |
| Activity/sidebar simplicity | Secondary information is available but not crowded or duplicated in header/sidebar. | `Complete` | Sidebar smoke covers global pinned chats, hover pin/unpin, double-click rename, running spinner, and unread/error-only dots; header status chip was removed. | Keep secondary controls out of the main transcript/header unless they directly unblock the current run. |
| Earlier transcript pages | Older messages are available without making fast chat switching feel like data loss. | `Implemented` | Transcript paging/search keeps initial render bounded. Product decision: do not expose implementation copy like "hidden for faster chat switching" in the default transcript. | Treat paging as an implementation detail, not a product concept: keep full transcript persistence/search, use quiet "Show earlier" affordances, and consider transcript virtualization as the longer-term path for very long chats. |
| Transcript virtualization | Very long threads feel complete and scrollable without mounting every rendered message at once. | `Complete` | Transcript rows now render through a measured virtual window with overscan; older chunks lazy-hydrate near the top with visible-row anchor preservation, and 421-message plus 2,501-message smokes verify bounded mounted rows. | Tune row-height estimates if long real-world markdown/tool-heavy transcripts expose anchor drift. |

### Files, Diff, And Workspace Effects

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| File create | Transcript summary, file card, Diff row, and click-to-open behavior. | `Complete` | Installed-app P2-001 smoke created `p2-created-by-claude.txt`, showed tool summary/file card, and Diff showed the untracked file; filesystem content matched `P2_CREATE_OK`. | Keep covered by repo-action fixture plus live smoke after workspace-effect UI changes. |
| File edit | Summary, exact file target, Diff row with additions/deletions. | `Complete` | Installed-app P2-002 smoke edited `p2-edit-target.txt`, showed file card, and Diff showed `+1 -1`; filesystem content matched the requested two-line result. | Keep covered by repo-action fixture plus live smoke after workspace-effect UI changes. |
| File delete | Clear deletion summary and Diff warning. | `Complete` | Installed-app P2-003 smoke deleted `p2-delete-target.txt`; file card showed missing/disabled actions and Diff showed deleted-file mode with removed baseline line. | Keep deletion rows visually checked in Diff edge-case smoke. |
| File read/search/list | Compact summary; no raw JSON; searchable targets in expanded details. | `Complete` | Installed-app P2-004 smoke read/listed/searched the repo, surfaced `P2_SEARCH_NEEDLE`, and showed `Read 2 files · Listed 1 listing` without raw JSON in chat. | Keep compact summary tests current as tool vocabulary changes. |
| Bash/shell | Permission-aware command summary with bounded output. | `Complete` | Installed-app P2-005 through P2-007 smokes covered Bash allow once, allow session, and deny; denied command ended with explicit permission-denied error and did not create the target file. | Add fixture if Claude denial event shape changes. |
| Workspace provenance | Session knows cwd, worktree/base/branch, provider session id, and generated artifact roots. | `Implemented` | App-managed worktrees exist; header now shows environment, project/folder, branch when available, and provider/model metadata. | Add generated artifact roots and deeper fork/worktree provenance when those flows become first-class. |
| Git state | Diff panel reflects changed files and risky deletes/large patches. | `Complete` | Installed-app P2-009 smoke showed modified, added/staged, deleted, untracked, and large modified states with previews for deleted, large, and staged-added files. | Keep as a required installed-app smoke after Diff renderer changes. |

### Permissions, Questions, And Plan Mode

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Claude hook broker | Tool approval cards can resolve without killing/replaying the Claude process when a hook is pending. | `Implemented` | `src/main/approvalBroker.ts`, tests. | Live mutating-tool approval flow with Sonnet. |
| Allow once | Allows one action without changing session settings. | `Complete` | Permission card behavior, tests, and live installed-app Write smoke. | Keep covered by regression tests when approval broker changes. |
| Allow session | Persists scoped grant and resumes. | `Complete` | Session allowlist handling, tests, and live installed-app two-Write smoke. | Add path/tool scoped grants before broadening beyond tool names. |
| Deny | Denies cleanly without corrupting session state. | `Complete` | Fixture coverage, tests, and live installed-app denied Write smoke. | Keep stop/deny interaction covered in P1/P3 tasks. |
| Permission scopes | Tool/path/url/MCP scopes display compactly and map back to provider flags/settings. | `Complete` | Installed-app cards showed readable path scopes for Write and parser tests cover file path, URL, MCP, Bash, and plan summaries. | Keep parser tests current as provider payloads change. |
| AskUserQuestion | User question card with choices/custom answer, separate from permissions. | `Complete` | Installed-app P3-004/P3-005 smokes verified option selection, free-form answer, user-input resume, and exact Claude echo replies. | Improve answered-card labeling in P6-004. |
| SendUserMessage/brief updates | Provider user-facing questions/updates map to user input or assistant status appropriately. | `Implemented` | `brief-usage.jsonl` maps `SendUserMessage` to assistant status; live Claude 2.1.140 `--brief` probes on 2026-05-13 exposed no `SendUserMessage` tool and returned normal assistant text plus usage. | Keep parser support; treat current live Claude brief output as assistant text unless a future CLI emits the tool. |
| Plan mode enter | Plan state appears in sidebar/card without crowding transcript. | `Complete` | Dev CUA structured smoke verified the Plan rail/sidebar renders TodoWrite tasks, ExitPlanMode plan bodies, markdown summary, and survives event-buffer reload via saved transcript reconstruction. | Keep saved-message reconstruction covered as provider payloads change. |
| Plan approval | `Approve Plan` and `Keep Planning` resume correctly. | `Complete` | Installed-app P3-006/P3-007 smokes verified native `Plan Ready`, approve-then-Write permission, `Kept planning`, and no workspace edit on keep-planning. | Save richer plan fixtures in P7-002. |
| Permission mode picker | Product labels map to provider-native policy. | `Complete` | Installed-app CUA verified Settings default `Mode` shows Auto selected; composer shows Auto, Plan, and Ask first as primary choices; Auto-edit, Preapproved only, raw allow/deny/tools/dirs, and Bypass unsafe live behind Advanced. | Existing sessions can retain their saved mode. |

### Agents And Subagents

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Active agent chips | Running agents appear above composer, not as a noisy sidebar list. | `Complete` | Installed-app P4-002 smoke showed a running Task chip during a long `sleep 18` subagent run. | Keep covered by installed-app smoke after agent UI changes. |
| Agent sidebar tabs | Clicking an agent chip opens/focuses that agent transcript tab. | `Complete` | Installed-app P4-002/P4-003 smokes verified running and completed agent tabs with cleaned transcript content. | Keep active/completed states in renderer tests where practical. |
| Task tool | `Task` creates/updates/completes an `AgentNode`. | `Complete` | Installed-app P4-001 smoke delegated README reading through Task and showed final subagent transcript in the Agents sidebar. | Keep `task-agent.jsonl` and live Task smoke current as Claude event shapes change. |
| Agent tool | `Agent` maps to same shared agent model. | `Implemented` | Fixtures. | Live selected-agent run if locally available. |
| Sidechain/nested transcript | Child transcript captured without raw event spam. | `Complete` | Installed-app P4-001/P4-004 smokes showed Task sidechain transcript in the sidebar with cleaned child content instead of raw JSON. | Save richer raw sidechain transcript in P7-005 for fixture refresh. |
| Agent failures | Failed/cancelled subagents show compact state and useful error. | `Complete` | Installed-app P4-005 denial smoke found and fixed stuck active chips; retry showed failed red sidebar state and no created denied file. | Keep failure finalization covered for event buffers and saved transcripts. |
| Multi-provider agents | Codex/Copilot/Cursor agent events use same `AgentNode` model. | `Partial` | Generic fixtures. | Add provider-specific live/fixture captures after Claude is solid. |

### Slash Commands, Skills, And Composer Commands

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| App slash commands | `/pet`, `/diff`, `/settings`, etc. are provider-neutral app actions. | `Complete` | Slash palette tests plus installed-app P5 smoke showed app/project/global/skill grouping and no duplicate `/agents` entry. | Keep grouped palette behavior covered when adding provider commands. |
| App command palette | Global app actions are discoverable outside the composer slash palette. | `Complete` | `Cmd+K`/`Ctrl+K` and `Cmd+Shift+P`/`Ctrl+Shift+P` open a grouped global palette; native menu accelerators cover new chat, search, rename, pin/unpin, navigation, panels, Settings, and Shortcuts. | Keep palette, native menu accelerators, and Shortcuts settings in sync as app-level actions change. |
| Provider slash commands | Prompt-like provider commands appear only where supported and useful. | `Complete` | Installed-app P5 smoke ran project command `/ui-smoke`, disposable global command `/orchestrator-global-smoke`, project skill `/skill:tiny-skill`, and disposable global skill `/skill:orchestrator-global-smoke`. | Add cache/invalidation if repeated scans become visible. |
| Built-in Claude TUI commands | True TUI-only commands open terminal overlay or provider management UI. | `Complete` | Settings P5 smoke showed read-only MCP/plugins/agents surfaces and `Purge project state` remained an explicit manual terminal handoff. | Add terminal-launch buttons only if the handoff UX is requested. |
| Project commands | Discover `.claude/commands` and render in command palette. | `Complete` | Installed-app P5 smoke ran `.claude/commands/ui-smoke.md` and returned `P5_PROJECT_COMMAND_OK`; `project-command.jsonl` fixture covers the parsed shape. | Keep fixture current as Claude command output changes. |
| Global commands | Discover `~/.claude/commands`. | `Complete` | Installed-app P5 smoke created a disposable global command, ran `/orchestrator-global-smoke` to `P5_GLOBAL_COMMAND_OK`, then removed the temporary files. | Do not leave smoke-only global commands in user config. |
| Project skills | Discover `.claude/skills` and expose useful runnable entries. | `Complete` | Installed-app P5 smoke discovered and ran `/skill:tiny-skill`, returning `tiny skill loaded`; `project-skill.jsonl` covers the parsed shape. | Keep project skill directory rendering in Skills panel. |
| Global skills | Discover `~/.claude/skills`. | `Complete` | Installed-app P5 smoke created a disposable global skill, ran `/skill:orchestrator-global-smoke` to `P5_GLOBAL_SKILL_OK`, then removed the temporary files. | Do not leave smoke-only global skills in user config. |
| Skill variables | Expand `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`, `$ARGUMENTS` where provider semantics allow. | `Partial` | `$ARGUMENTS` expansion is covered for discovered slash commands. | Add session/skill-dir variable expansion only after confirming Claude semantics for those contexts. |
| Command safety | Mutating/provider-state commands require confirmation or terminal handoff. | `Implemented` | Provider command surfaces block quota/mutating commands and settings renders them as terminal/confirmation handoffs. | Add explicit terminal-launch buttons only after confirming the desired handoff UX. |

## Claude Code Structured-First Coverage Map

The product target is first-class Orchestrator UI on top of Claude structured JSON/JSONL output. Native Claude remains a provider-management escape hatch, not a selectable chat lane.

| Claude Code surface | Structured-first Orchestrator mapping | Status | Remaining work |
| --- | --- | --- | --- |
| Assistant text and partials | Flat transcript text with streaming deltas and no raw JSON. | `Complete` | Keep partial/final dedupe fixtures current. |
| File tools: Read, Write, Edit, Delete, Glob/Grep/LS | Compact tool summaries, file cards, and Diff ownership. | `Complete` | Keep live workspace-effect smoke in git-backed repo after UI changes. |
| Bash | Permission card, bounded command/output details, resumed execution. | `Complete` | Refresh fixtures if Claude denial/hook payload changes. |
| MCP tools during a run | Tool cards and permission scopes using the shared MCP action vocabulary. | `Complete` | Add more real MCP server fixtures as local servers become available. |
| AskUserQuestion | User-input card with choices/free-form answer; never permission UI. | `Complete` | Polish answered-card copy if UX gets crowded. |
| SendUserMessage / `--brief` | User-facing updates map to a compact assistant status card when the tool appears; current live Claude 2.1.140 emits ordinary assistant text. | `Implemented` | `brief-usage.jsonl`; live probes with `--brief` and budget caps returned `ORCH_BRIEF_STATUS_OK` as assistant text and did not list `SendUserMessage` in tools. Keep fixture parser support and re-probe after Claude CLI changes. |
| Plan mode, TodoWrite, ExitPlanMode | Plan sidebar/card, plan approval card, keep-planning path. | `Complete` | Prefer structured plan fixtures over native plan placeholder evidence going forward. |
| Task/Agent subagents | Agent chips, sidebar tabs, cleaned nested transcripts, failure states. | `Complete` | Keep sidechain fixtures fresh; add more selected-agent live runs when useful. |
| `--agent` selected launch agent | Composer agent picker; launch-only provider flag. | `Complete` | Add clearer empty-state messaging when no agents are configured. |
| `--agents <json>` custom agents | Future agent editor/importer with validation. | `Planned` | Design only after built-in configured agents stay stable. |
| Project/global slash commands | Discover prompt-like commands and expand/send through structured runs. | `Complete` | Add cache invalidation only if repeated scans are visible. |
| Claude skills as slash commands | Skills panel plus slash palette entries for project/global skills. | `Complete` | Add variable semantics beyond `$ARGUMENTS` after confirming Claude behavior. |
| Cross-provider Capabilities page | One inventory for skills, plugins, MCPs, apps/connectors, agents, hooks, commands, and instructions across Claude and Codex. | `Implemented` | `src/main/providerResources.ts`, `src/main/capabilityCreator.ts`, `src/main/capabilityManager.ts`, `src/renderer/src/components/CapabilitiesPage.tsx`, `docs/capabilities-surface-matrix.md`, provider tests. | Keep provider-native install/update/auth/reload actions gated until explicit confirmation UX exists. |
| Capability sync/import | Users can backfill missing provider projections or import provider-native resources as portable Orchestrator capabilities. | `Implemented` | `src/main/capabilitySync.ts`, `src/main/__tests__/capabilitySync.test.ts`, `src/renderer/src/components/CapabilitiesPage.tsx`, `docs/capability-sync-spike.md`. | File-backed skill/plugin/MCP sync is live with dry-run UI and registry metadata. Provider-native install execution remains gated until explicit confirmation UX exists. |
| Built-in interactive slash commands | Orchestrator-native surfaces where safe; manual provider-management stays out of normal chat. | `Implemented` | `/btw` probe with `claude -p --output-format json --max-budget-usd 0.02 "/btw ..."` returned `/btw isn't available in this environment.` with zero turns/cost, confirming it is not a structured `-p` surface. Orchestrator now owns `/btw` side questions instead of depending on provider TUI state. |
| MCP list/get | Settings inventory and details without raw JSON spam. | `Complete` | Keep failed-local-server states readable. |
| MCP add/remove/reset/config mutations | Gated provider-management handoff. | `Gated` | Confirmation/terminal handoff only; never silently mutate provider config. |
| Plugin list | Settings inventory without raw JSON spam. | `Complete` | Recheck when local Claude plugins exist. |
| Plugin install/enable/disable/update/uninstall | Gated provider-management handoff. | `Gated` | Confirmation/terminal handoff only. |
| Auth status | Compact settings/diagnostics status. | `Implemented` | Verify in installed app after next settings pass. |
| Login/logout/setup-token/update/install/project purge | Explicit terminal handoff or confirmation. | `Gated` | Keep destructive/provider-state actions out of chat runtime. |
| `--mcp-config`, `--strict-mcp-config`, `--plugin-dir`, `--plugin-url` | Session-scoped advanced launch config. | `Planned` | Add only with validation and a clear user-facing settings surface. |
| Attachments / `--file` | Shared attachment model in composer. | `Implemented` | Composer local-file chips pass attachment context into runs; Claude resource attachments map to `--file file_id:relative_path` in command tests. Live-test provider-hosted file resources when a safe file id is available; expand to image/resource provider support later. |
| Usage/cost/budget/fallback | Settings-level provider diagnostics, not per-session sidebar chrome. | `Partial` | Claude result usage/cost parses into `UsageSummary`, and live `--brief` probes emitted usage/cost fields. The session Usage sidebar was removed in favor of settings-level diagnostics. |
| Worktree/tmux/from-pr/fork/name/remote-control | Advanced session-launch or provider-management controls. | `Research` | Prefer app-managed worktrees; only surface provider-native extras with clear value. |
| Doctor/ultrareview/debug/chrome/IDE | Diagnostics or gated provider actions. | `Research` | Classify each as no-quota diagnostics, quota-spending, or terminal-only before implementation. |

### MCP, Plugins, Agents Config, And Provider Management

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Claude auth status | Settings shows compact status, not raw CLI output. | `Implemented` | Smoke probes. | Verify in installed app. |
| Claude login/logout | Explicit terminal handoff or confirmation; never silent. | `Gated` | CLI help verified. | Design confirmation/terminal flow. |
| Claude MCP list/get | Settings renders servers/tools compactly. | `Complete` | Installed-app P5 smoke rendered compact `git` and `wiki-server` failed-to-connect rows, and `MCP details` expanded structured scope/status/type/command/args without raw JSON spam. | Keep local failure states readable and non-blocking. |
| Claude MCP add/remove/reset | Confirmation or terminal handoff only. | `Gated` | CLI help verified. | Add gated command flow in settings. |
| Claude `.mcp.json` prompt | Provider-management prompt outside normal chat. | `Won't Do` | Removed with the Claude-native parser/prompt bridge. | If needed later, implement as an explicit Settings or terminal-handoff flow. |
| Claude plugin list | Settings renders plugins compactly. | `Complete` | Installed-app P5 smoke rendered plugin list as compact `None` output. | Recheck if local Claude plugins are later configured. |
| Claude plugin mutations | Explicit confirmation or terminal handoff. | `Gated` | CLI help verified. | Add gated flow or mark terminal-only. |
| Claude agents list | Settings shows configured agents compactly. | `Complete` | Installed-app P5 smoke showed `4 active agents`: `Explore · haiku`, `general-purpose · inherit`, `Plan · inherit`, `statusline-setup · sonnet`; P4-006 reused the same native list in the composer. | Keep parser tolerant of CLI heading/count formatting. |
| Claude agent mutation | Confirmation/terminal handoff. | `Gated` | CLI help verified. | Decide product scope. |
| Doctor/update/install/setup-token/project purge | Diagnostics or terminal-only; destructive/system flows gated. | `Gated` | CLI help verified. | Add policy table before implementation. |

### Attachments, Images, Usage, And Advanced Launch

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Claude file attachments | Composer can attach local files as prompt context and provider file resources via `--file`. | `Implemented` | `Attachment` model, composer file chips, IPC file picker, and command construction test for `--file file_abc:docs/context.md`. | Live-test a real `file_id:relative_path` resource when one is safely available. |
| Codex images | Composer image attachment only when provider/runtime supports it. | `Planned` | Codex help verified. | Add shared attachment capability after Claude file path. |
| Usage/cost | Capture provider usage where emitted and route it to settings/provider diagnostics instead of a per-session inspector tab. | `Partial` | `brief-usage.jsonl`, provider tests, and live Claude `--brief` result with `total_cost_usd` / token fields. Session `UsagePanel` was removed during the sidebar cleanup. | Build the settings-level usage surface when provider diagnostics are normalized. |
| Rate limits/errors | Auth/rate/quota errors are classified and actionable. | `Complete` | `failure-categories.jsonl` plus provider tests classify auth, quota, rate-limit, and generic model failures into distinct session statuses. | Keep classifier strings narrow enough to avoid false positives. |
| Claude launch extras | `--agent`, `--agents`, `--name`, `--session-id`, `--fork-session`, `--from-pr`, `--worktree`, `--tmux`, `--fallback-model`, `--max-budget-usd`, `--json-schema`, `--file`. | `Partial` | `--agent` is surfaced in the composer agent picker and command tests cover launch-only `--agent` behavior. | Add only remaining launch extras with clear user value. |
| Provider profiles/backends | Codex local/OSS, Cursor Bedrock/API key, Copilot custom providers. | `Research` | Help/package evidence. | Defer until Claude support is complete. |

### Cross-Provider Parity

| Feature | Target UX | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| Codex exec automation | Deterministic structured lane for smoke/automation. | `Partial` | Live `codex exec --json` on 2026-05-13 emitted `item.completed` / `agent_message`; `exec-item-agent-message.jsonl` now covers that shape. | Keep exec as automation; do not fake interactive approvals through exec. |
| Codex app-server approvals | Real approval UX via Codex app-server protocol. | `Implemented` | `src/main/codexAppServerRuntime.ts` starts stdio app-server, opens/resumes threads, starts turns, and answers command/file/permission approval requests; `npm run live:codex-appserver` passed against Codex 0.128.0. | Live-smoke an approval-producing Codex run from the installed UI before promoting auto-review as a default. |
| Codex MCP elicitation | Map to `user_input.requested` and answer through app-server. | `Implemented` | `app-server-approval-question.jsonl` covers `mcpServer/elicitation/request`; `CodexAppServerRuntimeManager` responds to elicitation requests. | Capture a real MCP elicitation transcript when a local MCP server asks for form input. |
| Cursor print mode | Structured stream lane. | `Partial` | Adapter/tests; keychain caveats. | Add partial-output parsing and keychain-aware diagnostics. |
| Cursor plan/ask/worktree/MCP/rules | Shared plan/workspace/extension surfaces. | `Research` | Help verified. | Implement after Claude/Codex core. |
| Copilot prompt/interactive/SDK | Map rich SDK/CLI events to Orchestrator abstractions. | `Research` | Package/CLI research. | Defer until Claude is complete; keep diagnostics honest. |
| Provider diagnostics | Binary/version/auth/models/probes distinguish missing, auth error, keychain error, and smoke pass. | `Implemented` | `smoke:providers`. | Continue updating as provider probes change. |
| Capabilities inventory | First-class global left-nav surface for skills, plugins, apps, MCP servers, agents, hooks, and commands across providers. Project instruction files stay in project/chat context. | `Implemented` | `src/renderer/src/components/CapabilitiesPage.tsx`; `src/main/providerResources.ts`; `providers:listResources`; `npm run smoke:ui:auto -- --capabilities` passed with screenshot evidence. | Add provider-native marketplace install/update/auth actions behind confirmations. |
| Custom capabilities | Create global portable skills, portable plugin packages, and MCP configs from one screen where possible; edit/remove file-backed global skills/plugins/MCP config entries. | `Partial` | `src/main/capabilityCreator.ts`; `src/main/capabilityManager.ts`; `capabilityCreator.test.ts`; `capabilityManager.test.ts`; `npm run test:providers` passed 141/141, including portable plugin marketplace and mirror lifecycle coverage. | Promote provider-native plugin install/enable and MCP reload once confirmation flows are designed. |

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
| V-006 | Plan approval reaches Claude plan flow instead of prompting for `~/.claude/plans/*.md`. | `Implemented` | Live installed-app smoke: Claude plan artifact write auto-allowed, `Plan Ready` card shown, real workspace file write still prompted. |
| V-007 | Completed subagents appear in the Agents sidebar with cleaned transcript text. | `Implemented` | Live installed-app smoke on Task subagent; raw `agentId`/`<usage>` trailer removed by `src/types/activityView.ts`. |
| V-008 | Project skills render directory-backed Claude skills in the Skills panel. | `Implemented` | Live installed-app smoke showed `.claude/skills/tiny-skill/SKILL.md` as `Project skills 1 file`. |
| V-009 | Latest source/test checkpoint committed. | `Complete` | Commit `97d30c39` (`Polish Claude agent UI flows`); working tree clean afterward. |
| V-010 | P2 workspace effects, file references, Bash permissions, and Diff edge cases verified in installed app. | `Complete` | Installed-app P2 smoke on `/private/tmp/orchestrator-agent-ui-smoke`; `npm run test:providers` 126/126 and `npx tsc -p tsconfig.web.json --noEmit` passed. |
| V-011 | P3 permissions, user questions, plan approval, permission scopes, and mode picker verified in installed app. | `Complete` | Installed-app P3 smoke on `/private/tmp/orchestrator-agent-ui-smoke`; `toolActions.test` covers URL/MCP/long-path permission summaries. |
| V-012 | P5 command/skill/settings surfaces verified in installed app. | `Complete` | Installed-app CUA smoke ran project/global commands, project/global skills, MCP details, plugin list, agents list, and purge-state handoff on `/private/tmp/orchestrator-agent-ui-smoke`. |
| V-013 | P7 fixture refresh and failure classification verified. | `Complete` | Added `hook-approval.jsonl`, `plan-approval-live.jsonl`, `project-command.jsonl`, `project-skill.jsonl`, `sidechain-real.jsonl`, `mcp-web-approval.jsonl`, and `failure-categories.jsonl`; `npm run test:providers` passed. |
| V-014 | P4 selected Claude agent launch verified in installed app. | `Complete` | Composer listed configured Claude agents, selecting `Explore` changed the run label to `Claude · Explore · Sonnet 4.6 · High`, and the installed-app run returned `P4_SELECTED_AGENT_OK`. |
| V-015 | Isolated UI verification profile exists. | `Complete` | `src/main/appProfile.ts` selects `ORCHESTRATOR_PROFILE` / `ORCHESTRATOR_USER_DATA_DIR` before stores open; `npm run smoke:app` launches a separate dev Electron profile with a visible titlebar badge, clean user data, and pet overlay disabled by default. Packaged smoke copies `dist/mac-arm64/Orchestrator.app` to a temp renamed bundle. |
| V-016 | Claude native chat runtime retired. | `Complete` | Composer no longer exposes a Structured/Native runtime picker; stale Claude chat sessions normalize back to structured/headless before sending; Claude-native terminal parser/prompt code and runtime-parity script were removed. |
| V-017 | Codex app-server chosen as the rich Codex runtime target. | `Complete` | Local Codex 0.128.0 app-server help and generated v2 schema expose structured approvals, questions, diffs, plans, agents, plugins, skills, MCP, account, model, filesystem, hooks, and terminal APIs. |
| V-018 | Brief/status events, usage metadata, attachments, `/btw` side questions, and automated detached UI smoke landed. | `Complete` | `brief-usage.jsonl`; `npx tsc -p tsconfig.node.json --noEmit`; `npx tsc -p tsconfig.web.json --noEmit`; `npm run test:providers`; `npm run smoke:ui:auto`; live Claude 2.1.140 `--brief` probes showed usage/cost fields but no `SendUserMessage` tool. |
| V-019 | First-class Capabilities page landed. | `Complete` | `src/renderer/src/components/CapabilitiesPage.tsx`; `src/main/capabilityCreator.ts`; `npm run build`; `npm run test:providers` 141/141; `npm run smoke:ui:auto -- --capabilities` screenshot `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-capabilities-1778792716697.png`. |
| V-020 | Sidebar pin ordering and noisy file-reference cards hardened. | `Complete` | `src/types/sessionOrdering.ts`; `sessionOrdering.test.ts`; unresolved relative prose references now disappear instead of showing missing cards; `npm run test:providers` 156/156, `npm run build`, `npm run smoke:ui:auto -- --sidebar`, and `git diff --check` passed. |
| V-021 | Header thread identity and provenance strip landed. | `Complete` | Header shows environment icon, project/folder, branch when available, and provider/model; chat actions menu includes copy folder path and copy session ID. `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, and `npm run smoke:ui:auto -- --inspector` passed with `headerIdentity` and `headerActionMenu`. |
| V-022 | Sidebar project actions completed CP-003. | `Complete` | Project headers now support rename, pin/unpin, open folder, archive chats, and remove project. Sidebar smoke verifies project action menu labels, project rename, pinned-project ordering, existing pinned-chat ordering, hover pin, rename, running spinner, and unread/error-only dots. |
| V-023 | Settings structure split landed. | `Complete` | Settings now separates Providers & models from Provider diagnostics and Data controls. Settings smoke verifies Appearance taxonomy, Provider diagnostics, and Data controls sections. |
| V-024 | Theme parity parser and settings coverage landed. | `Complete` | `src/types/themeSharing.ts` owns the portable `codex-theme-v1:` schema used by Settings and node tests. `test:providers` verifies round-trip, defaults, bad prefix, invalid variant, invalid hex, invalid contrast, and invalid semantic colors; settings smoke verifies theme import/sharing controls. |
| V-025 | File-card confidence smoke landed. | `Complete` | Transcript-layout smoke proves unresolved relative prose cards are suppressed while explicit absolute missing references still render as missing with disabled actions. |
| V-026 | Sidebar live-transition smoke landed. | `Complete` | Sidebar smoke drives a pinned chat through running and completed/unread states and verifies its pin order remains stable. |
| V-027 | Transcript polish gate re-verified. | `Complete` | `transcript-stress`, `session-switch`, and `scroll` smokes passed, covering long-thread virtualization, lazy hydration, search jump, session switching, and manual-scroll behavior during streaming. |
| V-028 | Packaged pet-overlay smoke passed. | `Complete` | `npm run pack:mac`, `npm run smoke:ui:auto -- --packaged --pet-overlay`, and packaged resource listing verified bundled pet atlases and packaged overlay behavior. |
| V-029 | Right-panel tab menu and reorder landed. | `Complete` | Inspector smoke verifies the right-panel tab context menu and active tab order changes. |
| V-030 | Browser workbench controls landed. | `Complete` | Inspector smoke verifies real in-page find matches, zoom state, mobile viewport width, completed cache reload, screenshot, and embedded local page loading. |
| V-031 | Files tab binary/empty-state coverage landed. | `Complete` | Inspector smoke verifies bounded preview loading, binary preview fallback, no-results state clearing the stale preview/actions, and add-to-chat from the Files tab. |

### Codex Parity Matrix

The installed Codex app is the reference for desktop polish, but Orchestrator should translate those patterns into provider-neutral concepts instead of becoming a clone of one provider. This matrix tracks the visible gaps found by inspecting `/Applications/Codex.app` and comparing it against the current Orchestrator code.

| Area | Codex behavior | Orchestrator today | Gap | Status | What we need to do |
| --- | --- | --- | --- | --- | --- |
| Sidebar row primitive | Dense single-line task row with title, right metadata, status/env slots, hover-revealed actions, keyboard/focus states, and hidden-on-hover metadata. | `SessionItem` now uses compact metadata-first rows with stable status/action slots and keyboard focus behavior. | Core row behavior is covered. | `Complete` | Revisit only when new connection/cloud metadata becomes real app data. |
| Sidebar hover details | Rich delayed hover card shows title, project/folder, environment, worktree/cloud/remote context, and status details. | Hover cards show title, preview, project, folder, branch/worktree, provider/model, status, and updated time. | Core hover metadata is covered. | `Complete` | Add connection/cloud fields only when those concepts are first-class. |
| Sidebar environment identity | Compact local/cloud/worktree/remote icons with tooltips and full labels in hover cards. | Rows use compact local/worktree environment icons with labels in hover cards and accessible titles. | Core local/worktree identity is covered. | `Complete` | Add remote/cloud identity only when backed by provider/app state. |
| Sidebar status model | Active, follower, idle, needs-resume, read-only, realtime voice, automation next run, unread, error, and running states. | Running spinner, unread/error dots, permission/question previews, active row styling, and pinned live-transition stability are implemented. | Provider-specific states without Orchestrator data remain out of scope. | `Complete` | Add new states only when backed by runtime data. |
| Pinned and recent ordering | Pinned section is global and row metadata does not reorder unexpectedly. | Global pinned section exists, stable pin ordering is implemented, and sidebar smoke covers live running/completed/unread transitions. | No known open gap. | `Complete` | Keep sidebar smoke around pin/status transitions. |
| Sidebar organization | Organize popover supports project/connection/recent/chronological views, created/updated sort, filtering, show more/less, project pinning and actions. | Persisted organize/sort modes, pinned projects, project rename/open/archive/remove actions, project collapse, new chat, and show more/less are implemented. | Connection filtering remains out of scope until connections become first-class Orchestrator data. | `Complete` | Keep sidebar smoke covering project actions, pinned project ordering, pinned chat ordering, and status-dot transitions. |
| Header thread identity | Header carries env icon, secondary metadata line, and thread actions such as copy cwd/session/app link, fork/worktree, side chat. | Header is intentionally quiet after status chip removal and now shows compact project/folder/branch/provider identity. | Deeper fork/worktree/app-link actions are still missing, but the primary identity strip is in place without bringing back a status chip. | `Implemented` | Keep deeper actions inside the chat actions menu; add app-link/fork/worktree actions only when those flows are backed by stable product behavior. |
| Settings structure | Many focused sections: General, Appearance, Git, Connections, Worktrees, Agent, Personalization, Shortcuts, Usage, Browser, Computer Use, MCP, Hooks, Plugins, Skills, Data Controls. | Settings now separates General, Appearance, Providers & models, Provider diagnostics, Shortcuts, Pets, and Data controls while keeping Capabilities as a first-class left-nav surface. | Git/Connections/Worktrees/Usage/Browser/Computer Use should appear only when those concepts have dedicated product behavior. | `Complete` | Keep settings smoke covering Appearance taxonomy, Provider diagnostics, and Data controls; add new sections only with backed behavior. |
| Theme model | Light/dark/system top-level setting plus separate light/dark chrome themes and code theme IDs. | Settings persists `appearanceTheme`, per-variant chrome theme objects, and per-variant code theme IDs while preserving legacy preset compatibility. | Migration and resolver are in place; future work is only new product-backed theme fields. | `Complete` | Keep typecheck/settings smoke on the appearance resolver and schema before install builds. |
| Custom colors | Editable accent, surface/background, ink/foreground, contrast, translucent/opaque window behavior, semantic colors. | Appearance settings edit per-variant accent/background/foreground/contrast/opaque windows plus semantic diff/skill colors. | The core Codex-style color surface is covered. | `Complete` | Extend only when additional semantic tokens are visible in the app shell. |
| Theme import/export | Portable `codex-theme-v1:` JSON theme string with validation. | Appearance settings copy/import portable light and dark themes through the shared parser. | Round-trip and validation are covered; no known open gap. | `Complete` | Keep parser tests aligned with any future schema version. |
| Typography and motion | Raw UI/code font families, UI/code font sizes, font smoothing, pointer cursor, reduce motion. | Settings exposes UI/code font choices, numeric font sizes, font smoothing, pointer cursor, and reduced-motion toggles. | Core controls are covered. | `Complete` | Add new accessibility controls only with rendered UI verification. |
| Token layer | Broad `text-token-*`, `bg-token-*`, `border-token-*`, and `--color-token-*` bridge across app surfaces. | Theme application maps Orchestrator variables into Codex-like token aliases used by shared surfaces. | Current bridge is sufficient for the app shell; deeper token expansion can follow new surfaces. | `Complete` | Revisit as right-panel workbench components need more shared token names. |
| Right panel architecture | Reusable app-shell panel with durable tab controller, closeable/reorderable/context-menu tabs, overflow polish, width/full-width persistence, empty states. | `ContextSidebar` has per-session `rightPanel` state, closeable/reorderable tabs, width/full-width state, and smoke-covered shell behavior. | Core architecture is covered. | `Complete` | Keep future workbench tabs inside this shell. |
| Right panel existing content | Existing panels can live as durable tabs before deeper redesign. | Plan, Review, Agents, Extensions, Browser, Files, and Side Chat render through durable tab kinds. | Core panel port is covered. | `Complete` | Preserve tab contracts when redesigning individual panels. |
| Review/diff surface | Review tab has changed-file search, diff CSS, view controls, binary/no-content states, file actions, and bounded source previews. | `DiffPanel` now uses the shared bounded preview IPC for binary/image/PDF/source fallback states while preserving git diff rendering. | The core Review workbench behavior is covered; comments/action affordances remain future product work. | `Complete` | Keep inspector smoke covering search, textual diff, binary state, file actions, and no stale preview behavior. |
| Workspace/files browser | Side panel can browse workspace tree, search files, preview source/markdown/images/PDFs, copy paths, open with editor, add to chat. | Files tab browses/searches workspace files, previews text/images, gives PDF/binary fallbacks, copies/reveals/opens paths, and adds files to chat. | Current core workbench behavior is covered. | `Complete` | Keep inspector smoke covering text preview, binary fallback, empty search, and add-to-chat. |
| Browser tab | First-class Browser tab with URL bar, empty state, local server affordances, screenshot, external open, cache/cookie/device/find controls. | Browser tab has URL/navigation, empty state, local affordances, screenshot/external open, in-page find, zoom, mobile preview, and cache reload. | Cookie controls are intentionally deferred until there is a clear user-facing browser-data workflow. | `Complete` | Keep inspector smoke covering embedded load, screenshot, find, zoom, mobile preview, and cache reload. |
| Side chat | Side chats are real nested conversation tabs with independent IDs and cleanup on close. | `/btw` creates closeable side-chat tabs with independent history, persisted drafts, pending/error/unread tab badges, and close cleanup. | Core side-chat tab behavior is covered. | `Complete` | Add richer side-chat commands only when provider/runtime use cases appear. |
| Terminal panel | Bottom panel uses the same app-shell tab-controller ideas, multiple terminal tabs, persisted sizing, and theme-aware xterm colors. | Bottom terminal has persisted height/tabs, theme-aware xterm colors, hide/show restore, and tab context menu reorder/close. | Core terminal shell parity is covered. | `Complete` | Add provider-terminal handoff shortcuts only with explicit product flows. |
| Plan/tasks/usage/resources | Plan/tasks/rate-limit/resource surfaces exist as polished app pages or side surfaces where useful. | Plan and usage/resource concepts exist, but usage moved out of session sidebar and resources live mainly in Capabilities/settings. | Need clearer split between session-local workbench content and settings/global diagnostics. | `Partial` | Keep usage/provider diagnostics in Settings; put session-local plan/tasks/resources in right-panel tabs only when they help the active run. |
| Pets/personalization | Pet overlay has precise resize corner affordance and broader personalization settings. | Pet overlay has corner-only resize behavior, packaged atlas resources, packaged overlay smoke coverage, and a Pets settings section. | Current practical parity is covered; add personalization controls only when backed by stable product behavior. | `Complete` | Keep packaged pet-overlay smoke and resource listing in the release/install verification path. |
| Verification discipline | Codex-like polish is validated through rendered UI behavior, not screenshots alone. | Automated UI smokes cover sidebar hover/status, settings/theme, right-panel tabs, files, review, browser, side-chat, terminal, pets, transcript stress, and command palette. | Core parity surfaces now have targeted smokes. | `Complete` | Add focused smokes with each new surface instead of broad screenshot-only checks. |

### Codex Parity Backlog

This is the preferred implementation order. Each item should land as a small checkpoint with tests/smokes and a decision-log note.

| ID | Scope | Outcome | Status | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| CP-001 | Sidebar row primitive | Reusable row with compact title/meta/status/action slots and stable hover/focus behavior. | `Complete` | Existing sidebar state. | `npx tsc -p tsconfig.node.json --noEmit`; `npx tsc -p tsconfig.web.json --noEmit`; `npm run smoke:ui:auto -- --sidebar`; `git diff --check`. |
| CP-002 | Sidebar hover metadata | Hover card shows project, root/cwd, branch/worktree, provider/model, status, and updated time. | `Complete` | CP-001; project/session metadata. | Sidebar smoke now asserts hover card and environment icon visibility. |
| CP-003 | Sidebar organization | Persisted organize/sort modes, project actions, show more/less. | `Complete` | CP-001 and CP-002. | Sidebar smoke covers organize menu options, Chronological list, By project restore, project action menu, project rename, project pin ordering, and show more/less for long project groups. |
| CP-004 | Right panel state model | Per-session durable `rightPanel` store replaces boolean inspector state. | `Complete` | Current `ContextSidebar` behavior mapped. | `npx tsc -p tsconfig.node.json --noEmit`; `npx tsc -p tsconfig.web.json --noEmit`; `npm run smoke:ui:auto -- --inspector`; `git diff --check`. |
| CP-005 | Right panel shell | Closeable tabs, active tab persistence, width/full-width persistence, overflow/empty states. | `Complete` | CP-004. | Inspector smoke covers active tab, tab list, persisted width path, Expand/Restore panel behavior, tab context menu, and tab reordering. |
| CP-006 | Port existing panels | Diff, Plan, Agents, Extensions, and Side Questions run inside the new shell unchanged where possible. | `Complete` | CP-005. | Covered by the right-panel shell checkpoint; existing panel rendering still flows through the durable tab shell and inspector smoke. |
| CP-007 | Review tab v2 | Changed-file search, view controls, open/reveal/copy actions, binary/no-content states, and bounded source previews. | `Complete` | CP-006. | Inspector smoke seeds a git repo with modified/deleted/untracked/binary files, verifies the Review search path, textual diff, and binary state; typechecks and `git diff --check` are the code gate. |
| CP-008 | Files tab | Workspace tree/search/preview/actions and add-to-chat. | `Complete` | CP-005; editor-open settings. | Inspector smoke opens the Files tab, searches a nested path with spaces, previews file content, attaches the selected file to the composer, verifies binary fallback copy, and verifies the no-results empty state. |
| CP-009 | Browser tab | URL bar, navigation, empty state, screenshot, external open, local server affordance. | `Complete` | CP-005. | Inspector smoke opens the Browser tab, loads a local HTTP fixture, verifies the page title, captures a screenshot preview, and exercises find, zoom, mobile preview, and cache reload controls. |
| CP-010 | Side-chat tabs | `/btw` becomes durable side-chat tabs with independent composer/history and close cleanup. | `Complete` | CP-005. | Inspector smoke opens multiple `/btw` side-chat tabs, verifies independent draft persistence across tab switches, and verifies close cleanup. |
| CP-011 | Terminal shell parity | Persisted bottom panel state, theme-aware terminal colors, optional multiple terminal tabs. | `Complete` | Theme tokens; existing terminal. | Terminal smoke verifies multi-tab state persists across hide/show and verifies terminal tab context menu/reorder. |
| CP-012 | Theme model v2 | Light/dark/system plus per-variant chrome/code theme settings and migration. | `Complete` | Current settings schema. | Typecheck and settings smoke cover the expanded schema, light/dark/system resolver, Codex-style token bridge, and code/UI font-size tokens. |
| CP-013 | Custom theme editor | Editable accent/surface/foreground/contrast/semantic colors, font sizes, motion/cursor toggles. | `Complete` | CP-012. | Settings smoke verifies the expanded settings surface still renders; controls edit per-variant chrome colors, semantic colors, font sizes, and motion/cursor/font-smoothing toggles. |
| CP-014 | Theme import/export | Validated `codex-theme-v1:` import/export. | `Complete` | CP-012 and CP-013. | Settings smoke imports a valid `codex-theme-v1:` string and verifies sharing controls are present; `themeSharing.test.ts` validates round-trip, defaults, variant, prefix, hex colors, contrast, and semantic colors. |
| CP-015 | Settings taxonomy | Settings sections match the level of Codex polish without crowding normal preferences. | `Complete` | CP-012; capabilities surfaces. | Settings smoke verifies Appearance is grouped into Mode, Presets, Theme editor, Sharing, Typography, and Layout and reading. |
| CP-016 | Pet/personalization polish | Packaged pets render cleanly and resize/state behavior matches Codex expectations where practical. | `Complete` | Current pet overlay. | Pet overlay smoke verifies compact corner-only resize affordance, hidden grip on normal mascot hover, visible grip on handle hover/focus, geometry bounds, and status mapping. |
| CP-017 | Header thread identity | Compact header provenance without the old noisy status chip. | `Complete` | Sidebar metadata, project/session state, provider/model state. | Inspector smoke asserts the header environment icon, metadata line, and backed copy actions for folder/project/session/provider session IDs. |
| CP-018 | Settings structure split | Provider defaults, diagnostics, data controls, appearance, shortcuts, and personalization are separated without exposing capability matrices in normal chat. | `Complete` | CP-015 and provider diagnostics. | Settings smoke asserts Provider diagnostics and Data controls sections in addition to the Appearance taxonomy. |

### Next Polish Queue

These are the next small, user-visible polish slices to consider after the current reliability checkpoint.

| ID | Polish Area | Target UX | Status | Next action |
| --- | --- | --- | --- | --- |
| POL-001 | File cards | Cards appear only for confident, useful file references; no review prose, numeric literals, or unresolved relative guesses. | `Complete` | Renderer smoke now proves unresolved relative prose cards are suppressed while explicit absolute missing files still show disabled actions. |
| POL-002 | Pet overlay | Built-in pets render without white-square glitches and state transitions feel close to Codex. | `Complete` | Packaged pet-overlay smoke and packaged resource listing passed after rebuilding `dist/mac-arm64/Orchestrator.app`. |
| POL-003 | Command palette | Keyboard-first actions feel native and do not duplicate composer slash commands. | `Complete` | Transcript-layout smoke verifies command palette open paths, grouping, recent commands, fuzzy search, shortcut labels, and the search-transcript action. |
| POL-004 | Sidebar polish | Pinned, unread, running, rename, and project grouping feel stable during live runs. | `Complete` | Sidebar smoke now covers running/completion transitions while a pinned session receives messages, including spinner, unread dot, and stable pinned order. |
| POL-005 | Transcript polish | Long threads feel complete, searchable, and scroll-stable without exposing implementation copy. | `Complete` | `transcript-stress`, `session-switch`, and `scroll` smokes are the pre-install gate after transcript changes. |
| POL-006 | Codex-style settings taxonomy | Settings follow Codex's sectioned model while keeping Orchestrator behavior provider-neutral. | `Complete` | CP-015 and CP-018 are complete; add future sections only when backed by product behavior. |
| POL-007 | Theme parity | Theming supports per-variant custom colors, typography, semantic tokens, and import/export. | `Complete` | CP-012 through CP-014 are complete; revisit only when adding new visible theme surfaces. |
| POL-008 | Right sidebar parity | The right inspector becomes a durable app-shell workbench with tabs, files, review, browser, side chat, and polished empty states. | `Complete` | CP-004 through CP-010 are complete; keep new right-panel surfaces inside this shell. |
| POL-009 | Sidebar Codex parity | Chat rows expose project/branch/worktree/status metadata on hover and support richer organization modes. | `Complete` | CP-001 through CP-003 are complete; revisit only when new connection/cloud project data exists. |

### P0: Re-establish Installed-App Verification

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P0-001 | Diagnose final installed-app Computer Use attach timeout. | `Complete` | After reinstall/relaunch, `Computer Use get_app_state` returned the installed Orchestrator accessibility tree in 0.5-2.3 seconds. | Previous timeout did not reproduce after restart/reinstall; treat as stale app/CUA session unless it recurs. |
| P0-002 | Add repeatable install/restart smoke checklist. | `Complete` | `Installed App Smoke Checklist` below documents commands and expected observable app state; checklist was run from a clean package on 2026-05-12. | Keep this checklist as the minimum installed-app gate after major changes. |
| P0-003 | Verify final installed app can start a plain Claude session. | `Complete` | Live installed app returned `FINAL_INSTALLED_APP_SMOKE_OK` with Claude Sonnet 4.6 High in Ask mode. | Verified before the terminal command-bar patch; no Claude runtime changes landed afterward. |
| P0-004 | Verify packaged resources load. | `Complete` | `npm run test:smoke-config` passed; `/Applications/Orchestrator.app/Contents/Resources/pets/*/{pet.json,spritesheet.webp}` contains ditto, orchestrator, pika, and psyduck. `/pet` applied without visible error. | Pet overlay animation fidelity remains separate P-polish work. |
| P0-005 | Add isolated UI verification window/profile. | `Complete` | `node scripts/launch-isolated-app.mjs --print --profile smoke-check --user-data-dir /private/tmp/orchestrator-profile-check --workspace-dir /private/tmp/orchestrator-workspace-check` printed the expected isolated profile config; `npm run smoke:app:packaged -- --reset --profile smokecua` launched a temp renamed bundle with separate `userData`; TypeScript/build/provider tests passed. | Future UI verification should start here instead of the user's active Orchestrator window. Packaged smoke remains useful for parity, but current Computer Use can list the renamed app while `get_app_state` does not attach to it by name. |
| P0-006 | Use dev Electron as the primary Computer Use target. | `Complete` | `npm run smoke:app -- --reset --profile devcua --workspace-dir /private/tmp/orchestrator-agent-ui-smoke` launched `Orchestrator - Devcua`; Computer Use `get_app_state("Electron")` attached to `localhost:5173`, showed the `Devcua profile` badge and clean empty project state, and a Settings click opened the dev Settings UI. | Isolated profiles skip legacy user-data migration so old projects/sessions do not leak into smoke runs. |
| P0-007 | Add automated detached UI driver. | `Complete` | `npm run smoke:ui:auto` launches an isolated Electron profile, bootstraps a disposable project/session, inspects profile badge/composer/sidebar rail, and exits with JSON evidence. | Extend assertions as new primary UI flows land. |

### P1: Claude Core Run Semantics

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P1-001 | Plain answer stream. | `Complete` | Live installed-app Claude answer streams and ends idle; fixture covers same event shape; P0 installed artifact was verified. | Keep covered by provider fixtures and installed-app smoke checklist. |
| P1-002 | Multi-turn continuity. | `Complete` | Installed-app two-turn smoke remembered `ORCHID-912` and returned `CONTINUITY_OK: ORCHID-912` without duplicate transcript. | Verified with Claude Sonnet 4.6 High in Ask mode. |
| P1-003 | Stop during assistant text. | `Complete` | Installed-app stop smoke interrupted a long streaming answer, removed the streaming cursor, restored idle composer state, and re-enabled Send after text entry. | Added regression coverage for interrupted streaming/queued text settlement. |
| P1-004 | Stop during tool execution. | `Complete` | Installed-app Bash sleep smoke was approved once, stopped while the tool was active, returned to idle, and composer Send re-enabled after text entry. | Permission card cleanup was hardened so stale approvals no longer look active. |
| P1-005 | Stop during permission pause. | `Complete` | Installed-app Write permission pause now shows Stop; clicking Stop closes the request, restores the composer, and both smoke target files remained absent. | Added `canStopSession` coverage for `waiting_for_permission` and inactive permission-card rendering. |
| P1-006 | Queue next message. | `Complete` | Installed-app active-run queue smoke showed a queued card, then ran the follow-up to `P1_QUEUE_FOLLOWUP_OK` after primary completion. | Queue card includes Steer action while pending. |
| P1-007 | Steer queued message. | `Complete` | Installed-app retry queued a follow-up, clicked Steer, interrupted the active stream around line 181, avoided provider error, and ran `P1_STEER_RETRY_OK`. | Fixed intentional interrupt failure filtering and streaming-message settlement before follow-up resume. |
| P1-008 | Decide Claude one-process vs bidirectional stream. | `Complete` | Decision: keep current structured one-prompt-per-process plus resume/interrupt path for P1; bidirectional stdin remains deferred until a same-process-only user-question or plan behavior proves necessary. | P1-002 through P1-007 now pass without a bidirectional transport replacement. |

### P2: Workspace Effects, Diff, And Files

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P2-001 | File create. | `Complete` | Installed-app smoke created `p2-created-by-claude.txt`; transcript showed `Wrote 1 file`, file card opened/revealed, Diff showed untracked file, and filesystem content was `P2_CREATE_OK`. | Verified in disposable git repo `/private/tmp/orchestrator-agent-ui-smoke`. |
| P2-002 | File edit. | `Complete` | Installed-app smoke edited `p2-edit-target.txt`; transcript showed `Edited 1 file`, file card existed, Diff showed `+1 -1`, and filesystem content matched the requested two-line result. | Verified in disposable git repo. |
| P2-003 | File delete. | `Complete` | Installed-app smoke deleted `p2-delete-target.txt`; missing card disabled Open/Reveal and Diff showed deleted-file mode with removed baseline line. | Verified in disposable git repo. |
| P2-004 | File read/search/list. | `Complete` | Installed-app smoke found `P2_SEARCH_NEEDLE`; transcript summary stayed compact as `Read 2 files · Listed 1 listing`. | Verified with Claude Sonnet 4.6 High. |
| P2-005 | Bash allow once. | `Complete` | Installed-app Bash `printf 'P2_BASH_ONCE_OK\n'` prompted, `Allow Once` resumed, card showed `Allowed once`, and final reply was `P2_BASH_ONCE_DONE`. | Harmless no-network command. |
| P2-006 | Bash allow session. | `Complete` | Installed-app two-command Bash smoke prompted on the first command, `Allow Session` resumed, second command ran without another prompt, and final reply was `P2_BASH_SESSION_DONE`. | Session grant behavior verified. |
| P2-007 | Bash deny. | `Complete` | Installed-app denied Bash redirection showed `Denied` plus `Error — Permission denied by user`; `p2-bash-deny.txt` remained absent and no bogus success text appeared. | Current behavior ends the run with explicit denied-tool error rather than an assistant success reply. |
| P2-008 | File reference resolution matrix. | `Complete` | Installed-app retry after fixes showed cards for cwd-relative/absolute file, quoted path with spaces, long path with spaces, generated file, missing file with disabled actions, and `~/Desktop/Orchestrator/docs/orchestrator-source-of-truth.md`. | Fixed parser support for quoted/space/tilde paths and raised visible reference cap to 8. |
| P2-009 | Git Diff edge cases. | `Complete` | Installed-app Diff showed six states: modified, deleted, large modified `+50 -1`, staged added, staged modified, and untracked; previews worked for deleted, large, and staged-added rows. | Verified in disposable git repo. |

### P3: Permissions, Questions, And Plan Mode

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P3-001 | Write allow once. | `Complete` | Live installed-app smoke created disposable file after `Allow Once`; provider tests pass. | Already verified before commit `97d30c39`. |
| P3-002 | Write allow session. | `Complete` | Live installed-app smoke created two files with only first Write prompt after `Allow Session`; tests pass. | Already verified before commit `97d30c39`. |
| P3-003 | Write deny. | `Complete` | Live installed-app smoke denied Write, run ended idle, file absent; tests pass. | Already verified before commit `97d30c39`. |
| P3-004 | AskUserQuestion choices. | `Complete` | Installed-app smoke showed `Answer Required`, `ALPHA_P3_CHOICE`/`BETA_P3_CHOICE` options, answer sent, user bubble, and final `P3_CHOICES_DONE:ALPHA_P3_CHOICE`. | Choice path verified separate from permission resume. |
| P3-005 | AskUserQuestion free-form answer. | `Complete` | Installed-app smoke typed `FREEFORM_P3_TOKEN_742`, showed answer sent/user bubble, and final `P3_FREEFORM_DONE:FREEFORM_P3_TOKEN_742`. | Claude also emitted placeholder option buttons in this run; free-form path still worked. |
| P3-006 | Plan approve. | `Complete` | Installed-app smoke showed plan artifact auto-allow, native `Plan Ready`, `Plan approved`, real Write permission, `Allowed once`, file content `P3_PLAN_APPROVE_OK`, and final `P3_PLAN_APPROVE_DONE`. | Fixture capture remains P7-002, not a P3 blocker. |
| P3-007 | Plan keep-planning. | `Complete` | Installed-app smoke clicked `Keep Planning`, showed `Kept planning`, answered follow-up with `Keep planning`, and verified `p3-plan-keep-planning.txt` remained missing. | No workspace edit occurred. |
| P3-008 | Permission scope details. | `Complete` | Installed-app Write permission card showed full path scope; parser tests cover Write/Edit/Bash/ExitPlanMode/WebFetch/MCP and long-path truncation. | Add screenshots later if permission-card CSS changes. |
| P3-009 | Permission mode picker. | `Complete` | Installed-app smoke previously verified Claude permission modes; follow-up CUA verified Settings default Auto, primary composer choices Auto/Plan/Ask first, and advanced disclosure for Auto-edit/Preapproved only/raw tool fields/Bypass unsafe. | Existing sessions can retain their saved mode. |

### P4: Agents And Subagents

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P4-001 | Task subagent happy path. | `Complete` | Live installed-app smoke used Task to read README; main chat showed compact delegation summary and Agents sidebar showed final child transcript. | Fixture-backed by `task-agent.jsonl`; live run verified against installed Sonnet app. |
| P4-002 | Active agent chips while running. | `Complete` | Long Task smoke paused on `Bash sleep 18`; running chip appeared above composer and opened the active agent tab. | Verified before allowing the pending Bash permission. |
| P4-003 | Completed agent sidebar tabs. | `Complete` | Live installed-app smoke showed completed agent selectable with cleaned transcript. | Covered by commit `97d30c39` and P4-001 retry. |
| P4-004 | Nested/sidechain transcript capture. | `Complete` | Real Claude Task sidechain transcript appeared in the sidebar without raw event spam. | Richer raw sidechain fixture capture remains P7-005, not a P4 blocker. |
| P4-005 | Agent failure/cancel states. | `Complete` | Denying a subagent Bash permission now finalizes the child as failed, removes the running chip, shows a red failed tab, and leaves the target file absent. | Added event-buffer and saved-transcript regression coverage. |
| P4-006 | Selected-agent launch option. | `Complete` | Installed-app composer listed configured Claude agents, selecting `Explore` changed the label to `Claude · Explore · Sonnet 4.6 · High`, and the run returned `P4_SELECTED_AGENT_OK`. | Parser bug found and fixed during CUA smoke: CLI headings like `Built-in agents:` no longer render as agent chips. |

### P5: Slash Commands, Skills, MCP, Plugins, Agents

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P5-001 | Slash palette app commands. | `Complete` | Installed-app CUA smoke showed grouped app/project/global/skill command entries and no duplicate `/agents`; `npm run test:providers` covers registry behavior. | Keep palette grouping stable as more provider commands land. |
| P5-002 | Project command run. | `Complete` | Installed-app CUA smoke ran `.claude/commands/ui-smoke.md`; Claude requested harmless Bash `ls`, `Allow Once` resumed, and final output included `P5_PROJECT_COMMAND_OK`. | `project-command.jsonl` backs automated parsing. |
| P5-003 | Global command discovery/run. | `Complete` | Created disposable `~/.claude/commands/orchestrator-global-smoke.md`, ran `/orchestrator-global-smoke` to `P5_GLOBAL_COMMAND_OK`, then removed it. | No smoke-only global command remains in user config. |
| P5-004 | Project skill discovery. | `Complete` | Installed-app CUA smoke showed `tiny-skill/SKILL.md` in Skills panel and slash palette. | Covered by project-skill fixture and provider tests. |
| P5-005 | Project skill run. | `Complete` | Installed-app CUA smoke ran `/skill:tiny-skill`; response was `tiny skill loaded`. | `project-skill.jsonl` backs automated parsing. |
| P5-006 | Global skill discovery/run. | `Complete` | Created disposable `~/.claude/skills/orchestrator-global-smoke/SKILL.md`, ran `/skill:orchestrator-global-smoke` to `P5_GLOBAL_SKILL_OK`, then removed it. | No smoke-only global skill remains in user config. |
| P5-007 | Settings MCP list/get. | `Complete` | Installed-app settings CUA smoke rendered `git` and `wiki-server` failure rows; `MCP details` expanded structured details for `git`. | Local MCP failures are readable and non-blocking. |
| P5-008 | Settings plugin list. | `Complete` | Installed-app settings CUA smoke rendered plugin output compactly as `None`. | Use no-mutation command only. |
| P5-009 | Settings agents list. | `Complete` | Installed-app settings CUA smoke rendered `4 active agents`: `Explore`, `general-purpose`, `Plan`, and `statusline-setup`. | Selected-agent launch remains P4-006. |
| P5-010 | Mutating provider-management gates. | `Complete` | Installed-app settings CUA smoke showed `Purge project state` as a disabled/manual terminal handoff; no destructive command was executed. | Keep destructive/provider-state commands gated. |

### P6: Layout, Design, And Accessibility QA

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P6-001 | No page-level horizontal scroll. | `Complete` | Installed-app CUA walkthrough covered long file cards, settings output, permission cards, tool rows, and sidebar panels with no visible page-level horizontal scroll at the tested desktop viewport. | Add viewport-resized screenshot automation if Browser/Playwright stability improves. |
| P6-002 | Bounded tool expansions. | `Complete` | Code caps expanded tool output panes and installed-app P5/P6 walkthrough showed compact tool rows/details rather than transcript-wide dumps. | Keep max-height behavior when adding new tool detail renderers. |
| P6-003 | Permission card visual polish. | `Complete` | Long paths wrap inside max-width cards; live permission smokes showed readable cards and no layout spill. | Re-verify if approval-card structure changes. |
| P6-004 | Answered user-question and permission-card polish. | `Complete` | Installed-app CUA smoke approved a Bash permission, navigated to Settings and back, and the card still showed `Allowed once`; the run finished `P6_PERMISSION_DECISION_DONE`. | Keep result-state labels stable for inactive permission and user-question cards. |
| P6-005 | Terminal command input. | `Complete` | In the installed app, Computer Use entered `echo TERMINAL_COMMAND_VISIBLE_OK`; the terminal pane showed the command and `TERMINAL_COMMAND_VISIBLE_OK`. | Added an accessible command bar backed by `terminal:runCommand`, fixed terminal live-event targeting to the main renderer, and made terminal colors consistently dark. |
| P6-006 | Sidebar control audit. | `Complete` | Installed-app CUA walkthrough showed the right rail reduced to Agents, Diff, and Skills; Terminal remains in the header/bottom pane rather than duplicated in the rail. | Keep secondary controls out of the main transcript. |

### P7: Fixtures And Automated Coverage

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P7-001 | Save live hook approval fixture. | `Complete` | Added `hook-approval.jsonl`; tests cover approval broker event shape. | Refresh if Claude hook payload changes. |
| P7-002 | Save plan approval fixture. | `Complete` | Added `plan-approval-live.jsonl`; tests cover native plan approval shape. | Refresh after future plan-mode UX changes. |
| P7-003 | Save project command fixture. | `Complete` | Added `project-command.jsonl`; tests cover discovered command execution shape. | Keep in sync with P5 project command smoke. |
| P7-004 | Save skill fixture. | `Complete` | Added `project-skill.jsonl`; tests cover discovered skill execution shape. | Keep in sync with P5 skill smoke. |
| P7-005 | Save sidechain/nested agent fixture from real run. | `Complete` | Added `sidechain-real.jsonl`; tests cover sidechain transcript capture without raw event spam. | Refresh if Claude changes `Task`/sidechain event naming. |
| P7-006 | Save MCP/web approval fixtures. | `Complete` | Added `mcp-web-approval.jsonl`; tests cover MCP and WebFetch/WebSearch approval event mapping. | Live network/web fetch remains gated by local provider/network state. |
| P7-007 | Save auth/rate/quota error fixtures. | `Complete` | Added `failure-categories.jsonl`; tests cover auth, quota, rate-limit, and generic model failure classification. | Keep synthetic failure text realistic and narrow. |
| P7-008 | Add renderer/Playwright smoke harness or documented CUA script. | `Complete` | `Installed App Smoke Checklist` now includes rebuild/install/launch and core CUA checks; Decision Log records the P5-P7 CUA script and observed states. | Promote to automated Playwright only if app automation becomes stable enough. |

### P8: Cross-Provider After Claude Closure

| ID | Task | Status | Verification Required | Notes |
| --- | --- | --- | --- | --- |
| P8-001 | Shared runtime event contract cleanup. | `Planned` | Common types cover session/message/tool/permission/user_input/plan/agent/diff/usage across providers. | Do not start broad refactor until Claude UX is stable. |
| P8-002 | Codex app-server approval runtime. | `Complete` | `codex --help`, `codex app-server --help`, generated schema, parser fixtures, fake transport test, and `npm run live:codex-appserver` verified. | Follow-up only for richer settings surfaces: app/plugin/skill/model/account browsers. |
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
- `task-permission-denied.jsonl`
- `hook-approval.jsonl`
- `plan-approval-live.jsonl`
- `project-command.jsonl`
- `project-skill.jsonl`
- `sidechain-real.jsonl`
- `mcp-web-approval.jsonl`
- `failure-categories.jsonl`
- `brief-usage.jsonl`

- [x] Claude plain answer.
- [x] Claude partial assistant message.
- [x] Claude file/tool action bundle.
- [x] Claude permission denial.
- [x] Claude AskUserQuestion.
- [x] Claude plan/todo events.
- [x] Claude ExitPlanMode denial.
- [x] Claude Task/Agent subagent events.
- [x] Claude Task/subagent permission-denied failure event.
- [x] Claude live hook approval event stream.
- [x] Claude MCP tool approval.
- [x] Claude web fetch/search approval.
- [x] Claude plan approval live transcript.
- [x] Claude sidechain/nested real transcript.
- [x] Claude slash command real transcript beyond `/help`.
- [x] Claude project/global command fixture.
- [x] Claude skill fixture.
- [x] Claude rate limit/quota/auth error.
- [x] Claude SendUserMessage/brief usage fixture.
- [x] Codex app-server approval fixture.
- [x] Codex MCP elicitation fixture.
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
21. Installed app or isolated packaged smoke profile is rebuilt and smoke-verified after major changes.

## Isolated UI Smoke Profile

Use this path when the user has active work in their normal Orchestrator window. It launches a separate app profile with its own Electron `userData` directory, a visible `Smoke profile` titlebar badge, and the pet overlay disabled by default.

For Computer Use, prefer the dev Electron lane:

```bash
npm run smoke:app -- --reset
```

Then target Computer Use at:

```text
Electron
```

Expected: the CUA tree shows `Window: "Orchestrator - <Profile>"`, `URL: localhost:5173/`, and the profile badge. Do not target `Orchestrator` while the user has active installed-app work.

For packaged parity against `dist/mac-arm64/Orchestrator.app` without replacing `/Applications/Orchestrator.app`:

```bash
npm run pack:mac
npm run smoke:app:packaged -- --reset
npm run smoke:ui:auto -- --packaged --transcript-layout
```

Useful options:

```bash
npm run smoke:app -- --profile p8-codex --user-data-dir /private/tmp/orchestrator-p8-codex --workspace-dir /private/tmp/orchestrator-agent-ui-smoke
npm run smoke:app -- --print --profile smoke-check
```

Expected:

- The titlebar shows `<Profile> profile`.
- `window.api.app.getProfile()` returns `isIsolated: true` and a `/private/tmp` or otherwise explicit `userDataDir`.
- Existing sessions/settings in the user's normal Orchestrator window do not appear in the smoke profile.
- Computer Use targeting is reliable for the dev lane via `Electron`. Packaged renamed-bundle targeting is not fully solved in the current plugin: it can list the renamed smoke app, but `get_app_state` did not attach by renamed app name in the 2026-05-13 smoke.
- Packaged smoke scripts prepare a renamed temporary app bundle with a profile-specific bundle id before launching, so they do not register as the normal installed app.
- Do not quit or replace the user's installed `/Applications/Orchestrator.app` unless they explicitly ask for that.

## Installed App Smoke Checklist

Use this only when the installed app itself must be replaced or verified. Prefer the isolated smoke profile above when the user is actively using their normal Orchestrator window. Record the result in the Decision Log.

1. Build the packaged app:

```bash
npm run pack:mac
```

2. Quit the currently installed app before replacing it only if the user has approved touching the active installed app:

```bash
killall Orchestrator
```

3. Copy the fresh package into `/Applications` through the guarded installer:

```bash
npm run install:mac
```

Expected: if `/Applications/Orchestrator.app` is still running, the installer refuses to copy. Only bypass with `ORCHESTRATOR_ALLOW_RUNNING_APP=1` when intentionally accepting the risk of replacing a live app bundle.

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

## P5-P7 Computer Use Smoke Script

Use this after command/skill/settings/fixture changes. The current disposable project is `/private/tmp/orchestrator-agent-ui-smoke`.

1. Project command: open slash palette, run `/ui-smoke`, approve only the harmless listed command if prompted, and verify `P5_PROJECT_COMMAND_OK`.
2. Project skill: open slash palette, run `/skill:tiny-skill`, and verify `tiny skill loaded`.
3. Global command: create a disposable global command only for the smoke, run it from the palette, verify `P5_GLOBAL_COMMAND_OK`, then delete the global command file.
4. Global skill: create a disposable global skill only for the smoke, run it from the palette, verify `P5_GLOBAL_SKILL_OK`, then delete the global skill directory.
5. Settings MCP: click `MCP servers` and `MCP details`; failure states should render as compact status rows and details should be structured, not raw JSON.
6. Settings plugins: click `Plugins`; empty local config should render compactly as `None`.
7. Settings agents: click `Configured agents`; the installed app should show the current configured Claude agents compactly.
8. Gated provider management: inspect `Purge project state`; it must remain a disabled/manual terminal handoff unless the user explicitly confirms a destructive provider-state action.
9. Layout/design pass: while completing the above, watch for page-level horizontal scroll, overwide cards, raw event spam, duplicated sidebar controls, and stale active-state labels on answered permission/question cards.

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

### 2026-05-19

- Header provenance checkpoint: the titlebar now shows a compact environment icon plus project/folder, branch when available, and provider/model metadata under the active chat title. The old idle/status chip stays removed; deeper thread actions live in the chat actions menu, which now includes copy folder path and copy session ID.
- Verification passed for the header provenance checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, and `npm run smoke:ui:auto -- --inspector`; inspector smoke now asserts `headerIdentity` and `headerActionMenu`.
- Sidebar project-actions checkpoint: project headers now have a compact actions menu for rename, pin/unpin, open folder, archive project chats, and remove project. Pinned projects sort above unpinned projects without changing pinned-chat ordering.
- Verification passed for the sidebar project-actions checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, and `npm run smoke:ui:auto -- --sidebar`; sidebar smoke now asserts `projectActionMenuWorks`, `projectRenameWorks`, and `projectPinWorks`.
- Settings structure checkpoint: Settings now separates provider defaults from provider diagnostics/config/probes and adds a Data controls section for the active local profile. Capabilities remains a separate left-nav surface instead of being buried in Settings.
- Verification passed for the settings structure checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, and `npm run smoke:ui:auto -- --settings`; settings smoke now asserts `settingsDiagnosticsSection` and `settingsDataControls`.
- Theme parity coverage checkpoint: portable theme import/export now lives in shared `src/types/themeSharing.ts` so Settings and node tests use the same schema validator.
- Verification passed for the theme parity coverage checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run test:providers`, and `npm run smoke:ui:auto -- --settings`; the provider test suite now covers valid round-trip, default code themes, missing prefix, invalid variant, invalid hex colors, invalid contrast, and invalid semantic colors.
- Command palette verification checkpoint: the transcript-layout smoke now explicitly verifies command-palette open shortcuts, grouping, recent commands, fuzzy terminal lookup, shortcut labels, and the command-palette search-transcript action.
- File-card confidence smoke checkpoint: the transcript-layout fixture now includes both an unresolved relative prose reference and an explicit absolute missing path, and the smoke verifies the relative prose card is suppressed while the absolute missing card keeps disabled actions.
- Sidebar live-transition checkpoint: the sidebar smoke now drives a pinned row from running to completed/unread while another chat is pinned, and verifies the spinner, completion dot, and pinned order remain stable.
- Transcript polish gate checkpoint: `npm run smoke:ui:auto -- --transcript-stress`, `npm run smoke:ui:auto -- --session-switch`, and `npm run smoke:ui:auto -- --scroll` passed as the long-thread/session-switch/streaming-scroll verification set.
- Packaged pet-overlay checkpoint: `npm run pack:mac` rebuilt the packaged app, `npm run smoke:ui:auto -- --packaged --pet-overlay` passed in a renamed temp bundle, and packaged resources include ditto/orchestrator/pika/psyduck `pet.json` plus `spritesheet.webp`.
- Right-panel tab shell checkpoint: the right-panel tab strip now follows stored tab order, exposes a context menu with move-left/move-right/close actions, and inspector smoke verifies the browser/files active order changes after moving Browser left.
- Browser workbench checkpoint: Browser tab controls now include persisted in-page find, zoom in/out/reset, desktop/mobile preview, and reload without cache; webview popups are denied/externalized by the main process. Inspector smoke verifies real find matches, zoom state, mobile viewport width, cache reload completion, screenshot, and local embedded page load.
- Files workbench checkpoint: Files tab now renders image previews, PDF/system-viewer fallback copy, binary fallback copy, and bounded text previews through a preview IPC that sniffs extensionless binaries before decoding; inspector smoke verifies text preview, binary fallback, no-results state without a stale preview/action, and add-to-chat.
- Right-sidebar completion checkpoint: side-chat tabs now persist independent drafts across tab switches and expose pending/error/unread badges; terminal tabs now have a context menu with move-left/move-right/close behavior; header chat actions expose backed copy actions for folder/project/session/provider session IDs. The parity matrix was reconciled so completed sidebar/right-panel rows no longer read as stale `Partial` work.
- Transcript verification checkpoint: streaming assistant text, code block behavior, markdown table wrapping, and raw-event cleanliness are now marked complete. `npm run smoke:ui:auto -- --scroll` verifies visible streaming cursor, manual-scroll preservation, completion cursor cleanup, and final-text dedupe; `npm run smoke:ui:auto -- --transcript-layout` verifies desktop/narrow code and table bounds plus raw provider data staying out of the transcript.

### 2026-05-18

- Sidebar/shortcut checkpoint: pinned chats are global above projects, pin/unpin is available on hover, double-click rename works from the sidebar row, running rows use a spinner in the status-dot slot, idle gray status dots and the header idle/status chip were removed, and Settings now includes a Shortcuts section.
- Transcript search decision: search should not be permanent thin chrome. It opens on `Cmd+F`/`Ctrl+F`, focuses the input, and closes without leaving empty search UI behind.
- Command palette decision: app-wide actions should be discoverable with `Cmd+K`/`Ctrl+K`, while provider/project prompt commands remain in the composer slash palette.
- Codex parity shortcut decision: mirror the installed Codex app's broad shortcut shape where it fits Orchestrator: native Electron menu accelerators, `Cmd+Shift+P` as a command-palette alternate, `Cmd+J` for terminal, `Cmd+Alt+R` rename, `Cmd+Alt+P` pin/unpin, `Cmd+1-9` chat jumps, and a searchable Shortcuts settings table.
- App install safety decision: `/Applications/Orchestrator.app` replacement must go through `npm run install:mac`, which refuses to copy over a running installed app unless `ORCHESTRATOR_ALLOW_RUNNING_APP=1` is explicitly set. Packaged smokes launch renamed temp bundles instead of the raw `dist/mac-arm64/Orchestrator.app`.
- Command shortcut source-of-truth decision: native menus, command palette, and Settings shortcuts share `src/types/appCommands.ts`; command palette filtering uses scored fuzzy matching and records a small local Recent section.
- Crash note: `Orchestrator-2026-05-18-152656.ips` was an early native `_RegisterApplication`/`NSApplication init` abort from a packaged smoke-test app under the repo path, not the installed `/Applications/Orchestrator.app`. Avoid direct raw packaged launches while the installed app is running.
- Transcript paging copy decision: users should not see implementation language like "earlier messages hidden for faster chat switching." Older pages remain available, but the affordance should read as a quiet history action, not a performance warning.
- Transcript scroll decision: streaming output should not fight manual reading. Auto-follow is allowed only while the user is already near the bottom; upward scroll intent disables following until the user explicitly jumps back to latest.
- Transcript performance direction: bounded recent rendering is acceptable as an implementation detail, but the product promise is a complete searchable transcript. If long chats keep growing, prefer virtualized rendering and lazy hydration over user-visible "hidden messages" language.
- Lazy loading direction: the next transcript performance pass should make the full thread feel physically scrollable while only mounting the visible window plus overscan. Manual "Show earlier" can remain as a fallback, but it should not be the primary long-thread experience.
- Virtualization checkpoint: transcript rows now render through a measured virtual window with overscan, while older chunks hydrate automatically near the top and preserve the visible row anchor. This keeps long threads feeling complete without mounting every loaded row at once.
- Stress checkpoint: `npm run smoke:ui:auto -- --transcript-stress` seeds a 2,501-message transcript, verifies the latest page renders within budget, lazy-loads older chunks near the top, jumps to an early result through full-transcript search, and keeps mounted virtual rows bounded.
- Verification passed for the transcript-virtualization checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, `npm run smoke:ui:auto -- --transcript-stress`, `npm run smoke:ui:auto -- --session-switch`, `npm run smoke:ui:auto -- --transcript-layout`, and `npm run smoke:ui:auto -- --scroll`.
- Verification passed for the lazy-transcript checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, `npm run smoke:ui:auto -- --session-switch`, and `npm run smoke:ui:auto -- --scroll`.
- Verification passed for the streaming-scroll checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, `npm run smoke:ui:auto -- --scroll`, `npm run pack:mac`, copy to `/Applications/Orchestrator.app`, and packaged-vs-installed `app.asar` hash comparison.
- Verification passed for the sidebar/search/layout checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, `npm run smoke:ui:auto -- --sidebar`, `npm run smoke:ui:auto -- --transcript-layout`, `npm run smoke:ui:auto -- --session-switch`, `npm run pack:mac`, copy to `/Applications/Orchestrator.app`, and packaged-vs-installed `app.asar` hash comparison.
- Codex sidebar parity checkpoint: chat rows now use a compact metadata-first layout with an environment icon, right-side updated/status text, hover-revealed actions, keyboard focus behavior, and a Codex-style hover card with project, folder, branch/worktree, provider/model, status, and updated time. Branch lookup is lazy through the main-process git IPC so long sidebars do not eagerly probe every repo.
- Verification passed for the sidebar parity checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --sidebar`; the sidebar smoke now asserts hover-card and environment-icon visibility.
- Sidebar organization checkpoint: the sidebar now has a persisted Organize menu with By project, Recent projects, Chronological list, Sort by updated, and Sort by created modes, plus show-more/less inside long project groups. This matches the Codex direction of making organization a sidebar-level control while keeping Orchestrator provider-neutral.
- Verification passed for the sidebar organization checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --sidebar`; the sidebar smoke now switches into Chronological list and restores By project.
- Files-tab checkpoint: the right-panel shell now has an explicit Files tab opener. The tab keeps its durable shell state, shows a bounded workspace tree with search, previews text files, can copy/reveal/open selected paths, and can attach a selected file to the active composer.
- Verification passed for the Files-tab checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --inspector`; inspector smoke seeds a nested folder with spaces, searches that path in the Files tab, verifies preview content, attaches it to the composer, then returns to the Changes tab so existing right-panel assertions still compare against the Review surface.
- Browser-tab checkpoint: the right-panel shell now has an explicit Browser tab opener with a Codex-shaped empty state, URL bar, back/forward/reload controls, screenshot capture preview, external-open IPC, and quick local URL affordances. Electron `webviewTag` is enabled for the main window so this tab is a real embedded browser surface instead of a static link preview.
- Verification passed for the Browser-tab checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --inspector`; inspector smoke starts a local HTTP fixture, loads it in the Browser tab, confirms the side-panel title path, captures a screenshot preview, and returns to the Changes tab.
- Side-chat checkpoint: `/btw` now creates durable `sidechat:<id>` right-panel tabs with independent message arrays, per-chat titles, active-chat tracking, and close cleanup. Existing side-question storage remains as a compatibility fallback, but new composer and slash-palette `/btw` flows use side-chat tabs.
- Verification passed for the Side-chat checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --inspector`; inspector smoke opens two blank `/btw` side-chat tabs, verifies both are present in the tab strip, closes the active side-chat tab, and verifies the tab is removed.
- Terminal shell checkpoint: bottom-panel terminal state now lives in the per-session store with persisted height, tab list, active tab, and next-tab id. The terminal shell exposes Codex-like bottom-panel focus/data hooks while preserving the existing xterm-backed shell behavior and explicit tab close/kill path.
- Verification passed for the Terminal shell checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --terminal`; terminal smoke opens a second terminal tab, hides and restores the panel, and verifies the tab list, active tab, and height are preserved.
- Theme model checkpoint: settings now include Codex-shaped light/dark/system theme fields, per-variant chrome themes, per-variant code theme IDs, UI/code font sizes, pointer-cursor/font-smoothing/reduced-motion toggles, and a token bridge from Orchestrator variables to `--color-token-*` style names. `applyAppearance` resolves the v2 model while retaining legacy named-theme compatibility.
- Verification passed for the Theme model checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --settings`.
- Custom theme editor checkpoint: Appearance settings now expose Codex-style light/dark/system selection, per-variant chrome editors for accent/background/foreground/contrast/opaque windows, semantic color controls, UI/code font-size sliders, and font-smoothing/pointer-cursor/reduce-motion toggles.
- Verification passed for the Custom theme editor checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --settings`.
- Theme import/export checkpoint: Appearance settings now copy light/dark portable `codex-theme-v1:` strings and import validated portable themes into the matching light or dark variant while preserving code theme IDs.
- Verification passed for the Theme import/export checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --settings`; settings smoke imports a valid portable light theme and verifies the sharing controls render.
- Settings taxonomy checkpoint: Appearance settings are grouped as Mode, Presets, Theme editor, Sharing, Typography, and Layout and reading, so the new Codex-level theme controls are categorized instead of being one long mixed list.
- Verification passed for the Settings taxonomy checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --settings`; settings smoke now asserts the Appearance taxonomy headings.
- Pet personalization checkpoint: the overlay resize affordance is now a compact bottom-right corner target instead of a broad pet-surface hit area, and the overlay root no longer advertises a resize cursor while the normal mascot body remains draggable.
- Verification passed for the Pet personalization checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --pet-overlay`; pet smoke now asserts compact handle geometry, non-resize root cursor, hidden grip on mascot hover, visible grip on handle hover/focus, and existing notification/status behavior.
- Right panel state checkpoint: the inspector now writes through per-session `rightPanel` state with durable tab ids, active tab, width, full-width flag, and open state while preserving existing Diff, Plan, Agents, Extensions, and Side Question behavior. This is the foundation for replacing the inspector with a Codex-style app-shell tab workbench.
- Verification passed for the right panel state checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --inspector`; the inspector smoke now asserts the right-panel active tab, tabs list, and persisted width data path.
- Right panel shell checkpoint: the inspector now exposes Codex-like app-shell hooks, closeable durable tabs, a persisted Expand/Restore panel width control, and a right-panel focus area/tab-controller structure. This is still a shell pass; tab reordering and context-menu polish are deferred to the deeper workbench pass.
- Verification passed for the right panel shell checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --inspector`; the inspector smoke now clicks Expand panel and verifies the full-width state before restoring.
- Existing panel port checkpoint: Diff, Plan, Agents, Extensions, and Side Question content now render through the durable right-panel shell without changing their internal behavior, so future CP-007 and CP-010 work can improve individual tabs without replacing the container again.
- Review tab checkpoint: the Changes tab now behaves more like a review surface, with git-backed smoke data, changed-file search, a line-wrap control, open-file action, clearer no-diff context, and a changed-file preview that stays inside the right-panel shell. This is not yet Codex's full file-source tab system, but it moves the existing Diff panel into the Review direction.
- Verification passed for the Review tab checkpoint: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `git diff --check`, and `npm run smoke:ui:auto -- --inspector`; the inspector smoke seeds modified/deleted/untracked files and verifies Review search against the changed-file list.
- Review preview hardening checkpoint: the Review tab now uses the shared bounded file-preview IPC for binary/image/PDF/source fallback states, disables open/reveal for deleted files, adds reveal/copy actions, clears stale search selection, and shows an intentional binary state instead of raw git binary output.
- Pin-order reliability checkpoint: pinned chat ordering now lives in shared `src/types/sessionOrdering.ts`, is covered by `sessionOrdering.test.ts`, and is used by both main-process migration and renderer sorting. New pins append after existing pinned chats, and message recency no longer moves ordered pins.
- File-card confidence checkpoint: unresolved relative references extracted from assistant prose are suppressed after workspace resolution fails, while explicit absolute missing references can still render as disabled missing cards. This prevents review comments like bare class names or snippets from becoming visible missing-file cards.
- Verification passed for the pin/file-card checkpoint: `npm run test:providers` passed 156/156, `npm run build` passed, `npm run smoke:ui:auto -- --sidebar` passed, and `git diff --check` passed.

### 2026-05-11

- Created this canonical source-of-truth file.
- Current code default for Claude sessions is structured/headless CLI mode with hook approval bridge. The old Claude-native chat parser/prompt bridge has been removed from the app runtime.
- Older docs now point here for active status. Some historical notes still describe native CLI experiments, but their active runtime-decision sections have been aligned to the structured Claude default.
- Removed superseded plan/checklist docs from the remote-bound tree so this file remains the only active product specification.

### 2026-05-12

- Added `ProviderRuntimeManager` as the process lifecycle owner for current CLI lanes, including Claude hook prep, stdout parsing, stop, and interrupt-for-steer behavior.
- Added project/global Claude command and skill discovery with frontmatter descriptions, source-scoped slash palette grouping, and `$ARGUMENTS` expansion.
- Settings Native surfaces now include compact MCP list/details, plugin JSON list, and agents list rendering while mutating/quota commands remain terminal/confirmation handoffs.
- Fixed live Claude capability capture to parse structured `-p stream-json` stdout and use the structured runtime for normal Claude capability scenarios.
- Last verified: `CLAUDE_CAPABILITY_STRICT_EMPTY_MCP=1 npm run live:claude-capabilities` passed with Sonnet (`claude-sonnet-4-6`, low effort), covering plain answer, file ops, plan mode, streaming, auth status, MCP list, plugin JSON list, auto-mode defaults, and agents list.
- Last verified: `LIVE_PROVIDERS=claude npm run live:providers` passed with Sonnet (`claude-sonnet-4-6`, low effort), capturing `session.started`, assistant streaming, and `run.completed`.
- `npm run pack:mac` rebuilt `dist/mac-arm64/Orchestrator.app`; packaged resources include the bundled pets, and the packaged app launch was confirmed by process list. It was not copied over `/Applications/Orchestrator.app`.
- Verified `npm run test:providers`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run test:smoke-config`, `npm run smoke:providers`, `npm run build`, `npm run pack:mac`, and `git diff --check`.
- Checkpoint commit `97d30c39` (`Polish Claude agent UI flows`) landed the live-tested permission, plan, subagent, skills, settings, slash, and terminal polish pass.
- Live installed-app GUI smoke before the final label-only polish verified Write allow once, Write allow session, Write deny, AskUserQuestion choices, slash palette grouping, Diff for a real smoke git repo, project command discovery, project skill directory rendering, completed subagent sidebar transcript, and plan approval flow through Claude structured `Plan Ready`.
- The final installed-app Computer Use attach timeout no longer reproduces after restart/reinstall. `get_app_state` returned the `/Applications/Orchestrator.app/.../out/renderer/index.html` accessibility tree in 0.5-2.3 seconds.
- Final installed app plain Claude smoke passed: `Reply exactly FINAL_INSTALLED_APP_SMOKE_OK. Do not use tools.` returned `FINAL_INSTALLED_APP_SMOKE_OK` using Claude Sonnet 4.6 High in Ask mode.
- Packaged resource smoke passed: `npm run test:smoke-config` passed, installed pet resources include ditto/orchestrator/pika/psyduck `pet.json` and `spritesheet.webp`, and `/pet` applied without visible missing-resource errors.
- Terminal command input smoke passed in the installed app: Computer Use entered `echo TERMINAL_COMMAND_VISIBLE_OK`, clicked `Run`, and the terminal pane showed both the command and `TERMINAL_COMMAND_VISIBLE_OK`.
- Terminal design smell fixed during smoke: the terminal pane now uses a consistent dark palette instead of inheriting the light app background.
- Verification for this installed-app checkpoint: `npm run test:providers`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run test:smoke-config`, `npm run pack:mac`, copy to `/Applications`, relaunch, and Computer Use GUI smoke.
- P1 continuity smoke passed in the installed app: turn 1 returned `TURN1_OK`; turn 2 remembered `ORCHID-912` and returned `CONTINUITY_OK: ORCHID-912`.
- P1 stop-during-assistant-text initially failed: Stop removed the running backend state, but the partial assistant message kept its streaming cursor and the composer stayed visually stuck. Fixed by finalizing interrupted streaming/queued text when a run stops or when old non-running sessions load.
- P1 stop-during-assistant-text retry passed in the installed app: a long `STREAM_STOP_RETRY_LINE` run was interrupted, the assistant message no longer showed the streaming cursor, Stop disappeared, and entering `Composer usable after stop check` re-enabled Send.
- Verification for the P1 stop/continuity checkpoint: `npm run test:providers` passed 123/123, `npx tsc -p tsconfig.web.json --noEmit` passed, `git diff --check` passed, `npm run pack:mac` had rebuilt the app, and the rebuilt app was copied to `/Applications` before the Computer Use smoke.
- Residual verification note: one `Computer Use get_app_state` attach after relaunch took 87 seconds before returning the installed app tree. The app was responsive afterward, so treat this as a CUA/session flake unless it recurs.
- P1 stop-during-tool-execution passed in the installed app: a harmless Bash sleep command was allowed once, then stopped while active; the session returned to idle and the composer re-enabled Send after text entry.
- P1 stop-during-permission-pause initially exposed a real gap: the composer did not show Stop while Claude was waiting on a Write approval. Fixed by making `canStopSession` include `waiting_for_permission` and by rendering closed permission cards as inactive. Retry passed: Stop closed the pending request, the composer was usable, and both smoke files remained absent.
- P1 queue-next passed in the installed app: a follow-up was queued while a long primary answer streamed, the queued card showed `Queued` and `Steer`, and the follow-up ran to `P1_QUEUE_FOLLOWUP_OK` after the primary completed.
- P1 steer-next initially failed with a false provider-error state because Claude's intentional interrupt emitted `run.failed`, which lifecycle handling treated as a crash and killed the runtime before the queued follow-up could start. Fixed by filtering expected interrupt failures while a steer follow-up is pending and by settling the interrupted assistant stream before resuming the follow-up.
- P1 steer-next retry passed in the freshly reinstalled app: the primary answer stopped around `P1_STEER_RETRY_PRIMARY 181`, no error card appeared, and the follow-up returned `P1_STEER_RETRY_OK`.
- P1 transport decision: do not replace the current structured resume/interrupt path with a bidirectional stdin transport for P1. P1-002 through P1-007 now pass; keep `--input-format stream-json` as a deferred option for future same-process-only user-question or plan semantics.
- P3 AskUserQuestion choices passed in the installed app: Claude showed `Answer Required` with `ALPHA_P3_CHOICE`/`BETA_P3_CHOICE`, `ALPHA_P3_CHOICE` resumed as user input, and the run ended with `P3_CHOICES_DONE:ALPHA_P3_CHOICE`.
- P3 AskUserQuestion free-form passed in the installed app: typed `FREEFORM_P3_TOKEN_742`, the answer resumed through user-input UI rather than permission UI, and Claude returned `P3_FREEFORM_DONE:FREEFORM_P3_TOKEN_742`.
- P3 plan approve passed in the installed app: native `Plan Ready` appeared, `Approve Plan` resumed, a real workspace Write prompt appeared for `/private/tmp/orchestrator-agent-ui-smoke/p3-plan-approve.txt`, `Allow Once` created content `P3_PLAN_APPROVE_OK`, and Claude returned `P3_PLAN_APPROVE_DONE`.
- P3 plan keep-planning passed in the installed app: `Keep Planning` changed the plan card to `Kept planning`, Claude stayed in plan mode, follow-up `Keep planning` kept execution blocked, and `/private/tmp/orchestrator-agent-ui-smoke/p3-plan-keep-planning.txt` remained missing.
- P3 permission scope coverage is complete for the current contract: live Write cards show readable path scopes, and `toolActions.test` now covers Write/Edit/Bash/ExitPlanMode/WebFetch/MCP plus long-path truncation.
- P3 permission mode picker passed in the installed app before the later simplification: the menu showed Ask, Auto-edit, Plan, Auto safe, Allowlist, and isolated-only Bypass unsafe; no-tool runs in Auto-edit, Auto safe, and Allowlist returned exact sentinel replies. Bypass unsafe was inspected but not run.
- Verification for the P1 semantics checkpoint: `npm run test:providers` passed 125/125, `npx tsc -p tsconfig.web.json --noEmit` passed, `npm run pack:mac` passed, the app was copied to `/Applications`, relaunched, and Computer Use verified the installed UI steer retry.
- P2 workspace-effects smoke passed in the installed app on disposable repo `/private/tmp/orchestrator-agent-ui-smoke`: Claude read/listed/searched `P2_SEARCH_NEEDLE`, created `p2-created-by-claude.txt`, edited `p2-edit-target.txt`, deleted `p2-delete-target.txt`, and the filesystem/Diff panel matched those changes.
- P2 Bash permission smoke passed in the installed app: allow-once resumed a harmless `printf`, allow-session let the second harmless Bash command run without another prompt, and deny produced `Error — Permission denied by user` while leaving `p2-bash-deny.txt` absent.
- P2 file-reference matrix initially exposed a real bug: paths with spaces truncated into a bogus missing `p2` card, quoted paths and `~/...` paths were missed, and the four-card cap hid later references. Fixed by adding quoted/whole-line/tilde extraction, home-path resolution, truncated-space guardrails, and an 8-card visible cap.
- P2 file-reference retry passed in the installed app: cards resolved `p2-read-search.txt`, `"p2 paths/quoted path file.txt"`, the long path with spaces, generated `p2-created-by-claude.txt`, missing `p2-missing-reference.txt` with disabled Open/Reveal, and `~/Desktop/Orchestrator/docs/orchestrator-source-of-truth.md`.
- P2 Diff edge-case smoke passed in the installed app: the Diff panel showed `3 modified · 1 added · 1 deleted · 1 untracked +53 -3` across deleted, edited, large modified, staged added, staged modified, and untracked files, with previews for deletion, large diff, and staged add.
- Verification for the P2 checkpoint: `npm run test:providers` passed 126/126, `npx tsc -p tsconfig.web.json --noEmit` passed, `npm run pack:mac` passed twice after UI fixes, the app was copied to `/Applications`, relaunched, and Computer Use verified P2-008 and P2-009 in the installed app.
- P4 Task happy path passed in the installed app: Claude delegated README reading through Task, the main transcript showed compact delegation/tool summaries, and the Agents sidebar showed the child transcript with cleaned content.
- P4 active agent chips passed in the installed app: a long Task run paused on `Bash sleep 18`, showed a running chip above the composer, and clicking it opened the active child transcript tab before the permission was allowed.
- P4 agent failure smoke initially exposed a real stale-chip bug: denying a subagent Bash permission failed the main run but left the child chip running. Fixed by finalizing active agents on run failure for both event-buffer and saved-transcript reconstruction.
- P4 failure retry passed in the freshly reinstalled app: denying subagent Bash removed the running chip, showed a red failed agent tab with useful approval context, and `/private/tmp/orchestrator-agent-ui-smoke/p4-denied-agent-after-fix-2.txt` remained absent.
- Verification for the P4 checkpoint: `npm run test:providers` passed 128/128, `npx tsc -p tsconfig.web.json --noEmit` passed, `npm run pack:mac` passed, the app was copied to `/Applications`, relaunched, and Computer Use verified Task happy path, running-chip focus, completed sidebar tabs, sidechain transcript display, and failure/denial state.
- P5 command and skill smoke passed in the installed app: `/ui-smoke` returned `P5_PROJECT_COMMAND_OK`, `/skill:tiny-skill` returned `tiny skill loaded`, disposable global command `/orchestrator-global-smoke` returned `P5_GLOBAL_COMMAND_OK`, and disposable global skill `/skill:orchestrator-global-smoke` returned `P5_GLOBAL_SKILL_OK`; the temporary global files were removed afterward.
- P5 settings smoke passed in the installed app: MCP servers/details rendered compact failure rows for local `git`/`wiki-server`, plugin list rendered `None`, configured agents rendered four compact rows, and `Purge project state` stayed a manual terminal handoff without executing a destructive command.
- P6 design walkthrough found one real smell: permission cards could degrade to `Request closed` after approval/navigation. Fixed by persisting explicit permission decisions on result messages and rendering `Allowed once`, `Allowed for session`, `Denied`, or `Kept planning` after the request is inactive.
- P6 permission-card polish retry passed in the rebuilt installed app: approved a harmless Bash `printf`, navigated to Settings and back, and the card still showed `Allowed once`; Claude returned `P6_PERMISSION_DECISION_DONE`.
- P7 fixture refresh landed `hook-approval.jsonl`, `plan-approval-live.jsonl`, `project-command.jsonl`, `project-skill.jsonl`, `sidechain-real.jsonl`, `mcp-web-approval.jsonl`, and `failure-categories.jsonl`; provider tests now cover hook approval, plan approval, project commands/skills, sidechain transcript capture, MCP/web approval mapping, and auth/quota/rate-limit/generic failure categories.
- P4 selected-agent launch option passed in the rebuilt installed app: the composer loaded configured Claude agents from `claude agents`, selecting `Explore` changed the run label to `Claude · Explore · Sonnet 4.6 · High`, and the run returned `P4_SELECTED_AGENT_OK`.
- Selected-agent smoke caught and fixed one parser/design smell: the heading `Built-in agents:` briefly rendered as a bogus agent chip; parser coverage now skips headings/count lines and deduplicates entries.
- Verification for the selected-agent checkpoint: `npm run test:providers` passed 137/137, `npx tsc -p tsconfig.node.json --noEmit` passed, `npx tsc -p tsconfig.web.json --noEmit` passed, `npm run pack:mac` passed, the app was copied to `/Applications`, relaunched, and Computer Use verified the installed UI run.
- Permission mode polish decision: Claude `auto` is now the product default because it best balances convenience with Claude's native safety classifier. Installed-app CUA verified the Settings default-mode control with Auto selected, plus the composer picker showing Auto/Plan/Ask first by default and moving Auto-edit, Preapproved only, raw allow/deny/tools/dirs controls, and Bypass unsafe behind Advanced.
- Isolated UI verification decision: future Computer Use smokes should launch the dev lane with `npm run smoke:app -- --reset --profile devcua --workspace-dir /private/tmp/orchestrator-agent-ui-smoke` and target `Electron`, not `Orchestrator`. The 2026-05-13 retry verified CUA attached to `Orchestrator - Devcua`, showed a clean isolated project state after skipping legacy migration, and opened Settings in the dev window. Packaged smoke still creates a temp renamed bundle and preserves Electron framework symlinks; Computer Use can list that bundle, but this CUA build returned `appNotFound` for `get_app_state("Orchestrator Smokecua")`.
- P8 Codex spike verified on 2026-05-13: local Codex 0.128.0 help/features/schema, live `codex exec --json`, and generated app-server v2 bindings show the real split between headless exec automation and structured app-server approval/question semantics. Dev CUA also caught a settings smell: raw provider config could expose secret-looking env values; the advanced config editor now redacts those values and disables saving redacted files.
- Claude structured Plan sidebar polish verified on 2026-05-13 in isolated dev CUA profile `plan-agent-polish`: a structured plan run rendered TodoWrite tasks in the new Plan rail/sidebar, then after hot reload the sidebar reconstructed the ExitPlanMode markdown plan body from saved chat messages. The smoke also caught and fixed a duplication smell in recent plan updates.
- Claude structured subagent polish verified on 2026-05-13 in the same dev CUA run: two Task subagents completed with readable tabs (`Read README.md first sentence`, `Count files in docs directory`), cleaned transcripts, and no raw `toolu_...` tab labels after lifecycle updates. The run also verified a subagent Bash permission card can allow once and resume.
- `/btw` decision verified on 2026-05-13: `claude -p --output-format json --max-budget-usd 0.02 "/btw ..."` returned `/btw isn't available in this environment.` with zero turns/cost. Treat `/btw` as native interactive side-chat behavior, not a structured `-p` feature; build an Orchestrator-owned side question/chat if we want that UX.
- Attachment/usage/brief polish landed on 2026-05-13: local files can be attached from the composer, Claude file resources map to native `--file` specs, result usage/cost rolls up into a Usage sidebar, and `SendUserMessage` is supported as an assistant status card if a future Claude `--brief` stream emits it.
- Automated detached UI smoke landed on 2026-05-13: `npm run smoke:ui:auto` launches an isolated Electron profile, bootstraps a disposable project/session before renderer load, verifies the profile badge/composer/sidebar rail, and exits with JSON evidence without touching the user's active Orchestrator window.

### 2026-05-14

- Capabilities robustness checkpoint: renderer typecheck was restored, custom capability create results now only claim providers with actual file-backed resources, and portable plugin update/delete keeps mirrored Claude/Codex skill folders in sync instead of leaving stale global skills behind.
- Plugin compatibility decision: Claude and Codex plugin packages can share a plugin root and common `skills/` content, but they are not one manifest/marketplace format. Orchestrator writes both `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`, plus provider-specific local marketplace entries, then leaves native install/enable as a gated provider action.
- Verification passed: `npx tsc -p tsconfig.node.json --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run test:providers` 141/141, `npm run test:smoke-config`, `npm run smoke:providers`, `npm run build`, `git diff --check`, and `npm run smoke:ui:auto -- --capabilities` with screenshot `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/orchestrator-automated-ui-smoke-capabilities-1778792716697.png`.
