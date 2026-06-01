export type Appearance = 'system' | 'mist' | 'graphite' | 'ocean' | 'palenight' | 'high-contrast' | 'dark' | 'light'
export type Accent = 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system' | 'custom'
export type Density = 'comfortable' | 'compact'
export type TranscriptStyle = 'relaxed' | 'dense'
export type AppearanceTheme = 'light' | 'dark' | 'system'

export interface ChromeTheme {
  accent: string
  surface: string
  ink: string
  contrast: number
  opaqueWindows: boolean
  fonts?: {
    ui?: string
    code?: string
  }
  semanticColors?: {
    diffAdded?: string
    diffRemoved?: string
    skill?: string
  }
}

export interface AppearanceModelV2 {
  appearanceTheme?: AppearanceTheme
  appearanceLightChromeTheme?: ChromeTheme
  appearanceDarkChromeTheme?: ChromeTheme
  appearanceLightCodeThemeId?: string
  appearanceDarkCodeThemeId?: string
  sansFontSize?: number
  codeFontSize?: number
  useFontSmoothing?: boolean
  usePointerCursors?: boolean
  useTransparentSidebar?: boolean
  reduceMotion?: boolean
}

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
  monoFont = 'system',
  appearanceModel?: AppearanceModelV2
): void {
  const resolvedVariant = resolveAppearanceTheme(appearanceModel?.appearanceTheme, appearance)
  const chromeTheme = resolvedVariant === 'mist'
    ? appearanceModel?.appearanceLightChromeTheme
    : appearanceModel?.appearanceDarkChromeTheme
  const root = document.documentElement
  const forcedReducedMotion = root.dataset.forcedReducedMotion === 'true' || root.dataset.reducedMotion === 'true'
  root.dataset.theme = resolvedVariant
  root.dataset.appearanceTheme = appearanceModel?.appearanceTheme ?? legacyAppearanceTheme(appearance)
  root.dataset.accent = accent === 'system' ? 'blue' : accent
  root.dataset.density = density
  root.dataset.sidebarTint = sidebarTint ? 'on' : 'off'
  root.dataset.sidebarTransparency = appearanceModel?.useTransparentSidebar === false ? 'off' : 'on'
  root.dataset.transcript = transcriptStyle
  root.dataset.pointerCursors = appearanceModel?.usePointerCursors === false ? 'off' : 'on'
  root.dataset.fontSmoothing = appearanceModel?.useFontSmoothing === false ? 'off' : 'on'
  root.dataset.reducedMotion = forcedReducedMotion || appearanceModel?.reduceMotion ? 'true' : 'false'
  root.dataset.codeTheme = resolvedVariant === 'mist'
    ? appearanceModel?.appearanceLightCodeThemeId ?? 'github-light'
    : appearanceModel?.appearanceDarkCodeThemeId ?? 'github-dark'
  root.style.setProperty('--custom-accent', sanitizeHex(chromeTheme?.accent ?? customAccent, '#0a7cff'))
  root.style.setProperty('--interface-scale', String(clamp(interfaceScale, 0.9, 1.12)))
  root.style.setProperty('--font-ui-custom', fontStack(chromeTheme?.fonts?.ui ?? uiFont, 'ui'))
  root.style.setProperty('--font-mono-custom', fontStack(chromeTheme?.fonts?.code ?? monoFont, 'mono'))
  root.style.setProperty('--font-ui-size', `${clamp(appearanceModel?.sansFontSize ?? 13, 11, 18)}px`)
  root.style.setProperty('--font-code-size', `${clamp(appearanceModel?.codeFontSize ?? 13, 11, 18)}px`)
  applyChromeTheme(chromeTheme)
}

function resolveAppearanceTheme(theme: AppearanceTheme | undefined, fallback: Appearance): 'mist' | 'graphite' {
  const resolved = theme ?? legacyAppearanceTheme(fallback)
  if (resolved === 'light') return 'mist'
  if (resolved === 'dark') return 'graphite'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'mist' : 'graphite'
}

function legacyAppearanceTheme(appearance: Appearance): AppearanceTheme {
  if (appearance === 'mist' || appearance === 'light') return 'light'
  if (appearance === 'graphite' || appearance === 'dark' || appearance === 'ocean' || appearance === 'palenight' || appearance === 'high-contrast') return 'dark'
  return 'system'
}

function applyChromeTheme(theme?: ChromeTheme): void {
  if (!theme) return
  const accent = sanitizeHex(theme.accent, '#0a7cff')
  const surface = sanitizeHex(theme.surface, '#ffffff')
  const ink = sanitizeHex(theme.ink, '#111111')
  const contrast = clamp(theme.contrast, 0, 100)
  const borderAlpha = 0.06 + (contrast / 100) * 0.18
  document.documentElement.style.setProperty('--accent', accent)
  document.documentElement.style.setProperty('--surface-bg', surface)
  document.documentElement.style.setProperty('--canvas-bg', surface)
  document.documentElement.style.setProperty('--text-primary', ink)
  document.documentElement.style.setProperty('--border-subtle', colorMix(ink, borderAlpha))
  document.documentElement.style.setProperty('--border-strong', colorMix(ink, Math.min(0.32, borderAlpha + 0.08)))
  document.documentElement.style.setProperty('--accent-bg', colorMix(accent, 0.14))
  document.documentElement.style.setProperty('--state-success', sanitizeHex(theme.semanticColors?.diffAdded ?? '', getComputedStyle(document.documentElement).getPropertyValue('--state-success').trim() || '#13a355'))
  document.documentElement.style.setProperty('--state-danger', sanitizeHex(theme.semanticColors?.diffRemoved ?? '', getComputedStyle(document.documentElement).getPropertyValue('--state-danger').trim() || '#dc2f2f'))
}

function colorMix(hex: string, alpha: number): string {
  const safe = sanitizeHex(hex, '#111111')
  const r = Number.parseInt(safe.slice(1, 3), 16)
  const g = Number.parseInt(safe.slice(3, 5), 16)
  const b = Number.parseInt(safe.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
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
