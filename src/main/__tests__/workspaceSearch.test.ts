import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { searchWorkspace } from '../workspaceSearch'

test('workspace search finds deep files beyond the old renderer crawl depth', async () => {
  const root = mkdtempWorkspace()
  try {
    const deepDir = join(root, 'src', 'main', 'java', 'com', 'example', 'payments', 'fixtures')
    mkdirSync(deepDir, { recursive: true })
    writeFileSync(join(deepDir, 'CbccPaymentBenefitExperienceContractTest.java'), 'class Test {}')

    const result = await searchWorkspace({ root, query: 'cbcc contract', limit: 10 })

    assert.equal(result.entries[0]?.path, 'src/main/java/com/example/payments/fixtures/CbccPaymentBenefitExperienceContractTest.java')
    assert.equal(result.entries[0]?.kind, 'file')
    assert.equal(result.truncated, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace search ignores generated and dependency directories', async () => {
  const root = mkdtempWorkspace()
  try {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, '.git', 'objects'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'needle.ts'), 'ignored')
    writeFileSync(join(root, '.git', 'needle'), 'ignored')
    writeFileSync(join(root, 'src', 'needle.ts'), 'kept')

    const result = await searchWorkspace({ root, query: 'needle', limit: 20 })

    assert.deepEqual(result.entries.map((entry) => entry.path), ['src/needle.ts'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace search ranks basename matches before path-only matches', async () => {
  const root = mkdtempWorkspace()
  try {
    mkdirSync(join(root, 'src', 'feature-search'), { recursive: true })
    mkdirSync(join(root, 'src', 'other'), { recursive: true })
    writeFileSync(join(root, 'src', 'feature-search', 'index.ts'), 'path only')
    writeFileSync(join(root, 'src', 'other', 'FeatureSearchPanel.tsx'), 'basename')

    const result = await searchWorkspace({ root, query: 'feature search', limit: 20 })

    assert.equal(result.entries[0]?.path, 'src/other/FeatureSearchPanel.tsx')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace search can return bounded text content matches with line metadata', async () => {
  const root = mkdtempWorkspace()
  try {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'reference.md'), [
      '# Reference',
      '',
      'The parity audit uses a content-only sentinel phrase here.'
    ].join('\n'))
    writeFileSync(join(root, 'docs', 'content-only-sentinel.md'), 'Filename should rank first\n')

    const result = await searchWorkspace({
      root,
      query: 'content only sentinel',
      includeContentMatches: true,
      limit: 20
    })

    assert.equal(result.entries[0]?.path, 'docs/content-only-sentinel.md')
    const contentMatch = result.entries.find((entry) => entry.path === 'docs/reference.md')
    assert.equal(contentMatch?.matchKind, 'content')
    assert.equal(contentMatch?.matchLine, 3)
    assert.match(contentMatch?.matchText ?? '', /content-only sentinel phrase/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace search returns a browsable directory listing for an empty query', async () => {
  const root = mkdtempWorkspace()
  try {
    mkdirSync(join(root, 'src', 'components'), { recursive: true })
    writeFileSync(join(root, 'README.md'), '# Readme')
    writeFileSync(join(root, 'src', 'components', 'Panel.tsx'), 'export {}')

    const result = await searchWorkspace({ root, query: '', limit: 20 })

    assert.deepEqual(result.entries.map((entry) => [entry.kind, entry.path]), [
      ['directory', 'src'],
      ['directory', 'src/components'],
      ['file', 'src/components/Panel.tsx'],
      ['file', 'README.md']
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace search can lazily load only expanded directories for browsing', async () => {
  const root = mkdtempWorkspace()
  try {
    mkdirSync(join(root, 'src', 'components'), { recursive: true })
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'README.md'), '# Readme')
    writeFileSync(join(root, 'src', 'components', 'Panel.tsx'), 'export {}')
    writeFileSync(join(root, 'docs', 'guide.md'), '# Guide')

    const collapsed = await searchWorkspace({
      root,
      host: 'local-workspace',
      query: '',
      includeDirectories: true,
      lazyDirectories: true,
      expandedDirectories: []
    })

    assert.deepEqual(collapsed.entries.map((entry) => [entry.kind, entry.path, entry.loaded]), [
      ['directory', 'docs', false],
      ['directory', 'src', false],
      ['file', 'README.md', undefined]
    ])
    assert.equal(collapsed.host, 'local-workspace')
    assert.equal(collapsed.entries.find((entry) => entry.path === 'src')?.hasChildren, true)

    const expanded = await searchWorkspace({
      root,
      query: '',
      includeDirectories: true,
      lazyDirectories: true,
      expandedDirectories: ['src']
    })

    assert.deepEqual(expanded.entries.map((entry) => [entry.kind, entry.path, entry.loaded]), [
      ['directory', 'docs', false],
      ['directory', 'src', true],
      ['directory', 'src/components', false],
      ['file', 'README.md', undefined]
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace search reports truncation when the result cap is reached', async () => {
  const root = mkdtempWorkspace()
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(join(root, 'src', `File${index}.ts`), 'export {}')
    }

    const result = await searchWorkspace({ root, query: 'file', limit: 5 })

    assert.equal(result.entries.length, 5)
    assert.equal(result.truncated, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function mkdtempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'orchestrator-workspace-search-'))
}
