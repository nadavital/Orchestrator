export interface PortableChromeTheme {
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

export interface PortableTheme {
  variant: 'light' | 'dark'
  codeThemeId: string
  theme: PortableChromeTheme
}

export type PortableThemeParseResult =
  | { ok: true; value: PortableTheme }
  | { ok: false; error: string }

const PORTABLE_THEME_PREFIX = 'codex-theme-v1:'

export function serializePortableTheme(
  variant: 'light' | 'dark',
  theme: PortableChromeTheme,
  codeThemeId: string
): string {
  return `${PORTABLE_THEME_PREFIX}${JSON.stringify({ variant, codeThemeId, theme })}`
}

export function parsePortableTheme(raw: string): PortableThemeParseResult {
  const trimmed = raw.trim()
  if (!trimmed.startsWith(PORTABLE_THEME_PREFIX)) {
    return { ok: false, error: `Theme must start with ${PORTABLE_THEME_PREFIX}` }
  }

  try {
    const parsed = JSON.parse(trimmed.slice(PORTABLE_THEME_PREFIX.length)) as Partial<PortableTheme>
    if (parsed.variant !== 'light' && parsed.variant !== 'dark') {
      return { ok: false, error: 'Theme variant must be light or dark' }
    }
    if (!parsed.theme || typeof parsed.theme !== 'object') {
      return { ok: false, error: 'Theme payload is missing' }
    }

    const theme = normalizeImportedChromeTheme(parsed.theme)
    if (!theme) {
      return { ok: false, error: 'Theme colors must be #RRGGBB and contrast must be 0-100' }
    }

    return {
      ok: true,
      value: {
        variant: parsed.variant,
        codeThemeId: typeof parsed.codeThemeId === 'string' && parsed.codeThemeId.trim()
          ? parsed.codeThemeId
          : defaultCodeThemeId(parsed.variant),
        theme
      }
    }
  } catch {
    return { ok: false, error: 'Theme JSON is invalid' }
  }
}

function normalizeImportedChromeTheme(value: unknown): PortableChromeTheme | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<PortableChromeTheme>
  if (!isHexColor(record.accent) || !isHexColor(record.surface) || !isHexColor(record.ink)) return null
  if (typeof record.contrast !== 'number' || record.contrast < 0 || record.contrast > 100) return null
  if (record.semanticColors && typeof record.semanticColors !== 'object') return null

  const semanticColors = normalizeSemanticColors(record.semanticColors)
  if (semanticColors === null) return null

  return {
    accent: record.accent,
    surface: record.surface,
    ink: record.ink,
    contrast: record.contrast,
    opaqueWindows: record.opaqueWindows === true,
    fonts: normalizeFonts(record.fonts),
    semanticColors
  }
}

function normalizeSemanticColors(
  value: PortableChromeTheme['semanticColors'] | undefined
): PortableChromeTheme['semanticColors'] | null {
  if (!value) return undefined
  const semanticColors: PortableChromeTheme['semanticColors'] = {}
  for (const key of ['diffAdded', 'diffRemoved', 'skill'] as const) {
    const color = value[key]
    if (color !== undefined && !isHexColor(color)) return null
    if (color) semanticColors[key] = color
  }
  return Object.keys(semanticColors).length > 0 ? semanticColors : undefined
}

function normalizeFonts(value: PortableChromeTheme['fonts'] | undefined): PortableChromeTheme['fonts'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const fonts: PortableChromeTheme['fonts'] = {}
  if (typeof value.ui === 'string' && value.ui.trim()) fonts.ui = value.ui
  if (typeof value.code === 'string' && value.code.trim()) fonts.code = value.code
  return Object.keys(fonts).length > 0 ? fonts : undefined
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function defaultCodeThemeId(variant: 'light' | 'dark'): string {
  return variant === 'light' ? 'github-light' : 'github-dark'
}
