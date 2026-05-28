# Cursor SDK Runtime Spike

Date: 2026-05-28

## Goal

Implement a Cursor SDK provider runtime alongside the existing Cursor CLI runtime, then verify whether it can replace the current CLI path.

## What Was Wired

- Added `@cursor/sdk` and packaged its platform/native dependencies.
- Added `src/main/cursorSdkRuntime.ts` with:
  - `Agent.create` / `Agent.resume`
  - `agent.send`
  - run streaming
  - run cancel/stop handling
  - SDK message normalization into Orchestrator `RunEvent`s
  - agent/task/tool/result mapping for side-panel activity
  - local cwd and sandbox option mapping
  - local Cursor project/user/plugin setting sources, so `.cursor` and `~/.cursor` MCP/subagent config can be loaded by the SDK
  - local image attachment mapping
- Added Cursor SDK runtime dispatch in `ProviderRuntimeManager`.
- Exposed `sdk` in Cursor's provider manifest as an explicit experimental runtime. Cursor still defaults to the CLI/headless runtime because the SDK local stream does not complete in this environment.
- Added direct SDK and runtime smoke scripts:
  - `npm run live:cursor-sdk-probe`
  - `npm run live:cursor-sdk-runtime`

## Verification

Passed:

- `npx tsc -p tsconfig.node.json --noEmit`
- `npm run test:providers`
- `node -c scripts/cursor-sdk-live-probe.mjs`
- `node -c scripts/cursor-sdk-runtime-live-smoke.mjs`

Live SDK behavior on this machine:

- `agent --version` works: `2026.05.07-42ddaca`
- `agent status` / `cursor-agent status` can report `Not logged in` even while API-key based CLI runs work.
- `CURSOR_API_KEY` can be supplied from the repo `.env` for development or from `~/.cursor/cli-config.json` under `env.CURSOR_API_KEY` for the installed app.
- With network access, `npm run live:cursor-sdk-models -- composer` succeeds and shows `composer-2.5` plus its default fast variant. In the default Codex sandbox, the same command now exits cleanly with `NetworkError: Network request failed` instead of dumping the bundled SDK.
- With network access, `npm run live:cursor-sdk-probe` imports the SDK, reads the repo `.env` API key, loads Cursor project/user/plugin settings, creates a local agent, and starts a stream. The local SDK run currently ends as `ERROR` after about 33 seconds with `Connection stalled` in Cursor's local SDK run store.
- `npm run live:cursor-sdk-runtime` exercises the Orchestrator `runtime: "sdk"` path and fails cleanly at the same SDK local-run boundary.
- A clean SDK repro in a disposable temp directory with `settingSources: []` also fails `RUNNING -> ERROR` after about 31 seconds, so this is not caused by Orchestrator's message normalization, repo context, MCP setup, or skill/rules loading.
- The same API key works with `agent --print`, so the key can execute Cursor agent turns; the remaining failure is specific to the published SDK local runtime path on this machine.
- Cursor provider config is now read from `~/.cursor/cli-config.json`, matching the Settings page. Env overrides can be stored under an `env` object there, or in the repo `.env` during local development.
- Local Cursor config already contains `network.useHttp1ForAgent: true`, and Cursor's config docs describe that flag as using HTTP/1.1 instead of HTTP/2 for agent connections. The published SDK package does not expose an equivalent setting.
- Re-testing while not on VPN still produces `ERROR | Connection stalled` in the Cursor SDK run store. The process has Netskope CA env vars (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `GIT_SSL_CAINFO`, `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`); removing them makes the SDK fail earlier with `Network request failed`. Direct TLS ALPN checks to Cursor endpoints can negotiate `h2`, but the SDK's actual long-lived local agent stream still stalls.
- Public Cursor forum references align with this diagnosis:
  - "Cursor sdk with http/1.1" says the SDK local agent stream currently requires HTTP/2 and does not yet have the CLI/IDE HTTP/1.1 fallback.
  - "Local Cursor SDK agents fail with opaque RUNNING -> ERROR on local repos" says `Agent.create()` and other non-streaming calls can succeed while `agent.send()` fails because local SDK streaming needs HTTP/2.
  - Cursor IDE/CLI "Connection stalled" threads repeatedly recommend disabling HTTP/2 / enabling HTTP/1.1 fallback for VPN or proxy environments, which matches the older local CLI issue captured in `provider-capability-research.md`.

Evidence:

- `/var/folders/5n/nwtbs9wj6jl7whlscmg47_pc0000gn/T/cursor-sdk-live-probe-1779987436915.json`

## Current Answer

The Cursor SDK remains the desired migration target, but the local SDK run path is currently blocked by a Cursor SDK/runtime failure in live testing. Cursor's working default remains the CLI/headless runtime.

It gets us closer to a Codex-app-server-shaped provider in these areas:

- structured agent/run APIs instead of pty stdout parsing
- run streaming
- resume by agent id
- explicit run cancel
- model/account APIs
- artifacts
- local cwd and sandbox options
- MCP server configuration

It does not yet match our current needs in these areas:

- It requires `apiKey` or `CURSOR_API_KEY`; browser-login/subscription auth is still a CLI feature, not a documented SDK feature.
- With a valid API key, local SDK runs create and start, but fail with `Connection stalled` before assistant/tool events.
- This is most likely Cursor SDK local streaming's current HTTP/2-only limitation in this network environment, not an Orchestrator parser issue. The SDK can list models and create a run; the failure begins at streaming.
- Its MCP support accepts stdio/http/sse server configs, but does not expose an in-process dynamic tool callback like Claude SDK's `createSdkMcpServer` or Codex app-server dynamic tools.
- Local SDK agents now request `project`, `user`, and `plugins` setting sources. That gives Cursor its normal file-based MCP/subagent/rules inputs, but Browser host tools still need an Orchestrator-owned MCP bridge before they can match Claude SDK and Codex app-server.
- Cursor CLI ask mode is not represented in the SDK mode type; the SDK exposes `agent` and `plan`.

## Replacement Gate

Do not consider the migration complete until all of these pass:

- A live SDK run completes with the user's intended Cursor auth path.
- The app has a Cursor provider setup flow for Dashboard -> Integrations -> User API Key auth, with the key stored outside transcripts and passed only as process env / SDK option.
- Orchestrator Browser host tools are available through a Cursor-compatible MCP bridge.
- Plan/sandbox/default permission semantics are validated against the current CLI behavior.
- Packaged app smoke passes with the SDK native dependencies before the SDK becomes the default.
