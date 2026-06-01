# Orchestrator Design Language

## Goal

Make Orchestrator feel like a calm multi-agent workspace: clean enough for long coding sessions, structured enough for many providers and agents, and customizable without becoming theme chaos.

The direction should emphasize the qualities that make a native coding workspace pleasant:

- a soft translucent navigation rail
- large, quiet working canvases
- restrained borders and shadows
- rounded controls that feel native to macOS
- color used sparingly for state, provider identity, and primary actions

Orchestrator has more concurrent state than a single-agent chat surface: projects, sessions, providers, subagents, plan/diff/extensions panels, and terminal surfaces. The design system needs to support density and clarity when the app gets busy.

## Current Issues

The app already has good structure, but the visual language is still mostly implementation-driven:

- Color tokens are minimal: `bg`, `surface`, `surface2`, `border`, text, accent, and state colors.
- Many components hardcode radius, padding, borders, and hover states directly.
- The default dark theme reads utilitarian and heavy; the product needs a lighter, more spacious baseline.
- Sidebar, composer, settings, panels, transcript cards, and diff surfaces each solve similar UI problems slightly differently.
- There is no clear customization model beyond light/dark/system.

## Active Polish Ledger

These are the current product-facing cuts from the Codex-aligned design pass. Keep this list short and evidence-backed; broader design ideas belong in the phase plan below.

| Surface | Issue | Current direction | Evidence |
| --- | --- | --- | --- |
| Review toolbar | Diff display controls made the resting toolbar read like a Git tool palette. | Keep source, options, jump, refresh, navigation, and file stage controls visible; move display toggles through Review options while preserving command hooks. | `npm run smoke:ui:auto -- --diff-core`; installed `--diff-entry`; `tmp/side-panel-visual-inventory/review-entry.png` |
| Bottom panel | Workbench parity was implemented as a permanent row of Plan/Browser/Files/Review/Side chat shortcuts, making the bottom panel feel terminal-heavy and busy at the same time. | Keep parity through one plus menu and contextual terminal actions; tabs remain shared between right and bottom workbench surfaces. | `npm run smoke:ui:auto -- --terminal-visual`; installed `--terminal-visual`; `tmp/side-panel-visual-inventory/terminal-bottom-panel.png` |
| Git workflow | A full Git tab made source control feel like a separate destination. | Keep Review and Environment as the primary source-control contexts; commit/push stays as a contextual action rather than a persistent tab. | Review and bottom-panel smoke coverage asserts no Git menu item in the bottom opener. |
| Workbench tabs | Close buttons reserved dead space in tab labels, Browser could collapse below its own name, and legacy Git tab state could reappear from saved UI state. | Retire `git` from right-panel state on normalization, route programmatic Git opens to Environment, and let durable tabs keep readable name floors while close affordances avoid permanent dead space. | `npm run smoke:ui:auto -- --browser`; `npm run smoke:ui:auto -- --workbench-new-tab`; installed visual `tmp/side-panel-visual-inventory/browser.png` |
| Settings detail density | Providers and shared settings rows leaned on too many separators, making the right pane read like a diagnostics dashboard. | Reduce row chrome, soften settings separators, compact Provider diagnostics, and keep details secondary to Defaults. | `npm run smoke:ui:auto -- --settings-providers`; installed visual `tmp/side-panel-visual-inventory/settings-providers.png` |
| Composer controls | The composer toolbar had the right controls but the visual order and label pressure made it feel busy. | Keep branch/local as context, then order the execution cluster as attachment, permission mode, model/provider, send; keep provider menus translucent and compact. | `npm run smoke:ui:auto -- --composer`; installed visual `tmp/side-panel-visual-inventory/composer.png` |
| Side chat material | Side chat was usable but too opaque and metadata-heavy, especially when embedded while the bottom panel is expanded. | Restore more material transparency, soften divider chrome, hide secondary metadata in compressed workbench height, and keep the input pinned as the primary action. | `npm run smoke:ui:auto -- --side-chat`; installed visual `tmp/side-panel-visual-inventory/side-chat.png` |

## Design Direction: Calm Studio

Calm Studio is the proposed Orchestrator language.

It should feel:

- **Focused**: the current task gets the brightest canvas; surrounding state recedes.
- **Layered**: navigation, transcript, right rail, modal, dropdown, and terminal each have clear depth.
- **Native**: macOS titlebar spacing, soft material feel, rounded controls, familiar icon buttons.
- **Operational**: dense enough for real coding work, not a marketing surface.
- **Personal**: users can tune accent, density, sidebar tint, and transcript style.

## Visual System

### Color

Replace the current flat surface stack with semantic tokens:

- `--app-bg`: outer app/background material
- `--panel-bg`: left navigation rail and soft elevated panels
- `--canvas-bg`: main chat/content canvas
- `--control-bg`: buttons, chips, inputs
- `--control-bg-hover`
- `--control-bg-active`
- `--border-subtle`
- `--border-strong`
- `--text-primary`
- `--text-secondary`
- `--text-tertiary`
- `--accent`
- `--accent-bg`
- `--state-success`
- `--state-warning`
- `--state-danger`
- provider identity tokens for each supported agent

Suggested default palettes:

- **Mist Light**: pale blue/gray sidebar, white canvas, black primary text.
- **Graphite Dark**: dark but softer than current, with warm graphite panels instead of pure black.
- **System**: follows OS.
- **High Contrast**: accessibility-oriented.

Provider colors should be identity accents only. They should not determine the whole theme.

### Typography

Use one type scale for product UI:

- Page title: 28-32px, 650 weight
- Section title: 17-20px, 600 weight
- Panel title: 13px, 650 weight
- Body: 14px
- Dense body: 13px
- Metadata: 11-12px
- Code: 12-13px, SF Mono or JetBrains Mono

Rules:

- Avoid uppercase labels except tiny metadata chips.
- Use muted text for labels and metadata, not for content.
- Chat text should be slightly larger and more breathable than settings/sidebar text.

### Shape

Define radius tokens:

- `--radius-xs`: 4px for inline code/chips
- `--radius-sm`: 6px for compact controls
- `--radius-md`: 8px for toolbars, rows, cards
- `--radius-lg`: 12px for composer, dropdowns, modal panels
- `--radius-xl`: 18px for prominent composer/search surfaces

Cards should not be nested inside cards. Repeated items can be card-like; page sections should use whitespace and dividers.

### Spacing

Define spacing tokens:

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px
- `--space-8`: 32px

Default density should be comfortable. Add compact density later for power users.

### Depth

Use depth sparingly:

- Persistent panels: no shadow, subtle border.
- Composer: soft shadow when floating or focused.
- Dropdowns/popovers: visible shadow and stronger border.
- Modals/settings: own canvas with clear separation from app shell.

Suggested shadows:

- `--shadow-popover`: `0 16px 40px rgba(0,0,0,.16)`
- `--shadow-composer`: `0 10px 30px rgba(0,0,0,.10)`

## Layout System

### App Shell

The shell should become three stable zones:

1. **Navigation rail**: projects, sessions, settings. Soft tinted material.
2. **Work canvas**: active conversation, terminal, or diff.
3. **Context rail**: plan, agents, extensions, diff, usage, side questions.

The left rail should feel pleasant because it is lower contrast than the canvas:

- left rail uses `panel-bg` with blur; the right contextual inspector uses `surface-bg` so diffs and transcripts read as white workspace chrome
- active session uses a rounded active row, not a hard left border
- sections use generous vertical rhythm
- settings stays anchored at bottom

### Chat Canvas

The chat should be the calmest part of the app:

- centered readable transcript width when only chat is open
- expands naturally when diff/context panels are open
- assistant messages mostly unframed
- user messages use soft rounded bubbles
- tool activity appears as collapsed timelines, not heavy cards
- permissions and user-input requests use distinct state cards

### Composer

Composer is the primary object in the app:

- large rounded rectangle with soft shadow
- toolbar divided into left context controls and right execution controls
- provider/model/permission controls become consistent pill buttons
- send/stop stays icon-first
- focus state uses accent ring, not a heavy border

### Context Rail

The right rail should feel like a drawer:

- one consistent header style for Plan, Agents, Diff, Extensions, Usage, Side Questions
- shared row/card component for lists
- shared stat/chip component
- icon-only rail tabs with tooltips
- width modes: compact, standard, wide

### Settings

Settings should become a full app section, not a modal-feeling form:

- left settings nav with clear section selection
- content column with max width
- settings rows as structured list rows
- grouped controls for providers, account, models, permissions, appearance
- extension configuration links out to the Extensions rail when it is operational state

## Component Inventory

Build reusable primitives before restyling everything:

- `AppShell`
- `Panel`
- `PanelHeader`
- `RailButton`
- `SurfaceRow`
- `TokenChip`
- `IconButton`
- `SegmentedControl`
- `SelectButton`
- `Switch`
- `Popover`
- `StatusDot`
- `StatPill`
- `ProviderBadge`
- `Composer`
- `TranscriptBlock`
- `ToolTimeline`
- `StateCard`

The goal is to remove one-off inline styling from major surfaces and make new provider features feel native by default.

## Customization Model

Start with customization that affects comfort, not layout complexity:

- Appearance: System, Mist Light, Graphite Dark, High Contrast.
- Accent: Blue, Teal, Purple, Green, Rose, System.
- Density: Comfortable, Compact.
- Sidebar tint: On/off.
- Transcript style: Relaxed, Dense.
- Code theme: Dark, Light, System.

Store these as user preferences and map them to CSS variables through a theme registry.

Avoid per-component customization at first. It will make the app harder to reason about.

## Implementation Plan

### Phase 1: Foundations

- Expand CSS variables into semantic tokens.
- Add theme registry in `theme.ts`.
- Add appearance settings for preset, accent, and density.
- Create shared primitives for buttons, chips, panels, rows, and switches.
- Keep behavior unchanged.

### Phase 2: Shell

- Restyle left sidebar into a soft navigation rail.
- Replace active session left border with rounded selected row.
- Normalize session/project row heights and metadata.
- Restyle titlebar/header controls to match the shell.

### Phase 3: Composer And Chat

- Rebuild composer around shared controls.
- Normalize provider/model/permission pills.
- Give transcript a readable max width.
- Restyle tool activity as a compact timeline.
- Make approval/user-input cards visually distinct and calm.

### Phase 4: Context Rail

- Apply shared panel header, stat, row, and card components to Plan, Agents, Extensions, Usage, Diff, and Side Questions.
- Add context rail width modes.
- Make empty states consistent.

### Phase 5: Settings And Customization

- Rework Settings into a sectioned settings surface.
- Add theme/accent/density controls.
- Move operational extension state out of provider details and link to Extensions.
- Add provider/account/models as clean settings groups.

## Non-Goals

- Do not make Orchestrator a marketing-style app.
- Do not use decorative gradient blobs or ornamental backgrounds.
- Do not let provider colors dominate entire panels.
- Do not create many one-off card styles.
- Do not hide operational density that coding users need.

## Success Criteria

- The app looks good in both light and dark modes.
- A new provider feature can be added using existing primitives.
- Settings, sidebar, chat, composer, and context rail feel like one product.
- Users can personalize the app without breaking layout consistency.
- Long coding sessions feel calmer than the current UI.
