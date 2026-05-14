# Capability Sync Spike

Last checked: 2026-05-14

## Question

Can Orchestrator make skills, plugins, MCP servers, and related provider resources available across Claude, Codex, and future providers after a user installs or creates one capability?

Short answer: yes, but it should be built as a projection/sync system, not as a single provider-native install. Claude and Codex share enough concepts for a strong common layer, but their native plugin installs, marketplace files, skill folders, MCP config formats, and reload behavior differ.

## Implementation Status

Implemented in this pass:

- `src/main/capabilitySync.ts` now supports dry-run and apply flows for skill, command-as-skill, plugin projection, and MCP server sync.
- `providers:previewCapabilitySync` and `providers:syncCapability` are wired through IPC/preload/types.
- The Capabilities page has a row-level `Sync` action, provider coverage labels, target-provider selection, mode selection, dry-run operations, warnings, blockers, and apply.
- Sync writes registry metadata under `.orchestrator/capabilities/registry/<kind>/<slug>/capability.json`.
- Plugin sync creates or updates a portable Orchestrator package with Claude and Codex manifests plus marketplace entries.
- MCP sync writes canonical Orchestrator MCP descriptors plus provider projections for Claude/shared JSON, Codex TOML, Cursor JSON, and GitHub Copilot JSON.
- Provider-native plugin installs are represented as gated plan operations and are not executed silently.
- Hooks, agents, apps/connectors, and instruction/rule sync are intentionally blocked with provider-specific reasons until their schemas and risk gates are explicit.

## Current Baseline

Orchestrator already has the first half of the system:

- `createCapability` creates portable skills, plugins, and MCP servers across provider-readable files.
- Skills are mirrored into Claude `.claude/skills` and Codex `.agents/skills`.
- Plugins are written as a shared package under `.orchestrator/capabilities/plugins/<slug>` with both `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.
- Plugin marketplace entries are written for Claude and Codex separately.
- MCP servers are written to shared `.mcp.json`, provider JSON configs, and Codex TOML.
- Discovery merges provider resources into normalized `ProviderResource` rows.
- Edit/delete works only when discovery marks a file-backed resource as explicitly editable.

Remaining gaps:

- Provider-native install execution still needs an explicit confirmation flow before running Claude commands or Codex app-server writes.
- Registry metadata exists for new sync operations, but edit/delete still primarily operates from discovered file-backed paths.
- Provider-native plugin cache conversion is intentionally conservative: sync creates a portable package and generated common files instead of copying every provider-specific component.
- Agents, hooks, apps/connectors, and instruction/rule migration need dedicated editors or migration flows.

## Provider Evidence

Claude:

- Standalone skills live in personal, project, or plugin skill directories, and `.claude/commands` still works as skill-like flat markdown. Claude watches existing skill directories for live edits.
- Claude plugins use `.claude-plugin/plugin.json`; components such as `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `bin/`, LSP, monitors, output styles, and themes live at the plugin root.
- Claude marketplace plugins are copied into `~/.claude/plugins/cache`, and installed plugins cannot reference files outside their own plugin directory after caching.
- Claude CLI has native plugin marketplace and install flows: `claude plugin marketplace add <source>` and `claude plugin install <plugin> --scope user|project|local`.

Codex:

- Codex skills use `$HOME/.agents/skills` for global skills and `.agents/skills` for repo skills. `~/.codex/AGENTS.md` and repo `AGENTS.md` are instruction files, not skills.
- Codex plugins use `.codex-plugin/plugin.json`; plugin components may include `skills/`, `.app.json`, `.mcp.json`, `hooks/hooks.json`, and assets at the plugin root.
- Codex app-server exposes read/write surfaces relevant to sync: `skills/list`, `skills/config/write`, `plugin/list`, `plugin/read`, `plugin/install`, `plugin/uninstall`, `marketplace/add`, `marketplace/upgrade`, `mcpServerStatus/list`, `config/mcpServer/reload`, `config/value/write`, `config/batchWrite`, and `externalAgentConfig/import`.
- Local Codex CLI currently exposes plugin marketplace add/upgrade/remove, while richer plugin install/uninstall is app-server-facing.

## Design Principle

Treat every capability as:

1. A canonical Orchestrator capability package or descriptor.
2. One or more provider projections.
3. A sync plan that can create, update, disable, or remove projections.

Provider-native installs are just one possible projection source. If Orchestrator cannot safely mutate a native install, it should offer "Import as portable copy" instead of pretending the native package is cross-compatible.

## Proposed Data Model

Add a small metadata file per canonical capability:

```json
{
  "schemaVersion": 1,
  "id": "skill:release-reviewer",
  "kind": "skill",
  "name": "Release Reviewer",
  "slug": "release-reviewer",
  "scope": "global",
  "origin": {
    "providerId": "claude",
    "resourceId": "claude:skill:release-reviewer",
    "sourcePath": "~/.claude/skills/release-reviewer/SKILL.md"
  },
  "desiredProviders": ["claude", "codex"],
  "projections": {
    "claude": {
      "state": "synced",
      "mode": "file",
      "path": "~/.claude/skills/release-reviewer/SKILL.md",
      "lastSyncedAt": "2026-05-14T00:00:00Z"
    },
    "codex": {
      "state": "missing",
      "mode": "file",
      "path": "~/.agents/skills/release-reviewer/SKILL.md"
    }
  }
}
```

Suggested storage:

- Global: `~/.orchestrator/capabilities/registry/<kind>/<slug>/capability.json`
- Project: `<repo>/.orchestrator/capabilities/registry/<kind>/<slug>/capability.json`
- Existing portable packages can keep their content under `.orchestrator/capabilities/plugins/<slug>`, with registry metadata pointing at them.

## Sync Concepts

| Concept | Meaning |
| --- | --- |
| Origin | Where the capability first came from: Orchestrator, Claude, Codex, repo file, marketplace, user import. |
| Canonical package | The source Orchestrator can edit and re-project. |
| Projection | Provider-specific file/config/native install created from the canonical capability. |
| Desired coverage | Providers the user wants this capability available in. |
| Current coverage | Providers where discovery currently sees it. |
| Sync plan | Dry-run output listing writes, provider commands, conflicts, reloads, and unsupported projections. |
| Projection mode | `file`, `marketplace`, `native-install`, `config`, `read-only`, or `unsupported`. |

## Capability Kind Matrix

| Kind | Sync strategy | Claude projection | Codex projection | Future-provider rule |
| --- | --- | --- | --- | --- |
| Skill | Highest-confidence sync target. Canonicalize to `SKILL.md` plus optional folders. | `.claude/skills/<slug>/SKILL.md` | `.agents/skills/<slug>/SKILL.md` | Provider adapter declares skill root and frontmatter support. |
| Command | Convert to skill unless the target provider has command semantics. | Existing `.claude/commands/*.md` may import as a skill or stay command-only. | No separate command surface; project as skill. | Provider adapter may support command projection or decline. |
| Plugin | Package as portable root with per-provider manifests and marketplace entries. | `.claude-plugin/plugin.json`, Claude marketplace entry, optional native install. | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, optional app-server install. | Provider adapter declares manifest path and supported components. |
| MCP server | Canonical JSON config with provider-specific serialization. | `.mcp.json` or Claude CLI `mcp add` for provider-managed entries. | `.codex/config.toml` or app-server config write/reload. | Provider adapter declares config format and reload behavior. |
| Agent | Import/export only after validation. Claude has direct file-backed agents; Codex has external-agent import surfaces. | `.claude/agents/<slug>.md` | likely external-agent import or future subagent surface, not direct file sync today. | Provider adapter must define agent schema. |
| Hook | Inspect by default; import as plugin hook only when user confirms. | `settings.json` hooks or plugin `hooks/hooks.json` | plugin `hooks/hooks.json` / app-server hooks inventory | Hooks can block tools, so require preview and confirmation. |
| App/connector | Codex-only today. | Unsupported. | `.app.json` in plugin or app-server app surfaces. | Provider adapter may expose app connector projection later. |
| Instruction/rule | Show and optionally copy with confirmation; do not auto-sync. | `CLAUDE.md` family | `AGENTS.md` family | Instructions are context policy, not reusable capability by default. |

## Proposed API

Add `src/main/capabilitySync.ts` with two entrypoints:

```ts
export function previewCapabilitySync(input: CapabilitySyncRequest): CapabilitySyncPlan
export function applyCapabilitySync(input: CapabilitySyncRequest): CapabilityMutationResult
```

Types:

```ts
type CapabilitySyncMode =
  | 'backfill-missing-providers'
  | 'sync-selected-providers'
  | 'import-as-portable-copy'
  | 'install-native'
  | 'remove-provider-projection'

interface CapabilitySyncRequest {
  resources: ProviderResource[]
  workDir: string
  scope: 'global' | 'project'
  targetProviders: string[]
  mode: CapabilitySyncMode
  allowProviderMutations?: boolean
}

interface CapabilitySyncPlan {
  ok: boolean
  capabilityName: string
  kind: ProviderResourceKind
  operations: CapabilitySyncOperation[]
  warnings: string[]
  blockers: string[]
}

interface CapabilitySyncOperation {
  providerId: string
  action: 'write-file' | 'update-json' | 'update-toml' | 'run-command' | 'app-server-call' | 'manual'
  path?: string
  command?: string[]
  appServerMethod?: string
  summary: string
  risk: 'low' | 'medium' | 'gated'
}
```

IPC:

- `providers:previewCapabilitySync`
- `providers:syncCapability`

Renderer:

- Add `Sync...` to the row action menu when a row is missing providers or is provider-native importable.
- Add a side sheet showing provider checkboxes, operations, warnings, blockers, and confirmation for native provider mutations.

## Adapter Shape

Introduce provider projection adapters rather than hardcoding every provider in one file:

```ts
interface CapabilityProjectionAdapter {
  providerId: string
  supports(kind: ProviderResourceKind): ProjectionSupport
  discover(cwd: string, homeDir: string): ProviderResource[]
  planProjection(input: ProjectionInput): CapabilitySyncOperation[]
  applyProjection(input: ProjectionInput): string[]
}
```

Provider adapters should expose:

- skill roots
- plugin manifest format
- marketplace registration format
- MCP config format
- native install methods
- reload requirements
- unsupported reasons

This lets future providers fit into the same system by adding an adapter, not by changing the UI.

## UX Plan

Capabilities row:

- Provider chips stay visible.
- Add a small coverage indicator:
  - `Claude + Codex`
  - `Missing Codex`
  - `Provider-only`
  - `Portable copy available`
- Row menu actions:
  - `Sync to providers...`
  - `Import as portable copy...`
  - `Install natively...` when an adapter supports it
  - `Remove from provider...`

Sync sheet:

- Target provider checkboxes.
- Scope segmented control: Global / Project.
- Dry-run operation list grouped by provider.
- Gated operations require explicit confirmation.
- Result state: synced, partial, blocked, provider reload needed.

Important copy:

- For provider-native installs: "This installs into the provider, not just Orchestrator files."
- For imports: "This creates a portable copy. Future updates from the original provider install will not be automatic until sync tracking exists."
- For hooks/MCP: show exactly which files or provider commands will change.

## Implementation Phases

### Phase 1: Dry-run planner

- Status: implemented for skill, command-as-skill, plugin, MCP, and gated/blocked unsupported kinds.

- Add `capabilitySync.ts`.
- Build sync plans for skill, plugin, and MCP only.
- No writes yet.
- Add tests for missing provider detection, unsupported provider reasons, and operation planning.

### Phase 2: File-backed sync

- Status: implemented for skills, plugins, MCP JSON, and Codex TOML projections.

- Apply plans for:
  - skill to Claude/Codex
  - plugin missing manifest/marketplace entries
  - MCP JSON/TOML projections
- Add registry metadata for Orchestrator-managed capabilities.
- Add edit/delete to operate through registry projections rather than ad hoc path groups.

### Phase 3: UI sync sheet

- Status: implemented for row action, provider coverage labels, provider checkboxes, dry-run operations, warnings, blockers, and apply.

- Add `Sync...` row action.
- Add provider coverage status.
- Add preview sheet with provider checkboxes and operation list.
- Add UI smoke for a row that is missing Codex, syncs, refreshes, and shows both provider chips.

### Phase 4: Provider-native gated sync

- Status: planned operations are implemented; command/app-server execution is still gated pending confirmation UX.

- Claude:
  - `claude plugin marketplace add`
  - `claude plugin install --scope`
  - optional `claude plugin validate`
- Codex:
  - app-server `marketplace/add`
  - app-server `plugin/read`
  - app-server `plugin/install`
  - app-server `plugin/uninstall`
  - app-server `skills/config/write`
  - app-server `config/mcpServer/reload`
- All native mutations require explicit confirmation and clear rollback guidance.

### Phase 5: Import provider-native resources

- Status: implemented for skills/MCP and common plugin projection; deeper cache/component import remains future work.

- Skill import:
  - Read source `SKILL.md`.
  - Create canonical registry and missing provider projection.
- Plugin import:
  - Read provider plugin manifest and package root/cache when accessible.
  - Copy supported components into `.orchestrator/capabilities/plugins/<slug>`.
  - Generate missing provider manifest.
  - Mark unsupported components as provider-specific.
- MCP import:
  - Parse provider config.
  - Create canonical `.orchestrator/capabilities/mcp/<slug>.json`.
  - Write missing provider configs.

### Phase 6: Broader capability kinds

- Status: blocked intentionally with explicit plan reasons.

- Agents: add schema validation and explicit import/export.
- Hooks: import only into plugin hook packages; never auto-copy settings hooks.
- Apps/connectors: Codex-only until another provider exposes equivalent app connectors.
- Instructions: keep separate from capability sync unless the user explicitly chooses migration/copy.

## Tests Needed

Unit tests:

- Skill sync from Claude-only to Claude+Codex.
- Skill sync from Codex-only to Claude+Codex.
- Plugin sync generates missing `.claude-plugin` or `.codex-plugin` manifest without deleting existing provider-specific fields.
- Plugin marketplace entries update idempotently.
- MCP sync writes JSON and Codex TOML with stable markers.
- Provider-native resources produce import plans, not direct edit/delete.
- Hooks/instructions are blocked from automatic sync with clear warning.
- Future provider adapter can decline support without breaking UI.

Integration tests:

- `providers:previewCapabilitySync` returns a dry-run plan.
- `providers:syncCapability` applies file-backed projections and refreshes resources.
- Existing edit/delete tests keep passing with registry-backed projections.

UI tests:

- Missing-provider row shows `Sync...`.
- Sync sheet shows dry-run operations and warnings.
- Applying sync updates provider chips.
- Gated provider-native action cannot run without confirmation.

Live/no-quota verification:

- Claude plugin validation for generated plugin package.
- Codex capability discovery after writing `.agents/skills` and `.agents/plugins/marketplace.json`.
- MCP config discovery after JSON/TOML write.

## Risks And Decisions

| Risk | Recommendation |
| --- | --- |
| Provider-native plugin caches are not stable source-of-truth paths. | Import as portable copy; do not edit cache in place. |
| Claude and Codex plugin formats overlap but are not identical. | Preserve provider-specific manifest fields; only normalize common fields. |
| Hooks can enforce/block actions. | Preview and confirmation required; no bulk auto-sync. |
| MCP reload/auth differs per provider. | File sync first, provider reload/OAuth as gated follow-up actions. |
| Duplicate names across global/project/provider scopes. | Include scope in registry metadata and show conflict warnings before writing. |
| Future providers may only support one capability kind. | Adapter returns unsupported reasons; UI displays missing/unsupported separately. |

## Recommended First Ticket

Build Phase 1 and Phase 2 together for skills and MCP only:

1. Add `capabilitySync.ts` with dry-run and apply for file-backed skill/MCP projections.
2. Add IPC handlers and tests.
3. Add a minimal `Sync...` action in the Capabilities row menu.
4. Add a sync sheet that can backfill missing Claude/Codex projections.
5. Verify with provider tests, build, and Capabilities UI smoke.

After that, add plugin projection sync as the second ticket. Plugins deserve their own slice because native install, marketplace registration, provider-specific components, and validation need more careful UI.
