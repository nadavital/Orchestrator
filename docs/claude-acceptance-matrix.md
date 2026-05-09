# Claude Code Acceptance Matrix

This matrix is the product contract for Claude Code inside Orchestrator. The main transcript should stay calm, while Activity, Skills, Diff, Terminal, and Settings carry the detail.

| Capability | Source | Fixture / probe | Expected Orchestrator UX |
| --- | --- | --- | --- |
| Plain response | Claude stream JSON | `plain-answer.jsonl` | Assistant text plus silent successful completion. |
| File read/write/edit/delete | Claude tools | `repo-actions.jsonl` | Transcript summarizes by action count; expanded rows show exact file paths; Diff panel owns detailed file review. |
| Shell command | Claude `Bash` tool | `repo-actions.jsonl` | Transcript says `Ran N commands`; expanded row shows the command; permission UI highlights shell as medium risk. |
| Search/list/MCP tools | Claude tools and MCP names | `repo-actions.jsonl` | Search/list/MCP are distinct action kinds so provider-specific tools do not collapse into generic noise. |
| Permission request | Claude `permission_denials` | `permission-denied.jsonl` | Permission card shows compact action target, not raw JSON; `Allow Once` resumes without mutating session settings, `Allow Session` persists the grant, and `Deny` stops the run. |
| Ask user | `AskUserQuestion` | `ask-user-question.jsonl` | User question card, not permission UI; structured choices preserved. |
| Plan mode | `EnterPlanMode`, `TodoWrite` | `plan-todos.jsonl` | Activity panel Plans tab shows plan mode, summary, and task statuses. |
| Exit plan approval | `ExitPlanMode` denial | `exit-plan-denial.jsonl` | Plan Ready card with Approve Plan / Keep Planning; no red tool error. |
| Subagents | `Task` and `Agent` tools | `task-agent.jsonl`, `agent-tool.jsonl`, `task-progress.jsonl` | Activity panel Agents tab shows running/completed agent nodes with summaries. |
| Slash commands | Provider registry | Runtime info + `availableSlashCommands` | App commands always appear; provider commands appear only for supported/partial feature and active runtime lane. |
| Skills and project commands | `.claude/commands`, `CLAUDE.md`, provider registry | Skills panel + no-quota probes | Skills panel surfaces global/project instructions and command dirs without crowding the transcript. |
| CLI management | `claude agents/mcp/plugin/ultrareview` probes | `npm run smoke:providers` | No-quota commands appear as provider command surfaces; mutating/destructive commands stay behind settings/terminal confirmation. |

See `docs/orchestrator-completion-spec.md` for the complete cross-provider checklist.

## Sequential Gates

1. Fixture parsing passes for every row above.
2. Shared UI contracts pass for transcript summaries, Activity derivation, slash availability, and Diff summaries.
3. `npm run smoke:providers` confirms local CLI probes without using model quota.
4. One live Claude Sonnet smoke verifies the real installed CLI still emits the expected basic stream.
5. Any new live transcript shape becomes a fixture before it is treated as supported product behavior.
