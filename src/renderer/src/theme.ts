export type Appearance = 'system' | 'dark' | 'light'

export function resolveAppearance(appearance: Appearance): 'dark' | 'light' {
  if (appearance !== 'system') return appearance
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.theme = resolveAppearance(appearance)
}
