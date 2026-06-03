# Claude Code Support Test Matrix

This document is supporting evidence for `docs/orchestrator-source-of-truth.md`. The active Claude product path is now the Claude Agent SDK:

```text
@anthropic-ai/claude-agent-sdk query()
```

The old Claude-native chat parser/prompt bridge and structured `claude -p stream-json` normal chat lane have been removed from the app runtime. Historical native PTY and print-mode experiments remain useful only as evidence for why Orchestrator should prefer structured SDK messages for Claude chat.

## Status Legend

| Status | Meaning |
| --- | --- |
| Complete | Implemented, fixture/test covered, and live or no-quota verified where applicable. |
| Implemented | Wired in code but still needs stronger live/GUI verification. |
| Research | Requires more provider verification before product design. |
| Gated | Provider-state mutation, destructive action, or quota-spending action that needs explicit confirmation. |
| Won't Do | Intentionally out of scope for normal Claude chat. |

## Active Claude Matrix

| Claude surface | Expected Orchestrator UX | Current coverage | Next check |
| --- | --- | --- | --- |
| Claude SDK message stream | Default Claude chat/runtime path; not a user-visible runtime choice. | Complete via SDK runtime tests, provider fixtures, installed-app smokes, and live SDK probes. | Keep `plain`, `file_ops`, `plan_mode`, and `streaming` live scenarios current against the SDK path. |
| Partial assistant messages | Stream deltas without duplicating final text. | Complete via `partial-message.jsonl` and provider tests. | Refresh fixture if Claude stream event shape changes. |
| Hook approvals | Approval cards resolve without replaying the process. | Complete for current hook event bridge and installed-app smokes. | Keep `hook-approval.jsonl` current. |
| Resume/continue | Preserve Claude session id and visible continuity. | Complete for normal multi-turn structured sessions. | Re-test after runtime/app-server refactors. |
| File tools | Compact summaries, file cards, and Diff ownership. | Complete via repo-action fixtures and installed-app workspace smokes. | Keep parser/card tests current. |
| Bash | Permission-aware command card with bounded output. | Complete for allow once/session/deny. | Refresh if Claude denial payload changes. |
| AskUserQuestion tool | User-input card, separate from permissions. | Complete via fixture and installed-app choice/free-form smokes. | Polish answered-card copy if needed. |
| Plan mode | Plan sidebar/card plus Approve Plan / Keep Planning. | Complete via structured plan fixture and installed-app plan smokes. | Keep `plan-approval-live.jsonl` current. |
| `Task` tool subagents | Agent chips and sidebar transcript tabs. | Complete via fixtures and installed-app Task smokes. | Refresh sidechain fixture if event names change. |
| Skills as slash commands | Discover and run prompt-like commands/skills through structured chat. | Complete via command/skill fixtures and installed-app smokes. | Add cache invalidation only if scans become visible. |
| `claude mcp list/get` | Compact settings MCP surface, no raw JSON noise. | Complete for non-mutating list/detail flows. | Keep failed-local-server states readable. |
| `claude plugin list --json` | Compact settings plugin surface, no raw JSON noise. | Complete for non-mutating list flow. | Recheck when local plugins exist. |
| Queue/steer | Queue a follow-up or steer at a safe boundary without duplicate/stuck messages. | Complete via installed-app P1 smokes and lifecycle tests. | Re-test when runtime lifecycle changes. |
| Mutating provider management | Explicit confirmation or manual terminal/settings handoff. | Gated by product policy. | Add only scoped flows with confirmation. |

## Out Of Scope For Normal Chat

| Surface | Status | Reason |
| --- | --- | --- |
| Selectable Claude native chat runtime | Won't Do | Structured JSON covers the needed Claude Code surfaces with cleaner, testable events. |
| Claude native terminal text parser | Won't Do | Removed as dead code after structured-first verification. |
| Claude native workspace trust / `.mcp.json` prompt bridge | Won't Do | Removed with the native chat lane; future provider-management flows should use explicit settings or terminal handoff. |
| Workspace trust prompt | Won't Do | Avoided in normal chat by using the SDK runtime; do not revive native chat parsing for this. |
| Built-in TUI-only slash commands | Gated | Use Orchestrator-native surfaces where safe; route provider-state actions through settings/manual terminal flows. |

## Verification Gates

Do not call Claude support complete unless:

1. Structured assistant text streams and completes.
2. Multi-turn continuity works.
3. Stop works during text, tool, permission, and queued-message states.
4. Queue and steer work without duplicate or stuck messages.
5. File create/edit/delete/read/search produce transcript summaries, file cards, and Diff state.
6. Bash permission flow supports allow once, allow session, and deny.
7. AskUserQuestion resumes through user-input UI.
8. Plan mode supports approve and keep-planning.
9. Task/subagent runs show chips, sidebar tabs, transcript, and failure state.
10. Slash commands, skills, MCP, plugins, and agents remain compact and non-noisy.
11. Mutating provider commands remain gated.
12. Automated tests and SDK live smokes pass when auth/quota allow.

## Latest Notes

- 2026-05-30: `npm run live:claude-capabilities` still records `Unavailable`, not a passing Claude proof. The elevated refresh shows `claude --version` reports `2.1.51`, `auth status`, MCP list, plugin list, and agents probes pass, but `auto-mode defaults` returns API 401 invalid credentials, so the harness skips `plain`, `file_ops`, `plan_mode`, and `streaming` structured scenarios. Artifact: `/Users/nadav/Desktop/Orchestrator/tmp/claude-live-capabilities/_summary/summary.json`.
- 2026-05-29: `npm run live:claude-capabilities` added no-quota Claude probes before structured scenarios so auth/runtime unavailability is captured before quota-using proof runs.
- 2026-05-13, updated 2026-06-02: Claude native runtime selection was removed from normal chat; stale Claude sessions now normalize back to the SDK runtime before sending.
- 2026-05-13: Structured plan sidebar, subagent tabs, attachments, usage, and side questions were verified in isolated dev UI profiles.
- 2026-05-13: The old Claude-native terminal parser, native prompt bridge, and runtime-parity script were removed so Claude support stays structured-first.
