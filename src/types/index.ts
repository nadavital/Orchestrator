export interface Project {
  id: string
  name: string
  rootPath: string
  sessionIds: string[]
  pinned?: boolean
}

export interface CodexProjectImportResult {
  imported: Project[]
  skippedExisting: number
  scanned: number
}

export interface WorkspaceSearchRequest {
  root: string
  host?: string
  query?: string
  limit?: number
  includeDirectories?: boolean
  includeHidden?: boolean
  includeContentMatches?: boolean
  lazyDirectories?: boolean
  expandedDirectories?: string[]
}

export interface WorkspaceSearchEntry {
  host?: string
  path: string
  name: string
  kind: 'file' | 'directory'
  depth: number
  size?: number
  score?: number
  matchKind?: 'path' | 'content'
  matchLine?: number
  matchText?: string
  hasChildren?: boolean
  loaded?: boolean
}

export interface WorkspaceSearchResult {
  root: string
  host?: string
  query: string
  entries: WorkspaceSearchEntry[]
  visited: number
  truncated: boolean
  durationMs: number
}

export type PreferredOpenTarget = 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'
export type OpenTargetId = Exclude<PreferredOpenTarget, 'system'>
export type OpenPathMethod = 'system' | 'url-scheme' | 'cli' | 'app'

export interface OpenPathOptions {
  line?: number
  column?: number
  cwd?: string
  target?: PreferredOpenTarget
  preview?: boolean
}

export interface OpenPathResult {
  ok: boolean
  filePath: string
  target: PreferredOpenTarget
  method: OpenPathMethod
  line?: number
  column?: number
  message?: string
  openedWith?: string
  fallbackFrom?: OpenPathMethod
}

export interface OpenTargetAvailability {
  id: PreferredOpenTarget
  label: string
  available: boolean
  methods: OpenPathMethod[]
  supportsLineTarget: boolean
  appName?: string
  unavailableReason?: string
}

// Provider display info — shared between main and renderer
export interface CursorEffortLevel {
  id: string
  label: string
  modelId: string
  thinkingModelId?: string
  fastModelId?: string
}

export interface CursorModelConfig {
  defaultEffort?: string
  effortLevels?: CursorEffortLevel[]
  supportsThinking?: boolean
  thinkingModelId?: string
  fastModelId?: string
}

export interface ProviderModelDef {
  id: string
  label: string
  cursorConfig?: CursorModelConfig
}

export interface ProviderAgentDef {
  id: string
  name: string
  model?: string
}

export function parseClaudeAgentsOutput(output: string): ProviderAgentDef[] {
  const seen = new Set<string>()
  return output
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
    .flatMap((line): ProviderAgentDef[] => {
      if (/^\d+\s+active\s+agents?$/i.test(line)) return []
      const parts = line.split(/\s*[·•]\s*/).map((part) => part.trim()).filter(Boolean)
      const name = parts[0]?.replace(/^agent:\s*/i, '').trim()
      if (!name || /^(none|no configured agents)$/i.test(name)) return []
      if (/agents?:$/i.test(name)) return []
      const key = name.toLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      return [{ id: name, name, model: parts[1] }]
    })
}

export interface ProviderDef {
  id: string
  name: string
  color: string
  icon: string          // SVG path `d` attribute, viewBox 0 0 24 24
  iconFillRule?: string // 'evenodd' if the path needs it (default: nonzero)
  installCmd: string    // command to install the CLI
  models: ProviderModelDef[]
  supportsEffort: boolean
  effortLevels: Array<{ id: string; label: string }>
  supportsResume: boolean
  defaultPermissionMode?: string
  permissionModes: ProviderPermissionMode[]
}

export interface ProviderPermissionMode {
  id: string
  label: string
  desc: string
  intent?: PermissionIntent
}

export const PROVIDER_DEFS: Record<string, ProviderDef> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    color: '#D97757',
    icon: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    models: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
    ],
    supportsEffort: true,
    effortLevels: [
      { id: 'low', label: 'Low' },
      { id: 'normal', label: 'Normal' },
      { id: 'high', label: 'High' },
      { id: 'max', label: 'Max' }
    ],
    supportsResume: true,
    defaultPermissionMode: 'auto',
    permissionModes: [
      { id: 'auto', label: 'Auto', desc: 'Claude handles routine safe work automatically and asks or blocks when risk increases.', intent: 'autoEdit' },
      { id: 'plan', label: 'Plan', desc: 'Claude explores and proposes a plan before making changes.', intent: 'plan' },
      { id: 'default', label: 'Ask first', desc: 'Claude asks before edits, commands, and network requests.', intent: 'ask' },
      { id: 'acceptEdits', label: 'Auto-edit', desc: 'Claude can read and edit files in the workspace without prompting.', intent: 'autoEdit' },
      { id: 'dontAsk', label: 'Preapproved only', desc: 'Only explicitly preapproved tools run; other prompts are denied.', intent: 'workspaceSandbox' },
      { id: 'bypassPermissions', label: 'Bypass unsafe', desc: 'Skips native permission checks. Use only in isolated sandboxes.', intent: 'bypass' }
    ]
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    color: '#8957E5',
    icon: 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997a.617.617 0 0 1 .197-.82l1.084-.7a.617.617 0 0 1 .819.164C2.85 16.5 6.94 19.77 12 19.77c5.062 0 9.15-3.27 9.823-4.33a.617.617 0 0 1 .819-.163l1.084.699a.616.616 0 0 1 .196.82ZM8.073 11.997a2.528 2.528 0 1 0 0-5.056 2.528 2.528 0 0 0 0 5.056Zm7.854 0a2.528 2.528 0 1 0 0-5.056 2.528 2.528 0 0 0 0 5.056ZM12 1.98c3.853 0 6.96 3.44 6.96 6.96 0 1.086-.247 2.11-.685 3.02a5.283 5.283 0 0 0-3.781-1.59 5.26 5.26 0 0 0-2.494.624 5.26 5.26 0 0 0-2.494-.624 5.283 5.283 0 0 0-3.781 1.59A6.924 6.924 0 0 1 5.04 8.94C5.04 5.42 8.147 1.98 12 1.98Z',
    iconFillRule: 'evenodd',
    installCmd: 'npm install -g @github/copilot',
    models: [
      // ── Default 5: best-of-breed across companies ─────────────────────
      { id: 'claude-opus-4.7', label: 'Claude Opus 4.7' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
      { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
      { id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
      // ── Older / variant Claude ────────────────────────────────────────
      { id: 'claude-opus-4.6-fast', label: 'Claude Opus 4.6 Fast' },
      { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
      { id: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
      // ── Older / variant GPT ───────────────────────────────────────────
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      // ── Older / variant Gemini ────────────────────────────────────────
      { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }
    ],
    supportsEffort: true,
    effortLevels: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'X-High' }
    ],
    supportsResume: true,
    permissionModes: [
      { id: 'default', label: 'Prompt', desc: 'Prompt mode', intent: 'ask' },
      { id: 'allowEdits', label: 'Tools', desc: 'Allow tools', intent: 'autoEdit' },
      { id: 'yolo', label: 'Auto', desc: 'Allow everything', intent: 'bypass' }
    ]
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    color: '#6366F1',
    icon: 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z',
    iconFillRule: 'evenodd',
    installCmd: 'npm install -g @openai/codex',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'codex-mini-latest', label: 'Codex Mini' }
    ],
    supportsEffort: true,
    effortLevels: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'X-High' }
    ],
    supportsResume: true,
    permissionModes: [
      { id: 'default', label: 'Ask', desc: 'Ask when requested', intent: 'ask' },
      { id: 'untrusted', label: 'Trust safe', desc: 'Run trusted commands and ask for untrusted ones.', intent: 'ask' },
      { id: 'never', label: 'No prompts', desc: 'Never ask; return failures to the model.', intent: 'workspaceSandbox' },
      { id: 'autoReview', label: 'Auto-review', desc: 'Let Codex review approval requests before routing riskier ones to you.', intent: 'ask' },
      { id: 'fullAccess', label: 'Full access', desc: 'Run without workspace sandbox limits.', intent: 'fullAccess' },
      { id: 'yolo', label: 'Bypass unsafe', desc: 'Skip approvals and sandboxing. Use only in isolated sandboxes.', intent: 'bypass' }
    ]
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    color: '#A8B3CF',
    icon: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
    installCmd: 'curl https://cursor.com/install -fsS | bash',
    models: [
      // ── Default 5 ─────────────────────────────────────────────────────
      { id: 'auto', label: 'Auto' },
      { id: 'composer-2', label: 'Composer 2',
        cursorConfig: { fastModelId: 'composer-2-fast' } },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7',
        cursorConfig: {
          defaultEffort: 'high', supportsThinking: true,
          effortLevels: [
            { id: 'low',    label: 'Low',   modelId: 'claude-opus-4-7-low',    thinkingModelId: 'claude-opus-4-7-thinking-low' },
            { id: 'medium', label: 'Med',   modelId: 'claude-opus-4-7-medium', thinkingModelId: 'claude-opus-4-7-thinking-medium' },
            { id: 'high',   label: 'High',  modelId: 'claude-opus-4-7-high',   thinkingModelId: 'claude-opus-4-7-thinking-high' },
            { id: 'xhigh',  label: 'XHigh', modelId: 'claude-opus-4-7-xhigh',  thinkingModelId: 'claude-opus-4-7-thinking-xhigh' },
            { id: 'max',    label: 'Max',   modelId: 'claude-opus-4-7-max',    thinkingModelId: 'claude-opus-4-7-thinking-max' },
          ]
        } },
      { id: 'gpt-5.4', label: 'GPT-5.4',
        cursorConfig: {
          defaultEffort: 'high',
          effortLevels: [
            { id: 'low',    label: 'Low',   modelId: 'gpt-5.4-low' },
            { id: 'medium', label: 'Med',   modelId: 'gpt-5.4-medium', fastModelId: 'gpt-5.4-medium-fast' },
            { id: 'high',   label: 'High',  modelId: 'gpt-5.4-high',   fastModelId: 'gpt-5.4-high-fast' },
            { id: 'xhigh',  label: 'XHigh', modelId: 'gpt-5.4-xhigh',  fastModelId: 'gpt-5.4-xhigh-fast' },
          ]
        } },
      { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6',
        cursorConfig: {
          defaultEffort: 'medium', supportsThinking: true,
          effortLevels: [
            { id: 'medium', label: 'Med', modelId: 'claude-4.6-sonnet-medium', thinkingModelId: 'claude-4.6-sonnet-medium-thinking' },
          ]
        } },
      // ── Cursor-native ─────────────────────────────────────────────────
      { id: 'composer-1.5', label: 'Composer 1.5' },
      // ── Claude 4.6 ───────────────────────────────────────────────────
      { id: 'claude-opus-4.6', label: 'Claude Opus 4.6',
        cursorConfig: {
          defaultEffort: 'high', supportsThinking: true,
          effortLevels: [
            { id: 'high', label: 'High', modelId: 'claude-4.6-opus-high', thinkingModelId: 'claude-4.6-opus-high-thinking' },
            { id: 'max',  label: 'Max',  modelId: 'claude-4.6-opus-max',  thinkingModelId: 'claude-4.6-opus-max-thinking' },
          ]
        } },
      // ── Claude 4.5 ───────────────────────────────────────────────────
      { id: 'claude-opus-4.5', label: 'Claude Opus 4.5',
        cursorConfig: {
          defaultEffort: 'high', supportsThinking: true,
          effortLevels: [
            { id: 'high', label: 'High', modelId: 'claude-4.5-opus-high', thinkingModelId: 'claude-4.5-opus-high-thinking' },
          ]
        } },
      { id: 'claude-4.5-sonnet', label: 'Claude Sonnet 4.5',
        cursorConfig: { supportsThinking: true, thinkingModelId: 'claude-4.5-sonnet-thinking' } },
      { id: 'claude-4.5-haiku', label: 'Claude Haiku 4.5',
        cursorConfig: { supportsThinking: true, thinkingModelId: 'claude-4.5-haiku-thinking' } },
      // ── Claude 4 ─────────────────────────────────────────────────────
      { id: 'claude-4-sonnet', label: 'Claude Sonnet 4',
        cursorConfig: { supportsThinking: true, thinkingModelId: 'claude-4-sonnet-thinking' } },
      // ── GPT-5.5 ──────────────────────────────────────────────────────
      { id: 'gpt-5.5', label: 'GPT-5.5',
        cursorConfig: {
          defaultEffort: 'high',
          effortLevels: [
            { id: 'medium',     label: 'Med',   modelId: 'gpt-5.5-medium' },
            { id: 'high',       label: 'High',  modelId: 'gpt-5.5-high' },
            { id: 'extra-high', label: 'XHigh', modelId: 'gpt-5.5-extra-high' },
          ]
        } },
      // ── GPT-5.4 Mini / Nano ───────────────────────────────────────────
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini',
        cursorConfig: {
          defaultEffort: 'medium',
          effortLevels: [
            { id: 'medium', label: 'Med',   modelId: 'gpt-5.4-mini-medium' },
            { id: 'high',   label: 'High',  modelId: 'gpt-5.4-mini-high' },
            { id: 'xhigh',  label: 'XHigh', modelId: 'gpt-5.4-mini-xhigh' },
          ]
        } },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano',
        cursorConfig: {
          defaultEffort: 'medium',
          effortLevels: [
            { id: 'medium', label: 'Med',  modelId: 'gpt-5.4-nano-medium' },
            { id: 'high',   label: 'High', modelId: 'gpt-5.4-nano-high' },
          ]
        } },
      // ── GPT-5.3 Codex ────────────────────────────────────────────────
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex',
        cursorConfig: {
          defaultEffort: 'standard',
          effortLevels: [
            { id: 'standard', label: 'Standard', modelId: 'gpt-5.3-codex' },
            { id: 'high',     label: 'High',     modelId: 'gpt-5.3-codex-high' },
            { id: 'xhigh',    label: 'XHigh',    modelId: 'gpt-5.3-codex-xhigh' },
          ]
        } },
      // ── GPT-5.2 ──────────────────────────────────────────────────────
      { id: 'gpt-5.2', label: 'GPT-5.2',
        cursorConfig: {
          defaultEffort: 'standard',
          effortLevels: [
            { id: 'standard', label: 'Standard', modelId: 'gpt-5.2' },
            { id: 'high',     label: 'High',     modelId: 'gpt-5.2-high' },
            { id: 'xhigh',    label: 'XHigh',    modelId: 'gpt-5.2-xhigh' },
          ]
        } },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex',
        cursorConfig: {
          defaultEffort: 'standard',
          effortLevels: [
            { id: 'standard', label: 'Standard', modelId: 'gpt-5.2-codex' },
            { id: 'high',     label: 'High',     modelId: 'gpt-5.2-codex-high' },
          ]
        } },
      // ── GPT-5.1 ──────────────────────────────────────────────────────
      { id: 'gpt-5.1', label: 'GPT-5.1',
        cursorConfig: {
          defaultEffort: 'standard',
          effortLevels: [
            { id: 'standard', label: 'Standard', modelId: 'gpt-5.1' },
            { id: 'high',     label: 'High',     modelId: 'gpt-5.1-high' },
          ]
        } },
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini',
        cursorConfig: {
          defaultEffort: 'standard',
          effortLevels: [
            { id: 'standard', label: 'Standard', modelId: 'gpt-5.1-codex-mini' },
            { id: 'high',     label: 'High',     modelId: 'gpt-5.1-codex-mini-high' },
          ]
        } },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max',
        cursorConfig: {
          defaultEffort: 'high',
          effortLevels: [
            { id: 'high',  label: 'High',  modelId: 'gpt-5.1-codex-max-high' },
            { id: 'xhigh', label: 'XHigh', modelId: 'gpt-5.1-codex-max-xhigh' },
          ]
        } },
      // ── GPT-5 ────────────────────────────────────────────────────────
      { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
      // ── Gemini ───────────────────────────────────────────────────────
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      // ── xAI ──────────────────────────────────────────────────────────
      { id: 'grok-4-20', label: 'Grok 4.20',
        cursorConfig: { supportsThinking: true, thinkingModelId: 'grok-4-20-thinking' } },
      { id: 'grok-4.3', label: 'Grok 4.3' },
      // ── Moonshot / Kimi ───────────────────────────────────────────────
      { id: 'accounts/fireworks/models/kimi-k2p5', label: 'Kimi K2.5' }
    ],
    supportsEffort: false,
    effortLevels: [],
    supportsResume: true,
    permissionModes: [
      { id: 'default', label: 'Ask', desc: 'Ask mode', intent: 'ask' },
      { id: 'sandbox', label: 'Sandbox', desc: 'Sandbox mode', intent: 'workspaceSandbox' },
      { id: 'yolo', label: 'Auto', desc: 'Skip prompts', intent: 'bypass' }
    ]
  }
}

const DEFAULT_VISIBLE_COUNT = 5

const PRIMARY_PERMISSION_MODE_IDS: Record<string, string[]> = {
  claude: ['auto', 'plan', 'default'],
  codex: ['default', 'untrusted', 'never']
}

export function getDefaultPermissionMode(providerDef: ProviderDef, configuredMode?: string): string {
  if (configuredMode && providerDef.permissionModes.some((mode) => mode.id === configuredMode)) return configuredMode
  if (providerDef.defaultPermissionMode && providerDef.permissionModes.some((mode) => mode.id === providerDef.defaultPermissionMode)) {
    return providerDef.defaultPermissionMode
  }
  return providerDef.permissionModes[0]?.id ?? 'default'
}

export function getPrimaryPermissionModes(providerDef: ProviderDef): ProviderPermissionMode[] {
  const primaryIds = PRIMARY_PERMISSION_MODE_IDS[providerDef.id]
  if (!primaryIds) return providerDef.permissionModes.filter((mode) => mode.intent !== 'bypass')
  return primaryIds
    .map((id) => providerDef.permissionModes.find((mode) => mode.id === id))
    .filter((mode): mode is ProviderPermissionMode => Boolean(mode))
}

export function getAdvancedPermissionModes(providerDef: ProviderDef): ProviderPermissionMode[] {
  const primaryIds = new Set(PRIMARY_PERMISSION_MODE_IDS[providerDef.id] ?? [])
  return providerDef.permissionModes.filter((mode) => mode.intent !== 'bypass' && !primaryIds.has(mode.id))
}

export function getDangerPermissionModes(providerDef: ProviderDef): ProviderPermissionMode[] {
  return providerDef.permissionModes.filter((mode) => mode.intent === 'bypass')
}

export function getVisibleModels(
  providerDef: ProviderDef,
  providerModels: Record<string, string[]>
): ProviderModelDef[] {
  const stored = providerModels[providerDef.id]
  if (stored && stored.length > 0) {
    return stored.map((id) => providerDef.models.find((m) => m.id === id) ?? { id, label: id })
  }
  return providerDef.models.slice(0, DEFAULT_VISIBLE_COUNT)
}

export type SessionEffort = string
export type SessionPermissionMode = string
export type ProviderId = 'claude' | 'copilot' | 'codex' | 'cursor' | string
export type ExecutionPolicy = SessionPermissionMode

export type AgentStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentNode {
  id: string
  providerId: string
  sessionId: string
  parentAgentId?: string
  name?: string
  role?: string
  status: AgentStatus
  model?: string
  startedAt?: number
  completedAt?: number
  summary?: string
  transcript?: string
}

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked'

export interface PlanItem {
  id?: string
  content: string
  status: PlanItemStatus
}

export interface PlanState {
  providerId: string
  sessionId: string
  mode?: 'plan' | 'execute'
  title?: string
  items: PlanItem[]
  summary?: string
}

export interface ProviderCommand {
  binary: string
  args: string[]
}

export interface ProviderRunContext {
  settingsPath?: string
  includeHookEvents?: boolean
}

export interface ProviderCapabilities {
  resume: boolean
  streamingJson: boolean
  interactiveCli: boolean
  interactivePermissions: boolean
  allowedTools: boolean
  workspaceSandbox: boolean
  fullAccessMode: boolean
  checkpointUndo: boolean
  forcedAllTools?: boolean
}

export type ProviderCapabilityKey =
  | 'resume'
  | 'interactiveCli'
  | 'structuredOutput'
  | 'streamEvents'
  | 'interactivePermissions'
  | 'toolAllowlist'
  | 'workspaceSandbox'
  | 'fullAccess'
  | 'checkpointUndo'
  | 'bypassAll'

export interface ProviderCapability {
  key: ProviderCapabilityKey
  label: string
  support: 'supported' | 'partial' | 'unsupported' | 'forced'
  source: 'docs' | 'adapter' | 'fixture' | 'runtime'
  note?: string
}

export type ProviderRuntimeKind = 'headless' | 'interactive' | 'app-server' | 'sdk'

export type ProviderFeatureArea =
  | 'runtime'
  | 'permissions'
  | 'commands'
  | 'agents'
  | 'mcp'
  | 'extensions'
  | 'review'
  | 'workspace'
  | 'attachments'
  | 'usage'

export interface ProviderFeature {
  id: string
  label: string
  area: ProviderFeatureArea
  support: 'supported' | 'partial' | 'planned' | 'unsupported' | 'blocked'
  source: 'adapter' | 'local-cli' | 'sdk' | 'docs'
  runtimes: ProviderRuntimeKind[]
  note?: string
}

export interface ProviderCapabilityGap {
  id: string
  label: string
  area: ProviderFeatureArea
  severity: 'high' | 'medium' | 'low'
  status: 'missing' | 'partial' | 'blocked'
  summary: string
  nextStep: string
}

export interface ProviderProbeDefinition {
  id: string
  label: string
  args: string[]
  quota: 'none' | 'may-use-quota'
  safeByDefault: boolean
  category: 'version' | 'help' | 'features' | 'models' | 'auth' | 'mcp' | 'extensions'
}

export interface ProviderProbeResult extends ProviderProbeDefinition {
  status: 'ok' | 'error' | 'missing' | 'skipped'
  output: string
}

export type ProviderSlashCommandSource = 'app' | 'provider' | 'plugin' | 'mcp' | 'skill' | 'sdk'

export interface ProviderSlashCommand {
  id: string
  name: string
  description?: string
  providerId: string
  source: ProviderSlashCommandSource
  scope?: 'project' | 'global' | 'provider'
  runtime: ProviderRuntimeKind
  handler: 'app-action' | 'send-to-provider' | 'insert-prompt' | 'sdk-command'
  arguments?: Array<{ name: string; optional?: boolean; description?: string }>
  featureId?: string
  prompt?: string
}

export interface ProviderCommandSurface {
  id: string
  label: string
  area: ProviderFeatureArea
  command: string[]
  runtime: ProviderRuntimeKind
  quota: 'none' | 'may-use-quota'
  mutatesState: boolean
  appSurface: 'settings' | 'composer' | 'activity' | 'terminal' | 'planned'
  featureId?: string
  note?: string
}

export interface ProviderCapabilityRegistry {
  providerId: string
  features: ProviderFeature[]
  gaps: ProviderCapabilityGap[]
  probes: ProviderProbeDefinition[]
  commandSurfaces: ProviderCommandSurface[]
  slashCommands: ProviderSlashCommand[]
}

export interface ResolvedExecutionPolicy {
  policy: ExecutionPolicy
  support: 'exact' | 'approximate' | 'unsupported' | 'forced'
  args: string[]
  label: string
  description: string
  warning?: string
  intent?: PermissionIntent
  interaction?: PermissionInteraction
  controls?: PermissionRuntimeControl[]
  execution?: PermissionExecutionContract
}

export interface PermissionExecutionContract {
  nativeMode?: string
  approvalPolicy?: string
  approvalsReviewer?: string
  sandboxMode?: string
  toolPolicy?: string
  configSource?: 'cli' | 'config' | 'app-server' | 'mixed'
}

export interface ProviderPermissionRuntimeContext {
  providerId: string
  cwd?: string
  status: 'static' | 'ok' | 'unavailable' | 'error'
  source: 'static' | 'app-server'
  defaultPolicy?: string
  visiblePolicies?: string[]
  disabledPolicies?: Record<string, string>
  effective?: PermissionExecutionContract
  summary?: string
  updatedAt: number
}

export type PermissionIntent =
  | 'ask'
  | 'plan'
  | 'autoEdit'
  | 'workspaceSandbox'
  | 'fullAccess'
  | 'bypass'
  | 'custom'

export type PermissionInteraction =
  | 'structured'
  | 'pty'
  | 'headless'
  | 'config'
  | 'none'

export interface PermissionRuntimeControl {
  kind: 'tool' | 'path' | 'url' | 'sandbox' | 'config' | 'mode' | 'mcp'
  label: string
  description: string
  support: 'available' | 'planned' | 'not-supported'
  examples?: string[]
}

export interface ProviderRuntimeInfo {
  id: string
  capabilities: ProviderCapabilities
  abstractCapabilities: ProviderCapability[]
  registry: ProviderCapabilityRegistry
  policies: Record<string, ResolvedExecutionPolicy>
}

export interface ProviderRuntimeDebugEvent {
  id: string
  timestamp: number
  providerId: string
  runtime: ProviderRuntimeKind
  sessionId?: string
  hostId?: string
  method?: string
  severity: 'debug' | 'info' | 'warning' | 'error'
  noisy: boolean
  message: string
  code?: string
}

export interface ProviderRuntimeConnectionState {
  id: string
  providerId: string
  runtime: ProviderRuntimeKind
  sessionId?: string
  hostId?: string
  status: 'starting' | 'connected' | 'disconnected' | 'failed' | 'stopped'
  startedAt: number
  updatedAt: number
  version?: string
  method?: string
  errorCode?: string
  message?: string
}

export interface ProviderDiagnosticInfo {
  id: string
  binary: {
    status: 'found' | 'missing'
    path?: string
  }
  version: {
    status: 'ok' | 'error' | 'unknown'
    value?: string
    message?: string
  }
  auth: {
    status: 'ok' | 'error' | 'unknown'
    message: string
  }
  models: {
    status: 'configured' | 'available' | 'empty' | 'unknown'
    count: number
    message: string
  }
  usage: {
    status: 'available' | 'unavailable' | 'unknown'
    message: string
  }
  liveSmoke: {
    status: 'not-run' | 'passed' | 'failed'
    message: string
  }
  runtimeConnections?: ProviderRuntimeConnectionState[]
  runtimeEvents?: ProviderRuntimeDebugEvent[]
  probes: ProviderProbeResult[]
}

export interface ProviderCommandSurfaceResult {
  providerId: string
  surfaceId: string
  status: 'ok' | 'error' | 'blocked'
  output: string
}

export interface ProviderSidebarSyncResult {
  ok: boolean
  providerId: string
  changed: number
  skipped?: 'no-provider-sessions' | 'unsupported-provider'
  error?: string
}

export type ProviderResourceKind =
  | 'skill'
  | 'plugin'
  | 'app'
  | 'mcp_server'
  | 'mcp_tool'
  | 'agent'
  | 'hook'
  | 'rule'
  | 'command'

export interface ProviderResource {
  id: string
  kind: ProviderResourceKind
  providerId: string
  source: string
  name: string
  description?: string
  fingerprint: string
  status: 'available' | 'enabled' | 'disabled' | 'missing' | 'error' | 'unknown'
  scope: 'global' | 'project' | 'workspace' | 'session' | 'provider'
  actions: Array<'refresh' | 'inspect' | 'open_config' | 'import' | 'migrate' | 'enable' | 'disable' | 'edit' | 'remove'>
  raw?: unknown
}

export interface ProviderResourceSnapshot {
  providerId: string
  status: 'ok' | 'partial' | 'error'
  lastRefreshedAt: number
  resources: ProviderResource[]
  errors: Array<{ surfaceId: string; message: string }>
}

export type CapabilityCreateKind = 'skill' | 'plugin' | 'mcp_server'
export type CapabilityCreateScope = 'project' | 'global'
export type CapabilityMcpTransport = 'stdio' | 'http'

export interface CapabilityCreateRequest {
  kind: CapabilityCreateKind
  scope: CapabilityCreateScope
  workDir: string
  name: string
  description?: string
  body?: string
  transport?: CapabilityMcpTransport
  command?: string
  args?: string[]
  url?: string
}

export interface CapabilityCreateResult {
  ok: boolean
  files: string[]
  warnings: string[]
  resources: ProviderResource[]
}

export interface CapabilityUpdateRequest {
  resources: ProviderResource[]
  name: string
  description?: string
  body?: string
  transport?: CapabilityMcpTransport
  command?: string
  args?: string[]
  url?: string
}

export interface CapabilityDeleteRequest {
  resources: ProviderResource[]
}

export interface CapabilityMutationResult {
  ok: boolean
  files: string[]
  warnings: string[]
}

export type CapabilitySyncMode =
  | 'backfill-missing-providers'
  | 'sync-selected-providers'
  | 'import-as-portable-copy'
  | 'install-native'
  | 'remove-provider-projection'

export interface CapabilitySyncRequest {
  resources: ProviderResource[]
  workDir: string
  scope: CapabilityCreateScope
  targetProviders: string[]
  mode: CapabilitySyncMode
  allowProviderMutations?: boolean
}

export interface CapabilitySyncOperation {
  providerId: string
  action: 'write-file' | 'update-json' | 'update-toml' | 'run-command' | 'app-server-call' | 'manual'
  summary: string
  risk: 'low' | 'medium' | 'gated'
  path?: string
  command?: string[]
  appServerMethod?: string
}

export interface CapabilitySyncPlan {
  ok: boolean
  capabilityName: string
  kind: ProviderResourceKind
  operations: CapabilitySyncOperation[]
  warnings: string[]
  blockers: string[]
}

export interface RunRequest {
  prompt: string
  cwd: string
  model: string
  effort: SessionEffort
  agentName?: string | null
  providerSessionId: string | null
  executionPolicy: ExecutionPolicy
  allowedTools: string[]
  disallowedTools?: string[]
  availableTools?: string[]
  additionalDirs?: string[]
  runtime?: ProviderRuntimeKind
  useThinking?: boolean
  useFast?: boolean
  providerContext?: ProviderRunContext
  attachments?: Attachment[]
  codexReviewStart?: CodexReviewStartRequest
}

export type CodexReviewDelivery = 'inline' | 'detached'

export type CodexReviewStartTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title: string | null }
  | { type: 'custom'; instructions: string }

export interface CodexReviewStartRequest {
  target: CodexReviewStartTarget
  delivery?: CodexReviewDelivery | null
}

export interface UsageSummary {
  inputTokens?: number
  outputTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  totalTokens?: number
  totalCostUsd?: number
  durationMs?: number
  apiDurationMs?: number
  turns?: number
  serviceTier?: string
  modelUsage?: Record<string, {
    inputTokens?: number
    outputTokens?: number
    cacheReadInputTokens?: number
    cacheCreationInputTokens?: number
    costUSD?: number
    contextWindow?: number
    maxOutputTokens?: number
    webSearchRequests?: number
  }>
}

export interface SideQuestionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status?: 'pending' | 'complete' | 'error'
  usage?: UsageSummary
}

export type TerminalServiceSessionStatus = 'starting' | 'running' | 'exited' | 'buffered'

export interface TerminalServiceSessionSnapshot {
  terminalId: string
  workDir: string | null
  status: TerminalServiceSessionStatus
  bufferLength: number
  hasBuffer: boolean
  exitCode?: number
  signal?: number | null
}

export interface TerminalServiceSnapshot {
  sessions: TerminalServiceSessionSnapshot[]
  sessionCount: number
  runningCount: number
  startingCount: number
  exitedCount: number
  bufferedCount: number
  totalBufferLength: number
}

export type Attachment =
  | {
      id: string
      kind: 'local_file'
      path: string
      name: string
      size?: number
      mimeType?: string
    }
  | {
      id: string
      kind: 'claude_file'
      fileId: string
      relativePath: string
      name?: string
    }

export interface BrowserUseSurfaceSize {
  width: number
  height: number
}

export interface BrowserUseSurfaceBounds extends BrowserUseSurfaceSize {
  x: number
  y: number
  scale?: number
}

export interface BrowserUseCursorState {
  visible: boolean
  x: number
  y: number
  animateMovement?: boolean
  moveSequence?: number
}

export interface BrowserLocalServerRoute {
  serverUrl: string
  url: string
  title?: string | null
  source?: 'provider' | 'history' | 'manual'
}

export interface BrowserManagerStatePatch {
  browserUseActive?: boolean
  browserUseTurnId?: string | null
  browserUseViewportSize?: BrowserUseSurfaceSize | null
  browserUseCaptureSurfaceSize?: BrowserUseSurfaceSize | null
  browserUseCaptureBounds?: BrowserUseSurfaceBounds | null
  browserUseCursorState?: BrowserUseCursorState | null
  localServerRoutes?: BrowserLocalServerRoute[]
  hiddenLocalServerRoutes?: string[]
  shouldOpenBrowser?: boolean
}

export type RunEvent =
  | { type: 'session.started'; providerSessionId: string }
  | { type: 'assistant.text'; content: string }
  | { type: 'assistant.status'; content: string }
  | { type: 'assistant.text.delta'; streamId: string; content: string }
  | { type: 'assistant.text.completed'; streamId: string }
  | {
    type: 'diff.updated'
    content: string
    providerSessionId?: string
    providerTurnId?: string
    checkpointId?: string
    checkpointUndoSupported?: boolean
  }
  | { type: 'tool.started'; id: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'tool.completed'; id: string; toolUseId: string; content: string; isError: boolean }
  | { type: 'agent.started'; agent: AgentNode }
  | { type: 'agent.updated'; agent: AgentNode }
  | { type: 'agent.completed'; agent: AgentNode }
  | { type: 'agent.failed'; agent: AgentNode }
  | { type: 'agent.text.delta'; agentId: string; streamId: string; content: string }
  | { type: 'agent.text.completed'; agentId: string; streamId: string }
  | { type: 'plan.updated'; plan: PlanState }
  | { type: 'goal.updated'; goal: { providerId: string; sessionId: string; objective: string; status?: string; tokenBudget?: number | null; tokensUsed?: number; timeUsedSeconds?: number } }
  | { type: 'goal.cleared'; providerId: string; sessionId: string }
  | { type: 'review.mode.changed'; providerId: string; sessionId: string; active: boolean; review?: string; itemId?: string }
  | { type: 'permission.requested'; denials: PermissionDenial[]; content?: string }
  | { type: 'user_input.requested'; content: string; questions?: UserInputQuestion[] }
  | { type: 'connection.reconnecting'; attempt?: number; content?: string }
  | { type: 'connection.retrying'; attempt?: number; content?: string }
  | {
      type: 'browser.manager_state'
      active?: boolean
      turnId?: string | null
      viewportSize?: BrowserUseSurfaceSize | null
      captureSurfaceSize?: BrowserUseSurfaceSize | null
      captureBounds?: BrowserUseSurfaceBounds | null
      cursorState?: BrowserUseCursorState | null
      localServerRoutes?: BrowserLocalServerRoute[] | null
      hiddenLocalServerRoutes?: string[] | null
      open?: boolean
    }
  | { type: 'run.completed'; content?: string; usage?: UsageSummary }
  | { type: 'run.failed'; content?: string; usage?: UsageSummary }

export function browserManagerPatchFromEvents(events: readonly RunEvent[]): BrowserManagerStatePatch | null {
  let patch: BrowserManagerStatePatch | null = null

  for (const event of events) {
    if (event.type !== 'browser.manager_state') continue
    patch ??= {}

    if (event.open !== false) patch.shouldOpenBrowser = true
    if (typeof event.active === 'boolean') patch.browserUseActive = event.active
    if ('turnId' in event) patch.browserUseTurnId = typeof event.turnId === 'string' ? event.turnId : null
    if ('viewportSize' in event) patch.browserUseViewportSize = normalizeBrowserUseSurfaceSize(event.viewportSize)
    if ('captureSurfaceSize' in event) patch.browserUseCaptureSurfaceSize = normalizeBrowserUseSurfaceSize(event.captureSurfaceSize)
    if ('captureBounds' in event) patch.browserUseCaptureBounds = normalizeBrowserUseSurfaceBounds(event.captureBounds)
    if ('cursorState' in event) patch.browserUseCursorState = normalizeBrowserUseCursorState(event.cursorState)
    if ('localServerRoutes' in event) patch.localServerRoutes = normalizeBrowserLocalServerRoutes(event.localServerRoutes)
    if ('hiddenLocalServerRoutes' in event) patch.hiddenLocalServerRoutes = normalizeBrowserHiddenLocalServerRoutes(event.hiddenLocalServerRoutes)
  }

  return patch
}

function normalizeBrowserUseSurfaceSize(size: BrowserUseSurfaceSize | null | undefined): BrowserUseSurfaceSize | null {
  if (!size || typeof size !== 'object') return null
  const width = Math.round(size.width)
  const height = Math.round(size.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function normalizeBrowserUseSurfaceBounds(bounds: BrowserUseSurfaceBounds | null | undefined): BrowserUseSurfaceBounds | null {
  if (!bounds || typeof bounds !== 'object') return null
  const size = normalizeBrowserUseSurfaceSize(bounds)
  if (!size) return null
  const x = Math.round(Number(bounds.x))
  const y = Math.round(Number(bounds.y))
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const scale = Number(bounds.scale)
  return {
    x,
    y,
    ...size,
    ...(Number.isFinite(scale) && scale > 0 ? { scale: Math.round(scale * 1000) / 1000 } : {})
  }
}

function normalizeBrowserUseCursorState(cursor: BrowserUseCursorState | null | undefined): BrowserUseCursorState | null {
  if (!cursor || typeof cursor !== 'object') return null
  const x = Number(cursor.x)
  const y = Number(cursor.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const normalized: BrowserUseCursorState = {
    visible: cursor.visible === true,
    x,
    y
  }
  if (typeof cursor.animateMovement === 'boolean') normalized.animateMovement = cursor.animateMovement
  if (typeof cursor.moveSequence === 'number' && Number.isFinite(cursor.moveSequence)) normalized.moveSequence = cursor.moveSequence
  return normalized
}

function normalizeBrowserLocalServerRoutes(routes: BrowserLocalServerRoute[] | null | undefined): BrowserLocalServerRoute[] {
  if (!Array.isArray(routes)) return []
  const normalized = new Map<string, BrowserLocalServerRoute>()
  for (const route of routes) {
    if (!route || typeof route !== 'object') continue
    const serverUrl = normalizeLocalBrowserUrl(route.serverUrl)
    const url = normalizeLocalBrowserUrl(route.url)
    if (!serverUrl || !url) continue
    normalized.set(url, {
      serverUrl,
      url,
      title: typeof route.title === 'string' ? route.title : null,
      source: route.source === 'history' || route.source === 'manual' ? route.source : 'provider'
    })
  }
  return [...normalized.values()]
}

function normalizeBrowserHiddenLocalServerRoutes(routes: string[] | null | undefined): string[] {
  if (!Array.isArray(routes)) return []
  return [...new Set(routes.map(normalizeLocalBrowserUrl).filter((url): url is string => Boolean(url)))].sort()
}

function normalizeLocalBrowserUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const hostname = parsed.hostname
    if (hostname === '0.0.0.0') parsed.hostname = '127.0.0.1'
    else if (!isLoopbackBrowserHostname(hostname)) return null
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function isLoopbackBrowserHostname(hostname: string): boolean {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
}

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_user'
  | 'reconnecting'
  | 'auth_error'
  | 'model_error'
  | 'quota_error'
  | 'rate_limit_error'
  | 'provider_error'
  | 'error'

export type SessionWorktreeState = 'pending' | 'ready' | 'failed'

export type ReviewCheckStatus = 'passing' | 'failing' | 'pending' | 'skipped' | 'unknown'

export interface ReviewPullRequestMetadata {
  number: number
  title?: string
  url?: string | null
  state?: 'open' | 'draft' | 'merged' | 'closed'
  branch?: string
  baseBranch?: string
}

export interface ReviewCheckSummary {
  status: ReviewCheckStatus
  total: number
  passed?: number
  failing?: number
  pending?: number
  skipped?: number
  url?: string | null
}

export interface ReviewReviewerSummary {
  requested?: number
  approved?: number
  changesRequested?: number
  commented?: number
  names?: string[]
  url?: string | null
}

export interface ReviewCommentSummary {
  total: number
  unresolved?: number
  threads?: number
  authors?: string[]
  url?: string | null
}

export interface ReviewProviderComment {
  id: string
  source: 'github'
  path: string
  side: 'old' | 'new'
  startLine?: number
  lineNumber: number
  body: string
  author?: string
  url?: string | null
  resolved?: boolean
  outdated?: boolean
  createdAt?: string
  blame?: ReviewProviderBlame
}

export interface ReviewProviderBlame {
  source: 'github'
  commit?: string
  abbreviatedCommit?: string
  author?: string
  authoredAt?: string
  url?: string | null
}

export interface ReviewMetadata {
  pullRequest?: ReviewPullRequestMetadata
  checks?: ReviewCheckSummary
  reviewers?: ReviewReviewerSummary
  comments?: ReviewCommentSummary
  providerCommentsByPath?: Record<string, ReviewProviderComment[]>
}

export interface Session {
  id: string
  name: string
  pinned?: boolean
  pinOrder?: number
  projectId: string
  workDir: string
  useWorktree: boolean
  worktreeState?: SessionWorktreeState
  repoRoot?: string
  providerSessionId: string | null
  claudeSessionId?: string | null
  status: SessionStatus
  messages: ChatMessage[]
  messageCount?: number
  messagesLoaded?: boolean
  previewText?: string
  latestMessageAt?: number
  forkedFromSessionId?: string
  forkedFromSessionName?: string
  forkedFromMessageId?: string
  forkedAt?: number
  forkMode?: SessionForkMode
  archivedAt?: number
  createdAt: number
  provider: string
  model: string
  effort: SessionEffort
  agentName?: string | null
  permissionMode: SessionPermissionMode
  allowedTools: string[]
  disallowedTools?: string[]
  availableTools?: string[]
  additionalDirs?: string[]
  runtime?: ProviderRuntimeKind
  useThinking?: boolean
  useFast?: boolean
  usageSummary?: UsageSummary
  reviewMetadata?: ReviewMetadata
  providerThreadSource?: SidebarProviderThreadSource
  providerHostId?: string | null
  providerHostLabel?: string | null
  providerWorktreeSourceRoot?: string | null
  providerWorktreeRoot?: string | null
  providerWorktreeHostId?: string | null
  providerWorktreeHostLabel?: string | null
  providerPinned?: boolean
  providerPinOrder?: number
  providerPinnedThreadKey?: string | null
  providerProjectless?: boolean
  providerProjectlessThreadId?: string | null
}

export type SidebarThreadKind = 'local' | 'remote' | 'worktree' | 'pending-worktree'
export type SidebarProviderThreadSource = 'local' | 'remote' | 'cloud' | 'remote-host' | 'worktree'
export type SidebarConnectionGroupKind = 'local' | 'cloud' | 'remote' | 'worktree' | 'pending-worktree'
export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'providers'
  | 'automations'
  | 'worktrees'
  | 'shortcuts'
  | 'personalization'
  | 'browser'
  | 'pets'
  | 'data'
export type SettingsRouteMode = 'path' | 'hash'
export type SettingsContentScope = 'app' | 'host'
export type SettingsHostAdapterState = 'local' | 'app-global' | 'unavailable'

export const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  'general',
  'appearance',
  'providers',
  'shortcuts',
  'personalization',
  'browser',
  'pets',
  'automations',
  'worktrees',
  'data'
]

export interface SettingsRoute {
  section: SettingsSectionId
  hostId: string | null
  mode: SettingsRouteMode
}

export interface SettingsRouteLocationLike {
  protocol?: string
  hostname?: string
  pathname?: string
  search?: string
  hash?: string
}

export type SessionRouteMode = 'path' | 'hash'

export interface SessionRoute {
  sessionId: string
  mode: SessionRouteMode
}

export type OrchestratorDeepLinkNavigation =
  | { kind: 'session'; sessionId: string }
  | { kind: 'settings'; section: SettingsSectionId; hostId: string | null }
export type SettingsNavigationGroupId = 'app' | 'host'

export interface SettingsNavigationGroupDefinition {
  id: SettingsNavigationGroupId
  label: string
  sections: SettingsSectionId[]
}

export const SETTINGS_NAVIGATION_GROUP_DEFINITIONS: SettingsNavigationGroupDefinition[] = [
  {
    id: 'app',
    label: 'App',
    sections: ['general', 'appearance', 'providers', 'pets']
  },
  {
    id: 'host',
    label: 'Host',
    sections: ['automations', 'worktrees', 'shortcuts', 'personalization', 'browser', 'data']
  }
]

const REMOTE_HOST_VISIBLE_SETTINGS_SECTIONS = new Set<SettingsSectionId>([
  'general',
  'appearance',
  'providers',
  'shortcuts',
  'personalization',
  'pets'
])

export interface SidebarConnectionGroupIdentity {
  key: string
  kind: SidebarConnectionGroupKind
  providerId: string
  label: string
  threadKind: SidebarThreadKind
  order: number
}

export interface SettingsHostOption {
  id: string
  kind: 'local' | 'remote'
  providerId: string | null
  label: string
  hostId: string | null
}

export function settingsHostOptionsFromSessions(
  sessions: ReadonlyArray<Pick<Session, 'provider' | 'providerHostId' | 'providerHostLabel' | 'providerWorktreeHostId' | 'providerWorktreeHostLabel'>>
): SettingsHostOption[] {
  const hosts = new Map<string, SettingsHostOption>()
  for (const session of sessions) {
    const providerId = session.provider || 'unknown'
    const providerName = PROVIDER_DEFS[providerId]?.name ?? providerId
    const addHost = (hostId: string | null | undefined, label: string | null | undefined): void => {
      const normalizedHostId = hostId?.trim()
      if (!normalizedHostId || normalizedHostId === 'local') return
      const key = `${providerId}:${normalizedHostId}`
      if (hosts.has(key)) return
      hosts.set(key, {
        id: key,
        kind: 'remote',
        providerId,
        hostId: normalizedHostId,
        label: label?.trim() || `${providerName} ${normalizedHostId}`
      })
    }
    addHost(session.providerHostId, session.providerHostLabel)
    addHost(session.providerWorktreeHostId, session.providerWorktreeHostLabel ?? session.providerHostLabel)
  }
  return [
    { id: 'local', kind: 'local', providerId: null, hostId: 'local', label: 'Local' },
    ...[...hosts.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  ]
}

export function normalizeSettingsHostId(hostId: string | null | undefined, hosts: readonly SettingsHostOption[]): string {
  if (!hostId || hostId === 'local') return 'local'
  return hosts.some((host) => host.id === hostId) ? hostId : 'local'
}

export function isSettingsSectionVisibleForHostKind(section: SettingsSectionId, hostKind: SettingsHostOption['kind']): boolean {
  if (hostKind === 'local') return true
  return REMOTE_HOST_VISIBLE_SETTINGS_SECTIONS.has(section)
}

export function normalizeSettingsSectionForHostKind(section: SettingsSectionId, hostKind: SettingsHostOption['kind']): SettingsSectionId {
  return isSettingsSectionVisibleForHostKind(section, hostKind) ? section : 'general'
}

export function settingsNavigationGroupsForHostKind(hostKind: SettingsHostOption['kind']): SettingsNavigationGroupDefinition[] {
  return SETTINGS_NAVIGATION_GROUP_DEFINITIONS
    .map((group) => ({
      ...group,
      sections: group.sections.filter((section) => isSettingsSectionVisibleForHostKind(section, hostKind))
    }))
    .filter((group) => group.sections.length > 0)
}

export function settingsSectionScope(section: SettingsSectionId): SettingsContentScope {
  return section === 'general' || section === 'appearance' || section === 'providers' || section === 'pets'
    ? 'app'
    : 'host'
}

export function settingsHostAdapterState(
  section: SettingsSectionId,
  hostKind: SettingsHostOption['kind']
): SettingsHostAdapterState {
  if (section === 'personalization') return hostKind === 'remote' ? 'unavailable' : 'local'
  if (settingsSectionScope(section) === 'app') return hostKind === 'remote' ? 'app-global' : 'local'
  return hostKind === 'remote' ? 'unavailable' : 'local'
}

export function settingsRoutePath(section: SettingsSectionId, hostId?: string | null): string {
  const query = settingsRouteQuery(hostId)
  return `/settings/${section}${query}`
}

export function settingsRouteHash(section: SettingsSectionId, hostId?: string | null): string {
  const query = settingsRouteQuery(hostId)
  return `#/settings/${section}${query}`
}

export function settingsRouteUrlForLocation(section: SettingsSectionId, hostId: string | null | undefined, location: SettingsRouteLocationLike): string {
  return supportsSettingsPathRoutes(location) ? settingsRoutePath(section, hostId) : settingsRouteHash(section, hostId)
}

export function sessionRoutePath(sessionId: string): string {
  return `/threads/${encodeURIComponent(sessionId)}`
}

export function sessionRouteHash(sessionId: string): string {
  return `#/threads/${encodeURIComponent(sessionId)}`
}

export function sessionRouteUrlForLocation(sessionId: string, location: SettingsRouteLocationLike): string {
  return supportsSettingsPathRoutes(location) ? sessionRoutePath(sessionId) : sessionRouteHash(sessionId)
}

export function settingsRouteExitUrl(mode: SettingsRouteMode): string {
  return mode === 'path' ? '/' : '#/'
}

export function parseSessionRouteLocation(location: SettingsRouteLocationLike): SessionRoute | null {
  const hashRoute = parseSessionHashRoute(location.hash ?? '')
  if (hashRoute) return hashRoute
  return parseSessionPathRoute(location.pathname ?? '')
}

export function parseSettingsRouteLocation(location: SettingsRouteLocationLike): SettingsRoute | null {
  const hashRoute = parseSettingsHashRoute(location.hash ?? '')
  if (hashRoute) return hashRoute
  return parseSettingsPathRoute(location.pathname ?? '', location.search ?? '')
}

export function settingsDeepLinkUrl(section: SettingsSectionId, hostId?: string | null): string {
  const query = settingsRouteQuery(hostId)
  return `orchestrator://settings/${section}${query}`
}

export function parseOrchestratorDeepLink(rawUrl: string, protocol = 'orchestrator'): OrchestratorDeepLinkNavigation | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== `${protocol}:`) return null
    const route = parsed.hostname
    if (route === 'threads' || route === 'sessions') {
      const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).trim()
      return id.length > 0 ? { kind: 'session', sessionId: id } : null
    }
    if (route === 'settings') {
      const sectionSlug = parsed.pathname.split('/').filter(Boolean)[0]
      return {
        kind: 'settings',
        section: normalizeSettingsSectionId(sectionSlug),
        hostId: parsed.searchParams.get('host')
      }
    }
    return null
  } catch {
    return null
  }
}

function settingsRouteQuery(hostId?: string | null): string {
  if (!hostId || hostId === 'local') return ''
  const params = new URLSearchParams()
  params.set('host', hostId)
  return `?${params.toString()}`
}

function supportsSettingsPathRoutes(location: SettingsRouteLocationLike): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:' || location.protocol === 'orchestrator-app:'
}

function parseSessionHashRoute(hash: string): SessionRoute | null {
  if (!hash.startsWith('#/threads') && !hash.startsWith('#/sessions')) return null
  const raw = hash.slice(1)
  const [path] = raw.split('?')
  const [, root, encodedSessionId] = path.split('/')
  if (root !== 'threads' && root !== 'sessions') return null
  const sessionId = decodeRouteSegment(encodedSessionId)
  return sessionId.length > 0 ? { sessionId, mode: 'hash' } : null
}

function parseSessionPathRoute(pathname: string): SessionRoute | null {
  const [, root, encodedSessionId] = pathname.split('/')
  if (root !== 'threads' && root !== 'sessions') return null
  const sessionId = decodeRouteSegment(encodedSessionId)
  return sessionId.length > 0 ? { sessionId, mode: 'path' } : null
}

function parseSettingsHashRoute(hash: string): SettingsRoute | null {
  if (!hash.startsWith('#/settings')) return null
  const raw = hash.slice(1)
  const [path, query = ''] = raw.split('?')
  const [, root, sectionSlug] = path.split('/')
  if (root !== 'settings') return null
  return {
    section: normalizeSettingsSectionId(sectionSlug),
    hostId: new URLSearchParams(query).get('host'),
    mode: 'hash'
  }
}

function decodeRouteSegment(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return value.trim()
  }
}

function parseSettingsPathRoute(pathname: string, search: string): SettingsRoute | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'settings') return null
  return {
    section: normalizeSettingsSectionId(segments[1]),
    hostId: new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('host'),
    mode: 'path'
  }
}

function normalizeSettingsSectionId(sectionSlug: string | undefined): SettingsSectionId {
  return SETTINGS_SECTION_IDS.includes(sectionSlug as SettingsSectionId)
    ? sectionSlug as SettingsSectionId
    : 'general'
}

export function isSidebarProjectlessSession(
  session: Pick<Session, 'projectId' | 'providerProjectless' | 'providerProjectlessThreadId'>,
  knownProjectIds?: ReadonlySet<string> | string[]
): boolean {
  if (session.providerProjectless === true || Boolean(session.providerProjectlessThreadId)) return true
  if (!session.projectId) return true
  if (!knownProjectIds) return false
  const projectIds = Array.isArray(knownProjectIds) ? new Set(knownProjectIds) : knownProjectIds
  return !projectIds.has(session.projectId)
}

export function sidebarThreadKind(session: Pick<Session, 'providerSessionId' | 'status' | 'useWorktree' | 'worktreeState'>): SidebarThreadKind {
  if (session.useWorktree && (session.worktreeState === 'pending' || session.worktreeState === 'failed' || session.status === 'reconnecting')) return 'pending-worktree'
  if (session.useWorktree) return 'worktree'
  if (session.providerSessionId) return 'remote'
  return 'local'
}

export function sidebarConnectionGroupIdentity(session: Pick<Session, 'provider' | 'providerSessionId' | 'status' | 'useWorktree' | 'worktreeState' | 'providerThreadSource' | 'providerHostId' | 'providerHostLabel' | 'providerWorktreeHostId' | 'providerWorktreeHostLabel'>): SidebarConnectionGroupIdentity {
  const threadKind = sidebarThreadKind(session)
  const providerId = session.provider || 'unknown'
  const providerName = PROVIDER_DEFS[providerId]?.name ?? providerId
  const worktreeHostId = session.providerWorktreeHostId?.trim() || ''
  const worktreeHostLabel = session.providerWorktreeHostLabel?.trim() || session.providerHostLabel?.trim() || ''
  switch (threadKind) {
    case 'pending-worktree':
      if (worktreeHostId && worktreeHostId !== 'local') {
        return {
          key: `pending-worktree:${providerId}:${worktreeHostId}`,
          kind: 'pending-worktree',
          providerId,
          label: `${worktreeHostLabel || worktreeHostId} pending worktrees`,
          threadKind,
          order: 40
        }
      }
      return {
        key: `pending-worktree:${providerId}`,
        kind: 'pending-worktree',
        providerId,
        label: `${providerName} pending worktrees`,
        threadKind,
        order: 40
      }
    case 'worktree':
      if (worktreeHostId && worktreeHostId !== 'local') {
        return {
          key: `worktree:${providerId}:${worktreeHostId}`,
          kind: 'worktree',
          providerId,
          label: `${worktreeHostLabel || worktreeHostId} worktrees`,
          threadKind,
          order: 30
        }
      }
      return {
        key: `worktree:${providerId}`,
        kind: 'worktree',
        providerId,
        label: `${providerName} worktrees`,
        threadKind,
        order: 30
      }
    case 'remote':
      if (session.providerThreadSource === 'cloud') {
        return {
          key: `cloud:${providerId}`,
          kind: 'cloud',
          providerId,
          label: `${providerName} cloud`,
          threadKind,
          order: 20
        }
      }
      if (session.providerHostId && session.providerHostId !== 'local') {
        return {
          key: `host:${providerId}:${session.providerHostId}`,
          kind: 'remote',
          providerId,
          label: session.providerHostLabel?.trim() || `${providerName} ${session.providerHostId}`,
          threadKind,
          order: 25
        }
      }
      return {
        key: `remote:${providerId}`,
        kind: 'remote',
        providerId,
        label: `${providerName} remote`,
        threadKind,
        order: 20
      }
    case 'local':
      return {
        key: `local:${providerId}`,
        kind: 'local',
        providerId,
        label: `${providerName} local`,
        threadKind,
        order: 10
      }
  }
}

export type AutomationKind = 'heartbeat' | 'cron'
export type AutomationStatus = 'ACTIVE' | 'PAUSED' | 'DELETED'

export interface AutomationTarget {
  type: 'session'
  sessionId: string
}

export interface AutomationSchedule {
  mode: 'manual' | 'interval' | 'rrule'
  intervalMinutes?: number
  rrule?: string | null
}

export interface AutomationPermissionSnapshot {
  executionPolicy?: string | null
  approvalPolicy?: string | null
  approvalsReviewer?: string | null
  sandboxPolicy?: string | null
  allowedTools?: string[]
  disallowedTools?: string[]
}

export interface Automation {
  id: string
  kind: AutomationKind
  name: string
  prompt: string
  status: AutomationStatus
  target: AutomationTarget
  schedule: AutomationSchedule
  createdAt: number
  updatedAt: number
  lastRunAt?: number | null
  nextRunAt?: number | null
  permissionSnapshot?: AutomationPermissionSnapshot | null
}

export interface AutomationUpsertRequest {
  id?: string | null
  kind?: AutomationKind
  name: string
  prompt?: string
  status?: AutomationStatus
  target: AutomationTarget
  schedule?: AutomationSchedule
  permissionSnapshot?: AutomationPermissionSnapshot | null
}

export type AutomationRunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'
export type AutomationRunTrigger = 'schedule' | 'manual'
export type AutomationEligibilityReason =
  | 'missing_session'
  | 'unsupported_host'
  | 'turn_in_progress'
  | 'waiting_on_user_input'
  | 'waiting_on_approval'
  | 'pending_request'
  | 'not_active'
  | 'not_scheduled'

export interface AutomationEligibilityResult {
  isEligible: boolean
  reason?: AutomationEligibilityReason | string | null
}

export interface AutomationRun {
  id: string
  automationId: string
  status: AutomationRunStatus
  trigger: AutomationRunTrigger
  scheduledFor: number | null
  startedAt: number
  completedAt?: number | null
  error?: string | null
}

export interface WorktreeConversationSummary {
  id: string
  name: string
  status: SessionStatus
  provider: string
  worktreeState?: SessionWorktreeState
  updatedAt: number
}

export interface WorktreeInventoryItem {
  id: string
  repoRoot: string | null
  workDir: string
  state: SessionWorktreeState
  managed: boolean
  ownerSessionId: string | null
  conversationCount: number
  conversations: WorktreeConversationSummary[]
  updatedAt: number
}

export function applyAutomationPermissionSnapshot(
  request: RunRequest,
  snapshot?: AutomationPermissionSnapshot | null
): RunRequest {
  if (!snapshot) return request
  return {
    ...request,
    executionPolicy: snapshot.executionPolicy ?? request.executionPolicy,
    allowedTools: Array.isArray(snapshot.allowedTools) ? snapshot.allowedTools : request.allowedTools,
    disallowedTools: Array.isArray(snapshot.disallowedTools) ? snapshot.disallowedTools : request.disallowedTools
  }
}

export type SessionForkMode = 'local' | 'same-worktree' | 'new-worktree'

export interface SessionForkOptions {
  throughMessageId?: string
}

export interface SessionListItem extends Session {
  messageCount: number
  messagesLoaded: boolean
  previewText?: string
  latestMessageAt?: number
}

export interface TranscriptPageRequest {
  limit?: number
  beforeMessageId?: string
  afterMessageId?: string
  aroundMessageId?: string
}

export interface TranscriptPage {
  sessionId: string
  messages: ChatMessage[]
  messageCount: number
  pageStartIndex: number
  pageEndIndex: number
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  beforeCursor?: string
  afterCursor?: string
}

export interface TranscriptSearchResult {
  sessionId: string
  messageId: string
  messageIndex: number
  role: ChatMessage['role']
  type: ChatMessage['type']
  timestamp: number
  snippet: string
}

export interface PerformanceMetric {
  id: string
  name: string
  startedAt: number
  durationMs: number
  surface: 'main' | 'renderer' | 'smoke' | 'release'
  metadata?: Record<string, string | number | boolean | null>
}

export interface PerformanceMetricSummary {
  name: string
  count: number
  latestMs: number
  averageMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

export interface PerformanceSnapshot {
  metrics: PerformanceMetric[]
  summaries: PerformanceMetricSummary[]
}

export interface ProviderManifest {
  id: string
  name: string
  runtimes: ProviderRuntimeKind[]
  defaultRuntime: ProviderRuntimeKind
  statusLifecycle: SessionStatus[]
  capabilityKeys: ProviderCapability['key'][]
  customStates: string[]
}

export interface DesignSystemContract {
  version: number
  motionTokens: string[]
  requiredPrimitives: string[]
  codexParitySurfaces: string[]
  reducedMotionSelectors: string[]
}

export interface SessionRunEventRecord {
  id: string
  timestamp: number
  event: RunEvent
}

export interface FileChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'
  indexStatus?: 'M' | 'A' | 'D' | 'R' | 'C' | '?' | 'U' | ' '
  worktreeStatus?: 'M' | 'A' | 'D' | 'R' | 'C' | '?' | 'U' | ' '
  staged?: boolean
  unstaged?: boolean
  conflicted?: boolean
  conflictStatus?: string
  additions: number
  deletions: number
}

export type ReviewDiffSource = 'all' | 'unstaged' | 'staged' | 'branch' | 'commit' | 'last-turn' | 'cloud' | 'local' | 'worktree'

export interface GitPathActionResult {
  ok: boolean
  paths: string[]
  changedFiles: FileChange[]
  discarded?: boolean
  error?: string
}

export interface GitCommitResult {
  ok: boolean
  changedFiles: FileChange[]
  commit?: string
  message?: string
  error?: string
}

export interface GitBranchActionResult {
  ok: boolean
  branchName?: string
  currentBranch?: string | null
  branches: GitRefOption[]
  error?: string
}

export interface GitPullRequestCreateUrlResult {
  ok: boolean
  url?: string
  remoteUrl?: string
  baseBranch?: string
  headBranch?: string
  error?: string
}

export interface GitLineBlameResult {
  ok: boolean
  path: string
  line: number
  commit?: string
  author?: string
  authorTime?: number
  summary?: string
  error?: string
}

export interface GitRefOption {
  name: string
  label: string
  description?: string
  current?: boolean
}

export type ChatMessage =
  | TextMessage
  | ToolUseMessage
  | ToolResultMessage
  | ResultMessage

interface BaseMessage {
  id: string
  timestamp: number
}

export interface TextMessage extends BaseMessage {
  role: 'user' | 'assistant' | 'system'
  type: 'text'
  content: string
  isStreaming?: boolean
  interrupted?: boolean
  queueState?: 'queued' | 'steer_next'
  attachments?: Attachment[]
}

export function finalizeInterruptedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.type !== 'text') return message
    if (!message.isStreaming && !message.queueState) return message
    const settledMessage: TextMessage = {
      ...message,
      isStreaming: false,
      queueState: undefined
    }
    if (message.role === 'assistant' && message.isStreaming) {
      settledMessage.interrupted = true
    }
    return settledMessage
  })
}

export interface ToolUseMessage extends BaseMessage {
  role: 'assistant'
  type: 'tool_use'
  toolName: string
  toolInput: Record<string, unknown>
}

export interface ToolResultMessage extends BaseMessage {
  role: 'tool'
  type: 'tool_result'
  toolUseId: string
  content: string
  isError: boolean
}

export interface PermissionDenial {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

export interface UserInputOption {
  label: string
  description?: string
}

export interface UserInputQuestion {
  id?: string
  question: string
  header?: string
  options?: UserInputOption[]
  multiSelect?: boolean
  isOther?: boolean
  isSecret?: boolean
}

export interface UserInputAnswerPayload {
  content: string
  displayContent?: string
  answers?: Record<string, string[]>
}

export interface ResultMessage extends BaseMessage {
  role: 'system'
  type: 'result'
  content: string
  subtype: 'success' | 'error_during_execution' | string
  permissionDenials?: PermissionDenial[]
  permissionDecision?: 'allowed_once' | 'allowed_session' | 'denied' | 'kept_planning'
  userInputQuestions?: UserInputQuestion[]
  usageSummary?: UsageSummary
}

export interface ClaudeStreamEvent {
  type: 'system' | 'assistant' | 'user' | 'result'
  subtype?: string
  session_id?: string
  model?: string
  cwd?: string
  message?: {
    role: string
    content: ContentBlock[]
  }
  result?: string
  error?: string
  permission_denials?: PermissionDenial[]
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | ContentBlock[]
  is_error?: boolean
}

export type {
  PermissionRequestDetail,
  PermissionRequestField,
  PermissionRequestKind,
  ToolActionDescriptor,
  ToolActionKind,
  ToolActionRisk,
  ToolActivity
} from './toolActions'
export {
  describeToolAction,
  describeToolActivity,
  pairToolActivities,
  permissionRequestDetail,
  permissionSummary,
  summarizeToolActivities,
  toolTarget
} from './toolActions'
export {
  APP_SLASH_COMMANDS,
  availableSlashCommands,
  expandSlashCommandPrompt,
  getSlashQuery
} from './slashCommands'
export type {
  SlashPaletteCommand,
  SlashPaletteGroup
} from './slashCommands'
export {
  agentDepth,
  deriveAgentNodes,
  deriveAgentNodesFromMessages,
  derivePlanStates,
  derivePlanStatesFromMessages,
  eventCounts,
  isAgentTool
} from './activityView'
export type {
  FileChangeSummary,
  FileChangeTreeRow
} from './fileChanges'
export {
  adjacentFileChangePath,
  buildFileChangeTreeRows,
  fileStatusLabel,
  summarizeFileChanges
} from './fileChanges'
export {
  isBinaryDiffText,
  shouldPreferTextDiff
} from './reviewPreview'
export {
  diffForPathFromUnifiedDiff,
  parseFileChangesFromUnifiedDiff,
  resolveReviewDiffRenderWindow,
  REVIEW_LARGE_DIFF_CHANGED_BYTE_THRESHOLD,
  REVIEW_LARGE_DIFF_CHANGED_LINE_THRESHOLD,
  REVIEW_LARGE_DIFF_INITIAL_LINE_COUNT,
  REVIEW_LARGE_DIFF_LINE_THRESHOLD,
  REVIEW_LARGE_DIFF_MAX_CHANGED_LINE_BYTES
} from './reviewDiff'
export {
  ORCHESTRATOR_BROWSER_WEBVIEW_PARTITION_PREFIX,
  browserWebviewPartitionForHost,
  isOrchestratorBrowserWebviewPartition
} from './browserPartition'
export {
  applyCodexThreadListMetadata,
  codexThreadListItems
} from './providerThreadMetadata'
export type {
  ProviderThreadMetadataApplyOptions,
  ProviderThreadMetadataSession,
  ProviderThreadSourceProjection
} from './providerThreadMetadata'
export type {
  FileReference
} from './fileReferences'
export {
  extractFileReferences,
  extractWorkspaceRootsFromText
} from './fileReferences'
export {
  canStopSession,
  getComposerSendState
} from './sessionControls'
export type {
  ComposerSendState
} from './sessionControls'
export {
  BOTTOM_PANEL_TRANSFER_TAB_KINDS,
  bottomPanelTransferPolicyLabel,
  canCloseBottomPanelTab,
  closePanelTab,
  filePanelTabId,
  isBottomPanelTransferTabKind,
  movePanelTabByDirection,
  parseFilePanelTabId,
  pinPanelTab,
  reorderPanelTab,
  resolvePanelBrowserCommandTarget,
  resolvePanelCloseTarget,
  resolvePanelFindTarget,
  resolvePanelNewTabTarget,
  resolvePanelTabTransferAvailability,
  resetPanelTabSet,
  transferPanelTab,
  upsertPanelTab
} from './panelTabs'
export type {
  PanelCloseAvailability,
  PanelCloseFocusArea,
  PanelCloseTarget,
  PanelBrowserCommandAvailability,
  PanelBrowserCommandTarget,
  BottomPanelTransferTabKind,
  PanelFindAvailability,
  PanelFindTarget,
  PanelNewTabAvailability,
  PanelNewTabTarget,
  FilePanelTabIdentity,
  PanelTabId,
  PanelTabRecord,
  PanelTabSet,
  PanelTabTransferAvailability,
  PanelTabTransferPanelId,
  PanelTabTransferResult
} from './panelTabs'
export {
  compareSidebarSessions,
  applyProviderPinnedThreadState,
  comparePinnedSessions,
  ensurePinnedSessionOrders,
  isSidebarPinnedSession,
  normalizeProviderPinnedThreadKey,
  providerPinnedThreadKeyForSession,
  nextPinOrder,
  reorderPinnedSessions
} from './sessionOrdering'
export {
  moveSidebarSectionKey,
  orderProjectlessSidebarGroups
} from './sidebarLayout'
export {
  moveSessionToSidebarCustomSection
} from './sidebarCustomSections'
export {
  artifactImportKindForPath,
  artifactImportKindSupportsSource,
  artifactTabPresentationForPath
} from './artifactTabs'
export {
  DEFAULT_BROWSER_USE_POLICY,
  normalizeBrowserUseApprovalMode,
  normalizeBrowserUseOrigin,
  normalizeBrowserUseOrigins,
  normalizeBrowserUsePolicy
} from './browserUsePolicy'
export type {
  PinOrderedSession,
  ProviderPinnedThreadKeyKind,
  ProviderPinnedThreadState,
  SidebarSessionOrderOptions,
  SidebarSessionSortMode
} from './sessionOrdering'
export type {
  ArtifactImportKind,
  ArtifactTabPresentation,
  ArtifactType
} from './artifactTabs'
export type {
  BrowserUseApprovalMode,
  BrowserUsePolicy
} from './browserUsePolicy'
export type {
  OrderedSidebarProjectGroup
} from './sidebarLayout'
export type {
  SidebarCustomSectionLike
} from './sidebarCustomSections'
