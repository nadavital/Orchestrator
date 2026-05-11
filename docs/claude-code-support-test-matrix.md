# Claude Code Support Test Matrix

Date: 2026-05-11

This matrix tracks Claude Code capability support inside Orchestrator. A feature is not first-class until it has a product mapping, parser/runtime handling, UI behavior, and at least fixture or live coverage.

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
| Native interactive session: `claude [prompt]` | Default Claude session path. No user-visible runtime picker. Render chat from JSONL events plus terminal fallback. | Verified for plain response with `npm run live:claude-runtimes` using native CLI and Sonnet. | Live file edit, delete, shell command, permission, plan, subagent, and slash-command sessions through native wrapper. |
| Workspace trust prompt | Show compact Answer Required card with `Trust workspace` / `Exit`; send selected answer back to PTY. | Verified by native smoke auto-trust and `nativeCliPrompts` tests. | Manual UI smoke without auto-trust in a fresh workspace. |
| Structured print stream: `-p --output-format stream-json` | Internal smoke/automation path, not a user choice. | Verified by live structured smoke and parser fixtures. | Keep as regression lane only. |
| Partial messages: `--include-partial-messages` | Stream assistant text incrementally without duplicating final text. | Fixture-covered and live structured smoke observed deltas. | Native wrapper streaming behavior beyond terminal fallback. |
| Hook events: `--include-hook-events` | Activity/diagnostic events, not main transcript noise. | Inventory-only. | Capture fixture with hook events, normalize useful states, decide UI placement. |
| Streaming input: `--input-format stream-json`, `--replay-user-messages` | Potential future bidirectional structured bridge. | Inventory-only. | Spike whether this can replace terminal scraping while preserving native behavior. |
| Resume: `--resume`, `--continue`, `--session-id` | Continue existing Claude session from Orchestrator. | Implemented for provider session id; fixture-covered. | Live native resume with queued message, permission continuation, and user question answer. |
| Fork/from PR/name: `--fork-session`, `--from-pr`, `--name` | Advanced launch/session controls. | Inventory-only. | Add launch UI, no-quota command construction tests, live smoke for non-destructive flows. |
| Worktrees/tmux: `--worktree`, `--tmux` | Prefer app-managed worktrees; provider-native extras advanced. | App-managed worktrees implemented. | Native worktree/tmux spike, decide whether to surface. |
| Remote control: `--remote-control` | Possible future remote session control. | Inventory-only. | Research protocol and decide whether it fits Orchestrator. |

## Conversation, Tools, And Safety

| Claude surface | Expected Orchestrator UX | Current coverage | Tests still needed |
| --- | --- | --- | --- |
| Plain assistant answer | Flat assistant row, streaming when possible. | Verified native smoke and structured smoke. | Multi-turn native continuity. |
| Read/write/edit/delete tools | Concise tool summaries; Diff panel owns review. | Fixture-covered via `repo-actions.jsonl`; UI helpers tested. | Live native edit/create/delete smoke in a disposable repo. |
| Bash/shell tool | Summarize command; permission card for risky commands. | Fixture-covered. | Live native shell permission flow with harmless command. |
| Search/list/web/MCP tools | Normalize to shared action vocabulary. | Fixture-covered for common actions. | Live native MCP/search/web fixtures. |
| Permission modes: `default`, `acceptEdits`, `auto`, `dontAsk`, `plan`, `bypassPermissions` | Mode picker maps to Claude native policy without runtime complexity. | Command construction and policy tests cover supported modes. | Live native run for each non-dangerous mode; explicit gated test for bypass. |
| Tool allow/deny: `--allowedTools`, `--disallowedTools`, `--tools` | Session rules and permission cards stay in sync. | Command construction tests. | Live permission request, Allow Once, Allow Session, Deny, and persisted deny test. |
| Additional dirs: `--add-dir` | Settings row for extra roots. | Command construction tests. | Live file-read test from additional dir. |
| Dangerous skip flags | Only explicit unsafe flow, never accidental default. | Command construction coverage. | Manual gated verification only. |
| AskUserQuestion tool | User-input card, not permission UI. | Fixture-covered. | Live native AskUserQuestion session. |
| SendUserMessage / `--brief` | Agent-to-user question/update card. | Inventory-only. | Capture live/fixture output and map to `user_input.requested` or assistant update. |
| Plan mode / `EnterPlanMode` / `ExitPlanMode` / `TodoWrite` | Plan state UI and Approve Plan / Keep Planning card. | Fixture-covered. | Live native plan-mode approval flow. |

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
| Built-in slash commands | Composer palette sends provider slash text through native CLI. | Slash palette no longer split by runtime. | Live native `/help` or safe slash-command smoke. |
| Skills as slash commands | Skills panel plus slash palette discovery where possible. | Skills panel exists; CLI support confirmed by help text. | Inventory real global/project skills, run one safe skill live, verify UI. |
| `--disable-slash-commands` | Advanced run option. | Inventory-only. | Decide whether to surface. |
| `--plugin-dir`, `--plugin-url` | Session-scoped plugin loading. | Inventory-only. | Plugin picker/validation and safe local plugin smoke. |
| `claude plugin list --json` | Settings plugin inventory. | Help probed. | Run no-quota list, render compact plugin table. |
| Plugin install/enable/disable/update/uninstall | Explicit confirmation; provider-state mutating. | Inventory-only; should be gated. | Confirmation UI and dry/no-op validation where possible. |
| Plugin marketplace add/list/remove/update | Marketplace management surface. | Help probed. | List first; mutating commands gated. |
| `claude mcp list/get` | Settings MCP inventory. | Help probed; command surface exists. | Run no-quota list/get and render compact MCP state. |
| `claude mcp add/add-json/add-from-claude-desktop/remove/reset-project-choices` | Explicit confirmation; provider-state mutating. | Inventory-only; should be gated. | Confirmation UI and reversible test workspace. |
| `claude mcp serve` | Developer/server mode. | Help probed. | Decide whether Orchestrator needs to surface this. |
| `--mcp-config`, `--strict-mcp-config` | Session-scoped MCP config. | Inventory-only. | File picker, command construction, safe local server smoke. |

## Config, Auth, Project, And Environment

| Claude surface | Expected Orchestrator UX | Current coverage | Tests still needed |
| --- | --- | --- | --- |
| Auth status/login/logout | Status in settings; login/logout externally visible and gated. | Help probed; diagnostics report auth readiness indirectly. | Run `auth status`; design login/logout confirmation or terminal handoff. |
| `doctor` | Diagnostic action. | Inventory-only. | Safe no-quota probe and compact results UI. |
| `install`, `update`, `upgrade`, `setup-token` | Not normal chat actions; explicit system/provider management. | Inventory-only; should be gated. | Decide whether to omit or terminal-only. |
| Project purge | Destructive provider-state action. | Help probed and marked mutating. | Confirmation flow only; no automatic execution. |
| Auto mode `config/defaults/critique` | Settings diagnostics for auto mode. | `defaults` surfaced as safe command surface; help probed. | Run `config/defaults`, render JSON summary; gate `critique` due AI usage. |
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
