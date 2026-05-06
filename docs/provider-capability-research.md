# Provider Capability Research

Date: 2026-05-06

## Product Goal

Orchestrator should be one consistent GUI for multiple coding agents, not just a terminal wrapper. The user should be able to pick the provider that fits their current limits, model preference, or feature need, while the app preserves the real behavior and unique capabilities of each provider.

The core principle is:

> Normalize the app experience, not the provider truth.

That means chat, sessions, tools, diffs, file changes, questions, permission prompts, and terminal output should have one UI language. But provider-specific approval modes, sandboxing, output formats, model controls, MCP/plugin support, subagents, remote sessions, and worktree behavior should remain visible and configurable.

## Current Local CLI Reality

Verified locally on 2026-05-05:

| Provider | Binary | Version / status | Notes |
| --- | --- | --- | --- |
| Claude Code | `/Users/navital/.local/bin/claude` | `2.1.128` | Full help available in sandbox. |
| Codex CLI | `/Users/navital/.local/bin/codex` | `codex-cli 0.128.0` | Symlinked from NVM install; desktop bundle also exists. |
| GitHub Copilot CLI | `/Users/navital/.local/bin/copilot` | `1.0.39` | Needs non-sandbox process for Keychain access. |
| Cursor Agent | `/Users/navital/.local/bin/agent` | `2026.05.05-84a231c` | Live smoke passes after setting `network.useHttp1ForAgent` for the eBay network path. |

Important diagnostic lesson: `installed` is not enough. We need states for `missing`, `installed`, `auth-ok`, `auth-error`, `models-available`, `models-empty`, and `runtime-smoke-passed`.

## Provider Surfaces

### Claude Code

Useful capabilities:

- Interactive and print modes.
- `--output-format stream-json` with `--verbose` for event parsing.
- `--input-format stream-json` for programmatic multi-turn input.
- Session resume via `--resume`.
- Permission modes: `default`, `acceptEdits`, `auto`, `bypassPermissions`, `dontAsk`, `plan`.
- Tool control via `--tools`, `--allowedTools` / `--allowed-tools`, `--disallowedTools`.
- MCP config via `--mcp-config`.
- Agents via `--agent` and `--agents`.
- Plugins via `--plugin-dir`.
- Worktrees via `--worktree`.
- Structured output via `--json-schema`.
- Permission prompts in non-interactive mode can be routed through `--permission-prompt-tool`, which is worth researching as a better GUI bridge.

Current app implication:

Claude should be our first-class interactive permission implementation. Its stream JSON already gives session IDs, assistant text, tool uses/results, and permission denials. The app should model Claude permission denials as resumable UI events, not as fatal errors.

### OpenAI Codex CLI

Useful capabilities from local help:

- Interactive CLI if launched without `exec`.
- Non-interactive `codex exec --json` for JSONL events.
- `codex exec resume` for non-interactive session resume.
- Sandbox modes: `read-only`, `workspace-write`, `danger-full-access`.
- Interactive CLI approval policy: `--ask-for-approval untrusted | on-failure | on-request | never`.
- `--dangerously-bypass-approvals-and-sandbox`.
- `--search` in interactive mode.
- MCP/plugin commands and experimental app/app-server/exec-server surfaces.
- Review command.
- `--output-schema` in exec mode.
- `--cd` and `--add-dir`.
- `--ephemeral`, `--ignore-user-config`, `--ignore-rules`.

Current app implication:

The current adapter uses `codex exec`, so the GUI can reliably parse JSONL and control sandboxing. However, `codex exec` does not expose `--ask-for-approval`; that flag belongs to the interactive CLI surface. To support Codex approval modes properly, we likely need either:

1. Keep `exec` for headless runs and label it honestly as sandbox-based, non-interactive automation.
2. Add an interactive PTY-backed Codex mode that drives the TUI/inline CLI and parses screen/stdout enough to surface approval prompts.
3. Investigate `app-server`, `exec-server`, or `mcp-server` for a more structured GUI integration path.

Practical split:

- Use `codex exec` when the GUI already chose a sandbox scope up front: workspace write, full access, or bypass. This is the right fit for cheap integration smoke tests, deterministic background tasks, CI-like checks, and "run this with this policy" jobs.
- Use a future `codex interactive` runtime when the user expects a coding-session feel: approve/deny tools as they happen, answer questions, and keep a conversational loop alive.

So the `exec` sandbox mode is not wrong; it is just the automation/runtime-sandbox lane. Interactive coding needs a second Codex runtime bridge instead of overloading `exec`.

### GitHub Copilot CLI

Useful capabilities from local help and docs:

- Interactive mode by default.
- Non-interactive prompt mode via `-p` / `--prompt`.
- JSONL output via `--output-format json`.
- Models via `--model`; effort via `--effort` / `--reasoning-effort`.
- Modes: `interactive`, `plan`, `autopilot`; flags include `--plan`, `--autopilot`.
- Permission controls:
  - `--allow-tool`, `--deny-tool`.
  - `--available-tools`, `--excluded-tools`.
  - `--allow-all-tools`.
  - `--allow-all`, `--yolo`.
  - `--allow-all-paths`, `--add-dir`, `--disallow-temp-dir`.
  - `--allow-url`, `--deny-url`, `--allow-all-urls`.
- `ask_user` tool exists and can be disabled with `--no-ask-user`.
- Built-in GitHub MCP support and MCP config.
- Plugins and custom agents.
- Subagent/fleet/task commands in interactive mode.
- `/diff`, `/review`, `/pr`, `/delegate`, `/fleet`, `/tasks`, `/rewind`, `/undo`, `/share`, `/context`, `/usage`, `/research`.
- ACP server via `--acp`.
- Remote control via GitHub web/mobile.

Current app implication:

Copilot has a rich permission model, much richer than the current adapter. Programmatic `-p` requires `--allow-all-tools` for non-interactive use, but interactive Copilot can prompt for permissions and can ask the user questions. To expose its real capability through GUI, we should add a second runtime mode:

- `copilot prompt`: headless JSONL, likely auto-allowed.
- `copilot interactive`: PTY/ACP-backed, supports permission prompts, ask-user questions, slash commands, subagents, remote/delegate features.

ACP may be the best long-term integration if it exposes structured events.

### Cursor Agent

Useful capabilities from local help and docs:

- Interactive mode by default.
- Print mode with `--print`.
- `--output-format text | json | stream-json`.
- Cursor docs say `stream-json` is the default output format for print/inferred print mode.
- `--stream-partial-output`.
- Modes: `--mode plan`, `--mode ask`, plus `--plan`.
- `--resume`, `--continue`, `create-chat`, `ls`, `resume`.
- `--model`, `models`, `--list-models`.
- Permission/safety controls:
  - `--force`.
  - `--yolo`.
  - `--sandbox enabled|disabled`.
  - `--trust` for headless print mode.
  - Config permissions in `~/.cursor/cli-config.json` or `<project>/.cursor/cli.json`.
  - Permission tokens include `Shell(commandBase)`, `Read(pathOrGlob)`, `Write(pathOrGlob)`.
  - Deny rules take precedence.
- Worktrees via `--worktree`, `--worktree-base`, `--skip-worktree-setup`.
- MCP management.
- API key auth via `CURSOR_API_KEY`.

Current app implication:

The current adapter uses `agent --print --output-format stream-json`. Default mode should map to read-only `--mode ask`, while `Auto`/yolo is the only path that should force all tools. Cursor's richer permission controls are config-file based and require more adapter work:

- Generate temporary per-session Cursor CLI config files to represent GUI approval settings.
- Or drive interactive Cursor Agent where prompts can be surfaced directly.
- Treat `--mode plan` / `--mode ask` as first-class GUI modes, not just permission choices.

Network note: on the eBay network, Cursor Agent repeatedly reconnected until the Cursor config included:

```json
{
  "network": {
    "useHttp1ForAgent": true
  }
}
```

Without this, both headless `--print` mode and interactive PTY mode reached `connection.reconnecting` / `retry.starting` loops. With it, the `gpt-5-mini` live smoke completed and produced `session.started`, tool events, `assistant.text`, and `run.completed`.

## Normalized App Event Model

We should expand `RunEvent` beyond the current minimal shape. Proposed canonical event types:

| Event | Meaning | Provider examples |
| --- | --- | --- |
| `session.started` | Provider session/thread/chat ID captured. | Claude `session_id`, Codex `thread_id`, Cursor chat ID, Copilot session ID. |
| `assistant.delta` | Partial assistant output. | Claude partial messages, Cursor stream partial output. |
| `assistant.text` | Complete assistant message. | All providers. |
| `assistant.question` | Agent asks the user a question. | Copilot `ask_user`, Claude brief/SendUserMessage, plain text fallback. |
| `tool.started` | Tool call started. | Shell, edit/write/read, MCP, web, search, subagent. |
| `tool.delta` | Tool progress output. | Long shell output, streaming tool logs. |
| `tool.completed` | Tool finished. | Exit code/output/result. |
| `permission.requested` | Provider asks for allow/deny. | Claude permission denials, Copilot interactive prompts, Cursor interactive/config prompts, Codex interactive approval. |
| `permission.resolved` | User decision sent back to provider. | Allow once, allow session, deny, deny with instruction. |
| `file.changed` | Provider reports or app detects file change. | Diff watcher, tool parse, git status. |
| `diff.updated` | Current repo/worktree diff changed. | Git polling or fs watcher. |
| `plan.updated` | Agent creates/updates plan/tasks. | Copilot tasks, Codex plans, Claude todos. |
| `subagent.started` | Delegated/fleet/subagent task starts. | Copilot `/fleet`, Claude agents, Codex subagents if exposed. |
| `subagent.completed` | Delegated task completes. | Same. |
| `run.waiting_for_user` | Run is paused for question/permission/input. | Any provider. |
| `run.completed` | Provider finished successfully. | All. |
| `run.failed` | Provider failed. | Nonzero exit, JSON error, auth/model unavailable. |

Key rule: permissions and questions should pause the run in GUI state. They should not be represented only as a terminal line or as a generic error.

## Permission UX Strategy

The GUI should expose two layers:

1. A common intent selector:
   - Ask first / guarded.
   - Plan/read-only.
   - Auto-edit.
   - Workspace sandbox.
   - Full access.
   - Bypass/yolo.

2. A provider-specific resolved policy panel:
   - Actual flags/config used.
   - Whether support is exact, approximate, forced, or unsupported.
   - Whether prompts can be surfaced in the GUI.
   - What is auto-allowed.
   - What is denied.

Provider mapping should be data-driven, not UI conditionals.

Suggested policy object:

```ts
interface ProviderPermissionPolicy {
  id: string
  label: string
  intent:
    | 'ask'
    | 'plan'
    | 'autoEdit'
    | 'workspaceSandbox'
    | 'fullAccess'
    | 'bypass'
  support: 'exact' | 'approximate' | 'forced' | 'unsupported'
  interaction: 'structured' | 'pty' | 'headless' | 'none'
  commandArgs?: string[]
  configPatch?: unknown
  allowedTools?: string[]
  deniedTools?: string[]
  warning?: string
}
```

## Testing Plan

### Contract Fixtures

Each provider needs checked-in fixture tests for:

- Assistant text.
- Partial assistant text, if supported.
- Tool call start.
- Tool call completion.
- Tool failure.
- Shell command output.
- File edit/write tool input.
- Permission request.
- User question.
- Session started/resumed.
- Run completed.
- Run failed.
- Malformed/non-JSON lines.

### Live Smoke Tests

Add a diagnostics runner that creates a temp workspace and runs harmless tasks:

- Explain a small file.
- Ask a question back to the user.
- Attempt a safe file edit.
- Attempt a shell command.
- Attempt a denied/destructive-looking command that should trigger permission handling.
- Resume after permission grant.
- Verify git diff detection after edits.

Live tests should be opt-in and marked with provider/auth status.

Live integration tests should also default to the cheapest account-available model we have verified for each provider. The goal is to verify command construction, auth, output parsing, tool events, and completion events, not model quality. Current smoke defaults:

- Claude: `claude-sonnet-4-6`, low effort. `claude-haiku-4-5-20251001` failed against the current gateway.
- Codex: `gpt-5.4-mini`, low effort. `codex-mini-latest` is not supported on this ChatGPT account.
- GitHub Copilot: `gpt-5-mini`, low effort. `gpt-5.4-nano` is not available to the current Copilot account.
- Cursor: `gpt-5-mini`, low effort.

Use per-provider env overrides only when deliberately testing a specific model, for example `LIVE_MODEL_CODEX=gpt-5.5 LIVE_EFFORT_CODEX=high npm run live:providers`.

The same rule applies when manually testing through the GUI or Computer Use: switch the provider picker to the cheapest model/lowest reasoning effort before sending any real prompt unless the purpose of the test is model-specific behavior.

### Provider Diagnostics

Add UI and test coverage for:

- Binary path.
- Version.
- Auth/account status.
- Model list availability.
- JSON/stream format support.
- Permission mode support.
- Required trust/workspace state.
- Keychain or sandbox failures.
- Recommended setup command.

### Parser Robustness

Parsers should be table-driven and versioned:

- `providerId`.
- `providerVersion`.
- `runtimeMode`.
- fixture file.
- expected normalized events.

If a provider changes output shape, we should learn that through one failing fixture.

## Implementation Roadmap

### Phase 1: Make Current Headless Adapters Honest

- Keep Claude/Codex/Copilot/Cursor headless modes working.
- Expand `RunEvent` and message mapping.
- Add diagnostics UI.
- Add provider path/version/auth/model checks.
- Add warning badges for forced/headless modes.
- Add fixture coverage for permission, questions, tool calls, malformed output, and failures.

### Phase 2: First-Class Permissions

- Claude: complete permission-card flow with allow once, allow tool for session, deny with instruction, and resume.
- Copilot: add permission policy mapping for `--allow-tool`, `--deny-tool`, `--available-tools`, URL/path controls, and `--allow-all`.
- Cursor: generate per-session CLI config for allow/deny `Shell`, `Read`, and `Write` tokens.
- Codex: separate `exec` sandbox mode from interactive approval mode.

### Phase 3: Interactive Runtime Bridges

Add runtime modes per provider:

- `headless-json`: parse JSON/JSONL events.
- `interactive-pty`: drive CLI in a PTY, parse prompts, send keystrokes/responses.
- `server-protocol`: use ACP/app-server/exec-server/MCP where available.

Priority:

1. Claude print/stream-json plus permission prompt tool investigation.
2. Copilot ACP or interactive PTY for real ask/permission/subagent features.
3. Cursor config-backed permissions plus optional interactive PTY.
4. Codex interactive approval via PTY or app/exec server investigation.

### Phase 4: Orchestration UX

- Provider-neutral session list.
- Per-provider capability badges.
- Worktree/branch management.
- Diff review and apply/revert controls.
- Agent question inbox.
- Permission inbox.
- Multi-agent dashboard.
- Limits/quota tracking if providers expose it.
- Handoff: continue a task with another provider using summarized context and current diff.
- Compare providers on the same task in separate worktrees.

## Highest-Value Next Tickets

1. Build `ProviderDiagnosticsService`.
2. Expand `RunEvent` types and update renderer mapping.
3. Add fixture tests for questions, permissions, failed tools, and malformed output.
4. Add provider capability registry with runtime modes, not just provider IDs.
5. Implement Claude permission decisions beyond current `Allow & Continue`.
6. Add Copilot permission mapping from GUI to `--allow-tool` / `--deny-tool` / path / URL flags.
7. Add Cursor permission config generation.
8. Research and prototype Copilot `--acp`, Codex `app-server` / `exec-server`, and Claude `--permission-prompt-tool`.
9. Add live smoke-test command for all installed providers.
10. Add UI for agent questions separate from raw terminal input.

## Sources Checked

Local CLI help:

- `claude --help`
- `codex --help`
- `codex exec --help`
- `copilot --help`
- `copilot help permissions`
- `copilot help commands`
- `agent --help`
- `agent models`

Official docs:

- Anthropic Claude Code CLI reference: https://docs.anthropic.com/en/docs/claude-code/cli-reference
- OpenAI Codex CLI getting started: https://help.openai.com/en/articles/11096431-openai-codex-ligetting-started
- GitHub Copilot CLI command reference: https://docs.github.com/copilot/reference/cli-command-reference
- GitHub Copilot CLI allowing and denying tool use: https://docs.github.com/en/copilot/how-tos/copilot-cli/allowing-tools
- Cursor Agent CLI parameters: https://docs.cursor.com/en/cli/reference/parameters
- Cursor Agent output format: https://docs.cursor.com/en/cli/reference/output-format
- Cursor Agent permissions: https://docs.cursor.com/cli/reference/permissions
