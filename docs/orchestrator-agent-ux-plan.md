# Orchestrator Agent UX Plan

This plan keeps Orchestrator focused on one product goal: make many local coding agents feel like one calm, capable desktop workspace while preserving each provider's native CLI behavior.

## UX Principles

- Default to summaries. Raw provider output, full tool payloads, and long file contents should be behind expansion.
- Keep risky actions obvious. Writes, edits, deletes, shell commands, network access, MCP calls, and plan exits need clearer treatment than reads and searches.
- Separate state from detail. The main transcript should answer "what happened?", while the activity panel answers "how did it happen?"
- Preserve native provider behavior. Claude slash commands, skills, agents, MCP, permission modes, and plan mode should map to Orchestrator concepts without hiding the underlying CLI lane.
- Use one app vocabulary across providers. Claude `Task`, Copilot subagents, Codex multi-agent, and Cursor worktrees should all land in the same agent/activity model.

## Action Mapping

| Agent action | Provider examples | Main transcript | Activity panel | Permission UX |
| --- | --- | --- | --- | --- |
| Read file | `Read`, read tool calls | `Read N files` | file paths, result status | usually no prompt |
| Write file | `Write`, create file | `Wrote N files` | file paths, success/error | show path and allow/deny |
| Edit file | `Edit`, `MultiEdit`, patch tools | `Edited N files` | file paths, success/error | show path and allow/deny |
| Delete file | delete/remove tools, shell delete intent | `Deleted N files` | file paths, success/error | high-risk prompt |
| Shell command | `Bash`, shell, command execution | `Ran N commands` | command preview, status | show exact command |
| Search/list | `Grep`, `Glob`, search, list | `Searched N queries`, `Listed N listings` | query/path | usually no prompt |
| Web/network | `WebFetch`, URL tools | `Browsed N pages` | URL/domain | prompt when provider asks |
| MCP/tool integration | MCP tool calls | `Used MCP N tools` | server/tool name | show server/tool scope |
| Agent/subagent | Claude `Task`/`Agent`, Copilot subagent, Codex multi-agent | compact delegation row | agent tree with status | permission/question cards include agent context |
| Plan/todos | `TodoWrite`, plan events, `ExitPlanMode` | no noisy raw todo payload | Plans tab | `Approve Plan` / `Keep Planning` |
| User question | Claude `AskUserQuestion`, elicitation | `Answer Required` card | event detail | separate from permission approval |

## Sequential Implementation Plan

1. **Action vocabulary and tests**
   - Centralize tool/action classification in shared code.
   - Cover read/write/edit/delete/shell/search/list/web/MCP/agent/plan/question with tests.
   - Make the transcript consume this vocabulary instead of ad hoc tool-name checks.

2. **Calm transcript hardening**
   - Keep consecutive tool activity collapsed by default.
   - Show one-line action summaries with risk-aware color.
   - Keep raw payloads and verbose provider JSON out of the main thread.

3. **Activity panel as the detail surface**
   - Agents tab: parent/child status and summaries.
   - Plans tab: current plan and todo state.
   - Events/raw tabs: diagnostics only, not primary UX.

4. **Slash commands and native capability surfaces**
   - App commands always available.
   - Provider commands filtered by runtime and support.
   - Claude CLI mode exposes `/agents`, `/mcp`, `/plugins`, and later real command inventory.
   - Mutating native management flows route through terminal or explicit confirmation.

5. **Capability and gap verification**
   - Keep `docs/provider-cli-spec.md` as the CLI truth table.
   - Keep no-quota probes in `npm run smoke:providers`.
   - Use live provider smokes only for selected cheap models and only when auth/network access is needed.

6. **Cross-provider parity**
   - Bring Codex, Cursor, and Copilot into the same action/permission/question/agent vocabulary.
   - Keep provider-specific policy details visible in settings.
   - Avoid pretending approximate/forced support is exact.

7. **First-class GUI gaps to close**
   - Diff/file-change rail that follows writes/edits/deletes.
   - Permission scopes: allow once, allow session, deny, deny with instruction.
   - Worktree/session provenance: branch, base, changed files, merge/push readiness.
   - Native provider management panels for MCP, plugins, agents, skills, and auth/status.
