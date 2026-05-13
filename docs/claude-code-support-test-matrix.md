# Claude Code Support Test Matrix

Date: 2026-05-13

Canonical active plan: `docs/orchestrator-source-of-truth.md`.

This matrix tracks Claude Code capability evidence inside Orchestrator. A feature is not first-class until it has a product mapping, parser/runtime handling, UI behavior, and at least fixture or live coverage. Active implementation status and completion gates live in the source-of-truth plan.

## Status Legend

| Status | Meaning |
| --- | --- |
| Verified | Covered by automated tests and at least one live/no-quota CLI verification where applicable. |
| Fixture-covered | Covered by parser/runtime fixtures, but not recently exercised live. |
| Implemented | Wired in the app, but needs stronger verification. |
| Inventory-only | Confirmed from local CLI help, not yet implemented as product behavior. |
| Blocked / gated | Should require explicit user confirmation, may mutate provider state, or may spend model quota. |

## Runtime And Session Core

| Claude surface | Expected Orchestrator UX | Current coverage | Tests still needed |
| --- | --- | --- | --- |
| Native interactive session: `claude [prompt]` | Escape hatch for true TUI-only flows, native prompts, and fallback verification. Normal chat stays structured by default; the native lane is advanced/diagnostic. | Verified live with Sonnet through the native CLI path for plain response, file create/delete, plan mode, terminal streaming fallback, and `/help`. Provider PTYs now answer Claude terminal capability queries in the main process, so hidden terminal UI cannot stall startup. 2026-05-13 dev UI smoke verified native first-turn assistant text, native first-turn Write, and clean transcript filtering. | Live shell permission, AskUserQuestion, and subagent sessions. |
| Workspace trust prompt | Show compact Answer Required card with `Trust workspace` / `Exit`; send selected answer back to PTY. | Implemented and covered by `nativeCliPrompts` tests. Native prompt submit now sends Claude's enhanced Enter key sequence. | Manual UI smoke in a fresh workspace. |
| Structured print stream: `-p --output-format stream-json` | Default Claude product path and internal smoke/automation path. Not a user-visible runtime choice. | Verified by live structured smoke and parser fixtures. | Multi-turn/queued/steer verification and bidirectional input spike. |
| Partial messages / native terminal fallback | Stream assistant text incrementally without duplicating final text. | Fixture-covered for structured partials; live native Sonnet suite now emits `assistant.text.delta` and `assistant.text.completed` from terminal fallback. | Promote more live terminal repaint shapes into fixtures as discovered. |
| Hook events: `--include-hook-events` | Activity/diagnostic events, not main transcript noise. | Inventory-only. | Capture fixture with hook events, normalize useful states, decide UI placement. |
| Streaming input: `--input-format stream-json`, `--replay-user-messages` | Potential future bidirectional structured bridge. | Inventory-only. | Spike whether this can replace terminal scraping while preserving native behavior. |
| Resume: `--resume`, `--continue`, `--session-id` | Continue existing Claude session from Orchestrator. | Implemented for provider session id; fixture-covered. 2026-05-13 dev UI smoke verified native interactive sessions continue through the structured resume lane after the first native turn, avoiding warm TUI prompt loss. | Live permission continuation and user question answer. |
| Fork/from PR/name: `--fork-session`, `--from-pr`, `--name` | Advanced launch/session controls. | Inventory-only. | Add launch UI, no-quota command construction tests, live smoke for non-destructive flows. |
| Worktrees/tmux: `--worktree`, `--tmux` | Prefer app-managed worktrees; provider-native extras advanced. | App-managed worktrees implemented. | Native worktree/tmux spike, decide whether to surface. |
| Remote control: `--remote-control` | Possible future remote session control. | Inventory-only. | Research protocol and decide whether it fits Orchestrator. |

## Conversation, Tools, And Safety

| Claude surface | Expected Orchestrator UX | Current coverage | Tests still needed |
| --- | --- | --- | --- |
| Plain assistant answer | Flat assistant row, streaming when possible. | Verified native smoke and structured smoke. 2026-05-13 dev UI smoke rendered `INTERACTIVE_UI_CLEAN_FIRST_OK` and `INTERACTIVE_UI_CLEAN_SECOND_OK` without leaking Claude native mode banner text. | Keep live UI smoke current after terminal parser changes. |
| Read/write/edit/delete tools | Concise tool summaries; Diff panel owns review. | Verified by live native disposable file create/delete smoke plus fixture coverage. 2026-05-13 dev UI smoke created `interactive-native-smoke.txt`, rendered `Wrote 1 file`, and verified file contents on disk. | Add UI screenshot smoke for Diff/file-reference cards in a git-backed workspace after live file operation. |
| Bash/shell tool | Summarize command; permission card for risky commands. | Fixture-covered. | Live native shell permission flow with harmless command. |
| Search/list/web/MCP tools | Normalize to shared action vocabulary. | Fixture-covered for common actions. | Live native MCP/search/web fixtures. |
| Permission modes: `default`, `acceptEdits`, `auto`, `dontAsk`, `plan`, `bypassPermissions` | Mode picker maps to Claude native policy without runtime complexity. | Command construction and policy tests cover supported modes. | Live native run for each non-dangerous mode; explicit gated test for bypass. |
| Tool allow/deny: `--allowedTools`, `--disallowedTools`, `--tools` | Session rules and permission cards stay in sync. | Command construction tests. | Live permission request, Allow Once, Allow Session, Deny, and persisted deny test. |
| Additional dirs: `--add-dir` | Settings row for extra roots. | Command construction tests. | Live file-read test from additional dir. |
| Dangerous skip flags | Only explicit unsafe flow, never accidental default. | Command construction coverage. | Manual gated verification only. |
| AskUserQuestion tool | User-input card, not permission UI. | Fixture-covered. | Live native AskUserQuestion session. |
| SendUserMessage / `--brief` | Agent-to-user question/update card. | Inventory-only. | Capture live/fixture output and map to `user_input.requested` or assistant update. |
| Plan mode / `EnterPlanMode` / `ExitPlanMode` / `TodoWrite` | Plan state UI and Approve Plan / Keep Planning card. | Fixture-covered; live native attempt observed plan mode and `/plan to preview`; native wrapper now shows a placeholder instead of a false plan body. | Capture native plan body or route `/plan` preview into the sidebar, then run live native plan approval flow. |

## Agents And Subagents

| Claude surface | Expected Orchestrator UX | Current coverage | Tests still needed |
| --- | --- | --- | --- |
| `Task` tool subagents | Running-agent chips; click opens agent transcript/sidebar tab. | Fixture-covered for start/progress/completion and transcripts. | Live native task-agent run and sidebar transcript verification. |
| `Agent` tool | Same shared agent-node model as `Task`. | Fixture-covered. | Live native agent run if locally available. |
| Sidechain/nested agent JSONL | Agent transcript state without raw event spam. | Fixture-covered. | Live native nested-agent session. |
| `--agent <agent>` | Launch with selected agent. | Inventory-only. | Agent picker UI, command construction, live selected-agent smoke. |
| `--agents <json>` | Launch with custom agents. | Inventory-only. | Custom-agent editor/validation, command construction, fixture/live smoke. |
| `claude agents` | Settings/agents management surface. | No-quota help probed. | Safe list rendering, mutating flows with confirmation. |
| Ultrareview | Review command surface; quota warning. | Help probed, command surface exists. | Live gated ultrareview JSON test and UI mapping. |

## Slash Commands, Skills, Plugins, MCP

| Claude surface | Expected Orchestrator UX | Current coverage | Tests still needed |
| --- | --- | --- | --- |
| Built-in slash commands | Composer palette sends provider slash text through native CLI. | Slash palette no longer split by runtime; live native `/help` smoke passes. | Add a second safe slash command when a stable no-quota command is available. |
| Skills as slash commands | Skills panel plus slash palette discovery where possible. | Skills panel exists; CLI support confirmed by help text. | Inventory real global/project skills, run one safe skill live, verify UI. |
| `--disable-slash-commands` | Advanced run option. | Inventory-only. | Decide whether to surface. |
| `--plugin-dir`, `--plugin-url` | Session-scoped plugin loading. | Inventory-only. | Plugin picker/validation and safe local plugin smoke. |
| `claude plugin list --json` | Settings plugin inventory. | No-quota live probe passes. | Render compact plugin table and avoid raw JSON noise. |
| Plugin install/enable/disable/update/uninstall | Explicit confirmation; provider-state mutating. | Inventory-only; should be gated. | Confirmation UI and dry/no-op validation where possible. |
| Plugin marketplace add/list/remove/update | Marketplace management surface. | Help probed. | List first; mutating commands gated. |
| `claude mcp list/get` | Settings MCP inventory. | No-quota `mcp list` live probe passes; command surface exists. | Add `get` coverage and render compact MCP state. |
| `claude mcp add/add-json/add-from-claude-desktop/remove/reset-project-choices` | Explicit confirmation; provider-state mutating. | Inventory-only; should be gated. | Confirmation UI and reversible test workspace. |
| `claude mcp serve` | Developer/server mode. | Help probed. | Decide whether Orchestrator needs to surface this. |
| Native `.mcp.json` enable prompt | Show compact Answer Required card with `Enable selected` / `Reject all`; keep raw MCP warning out of the main transcript. | Implemented, covered by `nativeCliPrompts` tests, and exercised live by the Claude capability suite. | Manual UI smoke for both enable and reject. |
| `--mcp-config`, `--strict-mcp-config` | Session-scoped MCP config. | Inventory-only; live harness attempt showed argument ordering and setting-source behavior needs a dedicated command test before use as a gate. | File picker, command construction, safe local server smoke. |

## Config, Auth, Project, And Environment

| Claude surface | Expected Orchestrator UX | Current coverage | Tests still needed |
| --- | --- | --- | --- |
| Auth status/login/logout | Status in settings; login/logout externally visible and gated. | No-quota `auth status` live probe passes; diagnostics report auth readiness indirectly. | Design login/logout confirmation or terminal handoff. |
| `doctor` | Diagnostic action. | Inventory-only. | Safe no-quota probe and compact results UI. |
| `install`, `update`, `upgrade`, `setup-token` | Not normal chat actions; explicit system/provider management. | Inventory-only; should be gated. | Decide whether to omit or terminal-only. |
| Project purge | Destructive provider-state action. | Help probed and marked mutating. | Confirmation flow only; no automatic execution. |
| Auto mode `config/defaults/critique` | Settings diagnostics for auto mode. | No-quota `auto-mode defaults` live probe passes. | Render JSON summary; gate `critique` due AI usage. |
| Settings file/source: `--settings`, `--setting-sources` | Advanced config source control. | Inventory-only. | Decide whether to surface or keep provider-native. |
| System prompt and append prompt | Advanced launch controls. | Inventory-only. | Prompt editor, command tests, live safe smoke. |
| `--bare` | Minimal mode preset. | Inventory-only. | Decide if useful for clean/repro runs. |
| Debug/debug file | Diagnostics only. | Inventory-only. | Developer-only toggle if needed. |
| Chrome/IDE integration | Optional external integration. | Inventory-only. | Decide if out of scope or settings-only. |
| `--file` downloaded resources | Attachment/resource support. | Inventory-only. | Attachment model and safe file resource test. |
| JSON schema output | Structured response mode. | Inventory-only. | Decide if useful for slash/tools; command tests. |
| Budget/fallback/betas/no session persistence | Advanced run controls. | Inventory-only. | Surface only if product value is clear. |

## Required Verification Gates Before Calling Claude Support Complete

1. Native CLI plain-response smoke passes in a fresh trusted/untrusted workspace.
2. Native CLI workspace trust prompt appears as a card and both `Trust workspace` and `Exit` work.
3. Native CLI file create/edit/delete flow updates transcript summaries, file-reference cards, and Diff.
4. Native CLI Bash flow requests/handles permission and resumes correctly.
5. AskUserQuestion produces the user-input card and resumes correctly.
6. Plan mode enters plan, updates todos, shows plan approval, and supports approve/keep-planning.
7. Task/subagent run produces chips, sidebar tab, transcript, completion/failure states.
8. Slash commands send through the native CLI without requiring a runtime switch.
9. At least one skill slash command is discovered and run safely.
10. MCP list/get and plugin list render in settings without raw JSON noise.
11. Mutating provider commands require explicit confirmation or terminal handoff.
12. Queue/steer works while native Claude is running and resumes at a sensible boundary.
13. Stop consistently interrupts the native PTY and lets the user send/queue the next message.
14. Structured stream smoke remains available as internal regression coverage.
15. Every new live Claude transcript shape is saved as a fixture before being claimed as supported.

## Latest Live Pass Notes

2026-05-11:

- Native plain response passed with Sonnet via `npm run live:claude-capabilities`.
- Native disposable file operations passed after fixing terminal fallback parsing so corrupted tool-status rows like `Writ(...)`, `Wrte(...)`, and line-numbered tool output do not count as assistant completion.
- Native plan-mode attempt reached Claude plan mode and showed `/plan to preview`; Orchestrator now treats that as a placeholder completion, but still does not capture the plan body from the native terminal path.
- Native terminal fallback streaming passed: the live suite observed `assistant.text.delta` and `assistant.text.completed` from the real Claude TUI.
- Native slash-command smoke passed for `/help`.
- No-quota probes passed for `auth status`, `mcp list`, `plugin list --json`, `auto-mode defaults`, and `agents`.
- Artifacts from the latest live run are written under `tmp/claude-live-capabilities` for fixture promotion.

Follow-up later on 2026-05-11:

- A fresh raw PTY rerun exposed that Claude's startup prompts depend on terminal capability responses and can block before any JSONL/session output is written.
- The app bridge was patched for the workspace trust prompt to send Enter for the selected default instead of the literal `1`.
- The app bridge now detects Claude's native `.mcp.json` enable prompt and maps it to a compact Answer Required card.
- The live harness now exercises native prompt handling directly; network/auth access must run outside the sandbox because Claude's API key helper may need the corporate registry.

Final pass on 2026-05-11:

- Provider PTYs now answer Claude terminal capability requests from the main process, independent of whether a visible terminal panel is mounted.
- Native prompt answers now use Claude's enhanced Enter key sequence, which lets the live suite pass through the `.mcp.json` enable prompt.
- Live Sonnet suite passes for native plain response, native file create/delete, native plan mode placeholder, native terminal streaming, `/help`, and no-quota probes for auth, MCP, plugins, auto-mode, and agents.
- Terminal fallback parsing now ignores compact tool progress rows, tool-output rows, token/status footers, MCP status fragments, and corrupted plan status fragments instead of treating them as assistant completion.

2026-05-13 dev UI interactive pass:

- Fresh isolated Electron profile `interactivecua5` was driven with Computer Use against `/private/tmp/orchestrator-interactive-ui-smoke`, leaving the user's main Orchestrator window untouched.
- Advanced permissions exposed the native runtime selector and switching `Structured` to `Native terminal` worked from the composer popover.
- Native first-turn plain response returned `INTERACTIVE_UI_CLEAN_FIRST_OK`; the main transcript did not include the Claude auto-mode banner.
- Follow-up on the same native interactive session returned `INTERACTIVE_UI_CLEAN_SECOND_OK` through structured resume, confirming the warm native TUI prompt-loss workaround.
- Native first-turn Write in a fresh chat created `interactive-native-smoke.txt`, showed `Wrote 1 file`, returned `INTERACTIVE_UI_FILE_DONE`, and filesystem verification read `INTERACTIVE_NATIVE_FILE_OK`.
- Remaining polish smell: the advanced permissions popover is powerful but dense; keep runtime selection advanced-only and consider a clearer compact label for diagnostic sessions.
