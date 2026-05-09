# Claude Code CLI Map

This is the Claude-first provider contract Orchestrator should use as the baseline for other CLI providers.

## Runtime Lanes

| Lane | Claude surface | Orchestrator abstraction |
| --- | --- | --- |
| Interactive PTY | `claude [prompt]` | `runtime: interactive`, native permission prompts, JSONL transcript tail |
| Headless stream | `claude -p --output-format stream-json --verbose` | `runtime: headless`, stdout JSON event parser |
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

- Add launch options for `--agent`, `--agents`, `--worktree`, `--tmux`, `--from-pr`, `--name`, `--session-id`, and `--fork-session`.
- Capture fixtures for hook events and partial messages before enabling `--include-hook-events` or `--include-partial-messages`.
- Add settings panels for MCP/plugin/agent list commands, with mutating flows routed through explicit confirmations or terminal.
- Add file-change/diff fixture coverage from real Claude edits.
- Add usage/cost display from Claude JSONL usage fields.
