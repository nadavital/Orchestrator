# Claude Code CLI Map

Canonical active plan: `docs/orchestrator-source-of-truth.md`.

This is the Claude-first provider mapping reference Orchestrator should use as the baseline for other CLI providers. Active implementation status and completion gates live in the source-of-truth plan.

## Runtime Lanes

| Lane | Claude surface | Orchestrator abstraction |
| --- | --- | --- |
| Structured session | `claude -p --output-format stream-json --verbose --include-partial-messages` | Default Orchestrator session path; stdout JSON event parser plus per-run approval hook bridge |
| Interactive PTY | `claude [prompt]` | Deprecated for normal chat; terminal handoff only for true TUI-only/provider-management commands and rare native prompts |
| Streaming input | `--input-format stream-json --output-format stream-json` | Planned bidirectional provider stream |
| Session resume | `--resume`, `--continue`, `--session-id`, `--fork-session` | `providerSessionId`, future launch options |
| Worktree launch | `--worktree`, `--tmux`, `--from-pr`, `--name` | Future shared launch sheet |

## Core Event Mapping

| Claude shape | Orchestrator event |
| --- | --- |
| `system/init.session_id` | `session.started` |
| `permission-mode.sessionId` | `session.started` |
| assistant text block | `assistant.text` |
| assistant `tool_use` | `tool.started` |
| user `tool_result` | `tool.completed` |
| result success | `run.completed` |
| system `turn_duration` | `run.completed` |
| result error | `run.failed` |
| auth/API helper text | `run.failed` classified as `auth_error` |

## Agent Mapping

Claude has several agent-like surfaces:

| Claude surface | Current mapping |
| --- | --- |
| `--agent <agent>` | Launch option, planned UI control |
| `--agents <json>` | Launch option, planned custom-agent editor |
| `claude agents` | `commandSurfaces.agents-list` |
| `Task` tool use | `agent.started` plus `tool.started` |
| `Task` tool result | `agent.completed` or `agent.failed` plus `tool.completed` |
| `claude ultrareview --json` | `commandSurfaces.ultrareview-json`, quota-marked |

## Permission Mapping

| Claude surface | Current mapping |
| --- | --- |
| `--permission-mode default` | Ask |
| `--permission-mode acceptEdits` | Accept edits |
| `--permission-mode plan` | Plan |
| `--permission-mode bypassPermissions` | Auto/bypass |
| `--allowedTools` | Session allowlist |
| `--disallowedTools` | Session denied-tool rules |
| `--tools` | Session available-tool set |
| `--add-dir` | Session additional-directory rules |
| `--settings <hook config>` | Per-run Orchestrator approval broker for mutating tool approvals |
| `--include-hook-events` | Hook lifecycle events attached to the structured stream when a broker is present |
| `--allow-dangerously-skip-permissions` | Planned option exposure only for explicit unsafe flows |

## Provider Management Surfaces

These are represented as `ProviderCommandSurface` so the app can render compact provider-specific settings/actions without pretending every CLI command is a slash command.

| Surface | Command | Quota | App surface |
| --- | --- | --- | --- |
| Auth status | `claude auth status` | none | Settings |
| Agents | `claude agents` | none | Settings |
| MCP servers | `claude mcp list` | none | Settings |
| Plugins | `claude plugin list` | none | Settings |
| Auto mode defaults | `claude auto-mode defaults` | none | Settings |
| Project purge | `claude project purge` | none | Settings, destructive confirmation required |
| Ultrareview JSON | `claude ultrareview --json` | may use quota | Composer/review |

## Remaining Claude Gaps

- Native PTY sessions can hit Claude's workspace trust prompt before model work in new workspaces. This is fallback/terminal-handoff behavior only; normal chat uses structured print mode.
- Add launch options for `--agent`, `--agents`, `--worktree`, `--tmux`, `--from-pr`, `--name`, `--session-id`, and `--fork-session`.
- Capture more real hook-event fixtures for mutating tool approvals, MCP tool approvals, and plan-mode transitions.
- Add settings panels for MCP/plugin/agent list commands, with mutating flows routed through explicit confirmations or terminal.
- Add file-change/diff fixture coverage from real Claude edits.
- Add usage/cost display from Claude JSONL usage fields.
