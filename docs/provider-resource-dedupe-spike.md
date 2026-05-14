# Provider Resource Dedupe Spike

Date: 2026-05-14

## Problem

Orchestrator currently discovers provider resources through provider-specific command surfaces. Claude exposes agents, MCP, plugins, and skills differently from Codex app-server, Cursor, and Copilot. The UI should not make users manage four separate ideas when several entries describe the same underlying capability.

The Resources page should be a main settings surface, not a chat/session sidebar. Session sidebars should stay focused on live work: changes, plan, active subagent transcript, and side questions. Usage belongs in settings/provider diagnostics rather than per-session chrome.

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

## Migration Path

1. Add a provider resource discovery service in main process that calls existing safe command surfaces.
2. Cache resource snapshots by provider with `lastRefreshedAt`, status, and raw diagnostics.
3. Convert Claude, Codex, Cursor, and Copilot surfaces into `ProviderResource[]`.
4. Replace Resources page direct command-surface rendering with grouped normalized resources.
5. Add conflict UI for suggested duplicates: `Keep separate`, `Treat as same`, `Prefer provider`.
6. Store user decisions in settings as resource aliases, not by editing provider-native config.
7. Add import/migration actions only after read-only discovery is stable.

## Next Implementation Ticket

- Add `src/main/providerResources.ts` with a read-only `discoverProviderResources(providerId)` entrypoint.
- Wire IPC methods for list and refresh, returning cached normalized resources plus raw provider diagnostics.
- Move the renderer Resources section off direct provider command surfaces and onto grouped `ProviderResource` rows.
- Add provider badges, duplicate suggestions, and an expanded native-detail drawer before exposing any mutation actions.

## Provider Notes

| Provider | Current useful surfaces | Normalized resources |
| --- | --- | --- |
| Claude | `agents-list`, `mcp-list`, `mcp-details`, `plugin-list` | Agents, MCP servers/tools, plugins, project commands/skills when discoverable. |
| Codex | app-server skills, hooks, plugins, apps, MCP status, external agent config | Skills, hooks, plugins, apps/connectors, MCP servers, external agents. |
| Cursor | MCP and rules surfaces where available | MCP tools, rules, generated project conventions. |
| Copilot | plugin/MCP/ask-user/tool surfaces where available | Plugins, MCP servers/tools, permission/tool policies. |

## Open Questions

- Should user-created aliases be global or project-scoped by default?
- Do we want migration to copy provider-native resources, or only link them in Orchestrator?
- Should disabled or missing resources stay visible by default?
- Which resource kinds should support one-click enable/disable versus terminal handoff?
- How should conflicting versions of the same plugin or skill be shown?

## Recommendation

Start read-only. Ship the Resources page as a normalized inventory and dedupe suggestion surface first. After that, add explicit migration/import actions for the resource kinds with stable native contracts. This avoids mutating provider state before we know the discovery model is correct.
