# Provider Capability Research

Date: 2026-05-06

Canonical active plan: `docs/orchestrator-source-of-truth.md`.

This file is research evidence. Active implementation status and completion gates live in the source-of-truth plan.

## 2026-05-06 CLI Coverage Gap Baseline

This pass moved the known CLI coverage gaps out of prose-only research and into the provider runtime registry, so diagnostics and tests can track what still needs adapter/UI work.

Current high-priority gaps now tracked in code:

| Provider | Gap | Status | Next implementation slice |
| --- | --- | --- | --- |
| Claude Code | Rich permission controls: denied tools, scoped directories, persisted grants | Partial | Add compact GUI editing for tool/path rules and explicit allow-once vs allow-session behavior. |
| Copilot | Keychain access differs between sandboxed shell and app/non-sandbox process | Partial | Run account-sensitive probes from the installed app process and show keychain errors separately from missing CLI errors. |
| Copilot | Structured runtime parsing beyond basic JSON | Partial | Record CLI fixtures for command/user-input/permission/subagent events now that help/version are captured outside the sandbox. |
| Codex | Interactive approval prompts | Missing | Add a PTY-backed Codex interactive CLI lane using `--ask-for-approval`; keep `codex exec` only for non-interactive automation. |
| Codex | MCP elicitation | Partial | Add interactive CLI fixtures for `tool_call_mcp_elicitation` and normalize to `user_input.requested`. |
| Cursor | Account/model probes can fail on keychain | Blocked | Keep model probes optional and preserve manual model overrides. |
| Cursor | Worktree and MCP/rules controls | Missing | Add shared worktree launch controls and compact provider-specific MCP/rules actions. |

Implementation started:

- `ProviderCapabilityRegistry` now includes `gaps`.
- `npm run smoke:providers` prints feature, gap, probe, and permission-policy summaries.
- Generic CLI question events normalize to `user_input.requested` for Copilot, Codex, and Cursor fixtures.
- Generic CLI permission/approval events normalize to `permission.requested` for Copilot, Codex, and Cursor fixtures.
- Provider adapters now expose separate interactive CLI command builders so the app can wire a native CLI lane without reusing headless JSON launch flags.

## 2026-05-07 Open-Source Reference Notes

These repos are architecture references only. Do not copy implementation code; use them to validate product shape and risk areas.

| Project | What it proves | Useful ideas for Orchestrator | What not to copy blindly |
| --- | --- | --- | --- |
| `siteboon/claudecodeui` | A chat/file/git UI can sit on top of native coding CLIs and discovered provider sessions. | Use provider-native config/session state, keep a direct terminal escape hatch, and render CLI sessions as structured chat where possible. | Do not inherit shell/WebSocket risk patterns; keep process spawning argument-based and local/Electron-scoped. |
| `farion1231/cc-switch` | A desktop app can manage multiple coding CLI configs, MCP, prompts, skills, provider presets, usage, proxy/failover, and session browsing across apps. | Add a native-config management layer: import/backfill live provider config, switch provider profiles safely, use atomic writes/backups, and separate provider config management from agent runtime rendering. | Do not turn Orchestrator into a provider-proxy-first product. Proxy/takeover can be optional later; our core product remains real CLI sessions with clean GUI rendering. |
| `johannesjo/parallel-code` | Multi-agent coding can be modeled as isolated branches/worktrees with separate terminals, diffs, notes, CI status, and merge decisions. | Make worktree/session provenance first-class: branch, base, task notes, per-task terminal, diff review, merge/push controls, and optional Docker sandboxing. | Do not make every session a worktree by default. Keep direct/local sessions available and make isolation an explicit task mode. |
| `withcrux/claudia` | A narrow Claude Code desktop wrapper can still add value through session history, cost tracking, markdown rendering, tool-call viewers, export, and global stats. | Treat transcript quality as a product feature: searchable history, collapsed tool calls, cost/token summaries, export, and simple session stats. | It is Claude-only and very early, so do not use it as evidence for multi-provider behavior or mature parser coverage. |
| `markes76/claude-code-gui` | Useful evidence for fallback terminal/session-log behavior, but no longer the target runtime shape for normal Claude chat. | Prefer Claude structured JSON/JSONL for first-class Orchestrator UI; keep PTY/xterm ideas for explicit terminal handoffs and provider-management flows. | It is Claude-only and small/early, so treat the pattern as useful but verify every config/log shape against the installed Claude CLI before encoding behavior. |
| `xintaofei/codeg` | A broader multi-agent workspace can aggregate local sessions across Claude Code, Codex, OpenCode, Gemini CLI, OpenClaw, Cline, and more while adding worktrees, MCP/skills, git/file/terminal flows, and remote chat channels. | Use it as a reference for long-term multi-provider session ingestion, permission notifications, remote control surfaces, and worktree-aware engineering loops. | Do not let remote/server/channel breadth distract from the local desktop CLI-first core. |
| `sombraio/claudecodeui` | A CloudCLI/ClaudeCodeUI variant reinforces the same web/mobile session UI pattern: chat, integrated shell terminal, file/git explorer, session management, and native Claude MCP config sync. | Treat as corroborating evidence for the `claudecodeui` pattern rather than a separate architecture direction. | It appears to overlap heavily with CloudCLI; do not count it as independent proof of provider coverage. |

Immediate architecture implication:

- Split the product into two explicit layers:
  1. **Runtime layer**: starts/resumes provider CLI sessions, parses output, surfaces questions, permissions, tools, diffs, and subagents.
  2. **Config layer**: reads/writes provider-native config for models, endpoints, MCP, prompts/rules, skills/plugins, quotas, and local overrides.
- `claudecodeui` mostly informs the runtime/session layer.
- `cc-switch` mostly informs the config/provider-management layer.
- `parallel-code` mostly informs the multi-session worktree/orchestration layer.
- `claudia` mostly informs the transcript/history/cost-rendering layer.
- `claude-code-gui` mostly informs the concrete Claude PTY-plus-JSONL implementation pattern.
- `codeg` mostly informs longer-term multi-provider session aggregation and remote control.
- Together, they reinforce the same principle: provider-native files and CLI semantics should remain the source of truth.

## 2026-05-06 SDK Runtime Spike Addendum

Update: this spike is background evidence only. The product direction is CLI-first; SDKs and app-server protocols should not lead the implementation unless a native CLI surface cannot support a feature we need.

This pass inspected current public SDK surfaces and did local no-prompt import/status probes. No agent prompts were sent, so this did not spend model quota.

Sources checked:

- Cursor SDK announcement and examples: https://cursor.com/blog/typescript-sdk
- GitHub Copilot SDK custom agents/subagents docs: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-agents
- GitHub Copilot SDK streaming events docs: https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk/use-copilot-sdk/streaming-events
- Harness unified CLI docs: https://www.harness.lol/docs
- Cockpit Claude Code Agent SDK GUI: https://cocking.cc/en/
- Crest terminal-orchestration GUI: https://www.crestai.dev/

Local package probes:

| SDK | Version checked | Local import/status result | Packaging notes | Immediate implication |
| --- | --- | --- | --- | --- |
| `@cursor/sdk` | `1.0.12` | Temp install under `/tmp` imports cleanly. `Cursor.models.list()` fails without `CURSOR_API_KEY`. | Installed dependency tree is about 47 MB and includes `sqlite3`, `@connectrpc/*`, protobuf, Statsig, and Zod. | Good candidate for an optional Cursor SDK runtime, but account/model probes need API-key-based auth, not just desktop login. |
| `@github/copilot` | `1.0.43` | SDK imports cleanly. `CopilotClient.start()`, `getStatus()`, `getAuthStatus()`, and `listModels()` work without sending a prompt. | Package is large, about 179 MB unpacked, with native/prebuilt modules and SDK docs/types bundled. | Strongest SDK candidate. SDK status/auth/model-list works even while plain `copilot --version` still fails with `SecItemCopyMatching failed -50`. |

Cursor SDK facts from package/types and official docs:

- Public API exports `Agent`, `Cursor`, `Run`, streaming `SDKMessage` types, model listing, local/cloud agent options, MCP server config, artifacts, conversation history, and run event storage/notifiers.
- Minimal local pattern is `Agent.create({ apiKey, model, local: { cwd } })`, `agent.send(...)`, then `for await (const event of run.stream())`.
- The SDK explicitly shares Cursor's runtime/harness/models across desktop, CLI, web, local, self-hosted, and cloud.
- It advertises MCP, skills, hooks, and subagents. Subagents are spawned through an `Agent` tool and can have their own prompts/models.
- Local/cloud model listing wants `CURSOR_API_KEY`; in this spike, no API key was present, so SDK account calls returned a configuration error before any network/model usage.

Copilot SDK facts from package/types and official docs:

- Public API exports `CopilotClient`, `CopilotSession`, tools, command definitions, permission handlers, user-input handlers, elicitation handlers, MCP configs, custom agents, skills, session FS, and event handlers.
- No-prompt SDK status probe succeeded:
  - version `1.0.43`
  - protocol version `3`
  - auth OK via `gh-cli`
  - model list returned account-enabled models and capability metadata.
- Event schemas include assistant deltas/messages, tool start/progress/complete, usage, session context, permissions, user input, elicitation, MCP OAuth, external tools, command events, background tasks, skills, custom agents, MCP server status, extensions, and subagent lifecycle events.
- Permission requests are structured by kind: shell, write, read, MCP, URL, memory, and custom-tool.
- Subagent events include selected/started/completed/failed/deselected and include fields like tool call ID, agent display name, description, model, duration, token totals, and error.

Open-source comparison:

- Harness is closest to our existing adapter direction: one subprocess wrapper, one NDJSON event stream, supported backends for Claude Code, Codex, OpenCode, and Cursor.
- Cockpit is evidence that a GUI can be SDK-native when the SDK is good enough: it is a Claude Code GUI built on the Claude Agent SDK, while still assuming the local CLI config works.
- Crest is evidence for terminal-overlay orchestration: it keeps Claude Code and Codex running in real terminals, then layers supervision, prompt answering, approvals, and orchestration on top.

Evaluation:

| Runtime path | Difficulty | Value | Main risk | Recommendation |
| --- | --- | --- | --- | --- |
| Current headless JSON CLIs | Low | Stable baseline for automation, smoke tests, prompt/result, tools, diffs, permissions where emitted | Provider-specific gaps remain; weaker for rich subagents/commands | Keep for automation and tests, not as the primary product experience. |
| PTY/terminal overlay | Medium | Preserves native provider behavior, permissions, slash commands, and interactive flows | Harder to parse reliably; permission states can become text-scraping | Primary next runtime path for provider features that only exist in the CLI. |
| Cursor SDK runtime | Medium | Local/cloud runs, stream events, artifacts, MCP, skills, hooks, subagents | Requires `CURSOR_API_KEY` for account/cloud calls; adds native-ish dependency tree | Spike behind optional runtime flag after runtime abstraction exists. |
| Copilot SDK runtime | Medium-high | Best structured event surface; solves current CLI keychain failure for status/auth/models; rich permissions/subagents/commands | Large dependency/package footprint; protocol is preview and may shift | Defer; first fix/observe the native CLI path. |
| Codex app-server/runtime | Medium-high | Potentially Codex.app-like approvals/events/features | Protocol discovery still needed | Defer until the CLI/PTY path proves insufficient. |

Implementation proposal:

1. Add `ProviderRuntimeAdapter` as the layer below provider adapters:

```ts
interface ProviderRuntimeAdapter {
  id: string
  providerId: string
  kind: 'headless-json' | 'pty-overlay' | 'sdk' | 'app-server'
  available(): Promise<RuntimeHealth>
  start(request: RunRequest, emit: (event: RunEvent) => void): Promise<RuntimeHandle>
  resume(request: RunRequest, emit: (event: RunEvent) => void): Promise<RuntimeHandle>
}
```

2. Keep current adapters as `*-headless-json` implementations.
3. Add provider-specific interactive CLI/PTY runtime lanes for native permission prompts, slash commands, questions, and session controls.
4. Keep SDK/app-server paths as fallback research only when the CLI cannot expose a feature cleanly.
5. Superseded on 2026-05-13: do not make runtime selection a normal user setting for Claude. Prefer structured JSON for user-facing Claude coding sessions; keep native CLI only for explicit terminal handoff/provider-management flows.

Hardness estimate:

- Runtime abstraction plus migration of current providers: 1-2 focused slices.
- Copilot SDK MVP: 2-3 slices. Start/status/model health, then send/stream parser, then permissions/user input.
- Cursor SDK MVP: 2-3 slices after auth config. Health/API key, local run stream parser, then model/MCP/artifact surfaces.
- UI polish for runtime choice/health: 1 slice.

## 2026-05-06 Local CLI Spike Addendum

This pass used local CLI discovery only. No model prompts were sent, so this did not spend provider quota.

Commands sampled:

- `which claude`, `claude --help`, `claude --version`, `claude agents --help`, `claude mcp --help`, `claude plugin --help`, `claude ultrareview --help`
- `which codex`, `codex --help`, `codex --version`, `codex exec --help`, `codex review --help`, `codex mcp --help`, `codex plugin --help`, `codex sandbox --help`, `codex features list`
- `which cursor-agent`, `cursor-agent --help`, `cursor-agent --version`, `cursor-agent mcp --help`, `cursor-agent create-chat --help`, `cursor-agent models`, `cursor-agent status`, `cursor-agent about`
- `which copilot`, `copilot --help`, `copilot --version`, plus static inspection of the installed `@github/copilot` package. Copilot help/version work outside the sandbox, while sandboxed shells can fail on Keychain access.

Current local binaries:

| Provider | Binary | Version / spike status | Immediate implication |
| --- | --- | --- | --- |
| Claude Code | `/Users/navital/.local/bin/claude` | `2.1.129 (Claude Code)` | Richest directly discoverable CLI surface. |
| Codex CLI | `/Users/navital/.local/bin/codex` | `codex-cli 0.128.0` | Strong structured automation surface plus app/plugin/MCP/sandbox surfaces. |
| Cursor Agent | `/Users/navital/.local/bin/cursor-agent` | `2026.05.07-42ddaca` | Help works; sandboxed model/auth/status commands can hit keychain errors, while non-sandbox status and Sonnet live smoke pass. |
| GitHub Copilot CLI | `/Users/navital/.local/bin/copilot` | `GitHub Copilot CLI 1.0.39` outside the sandbox; sandboxed shell can fail with `SecItemCopyMatching failed -50` | Installed, but health must distinguish sandbox/keychain failure from missing binary. |

### Cross-Provider Capabilities We Should Model

| Capability | Claude | Codex | Copilot | Cursor | Current Orchestrator gap |
| --- | --- | --- | --- | --- | --- |
| Structured non-interactive output | `--output-format stream-json` | `exec --json` | `--output-format json` in current adapter | `--print --output-format stream-json` | We parse basics, but not partials, progress, subagents, commands, background tasks, or rich permissions. |
| Interactive / TUI runtime | Default CLI mode | Default CLI mode | Default CLI mode | Default CLI mode | We mostly use headless prompt mode; need a second runtime class for interactive/PTY or structured app-server protocols. |
| Permission modes | `default`, `acceptEdits`, `auto`, `bypassPermissions`, `dontAsk`, `plan`; `--allowedTools`, `--disallowedTools`, `--tools` | sandbox: `read-only`, `workspace-write`, `danger-full-access`; interactive approval: `untrusted`, `on-request`, `never`; bypass flag | CLI exposes interactive/plan/autopilot, `--allow-tool`, `--deny-tool`, `--available-tools`, path/url/MCP allow-deny, `--allow-all`, and `--no-ask-user`; SDK exposes shell/write/read/MCP/url/memory/custom-tool/hook permission schemas | `ask`, `plan`, `force/yolo`, `sandbox enabled/disabled`, trust, MCP approval | Need a provider-specific permission request model with allow once/session, deny, diff preview, path/url scope, and "forced headless" honesty. |
| User questions / elicitation | `AskUserQuestion`, `--brief`, `SendUserMessage` | feature flags include `tool_call_mcp_elicitation`; app supports request_user_input in Codex host | SDK exposes interactive elicitation capability and command/user input events | Not proven from help; likely textual/interactive path | We have Claude question cards; need canonical `user_input.requested` across providers. |
| Slash commands | CLI has slash-command/skills controls: `--disable-slash-commands`, skills resolve as `/skill-name` | Interactive commands plus plugins/skills; exact slash list not exposed by `--help` | SDK exposes `command.queued`, `command.execute`, `commands.changed`, `CommandDefinition`; skills can be slash commands | Interactive CLI likely has slash commands, not exposed by top-level help | Need a provider command registry and composer autocomplete. Some commands are app-owned, some provider-owned, some extension-owned. |
| MCP | `claude mcp add/list/get/remove/serve`, `--mcp-config`, strict MCP config | `codex mcp list/get/add/remove/login/logout`, `mcp-server` | CLI exposes `mcp`, built-in GitHub MCP tool/toolset flags, extra MCP config, enable/disable controls; SDK has MCP permission/config events | `cursor-agent mcp list/list-tools/login/enable/disable` | Need MCP server status, tool listing, OAuth/login, and per-tool permission UI. |
| Plugins / skills | `claude plugin install/list/enable/disable/update/validate`, `--plugin-dir`, `--plugin-url` | `codex plugin marketplace`, features show plugins stable | CLI exposes `plugin` and `--plugin-dir`; package has built-in skills and SDK extension model | Cursor has `~/.cursor/plugins` and MCP integrations | Need provider-specific extension settings and command/tool surfacing. |
| Agents / subagents / multi-agent | `--agent`, `--agents <json>`, `claude agents`, `ultrareview` cloud multi-agent review | Feature flags show `multi_agent` stable, `multi_agent_v2` under development | SDK event types include `subagent.started/completed/failed/selected/deselected`; built-in agents: code-review, configure-copilot, explore, research, rubber-duck, task | Worktrees/chat/rules; no structured subagent event proven from help | Need agent activity tree: parent, child agents, status, transcript/tool stream, permissions, pet notifications. |
| Worktrees | `--worktree`, `--tmux` | `--cd`, `--add-dir`; interactive has app/cloud workflows | Not verified from current help due keychain failure | `--worktree`, `--worktree-base`, `--skip-worktree-setup` | Need a workspace/worktree launch surface and session provenance. |
| Review mode | `ultrareview [--json]` | `codex review`, `codex exec review` | Built-in `code-review.agent.yaml`; prior docs mention review commands | No dedicated review command in top help | Review should be a first-class task type, not only a prompt. |
| Local/OSS providers | Not from help sampled | `--oss`, `--local-provider lmstudio|ollama` | Not sampled | Bedrock config command exists | Need provider backend variants under one provider, separate from model list. |
| Images / file attachments | `--file file_id:path`; Chrome integration | `--image <FILE>...` | Package includes computer/image dependencies, but not verified in CLI help due keychain failure | Not from top help | Composer should expose attachment support only when runtime supports it. |
| Usage / model listing | Model aliases in help; account-specific list not found | `models_cache.json` exists; model arg is arbitrary | Model flag is arbitrary; account/model listing still needs a non-sandbox probe | `models` / `--list-models`, but sandboxed shell can hit keychain error | Need cached last-known working model, invalid-model suppression, and opt-in model probes. |

### Provider-Specific Notes

#### Claude Code

Newly verified CLI details:

- Agents: `--agent`, `--agents <json>`, and `claude agents`.
- Multi-agent review: `claude ultrareview [target] --json --timeout <minutes>`.
- Plugins: install/list/enable/disable/update/validate/marketplace/prune/tag.
- MCP: add HTTP/stdio servers, add JSON, import from Claude Desktop, get/list/remove/reset project choices, serve.
- Runtime toggles: `--bare`, `--chrome`, `--ide`, `--worktree`, `--tmux`, `--fork-session`, `--from-pr`, `--session-id`, `--json-schema`, `--include-partial-messages`, `--input-format stream-json`, `--replay-user-messages`.
- Permission surface is richer than our UI: allow/disallow specific tools, add directories, choose built-in tool set, and multiple permission modes.

UI implications:

- Add a Claude "Agents" subsection: selected agent, custom agents JSON, and cloud review task.
- Add a plugin/MCP subsection with installed/listed state and tool exposure.
- Extend parser support for partial messages and hook lifecycle events when enabled.
- Treat worktree sessions as separate workspaces with visible origin/base.

#### Codex CLI

Newly verified CLI details:

- `codex exec` has nested `resume` and `review`.
- `codex review` supports `--uncommitted`, `--base`, `--commit`, and custom title/instructions.
- `codex sandbox` has platform-specific subcommands: macOS Seatbelt, Linux sandbox, Windows restricted token.
- `codex features list` shows useful enabled features on this machine: `apps`, `browser_use`, `computer_use`, `multi_agent`, `plugins`, `tool_call_mcp_elicitation`, `tool_search`, `tool_suggest`, `shell_tool`, `guardian_approval`, and more.
- Interactive CLI supports images, web search, OSS/local providers, profiles, approval policies, and remote app server connection.
- `codex app-server`, `exec-server`, `mcp-server`, `cloud`, `resume`, and `fork` are worth treating as separate integration spikes.

UI implications:

- Keep `codex exec` as the deterministic headless lane.
- Add a Codex "interactive/app server" spike before trying to fake approval prompts through `exec`.
- Add review task creation UI.
- Add feature flag diagnostics, but keep it tucked away from normal users.
- Add local/OSS provider support as a provider backend variant.

#### GitHub Copilot CLI / SDK

Sandboxed shells can fail to run `copilot --help` or `copilot --version` with:

```text
ERROR: SecItemCopyMatching failed -50
```

Running outside the sandbox, `copilot --version` reports `GitHub Copilot CLI 1.0.39`, and `copilot --help` exposes interactive prompt mode, JSON prompt mode, ACP, plan/autopilot modes, MCP, plugins, custom providers, ask-user controls, and tool/path/URL allow-deny flags. Static package inspection adds deeper event details:

- SDK event union includes `subagent.started`, `subagent.completed`, `subagent.failed`, `subagent.selected`, `subagent.deselected`.
- SDK event union includes `command.queued`, `command.execute`, `command.completed`, and `commands.changed`.
- SDK permission schema includes shell, write, read, MCP, URL, memory, custom-tool, and hook permission requests.
- SDK supports user input, elicitation, sampling, MCP OAuth, background tasks, loaded skills, custom agents, MCP server status, and tools updated events.
- Built-in agent definitions found locally: `code-review`, `configure-copilot`, `explore`, `research`, `rubber-duck`, and `task`.

UI implications:

- Our current Copilot adapter is too shallow. We should strongly consider using the SDK/session event protocol rather than only the CLI prompt mode.
- Copilot is the strongest evidence for a normalized subagent tree and slash-command registry.
- Health should say "installed but keychain/auth unavailable in this process" instead of only ready/missing.
- Permission UI should be richer than Allow/Deny: shell command details, write diff, URL, MCP tool, memory, and custom tool prompt shapes.

#### Cursor Agent

Newly verified CLI details:

- Modes: `--mode plan`, `--mode ask`, `--plan`; print mode has full tools unless configured.
- Model listing exists via `models` / `--list-models`, but local model/status/about calls hit the same keychain error in this shell.
- Worktree support: `--worktree`, `--worktree-base`, `--skip-worktree-setup`.
- MCP commands: `login`, `list`, `list-tools`, `enable`, `disable`.
- Session controls: `create-chat`, `ls`, `resume`, `--resume`, `--continue`.
- Other setup: shell integration install/uninstall, Bedrock config, rule generation.
- Network config remains important for this environment: `network.useHttp1ForAgent`.

UI implications:

- Make Cursor "Plan", "Ask", "Sandbox", and "Auto" look like Cursor-native modes, not generic paragraphs.
- Add model list probing with failure states.
- Add MCP list-tools UI.
- Add worktree launch controls.
- Add "Generate Rule" and Bedrock config entry points only in advanced/provider-specific settings.

### Slash Command Product Shape

Slash commands should be provider-aware and runtime-aware:

1. **App-owned commands**: things Orchestrator implements itself, such as `/new`, `/settings`, `/diff`, `/terminal`, `/providers`, `/model`, `/permission`.
2. **Provider-owned commands**: commands the provider CLI understands in interactive mode.
3. **Extension-owned commands**: commands registered by plugins, skills, MCP bridges, or SDK integrations.

Canonical shape:

```ts
interface ProviderSlashCommand {
  id: string
  name: string
  description?: string
  providerId: string
  source: 'app' | 'provider' | 'plugin' | 'mcp' | 'skill' | 'sdk'
  runtime: 'headless' | 'interactive' | 'app-server' | 'sdk'
  arguments?: Array<{ name: string; optional?: boolean; description?: string }>
  handler: 'send-to-provider' | 'app-action' | 'sdk-command'
}
```

Composer behavior:

- Typing `/` opens a provider-filtered command palette.
- Commands unavailable in the current runtime are hidden by default.
- Extension commands refresh on `commands.changed` / plugin load / skills loaded / MCP tools loaded events when providers expose those.
- For headless runtimes, only app-owned or adapter-emulated commands should appear.

### Multi-Agent Product Shape

The GUI should not special-case "Copilot fleet" vs "Claude agents" vs "Codex multi_agent". It should normalize this:

```ts
interface AgentNode {
  id: string
  providerId: string
  sessionId: string
  parentAgentId?: string
  name?: string
  role?: string
  status: 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled'
  model?: string
  startedAt?: number
  completedAt?: number
  summary?: string
}
```

UI surfaces:

- Main transcript groups messages by agent when subagents exist.
- A compact side rail shows active agents and statuses.
- Permissions/questions include the agent name and parent session context.
- Pet notifications can represent root session or child agent state.
- The session list title should summarize root task, while agent cards show delegated work.

### Next Implementation Slices

1. Add `ProviderCapabilityRegistry` generated from static adapter metadata plus optional probes.
2. Add health states: `missing`, `installed`, `auth-ok`, `auth-error`, `model-error`, `keychain-error`, `smoke-passed`.
3. Add slash command registry and composer autocomplete for app-owned commands first.
4. Add provider probe commands that are no-quota by default: help/version/features/MCP list/models list where safe.
5. Add fixture types for command events, subagent events, elicitation, rich permissions, partial messages, and MCP events.
6. Add Copilot SDK spike separately from CLI prompt mode.
7. Add Codex interactive/app-server spike separately from `exec`.
8. Add provider-specific settings tabs: Models, Modes, Commands, Agents, MCP/Plugins, Advanced.

## Product Goal

Orchestrator should be one consistent GUI for multiple coding agents, not just a terminal wrapper. The user should be able to pick the provider that fits their current limits, model preference, or feature need, while the app preserves the real behavior and unique capabilities of each provider.

The core principle is:

> Normalize the app experience, not the provider truth.

That means chat, sessions, tools, diffs, file changes, questions, permission prompts, and terminal output should have one UI language. But provider-specific approval modes, sandboxing, output formats, model controls, MCP/plugin support, subagents, remote sessions, and worktree behavior should remain visible and configurable.

## Current Local CLI Reality

Verified locally on 2026-05-05:

| Provider | Binary | Version / status | Notes |
| --- | --- | --- | --- |
| Claude Code | `claude` | `2.1.128` | Full help available in sandbox. |
| Codex CLI | `codex` | `codex-cli 0.128.0` | PATH lookup plus desktop bundle fallback. |
| GitHub Copilot CLI | `copilot` | `1.0.39` | Needs non-sandbox process for Keychain access. |
| Cursor Agent | `agent` / `cursor-agent` | `2026.05.07-42ddaca` | Live smoke passes with Sonnet after enabling the HTTP/1 compatibility option in one enterprise proxy environment. |

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

Network note: in one enterprise proxy environment, Cursor Agent repeatedly reconnected until the Cursor config included:

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
