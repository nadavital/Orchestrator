# Provider CLI Spec

Date: 2026-06-02

Canonical active plan: `docs/orchestrator-source-of-truth.md`.

This file is the provider CLI evidence reference for Orchestrator's provider support. It should be updated when local CLI evidence changes, but active implementation status and completion gates live in the source-of-truth plan.

Current implementation baseline:

- Provider adapters expose separate SDK, structured automation, and interactive CLI commands where those surfaces are useful.
- Codex, Cursor, and Copilot are marked `interactiveCli=supported` in diagnostics. Claude's installed CLI can run interactively, but Orchestrator marks the Claude adapter's interactive chat lane unsupported so normal chat cannot drift back to the retired native parser.
- Cursor and Copilot account-sensitive probes may need a non-sandbox app process for macOS Keychain access.
- Antigravity is now a first-class SDK provider entry, but live runtime execution is blocked until `google-antigravity` is installed in the selected Python 3.10+ interpreter.
- Orchestrator's normal Claude product path uses `@anthropic-ai/claude-agent-sdk`. The old structured `claude -p --output-format stream-json` lane is retained only as historical evidence and compatibility/parser fixture context; provider management should be handled by Orchestrator settings, no-quota CLI probes, or the separate user terminal.

Evidence levels:

- `verified-cli`: confirmed from the installed CLI help/output in this repo session.
- `verified-config`: confirmed from local provider config/rules files.
- `verified-package`: confirmed from installed package schemas/types because the CLI could not expose help.
- `inferred`: likely from adjacent provider behavior or prior tests, but not enough to build UI without another probe.
- `unknown`: explicitly not verified yet.

## Claude Code

Evidence commands:

- `claude --help`
- `claude --version`
- `claude agents --help`
- `claude mcp --help`
- `claude plugin --help`

Local status:

- Binary: `/Users/navital/.local/bin/claude`
- Version: `2.1.132 (Claude Code)` from current diagnostics.
- CLI help: available.

Runtime modes:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Interactive session | `verified-cli` | Default `claude [prompt]` starts interactive mode and may show the workspace trust prompt. | Historical only for Orchestrator chat; the app adapter does not expose Claude interactive chat support. Provider-management work should use settings or a separate terminal handoff. |
| SDK runtime | `verified-package` | `@anthropic-ai/claude-agent-sdk` `query()` streams SDK messages and uses the local Claude auth/helper flow. | Normal Orchestrator session path. |
| Non-interactive print | `verified-cli` | `-p/--print`; output formats `text`, `json`, `stream-json`. | Historical compatibility and probe evidence only; not the normal chat runtime. |
| Streaming input | `verified-cli` | `--input-format stream-json`; `--replay-user-messages`. | Historical/deferred; SDK owns the active runtime. |
| Partial messages | `verified-package` | SDK message streams include partial assistant/subagent text. | Implemented for assistant and subagent text streaming. |
| Hook lifecycle events | `verified-package` | SDK message objects and host-tool bridge cover the app-owned approval/user-input flow. | Implemented where surfaced by the SDK normalizer; extra hook lifecycle UI remains a gap. |
| Resume/continue | `verified-cli` | `--resume`, `--continue`, `--session-id`, `--fork-session`, `--from-pr`. | Resume implemented; fork/from-PR are advanced launch extras. |
| Worktrees | `verified-cli` | `--worktree`, `--tmux`. | App-managed worktrees implemented; native launch extras tracked as advanced. |
| Chrome/IDE integration | `verified-cli` | `--chrome`, `--no-chrome`, `--ide`. | Not surfaced. |
| Bare/minimal mode | `verified-cli` | `--bare` skips hooks, LSP, plugin sync, keychain, memory, and CLAUDE.md discovery. | Not surfaced. |

Models and effort:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Model selection | `verified-cli` | `--model`; aliases like `sonnet` or `opus`, or full model names. | Partial static model list. |
| Fallback model | `verified-cli` | `--fallback-model` for print mode. | Not surfaced. |
| Effort | `verified-cli` | `--effort low|medium|high|xhigh|max`. | Partial. |
| Max budget | `verified-cli` | `--max-budget-usd` for print mode. | Not surfaced. |

Permissions and tools:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Permission mode | `verified-cli` | `--permission-mode acceptEdits|auto|bypassPermissions|default|dontAsk|plan`. | Implemented picker for product-supported modes. |
| Dangerous bypass | `verified-cli` | `--dangerously-skip-permissions`; `--allow-dangerously-skip-permissions`. | Partial. |
| Allowed tools | `verified-cli` | `--allowedTools` / `--allowed-tools`. | Implemented with session and allow-once grants. |
| Denied tools | `verified-cli` | `--disallowedTools` / `--disallowed-tools`. | Implemented. |
| Available tool set | `verified-cli` | `--tools` controls built-in tool availability. | Implemented. |
| Additional dirs | `verified-cli` | `--add-dir`. | Implemented. |
| User questions | `verified-cli` | `--brief` enables `SendUserMessage`; `AskUserQuestion` observed in stream output. | Implemented parser/UI. |

Provider features:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Agents | `verified-cli` | `--agent`, `--agents <json>`, `claude agents`. | No-quota list surfaced; mutating management routed away from auto-run. |
| MCP | `verified-cli` | `claude mcp add/list/get/remove/reset-project-choices/serve`; `--mcp-config`, `--strict-mcp-config`. | No-quota list surfaced; mutating management routed away from auto-run. |
| Plugins | `verified-cli` | `claude plugin install/list/enable/disable/update/validate/marketplace/prune/tag`. | No-quota list surfaced; mutating management routed away from auto-run. |
| Slash commands/skills | `verified-cli` | `--disable-slash-commands`; skills resolve through slash names. | Partial registry. |
| Review | `verified-cli` | `claude ultrareview [target]`. | Prompt shortcut plus quota-blocked command surface. |
| Auth/project/doctor | `verified-cli` | `auth status/login/logout`, `project`, `doctor`, `setup-token`, `install`, `update`. | Auth status is read-only in Settings; login/logout are explicit terminal handoffs and blocked from auto-run. |
| Attachments | `verified-cli` | `--file file_id:relative_path`. | Not surfaced. |
| Structured final schema | `verified-cli` | `--json-schema`. | Not surfaced. |

## Codex CLI

Evidence commands:

- `codex --help`
- `codex --version`
- `codex exec --help`
- `codex review --help`
- `codex mcp --help`
- `codex plugin --help`
- `codex features list`
- `~/.codex/config.toml`
- `~/.codex/rules/default.rules`

Local status:

- Binary: `/Users/navital/.nvm/versions/node/v22.12.0/bin/codex`
- Version: `codex-cli 0.128.0` from current diagnostics.
- CLI help: available.

Runtime modes:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Interactive TUI | `verified-cli` | Top-level `codex [prompt]` starts interactive CLI; `--no-alt-screen` probe showed the native workspace trust prompt. | Verified fallback only; do not build a Codex PTY approval lane unless app-server proves insufficient. |
| Non-interactive exec | `verified-cli` | `codex exec --json`; live 2026-05-13 smoke emitted `item.completed` with `item.type = agent_message`. | Implemented as current automation lane. |
| Review command | `verified-cli` | `codex review --uncommitted`, `--base`, `--commit`, `--title`. | Partial. |
| Resume/fork | `verified-cli` | Top-level `resume`, `fork`; exec has `exec resume`. | Partial. |
| App/app-server/exec-server | `verified-cli` | Experimental app/server commands exist; generated v2 schema includes command/file/general approvals, user-input requests, MCP elicitation, turn diffs, plans, agents, skills, plugins, MCP, account, model, filesystem, hooks, and terminal APIs. | App-server is the normal rich Codex runtime; `npm run live:codex-appserver` verifies live thread/turn completion. |
| Remote app server | `verified-cli` | Top-level `--remote` and `--remote-auth-token-env`. | Deferred. |
| Inline terminal scrollback | `verified-cli` | `--no-alt-screen`. | Verified CLI fallback only; app-server is the planned UI integration path. |
| Apply latest diff | `verified-cli` | `codex apply`. | Not surfaced. |
| Cloud tasks | `verified-cli` | Experimental `cloud`. | Not surfaced. |

Models, providers, and effort:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Model selection | `verified-cli` | `--model`; config key `model`. | Partial static model list. |
| Reasoning effort | `verified-config` | `model_reasoning_effort` in config. | Partial via `-c model_reasoning_effort`. |
| Profiles | `verified-cli` | `--profile`. | Not surfaced. |
| OSS provider | `verified-cli` | `--oss`. | Gap tracked. |
| Local provider | `verified-cli` | `--local-provider lmstudio|ollama`. | Gap tracked. |
| Web search | `verified-cli` | `--search` in interactive CLI. | Not surfaced. |
| Images | `verified-cli` | `--image` for top-level and exec. | Not surfaced. |
| Output schema | `verified-cli` | `codex exec --output-schema`. | Not surfaced. |

Approvals, sandbox, and permissions:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Approval policy | `verified-cli` | `--ask-for-approval untrusted|on-request|never`; `on-failure` deprecated. | Partial; currently passed as config in exec lane. |
| Sandbox mode | `verified-cli` | `--sandbox read-only|workspace-write|danger-full-access`; config key `sandbox_mode` is accepted. | Partial. |
| Dangerous bypass | `verified-cli` | `--dangerously-bypass-approvals-and-sandbox`. | Partial. |
| Additional writable dirs | `verified-cli` | `--add-dir`. | Not surfaced. |
| Config overrides | `verified-cli` | `-c key=value`, including `approval_policy` and `sandbox_mode`. | Partial. |
| Exec permission approvals | `verified-cli` | Feature flag `exec_permission_approvals` exists but is currently false/under development. | Unknown behavior. |
| Guardian approval | `verified-cli` | Feature flag `guardian_approval` is stable/true. | Unknown UI mapping. |
| Rule-based approvals | `verified-config` | `~/.codex/rules/default.rules` contains `prefix_rule(... decision="allow")`. | Not surfaced. |
| Auto-review permission mode | `unknown` | User reports an auto-review permission mode; not present as literal flag in current `codex --help` or `codex review --help`. Could be config/UI/feature-backed. | Must verify before UI. |

Provider features:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| MCP | `verified-cli` | `codex mcp list/get/add/remove/login/logout`; `mcp-server`. | Partial. |
| Plugins | `verified-cli` | `codex plugin marketplace`; feature flag `plugins` true. | Partial. |
| Apps/connectors | `verified-cli` | Feature flags `apps`, `enable_mcp_apps`, `tool_search`, `tool_suggest`. | Partial. |
| Multi-agent | `verified-cli` | Feature flags `multi_agent` true, `multi_agent_v2` under development. | Partial activity parser. |
| Computer/browser use | `verified-cli` | Feature flags `computer_use`, `browser_use`, `in_app_browser` true. | Not provider-surfaced. |
| MCP elicitation | `verified-cli` | Feature flag `tool_call_mcp_elicitation` true; app-server protocol has `mcpServer/elicitation/request`. | Implemented through app-server user-input mapping and response handling. |
| Request user input | `verified-cli` | Feature flag `default_mode_request_user_input` false; app-server protocol has `item/tool/requestUserInput`. | Implemented through app-server question mapping and response handling. |
| Auto-review approvals | `verified-schema` | App-server v2 schema exposes `approvalsReviewer: "auto_review"` and config key `approvals_reviewer`. | Advanced Codex permission mode passes the config; live user-review command approval is proven by `npm run live:codex-composer-approval`, but auto-review-specific behavior still needs approval-producing verification. |
| Hooks | `verified-cli` | Feature flag `codex_hooks` true. | Not surfaced. |
| Runtime metrics | `verified-cli` | Feature flag `runtime_metrics` false/under development. | Not surfaced. |
| Login/logout/status | `verified-cli` | `codex login status`, `codex login --device-auth`, `codex login --with-api-key`, and `codex logout`. App-server `getAuthStatus` is available for account status without exposing tokens. | App-server auth status and CLI status are read-only Settings checks; device/API-key sign-in and logout are explicit terminal handoffs blocked from auto-run. |

## Cursor Agent

Evidence commands:

- `cursor-agent --help`
- `cursor-agent --version`
- `cursor-agent mcp --help`
- `cursor-agent create-chat --help`
- `cursor-agent generate-rule --help`
- `cursor-agent models` and `cursor-agent status` attempted, but account/keychain-sensitive probes can fail locally.

Local status:

- Binary: `/Users/navital/.local/bin/cursor-agent`
- Version: `2026.05.07-42ddaca` from current diagnostics.
- CLI help: available.
- Account/model probes: partially blocked by local keychain/account access.

Runtime modes:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Interactive session | `verified-cli` | `cursor-agent [prompt]` / `agent [prompt]`. | Needs PTY runtime. |
| Print/headless | `verified-cli` | `--print` with `--output-format text|json|stream-json`. | Implemented as current structured lane. |
| Partial output | `verified-cli` | `--stream-partial-output`. | Gap tracked. |
| Ask mode | `verified-cli` | `--mode ask`; read-only Q&A. | Partial. |
| Plan mode | `verified-cli` | `--mode plan` or `--plan`; read-only planning. | Partial. |
| Resume/continue/list | `verified-cli` | `--resume [chatId]`, `--continue`, commands `ls`, `resume`. | Partial. |
| Create chat | `verified-cli` | `create-chat` returns a new empty chat ID. | Not surfaced. |
| Worktrees | `verified-cli` | `--worktree`, `--worktree-base`, `--skip-worktree-setup`. | Gap tracked. |
| Shell integration | `verified-cli` | `install-shell-integration`, `uninstall-shell-integration`. | Not surfaced. |

Models and auth:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| API key | `verified-cli` | `--api-key` or `CURSOR_API_KEY`. | Not surfaced. |
| Custom headers | `verified-cli` | `--header 'Name: Value'`. | Not surfaced. |
| Model selection | `verified-cli` | `--model`; `models` / `--list-models`. | Partial static/custom model list. |
| Login/logout/status | `verified-cli` | `login`, `logout`, `status|whoami`, `about`. | Not surfaced; probes can fail. |
| Bedrock config | `verified-cli` | `bedrock` command. | Not surfaced. |

Permissions and tools:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Force/yolo | `verified-cli` | `--force`, `--yolo`. | Partial. |
| Sandbox | `verified-cli` | `--sandbox enabled|disabled`. | Partial. |
| Workspace trust | `verified-cli` | `--trust` for print/headless mode. | Adapter uses it. |
| MCP approval | `verified-cli` | `--approve-mcps`; MCP enable/disable commands. | Not surfaced. |
| Permission config files | `inferred` | Help mentions explicit deny rules for `--force`; actual config shape not verified. | Unknown. |

Provider features:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| MCP | `verified-cli` | `mcp login/list/list-tools/enable/disable`. | Gap tracked. |
| Rules | `verified-cli` | `generate-rule|rule` interactive prompt flow. | Gap tracked. |
| Worktree setup | `verified-cli` | `.cursor/worktrees.json` mentioned in help. | Not surfaced. |

## GitHub Copilot CLI

Evidence commands:

- `copilot --help`
- `copilot --version`
- Installed package inspection under `/Users/navital/.nvm/versions/node/v22.12.0/lib/node_modules/@github/copilot`
- Installed package schemas/types:
  - `copilot-sdk/types.d.ts`
  - `schemas/session-events.schema.json`
  - built-in agent definitions

Local status:

- Binary: `/Users/navital/.local/bin/copilot`
- Version: `GitHub Copilot CLI 1.0.39` when run outside the sandbox.
- CLI help/version: available outside the sandbox; sandboxed shells can fail with `ERROR: SecItemCopyMatching failed -50`.
- Package: installed and inspectable.

CLI surface:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Top-level CLI help | `verified-cli` | `copilot --help` exposes interactive mode, prompt mode, ACP, plugins, MCP, permissions, providers, monitoring, and completion. | Supported baseline. |
| Version/status/auth | `verified-cli` / `verified-package` | `copilot --version` works outside the sandbox; package inspection verifies `copilot login` OAuth device flow, and a temp config probe showed the CLI emits `https://github.com/login/device` plus a device code. SDK status/auth metadata is available, but account-sensitive CLI probes still need app-process verification. | Copilot sign-in uses a managed Orchestrator handoff: start the CLI device flow, open the GitHub device page, and surface the emitted code in Settings. SDK/runtime status remains the source for account diagnostics until CLI status/logout commands are fixture-backed. |
| Prompt mode flags | `verified-cli` | `-p`, `--output-format json`, `--allow-all-tools`, `--allow-all`, `--model`, and `--effort` are exposed by help. | Partial. |
| Interactive mode | `verified-cli` | Default interactive CLI plus `-i`, `--mode interactive/plan/autopilot`, `--plan`, `--autopilot`, and `--no-ask-user`. | Supported CLI lane. |
| Permissions | `verified-cli` | `--allow-tool`, `--deny-tool`, `--available-tools`, `--allow-url`, `--deny-url`, `--allow-all-paths`, `--allow-all-urls`, and MCP tool flags. | Needs richer GUI mapping. |
| Interactive CLI behavior | `unknown` | Not verified due keychain failure. | Do not build labels from it yet. |

Installed package capabilities:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| Slash commands | `verified-package` | SDK types expose `CommandDefinition`; schema includes `command.queued/execute/completed`. | Not CLI-verified. |
| Permissions | `verified-package` | SDK types expose `onPermissionRequest`; schemas include `permission.requested/completed`. | Not CLI-verified. |
| User input | `verified-package` | SDK types expose user input request/response; schemas include `user_input.requested/completed`. | Partial parser. |
| Elicitation | `verified-package` | SDK types expose elicitation; schemas include `elicitation.requested/completed`. | Partial parser. |
| MCP | `verified-package` | SDK types expose MCP server config and tool permissions. | Not CLI-verified. |
| Subagents | `verified-package` | Schemas include `subagent.started/completed/failed/selected/deselected`; built-in agents include code-review, configure-copilot, explore, research, rubber-duck, task. | Partial parser. |
| Skills | `verified-package` | Built-in skills directory exists. | Not CLI-verified. |
| Review | `verified-package` | Built-in `code-review.agent.yaml`. | Not CLI-verified. |

## Google Antigravity SDK

Evidence commands and sources:

- PyPI SDK package: https://pypi.org/project/google-antigravity/
- Local temp SDK probe with Python 3.13:
  - `pip install google-antigravity` installed `google-antigravity 0.1.1`.
  - Import probe verified `Agent`, `LocalAgentConfig`, `CapabilitiesConfig`, `Conversation`, `ChatResponse`, `Step`, `ToolCall`, and usage metadata shapes.
- Local probes in this worktree:
  - `/usr/bin/python3` is Python 3.9 and cannot install the SDK because the package requires Python >=3.10.
  - `/opt/homebrew/bin/python3.13` exists and can install/import the SDK in a temp venv.

Local status:

- Runtime binary: Python 3.10+ interpreter, preferred via `ORCHESTRATOR_ANTIGRAVITY_PYTHON`, then Homebrew/PATH Python candidates.
- Runtime package: `google-antigravity` must be installed in the selected interpreter.
- Runtime adapter: SDK bridge at `resources/provider-bridges/antigravity_sdk_bridge.py`.
- CLI: not used by the Orchestrator Antigravity runtime.

Runtime modes:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| SDK Agent runtime | `verified-package` | `Agent(LocalAgentConfig(...))` supports async context startup and `agent.chat(prompt)`. | Implemented through the Python bridge. |
| SDK streaming chunks | `verified-package` | `ChatResponse.chunks` yields `Text`, `Thought`, `ToolCall`, and `ToolResult`; `usage_metadata` exposes token counts. | Implemented parser/fixture for text deltas, tool start/complete, run completion, and usage. |
| SDK conversations | `verified-package` | `LocalAgentConfig` accepts `conversation_id`, `workspaces`, `save_dir`, and `app_data_dir`. | Provider session id maps to SDK `conversation_id`; resume uses the same bridge. |
| SDK policies | `verified-package` | Default SDK behavior is read-only unless write tools/MCP are paired with policies; `policy.allow_all()` exists. | Default and workspace modes keep SDK defaults; bypass mode passes `policy.allow_all()`. |
| SDK subagents | `verified-package` | `BuiltinTools.START_SUBAGENT` exists. | Agent Threads graph is ready, but child thread open/resume remains planned pending fixtures. |

Models and configuration:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| SDK install | `verified-package` | `google-antigravity` requires Python >=3.10 and includes macOS arm64 wheels. | Install command is `python3.13 -m pip install google-antigravity`; diagnostics probe SDK import/version. |
| API key | `verified-package` | `LocalAgentConfig` accepts `api_key`; bridge reads `GEMINI_API_KEY` or `GOOGLE_API_KEY`. | Supported through provider env. |
| Model selection | `verified-package` | `LocalAgentConfig` accepts `model`. | Static Gemini-oriented model list is passed to the bridge. |
| Workspaces | `verified-package` | `LocalAgentConfig` accepts `workspaces`. | Orchestrator passes the session cwd as the SDK workspace. |

Provider features:

| Feature | Evidence | Details | Orchestrator status |
| --- | --- | --- | --- |
| MCP/skills/hooks/triggers | `verified-package` | `LocalAgentConfig` accepts `mcp_servers`, `skills_paths`, hooks, and triggers. | Planned until fixture-backed UI mapping. |
| Usage/cost | `verified-package` | `UsageMetadata` includes prompt/cached/candidate/thought/total token counts. | Run usage mapping implemented; no no-run quota probe. |

## Cross-Provider UI Implications

These are the product surfaces Orchestrator should build around. Each provider row should remain provider-native; do not invent generic labels unless the feature is genuinely shared.

| Surface | Claude | Codex | Cursor | Copilot | Antigravity |
| --- | --- | --- | --- | --- | --- |
| Runtime lane | interactive + print JSON | interactive + exec JSON | interactive + print JSON | SDK + interactive + prompt JSON | Python SDK bridge |
| Approval axis | permission mode | approval policy | ask/plan/force/sandbox | interactive/plan/autopilot + allow/deny controls | SDK policy hooks |
| Sandbox axis | tool/directory grants, no workspace sandbox flag | read-only/workspace/danger | enabled/disabled | path/tool/url/MCP allow-deny controls | SDK read-only default / allow_all bypass |
| Questions | AskUserQuestion / SendUserMessage | MCP elicitation + app user input features | unknown textual/interactive | SDK user input / elicitation controls | SDK ask_question fixture needed |
| Review | ultrareview | review command | unknown | SDK/built-in code-review agent | unknown |
| Agents | --agent/--agents/agents | multi_agent features | unknown | SDK subagents | SDK START_SUBAGENT fixture needed |
| MCP | mcp command and config flags | mcp command/server | mcp command/list-tools | SDK/CLI MCP config | SDK mcp_servers planned |
| Plugins/skills | plugin command, slash skills | plugin marketplace, Codex plugins | rules, MCP | SDK/CLI plugins and skills | SDK skills_paths/hooks planned |
| Worktrees | --worktree/--tmux | cd/add-dir, interactive workspace flows | --worktree | unknown | SDK workspaces=[cwd] |
| Attachments | --file | --image | unknown | unknown | unknown |

## Required Next Specs

Before implementing the next provider-specific UI slice:

1. For Codex, verify the reported "auto review" permission mode by finding the exact config key, app setting, feature flag behavior, or CLI output that exposes it.
2. For Copilot, capture help-topic details for permissions, providers, commands, plugin, and mcp, then map the useful controls into provider settings.
3. For Cursor, capture account-sensitive `models`, `status`, and `about` output in a shell where keychain access works.
4. For Claude, capture deeper subcommand help for `auth`, `project`, `doctor`, `setup-token`, `auto-mode`, and `ultrareview`.
5. For Antigravity SDK, install `google-antigravity` into the selected Python 3.10+ runtime and run a no-mutation live smoke only with explicit quota approval.
6. For Antigravity SDK, capture fixtures for `ask_question`, `START_SUBAGENT`, MCP servers, policy denial/allow, conversation resume, and cancellation.
7. Add fixture transcripts for interactive approval prompts per provider before designing the GUI buttons.
