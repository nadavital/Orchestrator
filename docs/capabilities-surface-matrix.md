# Capabilities Surface Matrix

Last checked: 2026-05-14

This matrix defines what Orchestrator means by a capability, where Claude and Codex store or expose it, and what the Capabilities page should do with it.

## Research Basis

- Claude Code docs: plugins package skills, agents, hooks, and MCP servers through `.claude-plugin/plugin.json`; standalone skills live in `~/.claude/skills/<name>/SKILL.md` or `.claude/skills/<name>/SKILL.md`; legacy `.claude/commands/*.md` still works as command-like skills.
- Claude Code plugin reference: plugin components live at the plugin root, not inside `.claude-plugin/`; supported components include `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, LSP, monitors, themes, output styles, and `bin/`.
- Codex docs: skills are the authoring format and plugins are the installable distribution unit; global skills live in `$HOME/.agents/skills`, repo skills in `.agents/skills`, and AGENTS instructions in `~/.codex/AGENTS.md` or repo `AGENTS.md`.
- Codex plugin docs: plugins use `.codex-plugin/plugin.json` and may point at `skills/`, `.app.json`, `.mcp.json`, `hooks/hooks.json`, and assets at the plugin root.
- Codex app-server docs: native APIs can list skills, hooks, plugins, apps, MCP status, external agent config, and can mutate selected provider state through explicit methods such as `skills/config/write`, `plugin/install`, `plugin/uninstall`, `marketplace/add`, `config/mcpServer/reload`, and `externalAgentConfig/import`.
- Local CLI evidence on this machine:
  - `claude plugin --help` exposes install/list/details/enable/disable/update/uninstall/validate/marketplace actions.
  - `codex plugin --help` currently exposes marketplace management from the CLI; richer plugin install/read/uninstall is available through app-server.

## Ownership Model

| Ownership | Meaning | UI action policy |
| --- | --- | --- |
| File-backed, Orchestrator-owned | Files created by Orchestrator or obvious user/team capability files with stable structure. | Allow edit/delete when the row includes an explicit `editable` marker. |
| File-backed, provider-owned | Provider settings, hooks, instruction files, system skills, and installed/plugin cache files. | Inspect only until a scoped editor is designed. |
| Provider inventory | Native list output from CLI or app-server. | Inspect/refresh only. Provider mutations need explicit confirmation or terminal handoff. |
| Provider marketplace | Package indexes that point at plugins. | Read/refresh now; install/enable/update/remove later behind confirmation. |

## Unified Capability Matrix

| Capability | Claude source | Codex source | Orchestrator support | Next policy |
| --- | --- | --- | --- | --- |
| Skills | `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, plugin `skills/` | `$HOME/.agents/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`, plugin `skills/`; legacy installed skills may appear under `~/.codex/skills` | Discover global and project skills for both providers. New skill creation writes Claude `.claude/skills` and documented Codex `.agents/skills`. Editable only when explicitly file-backed. | Keep skills as the common authoring unit. |
| Commands | `.claude/commands/*.md`, plugin `commands/` | No separate Codex command file surface; use skills or app-owned slash commands. | Discover Claude project/global commands as `command`. | Treat new prompt workflows as skills, not commands. |
| Plugins | `.claude-plugin/plugin.json`, marketplace `.claude-plugin/marketplace.json`, `claude plugin list` | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, app-server `plugin/list` | Portable plugin creation writes both manifests and both local marketplace entries. Discovery merges provider rows by plugin name. | Provider-native install/update/uninstall remains gated. |
| Plugin children | Claude plugin `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json` | Codex plugin `skills/`, `.app.json`, `.mcp.json`, `hooks/hooks.json`, assets | Matrix recognizes them as plugin-contained capabilities. The page shows the package row and standalone mirrors for immediate skills. | Add child inventory drawer before surfacing every child as top-level rows. |
| Agents/subagents | `.claude/agents/*.md`, plugin `agents/`, `claude agents list` | App-server external-agent config detection/import can see subagents; runtime multi-agent events are separate from capability inventory. | Discover Claude agent files and provider agent inventory. Codex external config remains app-server inventory. | Edit/import agents later with validation. |
| Hooks | Claude `settings.json` hooks and plugin `hooks/hooks.json` | Codex app-server `hooks/list`, plugin `hooks/hooks.json` | Discover Claude settings hooks and Codex app-server hooks as inspect-only. | Hooks can block tools; keep edit/delete out until there is a dedicated hook editor. |
| MCP servers | Claude `.mcp.json`, `claude mcp list/get`, plugin `.mcp.json` | `~/.codex/config.toml` / project `.codex/config.toml` `[mcp_servers.*]`, app-server `mcpServerStatus/list`, plugin `.mcp.json` | Create writes shared `.mcp.json`, Claude-readable project config, Cursor/Copilot configs, and Codex TOML. Edit/delete supports JSON MCP config and Orchestrator-managed Codex TOML sections. | OAuth/reload/tool/resource actions stay provider-native and gated. |
| MCP tools/resources | Claude MCP details during runtime/settings | Codex app-server `mcpServerStatus/list`, `mcpServer/resource/read`, `mcpServer/tool/call` | Runtime tool calls are normalized; inventory rows focus on servers. | Add tool/resource drilldown once server inventory is stable. |
| Apps/connectors | No direct Claude Code equivalent in this repo surface. | Codex app-server `app/list`; Codex plugins may include `.app.json`. | Read-only Codex app inventory. | Add connector auth/insertion only through app-server or installed connectors. |
| Instructions/rules | `CLAUDE.md`, `.claude/CLAUDE.md` style memory/instruction files | `~/.codex/AGENTS.md`, repo `AGENTS.md` | Discover global/project instruction files as `rule`, inspect-only. | Keep instructions visible but avoid editing provider memory through a generic sheet. |
| Output styles/themes/monitors/LSP/bin | Claude plugin components | Codex plugin manifest/assets; not all Claude-only components have Codex equivalents | Matrix tracks them as package internals, not first-class rows yet. | Add only when the UI has a real use for managing them. |
| Goal | Not a provider capability. | Codex app-server thread goal APIs | Session metadata, not capability inventory. | Keep `/goal` work in session UI, not Capabilities. |

## Implementation Rules

- The Capabilities page is the user-facing inventory across providers.
- Settings can keep diagnostics, raw command surfaces, and provider readiness.
- Capabilities should group by normalized kind/name and show provider badges so a portable package appears as one thing with provider provenance.
- Never infer edit/delete safety from path alone. Discovery must set an explicit editable flag.
- Prefer documented Codex `.agents/skills` for new skills. Continue discovering legacy `.codex/skills` as inspect-only or migration candidates.
- Mutating provider commands such as plugin install, plugin uninstall, marketplace add, MCP reload, OAuth login, and external config import require explicit confirmation or terminal handoff.
