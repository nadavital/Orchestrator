# Provider Resource Dedupe Spike

Date: 2026-05-14

## Problem

Orchestrator currently discovers provider resources through provider-specific command surfaces. Claude exposes agents, MCP, plugins, and skills differently from Codex app-server, Cursor, and Copilot. The UI should not make users manage four separate ideas when several entries describe the same underlying capability.

Capabilities should be a first-class app surface, not a settings subsection or chat/session sidebar. Session sidebars should stay focused on live work: changes, plan, active subagent transcript, and side questions. Usage belongs in settings/provider diagnostics rather than per-session chrome.

## Target Shape

Create a normalized `ProviderResource` model:

| Field | Purpose |
| --- | --- |
| `id` | Stable Orchestrator id, namespaced by provider and resource kind. |
| `kind` | `skill`, `plugin`, `app`, `mcp_server`, `mcp_tool`, `agent`, `hook`, `rule`, or `command`. |
| `providerId` | Provider that exposed the resource. |
| `source` | Native source, such as Codex app-server, Claude CLI, Cursor rules, Copilot CLI. |
| `name` | Display name after provider-specific cleanup. |
| `description` | Short user-facing summary when available. |
| `fingerprint` | Dedupe key derived from kind, canonical name, package/source id, and command/tool identity. |
| `status` | `available`, `enabled`, `disabled`, `missing`, `error`, or `unknown`. |
| `scope` | `global`, `project`, `workspace`, `session`, or `provider`. |
| `actions` | Safe actions like refresh, enable, disable, inspect, open config, import, migrate. |
| `raw` | Provider-specific payload for diagnostics only. |

## Dedupe Rules

- Dedupe within a kind first. A skill and plugin with the same name are not automatically the same resource.
- Normalize provider prefixes and package names before comparing: lowercase, trim, remove command-only suffixes, collapse whitespace, strip common scopes like `@global`.
- Prefer exact identifiers when available: MCP server name, plugin package id, app connector id, skill folder path, external agent config id.
- Use fuzzy name matching only as a suggestion, not an automatic merge.
- Show merged resources as one row with provider badges when the same resource is available through multiple providers.
- Keep provider-specific detail in an expanded drawer so dedupe does not erase important runtime differences.

## Implemented Shape

- `src/main/providerResources.ts` owns read-only discovery and normalization.
- `providers:listResources` returns provider snapshots with normalized global resources and raw provider diagnostics.
- The left-nav Capabilities page is centralized by resource kind, then merged by fingerprint, with provider badges as provenance.
- `providers:createCapability` can create global portable skills, portable plugin packages, and MCP server configs from the same screen.
- `providers:updateCapability` and `providers:deleteCapability` manage file-backed global skills, portable plugins, and MCP JSON config entries.
- Safe provider command surfaces are still used where they exist; file/config-backed provider resources are discovered locally when the provider has no stable read-only inventory command.
- Mutation actions are limited to file-backed global capabilities Orchestrator can safely edit; provider-native marketplace install/uninstall/update flows remain gated until confirmation UX is added.

## Provider Support Snapshot

| Provider | Discovery sources | Normalized resources |
| --- | --- | --- |
| Claude | Safe CLI surfaces plus `.claude/skills` and `.claude/commands` discovery | Agents, MCP servers, plugins, skills, commands. |
| Codex | App-server read APIs plus local `.codex/skills` discovery | Skills, hooks, plugins, apps, MCP servers, external agent configs. |
| Cursor | `.cursor/rules`, `.cursorrules`, and Cursor MCP config files | Rules and MCP servers. |
| Copilot | Built-in GitHub MCP, `~/.copilot/mcp-config.json`, `.github/copilot-instructions.md`, `.github/instructions`, `AGENTS.md`, root `CLAUDE.md`/`GEMINI.md` | MCP servers and repository/agent instruction rules. |

## Research Notes

- Claude Code skills live in personal/project/plugin skill directories, and Claude plugins can package skills, agents, hooks, MCP servers, LSP servers, and monitors.
- Codex app-server provides read APIs for skills, hooks, plugins, apps, MCP status, config, account, models, and thread state; Resources consumes only the extension/MCP/agent-config surfaces.
- Cursor CLI documents MCP listing and tool listing, while rules are file-backed project resources.
- GitHub Copilot CLI documents MCP configuration in `~/.copilot/mcp-config.json` and `/mcp show`; GitHub also documents repository custom instructions, path-specific instructions, and `AGENTS.md`.

## Open Questions

- Should user-created aliases be global or project-scoped by default?
- Do we want migration to copy provider-native resources, or only link them in Orchestrator?
- Should disabled or missing resources stay visible by default?
- Which resource kinds should support one-click enable/disable versus terminal handoff?
- How should conflicting versions of the same plugin or skill be shown?
- Should Cursor MCP live status come from `cursor-agent mcp list` once we add a parser, or stay config-backed until the CLI output contract is fixture-backed?
- Should Copilot `/mcp show` be run through an interactive/PTY bridge, or should we keep using `~/.copilot/mcp-config.json` for read-only inventory?

## Recommendation

Keep the Capabilities page as the one user-facing inventory. Continue adding provider-native actions behind explicit confirmation: Claude marketplace add/install/update, Codex marketplace/plugin install, app auth/connect, and MCP reload/OAuth. Avoid duplicating this surface back into Settings.
