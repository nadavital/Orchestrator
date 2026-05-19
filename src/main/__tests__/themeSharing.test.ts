import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePortableTheme, serializePortableTheme, type PortableChromeTheme } from '../../types/themeSharing'

const validTheme: PortableChromeTheme = {
  accent: '#0a7cff',
  surface: '#ffffff',
  ink: '#111111',
  contrast: 45,
  opaqueWindows: false,
  fonts: {
    ui: 'rounded',
    code: 'mono'
  },
  semanticColors: {
    diffAdded: '#13a355',
    diffRemoved: '#dc2f2f',
    skill: '#7c3aed'
  }
}

test('portable themes serialize and parse the shared codex-theme schema', () => {
  const raw = serializePortableTheme('light', validTheme, 'github-light')
  const result = parsePortableTheme(raw)

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.value.variant, 'light')
  assert.equal(result.value.codeThemeId, 'github-light')
  assert.deepEqual(result.value.theme, validTheme)
})

test('portable theme parser trims whitespace and defaults missing code themes', () => {
  const result = parsePortableTheme(`\n codex-theme-v1:${JSON.stringify({ variant: 'dark', theme: validTheme })} \n`)

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.value.variant, 'dark')
  assert.equal(result.value.codeThemeId, 'github-dark')
})

test('portable theme parser rejects missing prefixes', () => {
  const result = parsePortableTheme(JSON.stringify({ variant: 'light', theme: validTheme }))

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /codex-theme-v1/)
})

test('portable theme parser rejects invalid variants', () => {
  const result = parsePortableTheme(`codex-theme-v1:${JSON.stringify({ variant: 'system', theme: validTheme })}`)

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /variant/)
})

test('portable theme parser rejects invalid color and contrast values', () => {
  const badColor = parsePortableTheme(
    `codex-theme-v1:${JSON.stringify({ variant: 'light', theme: { ...validTheme, accent: 'blue' } })}`
  )
  const badContrast = parsePortableTheme(
    `codex-theme-v1:${JSON.stringify({ variant: 'light', theme: { ...validTheme, contrast: 101 } })}`
  )

  assert.equal(badColor.ok, false)
  assert.equal(badContrast.ok, false)
})

test('portable theme parser rejects invalid semantic colors', () => {
  const result = parsePortableTheme(
    `codex-theme-v1:${JSON.stringify({
      variant: 'light',
      theme: {
        ...validTheme,
        semanticColors: {
          ...validTheme.semanticColors,
          diffAdded: '#12345g'
        }
      }
    })}`
  )

  assert.equal(result.ok, false)
})
