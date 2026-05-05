# Orchestrator

A desktop app for running and managing multiple AI coding agent sessions simultaneously — Claude Code, GitHub Copilot, Codex CLI, and Cursor — all in one place.

## Features

- **Multi-session workspace** — run as many parallel agent sessions as you want, each in its own terminal and chat pane
- **Multi-provider** — Claude Code, GitHub Copilot, Codex CLI, Cursor (and more) from a single interface
- **Project management** — organize sessions by project with optional git worktree isolation per session
- **Floating pet companion** — a pixel-art mascot that shows aggregate agent status at a glance, floats above all other windows, and notifies you when a session needs attention
- **Session notifications** — see which sessions are running, waiting for input, have unread responses, or hit errors — without switching windows

## Getting started

```bash
npm install
npm run rebuild   # builds node-pty native module
npm run dev       # launch in development mode
```

## Building

```bash
npm run build     # compile with electron-vite
```

## Requirements

- Node.js 18+
- One or more AI agent CLIs installed (e.g. `npm install -g @anthropic-ai/claude-code`)

## Stack

- **Electron** — desktop shell
- **Vite + React** — renderer (main UI and pet overlay are separate bundles)
- **TypeScript** — throughout
- **node-pty** — PTY sessions for each agent
- **xterm.js** — terminal rendering
- **Tailwind CSS** — styling
- **electron-store** — persistent settings
