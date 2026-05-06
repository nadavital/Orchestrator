export interface Project {
  id: string
  name: string
  rootPath: string
  sessionIds: string[]
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
      { id: 'claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
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
    permissionModes: [
      { id: 'default', label: 'Ask', desc: 'Ask before tools', intent: 'ask' },
      { id: 'acceptEdits', label: 'Accept Edits', desc: 'Accept file edits', intent: 'autoEdit' },
      { id: 'plan', label: 'Plan', desc: 'Plan without changes', intent: 'plan' },
      { id: 'bypassPermissions', label: 'Auto', desc: 'Skip prompts', intent: 'bypass' }
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
      { id: 'default', label: 'Workspace', desc: 'Write within workspace', intent: 'workspaceSandbox' },
      { id: 'fullAccess', label: 'Full Access', desc: 'Full filesystem', intent: 'fullAccess' },
      { id: 'yolo', label: 'Auto', desc: 'Bypass prompts', intent: 'bypass' }
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

export interface ProviderCommand {
  binary: string
  args: string[]
}

export interface ProviderCapabilities {
  resume: boolean
  streamingJson: boolean
  interactivePermissions: boolean
  allowedTools: boolean
  workspaceSandbox: boolean
  fullAccessMode: boolean
  forcedAllTools?: boolean
}

export type ProviderCapabilityKey =
  | 'resume'
  | 'structuredOutput'
  | 'streamEvents'
  | 'interactivePermissions'
  | 'toolAllowlist'
  | 'workspaceSandbox'
  | 'fullAccess'
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
  runtime: ProviderRuntimeKind
  handler: 'app-action' | 'send-to-provider' | 'insert-prompt' | 'sdk-command'
  arguments?: Array<{ name: string; optional?: boolean; description?: string }>
  featureId?: string
  prompt?: string
}

export interface ProviderCapabilityRegistry {
  providerId: string
  features: ProviderFeature[]
  probes: ProviderProbeDefinition[]
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
  probes: ProviderProbeResult[]
}

export interface RunRequest {
  prompt: string
  cwd: string
  model: string
  effort: SessionEffort
  providerSessionId: string | null
  executionPolicy: ExecutionPolicy
  allowedTools: string[]
  useThinking?: boolean
  useFast?: boolean
}

export type RunEvent =
  | { type: 'session.started'; providerSessionId: string }
  | { type: 'assistant.text'; content: string }
  | { type: 'tool.started'; id: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'tool.completed'; id: string; toolUseId: string; content: string; isError: boolean }
  | { type: 'permission.requested'; denials: PermissionDenial[]; content?: string }
  | { type: 'user_input.requested'; content: string; questions?: UserInputQuestion[] }
  | { type: 'connection.reconnecting'; attempt?: number; content?: string }
  | { type: 'connection.retrying'; attempt?: number; content?: string }
  | { type: 'run.completed'; content?: string }
  | { type: 'run.failed'; content?: string }

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_user'
  | 'reconnecting'
  | 'auth_error'
  | 'model_error'
  | 'provider_error'
  | 'error'

export interface Session {
  id: string
  name: string
  projectId: string
  workDir: string
  useWorktree: boolean
  repoRoot?: string
  providerSessionId: string | null
  claudeSessionId?: string | null
  status: SessionStatus
  messages: ChatMessage[]
  createdAt: number
  provider: string
  model: string
  effort: SessionEffort
  permissionMode: SessionPermissionMode
  allowedTools: string[]
  useThinking?: boolean
  useFast?: boolean
}

export interface SessionRunEventRecord {
  id: string
  timestamp: number
  event: RunEvent
}

export interface FileChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '?'
  additions: number
  deletions: number
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
  question: string
  header?: string
  options?: UserInputOption[]
  multiSelect?: boolean
}

export interface ResultMessage extends BaseMessage {
  role: 'system'
  type: 'result'
  content: string
  subtype: 'success' | 'error_during_execution' | string
  permissionDenials?: PermissionDenial[]
  userInputQuestions?: UserInputQuestion[]
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
