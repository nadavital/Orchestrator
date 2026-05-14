export type Appearance = 'system' | 'mist' | 'graphite' | 'high-contrast' | 'dark' | 'light'
export type Accent = 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system'
export type Density = 'comfortable' | 'compact'
export type TranscriptStyle = 'relaxed' | 'dense'

export function resolveAppearance(appearance: Appearance): 'mist' | 'graphite' | 'high-contrast' {
  if (appearance === 'mist' || appearance === 'light') return 'mist'
  if (appearance === 'graphite' || appearance === 'dark') return 'graphite'
  if (appearance === 'high-contrast') return 'high-contrast'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'mist' : 'graphite'
}

export function applyAppearance(
  appearance: Appearance,
  accent: Accent = 'blue',
  density: Density = 'comfortable',
  sidebarTint = true,
  transcriptStyle: TranscriptStyle = 'relaxed'
): void {
  document.documentElement.dataset.theme = resolveAppearance(appearance)
  document.documentElement.dataset.accent = accent === 'system' ? 'blue' : accent
  document.documentElement.dataset.density = density
  document.documentElement.dataset.sidebarTint = sidebarTint ? 'on' : 'off'
  document.documentElement.dataset.transcript = transcriptStyle
}
