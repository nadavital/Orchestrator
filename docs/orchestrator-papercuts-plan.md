# Orchestrator Papercuts Plan

Date: 2026-05-20

This is the active checklist for the current sidebar, notification, modal, archive, tooltip, and typing-latency cleanup pass. Keep this file current as implementation moves, add any newly reported papercuts here, and commit completed slices locally. Remote push is intentionally out of scope while the user is on corporate VPN.

Status key: `Todo`, `Investigating`, `Verified`, `In progress`, `Complete`, `Blocked`.

## Working Rules

- Verify every user report against the current implementation or running UI before calling it fixed.
- Keep changes in small local commits with focused verification.
- Update this file when findings change or a new papercut is added.
- Compare Codex behavior directly from the local Codex app bundle when a report asks for Codex parity.
- Preserve `bootstrap.js` as untracked local state unless the user explicitly says otherwise.

## Checklist

| ID | Report | Initial Evidence | Plan | Status |
| --- | --- | --- | --- | --- |
| PP-001 | The sidebar loading indicator should live where the time/actions live, not farther inset. | `SessionItem` rendered spinner/status dot before the right metadata/actions slot. | Make the right-side slot mutually exclusive: action button on hover/focus, otherwise running/waiting/error/unread state, otherwise relative creation time. Verify with sidebar smoke/DOM checks. | `Complete` |
| PP-002 | A blank newly created chat should always remain at the top; an older chat rose above it. | Sidebar sort used `latestMessageAt ?? createdAt`, so any recently updated/running chat could jump above a blank active chat. | Add an active blank-chat priority before normal sorting. Verify with unit tests and sidebar smoke if available. | `Complete` |
| PP-003 | Active chats constantly reorder; active chats should stay in a stable order above inactive chats. | `compareSessionsByMode` sorted every unpinned list by latest activity, so streaming or status updates could move active rows repeatedly. | Group live sessions (`running`, `reconnecting`, waiting states) above inactive rows, but keep that group in a stable created-time/id order instead of latest-message order. | `Complete` |
| PP-004 | Permission requests need sidebar state, pet state, and notification behavior when the app is not focused. | Pet notification mapping already treats `waiting_for_permission` and `waiting_for_user` as `waiting`; sidebar `showStatusIndicator` excluded waiting states. App notification code focused on finished sessions. | Add sidebar waiting state first, then inspect app-focus notification behavior and extend if missing. Verify pet tests and notification path. | `Complete` |
| PP-005 | Delete confirmation blurs the whole app and has no visible card background. | `ConfirmDialog` uses `MotionOverlay`; `.motion-overlay-surface` had no background/border/shadow, while backdrop blur was `16px`. | Add shared card styling to the overlay surface and reduce the default blur. Verify delete dialog visually and via CSS/DOM smoke where possible. | `Complete` |
| PP-006 | Codex may archive chats before deleting; investigate and mirror if appropriate. | Codex local bundle includes an `Archive chat` action and app-server archive lifecycle via `thread/archive`, `thread/unarchive`, `thread/unsubscribe`, and `thread/archived`. Orchestrator delete called remove directly. | Add an archive path that hides chats from active lists while preserving their stored record, and keep hard remove for empty/internal cleanup. | `Complete` |
| PP-007 | Header hover chips/tooltips are malformed; one wraps one character per line. | `.orchestrator-tooltip` used `overflow-wrap: anywhere` with normal wrapping and no intrinsic width, which could produce unreadably narrow chips. | Fix tooltip sizing/wrapping constraints and verify tooltip screenshots/DOM measurements. | `Complete` |
| PP-008 | Composer typing lags while an agent is generating. | Streaming updates mutate session/message state; `SessionPane` passes the full session into `InputBar`, and `InputBar` subscribed to the full session store. | Profile/inspect render path, then isolate composer props/state from streaming transcript updates where practical. Verify typing smoke or render-count evidence. | `Complete` |
| PP-009 | Confirm whether app notification behavior covers permission waits when unfocused. | Renderer notification bridge only created a system notification for inactive completed sessions. | Add a deduped permission/user-input waiting notification when the document is not focused. | `Complete` |
| PP-010 | Composer text persists when switching chats; drafts should be per chat and restored when returning. | `InputBar` owned `text` as local component state, so changing the `session` prop did not reset or restore per-session content. Empty draft-only chats were also auto-cleaned during switching. | Store composer draft text in `uiState` by session id, load it whenever `InputBar` changes sessions, and do not auto-remove empty chats with drafts. | `Complete` |
| PP-011 | Sidebar chat hover card is hidden behind the main window and nearly invisible. | Hover card was rendered inside the sidebar subtree; the sidebar uses overflow/blur styling that can clip or create a containing layer for fixed children. | Portal the hover card to `document.body` and raise its z-index above app chrome. | `Complete` |
| PP-012 | Adding a project should put the user on a new chat screen for that project. | Empty-state project add creates and activates a session, but sidebar `handleAddProject` only added the project. | Make sidebar Add Project create/activate a new local chat in the newly added project. | `Complete` |

## Verification Log

- 2026-05-20: `git status --short --branch` shows `main...origin/main [ahead 1]` and untracked `bootstrap.js`.
- 2026-05-20: Initial code inspection confirms sidebar ordering is activity timestamp based, delete dialog has no surface card style, sidebar waiting status is not in `showStatusIndicator`, pet notification semantics already know waiting states, and tooltip CSS can wrap anywhere.
- 2026-05-20: Added `compareSidebarSessions` with tests for active blank chats and stable live-chat ordering. `npm run test:providers` passed all 170 tests.
- 2026-05-20: Local Codex bundle inspection found UI copy `Archive chat`; action calls `archive-conversation`, and app-server manager sends `thread/archive`, suppresses archived conversations, unpins archived threads, removes them from cache, handles `thread/archived`, and uses `thread/unsubscribe` for empty discarded threads.
- 2026-05-20: Composer latency likely came from `InputBar` subscribing to the entire Zustand store plus receiving a full `session` object. First mitigation isolates store selectors and memoizes the composer against message-only session churn.
- 2026-05-20: Verification passed for first slice: `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.node.json --noEmit`, `git diff --check`, and escalated `npm run smoke:ui:auto -- --sidebar`.
- 2026-05-20: Archive slice adds `sessions.archive`, `archivedAt`, active-list filtering, `session:archived`, and Archive chat UI copy. Verification passed: web/node TypeScript, `git diff --check`, escalated sidebar smoke, and `npm run test:providers` with 170 passing tests.
- 2026-05-20: Added PP-010 through PP-012 from user testing: per-chat composer drafts, sidebar hover-card visibility, and Add Project opening a new chat.
- 2026-05-20: Draft/hover/add-project slice complete. Composer drafts are stored per session in `uiState`; draft-only empty chats are no longer auto-removed on chat switch/new-chat cleanup; sidebar hover cards portal to `document.body`; sidebar Add Project creates and activates a new chat in the added project. Verification passed: web/node TypeScript, `git diff --check`, escalated sidebar smoke, and escalated composer smoke with `composerDraftsPerChat: true`.
