export type Appearance = 'system' | 'mist' | 'graphite' | 'ocean' | 'palenight' | 'high-contrast' | 'dark' | 'light'
export type Accent = 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system' | 'custom'
export type Density = 'comfortable' | 'compact'
export type TranscriptStyle = 'relaxed' | 'dense'

export function resolveAppearance(appearance: Appearance): 'mist' | 'graphite' | 'ocean' | 'palenight' | 'high-contrast' {
  if (appearance === 'mist' || appearance === 'light') return 'mist'
  if (appearance === 'graphite' || appearance === 'dark') return 'graphite'
  if (appearance === 'ocean') return 'ocean'
  if (appearance === 'palenight') return 'palenight'
  if (appearance === 'high-contrast') return 'high-contrast'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'mist' : 'graphite'
}

export function applyAppearance(
  appearance: Appearance,
  accent: Accent = 'blue',
  density: Density = 'comfortable',
  sidebarTint = true,
  transcriptStyle: TranscriptStyle = 'relaxed',
  customAccent = '#0a7cff',
  interfaceScale = 1,
  uiFont = 'system',
  monoFont = 'system'
): void {
  document.documentElement.dataset.theme = resolveAppearance(appearance)
  document.documentElement.dataset.accent = accent === 'system' ? 'blue' : accent
  document.documentElement.dataset.density = density
  document.documentElement.dataset.sidebarTint = sidebarTint ? 'on' : 'off'
  document.documentElement.dataset.transcript = transcriptStyle
  document.documentElement.style.setProperty('--custom-accent', sanitizeHex(customAccent, '#0a7cff'))
  document.documentElement.style.setProperty('--interface-scale', String(clamp(interfaceScale, 0.9, 1.12)))
  document.documentElement.style.setProperty('--font-ui-custom', fontStack(uiFont, 'ui'))
  document.documentElement.style.setProperty('--font-mono-custom', fontStack(monoFont, 'mono'))
}

function sanitizeHex(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(min, Math.min(max, value))
}

function fontStack(value: string, kind: 'ui' | 'mono'): string {
  if (value === 'rounded') return "'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
  if (value === 'serif') return "New York, 'Iowan Old Style', Georgia, serif"
  if (value === 'mono') return "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
  if (kind === 'mono') return "'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace"
  return "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
}
